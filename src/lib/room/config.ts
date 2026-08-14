/**
 * Runtime configuration for the @room MCP server.
 * All values are read lazily inside functions — never at module scope —
 * because the Worker runtime injects env per request.
 */

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function num(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const SERVICE_NAME = "room-mcp";
export const SERVICE_VERSION = "1.0.0";

export function config() {
  return {
    messageRetentionHours: num("MESSAGE_RETENTION_HOURS", 24),
    maxRoomMembers: num("MAX_ROOM_MEMBERS", 5),
    maxMessageLength: num("MAX_MESSAGE_LENGTH", 500),
    rateLimitPerMinute: num("RATE_LIMIT_PER_MINUTE", 10),
    rateLimitPerHour: num("RATE_LIMIT_PER_HOUR", 100),
    joinLimitPerHour: num("JOIN_LIMIT_PER_HOUR", 10),
    reportLimitPerHour: num("REPORT_LIMIT_PER_HOUR", 5),
    maxLinksPerMessage: num("MAX_LINKS_PER_MESSAGE", 2),
    publicMcpBaseUrl: env("PUBLIC_MCP_BASE_URL") ?? "",
  };
}

export function requireSecret(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Per-room retention: only the newest N items survive. */
export const TEXT_RETENTION = 7;
export const IMAGE_RETENTION = 3;

export const IMAGE_BUCKET = "room-images";

export function imageConfig() {
  return {
    maxImageBytes: num("MAX_IMAGE_BYTES", 10 * 1024 * 1024),
    uploadLimitPerHour: num("UPLOAD_LIMIT_PER_HOUR", 10),
    uploadTokenTtlSeconds: num("UPLOAD_TOKEN_TTL_SECONDS", 900),
    reviewTokenTtlSeconds: num("REVIEW_TOKEN_TTL_SECONDS", 900),
    signedUrlTtlSeconds: num("SIGNED_URL_TTL_SECONDS", 300),
  };
}
