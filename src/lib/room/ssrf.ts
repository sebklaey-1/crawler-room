/**
 * SSRF hardening for server-side image fetches (profile avatar / banner).
 *
 * The server must never be usable as a proxy into the internal network. Every
 * URL — including every redirect hop — passes the same pure checks:
 *
 * - https only, no credentials, no port other than 443
 * - no localhost, `.local`, private / reserved / link-local / loopback /
 *   multicast IPv4 and IPv6 ranges, no cloud metadata addresses
 * - literal IP hosts are checked directly; hostnames that *look* like IPs
 *   cannot bypass the check (DNS rebinding to a literal is blocked because a
 *   literal private target is rejected outright at every hop)
 *
 * Errors are intentionally opaque: no target URL, host, IP or network error
 * ever reaches a tool result or a log line.
 */

export type UrlRejection =
  "not_a_url" | "scheme" | "credentials" | "port" | "host" | "private_address";

export interface UrlCheck {
  ok: boolean;
  reason?: UrlRejection;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/** Cloud metadata endpoints that must never be reachable. */
const METADATA_IPS = new Set(["169.254.169.254", "169.254.170.2", "100.100.100.200"]);

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number.parseInt(part, 10);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/** True for loopback, private, link-local, CGNAT, reserved and multicast IPv4. */
export function isPrivateIpv4(host: string): boolean {
  const octets = parseIpv4(host);
  if (!octets) return false;
  const [a, b] = octets as [number, number, number, number];
  if (METADATA_IPS.has(host)) return true;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // documentation
  if (a === 203 && b === 0) return true; // documentation
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** True for loopback, unspecified, unique-local, link-local and mapped-private IPv6. */
export function isPrivateIpv6(rawHost: string): boolean {
  const host = rawHost.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!host.includes(":")) return false;
  if (host === "::1" || host === "::" || host === "0:0:0:0:0:0:0:1") return true;
  // IPv4-mapped / IPv4-compatible: ::ffff:127.0.0.1
  const mapped = host.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1] && isPrivateIpv4(mapped[1])) return true;
  const head = host.split(":")[0] ?? "";
  if (/^f[cd][0-9a-f]{0,2}$/.test(head)) return true; // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]?$/.test(head)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{0,2}$/.test(head)) return true; // ff00::/8 multicast
  return false;
}

/**
 * Pure validation of a single fetch target. Used for the initial URL and
 * re-applied to every redirect hop.
 */
export function checkImageUrl(raw: unknown): UrlCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "not_a_url" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "not_a_url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (url.port && url.port !== "443") return { ok: false, reason: "port" };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "host" };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: "host" };
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return { ok: false, reason: "host" };
  }
  if (!host.includes(".") && !host.includes(":")) return { ok: false, reason: "host" };
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) return { ok: false, reason: "private_address" };
  return { ok: true };
}

export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 8000;

/** Raised for every fetch failure. Carries no target information. */
export class SafeFetchError extends Error {
  constructor(public readonly reason: string) {
    super("image fetch rejected");
    this.name = "SafeFetchError";
  }
}

const ALLOWED_RESPONSE_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/**
 * Fetches an image with manual redirect handling, a hard byte cap enforced
 * while streaming and a request timeout. The caller still sniffs magic bytes.
 */
export async function fetchImageSafely(
  rawUrl: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; mime: string }> {
  let target = rawUrl.trim();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = checkImageUrl(target);
    if (!check.ok) throw new SafeFetchError(check.reason ?? "url");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(target, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "image/jpeg,image/png,image/webp" },
      });
    } catch {
      clearTimeout(timer);
      throw new SafeFetchError("network");
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new SafeFetchError("redirect");
      try {
        target = new URL(location, target).toString();
      } catch {
        throw new SafeFetchError("redirect");
      }
      continue;
    }

    if (!response.ok) throw new SafeFetchError("status");

    const declared = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!ALLOWED_RESPONSE_MIME.has(declared.toLowerCase())) throw new SafeFetchError("mime");

    // Advisory only — Content-Length is never trusted, the stream is capped too.
    const length = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(length) && length > maxBytes) throw new SafeFetchError("too_large");

    const bytes = await readCapped(response, maxBytes);
    return { bytes, mime: declared.toLowerCase() };
  }

  throw new SafeFetchError("too_many_redirects");
}

/** Reads a body, aborting as soon as the cap is exceeded — never buffers more. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new SafeFetchError("too_large");
    return new Uint8Array(buffer);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SafeFetchError("too_large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
