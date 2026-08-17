/**
 * Crawler Room OAuth 2.1 authorization server (self-hosted).
 *
 * Everything an MCP client needs runs inside this app on Lovable Cloud:
 * discovery (RFC 8414), dynamic client registration (RFC 7591), the
 * authorization-code flow with mandatory PKCE S256, resource indicators
 * (RFC 8707) and rotating refresh tokens. There is no external identity
 * provider and no platform auth hook.
 *
 * SECURITY
 * - PKCE `S256` is mandatory; `plain` is rejected.
 * - Authorization codes are single-use, 60 s lived and stored only as SHA-256
 *   digests, bound to client, redirect URI, resource and code challenge.
 * - Refresh tokens are opaque, hashed at rest and rotated on every use; a
 *   replayed refresh token revokes the whole chain.
 * - Redirect URIs are compared byte-for-byte against the registration; no
 *   prefix, wildcard or "same origin" matching.
 * - Access tokens are short-lived signed JWTs bound to the canonical MCP
 *   resource. Nothing about them is stored server-side.
 */
import { canonicalResource } from "../auth";
import { sha256Hex } from "../crypto";
import { roomError } from "../errors";
import { getDb, type Db } from "../store";
import { signJwt, type JwtClaims } from "./jwt";
import { negotiateScopes, parseScope, SUPPORTED_SCOPES } from "./scopes";

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
const CODE_TTL_SECONDS = 60;
const AUTH_REQUEST_TTL_SECONDS = 600;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600;
const MAX_REDIRECT_URIS = 10;

export interface OAuthFailure {
  error: string;
  error_description: string;
  status: number;
}

export function oauthFailure(error: string, description: string, status = 400): OAuthFailure {
  return { error, error_description: description, status };
}

export function isOAuthFailure(value: unknown): value is OAuthFailure {
  return Boolean(value) && typeof (value as OAuthFailure).error === "string";
}

/* -------------------------------- discovery ------------------------------- */

/** Issuer of this authorization server: always the canonical app origin. */
export function oauthIssuer(requestOrigin?: string): string {
  return new URL(canonicalResource(requestOrigin)).origin;
}

export function authorizationServerMetadata(requestOrigin?: string) {
  const issuer = oauthIssuer(requestOrigin);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    scopes_supported: [...SUPPORTED_SCOPES],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    // RFC 8707 — the MCP endpoint is the only resource this server issues for.
    resource_indicators_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${issuer}/crawler-room`,
    op_policy_uri: `${issuer}/privacy`,
    op_tos_uri: `${issuer}/terms`,
  };
}

/* --------------------------------- helpers -------------------------------- */

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const encoder = new TextEncoder();

async function digest(value: string): Promise<string> {
  return sha256Hex(encoder.encode(value));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(hash)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A redirect URI is acceptable when it is HTTPS, a loopback HTTP URL, or a
 * private-use scheme (native clients). Nothing else, and never a URL with a
 * fragment or embedded credentials.
 */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  // Private-use scheme, e.g. `com.example.app:/callback`.
  return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol) && url.protocol !== "javascript:";
}

function isoIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/* --------------------------- client registration -------------------------- */

export interface RegisteredClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  scope: string;
  client_id_issued_at: number;
  client_secret?: string;
}

export async function registerClient(
  body: unknown,
  db?: Db,
): Promise<RegisteredClient | OAuthFailure> {
  const payload = (body ?? {}) as Record<string, unknown>;
  const redirectUris = Array.isArray(payload["redirect_uris"]) ? payload["redirect_uris"] : [];
  if (redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
    return oauthFailure("invalid_redirect_uri", "redirect_uris must contain 1-10 entries.");
  }
  if (!redirectUris.every(isAllowedRedirectUri)) {
    return oauthFailure(
      "invalid_redirect_uri",
      "Every redirect_uri must be https, a loopback URL or a private-use scheme.",
    );
  }
  const name = typeof payload["client_name"] === "string" ? payload["client_name"].trim() : "";
  const clientName = (name || "MCP client").slice(0, 120);
  const clientUri = typeof payload["client_uri"] === "string" ? payload["client_uri"] : null;
  const authMethod =
    payload["token_endpoint_auth_method"] === "client_secret_post" ? "client_secret_post" : "none";
  const scope = negotiateScopes(payload["scope"]).join(" ");

  const clientId = `crc_${randomToken(16)}`;
  const secret = authMethod === "client_secret_post" ? randomToken(32) : null;

  const database = db ?? (await getDb());
  const { error } = await database.from("oauth_clients").insert({
    client_id: clientId,
    client_secret_hash: secret ? await digest(secret) : null,
    client_name: clientName,
    client_uri: clientUri && /^https:\/\//i.test(clientUri) ? clientUri : null,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: authMethod,
    scope,
  });
  if (error) throw roomError("INTERNAL_ERROR");

  return {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris as string[],
    token_endpoint_auth_method: authMethod,
    scope,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret } : {}),
  };
}

interface ClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string;
  client_uri: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  scope: string;
}

async function loadClient(db: Db, clientId: unknown): Promise<ClientRow | null> {
  if (typeof clientId !== "string" || !clientId.trim()) return null;
  const { data, error } = await db
    .from("oauth_clients")
    .select(
      "client_id, client_secret_hash, client_name, client_uri, redirect_uris, token_endpoint_auth_method, scope",
    )
    .eq("client_id", clientId.trim())
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  return (data as ClientRow | null) ?? null;
}

/* ----------------------------- authorize step ----------------------------- */

export interface AuthorizeParams {
  client_id?: unknown;
  redirect_uri?: unknown;
  response_type?: unknown;
  scope?: unknown;
  state?: unknown;
  code_challenge?: unknown;
  code_challenge_method?: unknown;
  resource?: unknown;
}

export interface AuthorizeAccepted {
  requestId: string;
  clientName: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * Validates an authorization request and parks it in the database. Nothing is
 * granted here: the consent step decides. Errors that cannot be safely
 * redirected (unknown client / bad redirect URI) are returned to the caller.
 */
export async function beginAuthorization(
  params: AuthorizeParams,
  requestOrigin?: string,
  db?: Db,
): Promise<AuthorizeAccepted | OAuthFailure> {
  const database = db ?? (await getDb());
  const client = await loadClient(database, params.client_id);
  if (!client) return oauthFailure("invalid_client", "Unknown client_id.", 400);

  const redirectUri = typeof params.redirect_uri === "string" ? params.redirect_uri : "";
  if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
    return oauthFailure("invalid_request", "redirect_uri is not registered for this client.", 400);
  }
  if (params.response_type !== "code") {
    return oauthFailure("unsupported_response_type", "Only response_type=code is supported.");
  }
  if (params.code_challenge_method !== "S256") {
    return oauthFailure("invalid_request", "code_challenge_method must be S256.");
  }
  const challenge = typeof params.code_challenge === "string" ? params.code_challenge.trim() : "";
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(challenge)) {
    return oauthFailure("invalid_request", "code_challenge is missing or malformed.");
  }

  const resource = canonicalResource(requestOrigin);
  if (typeof params.resource === "string" && params.resource.trim()) {
    if (params.resource.trim().replace(/\/+$/, "") !== resource) {
      return oauthFailure("invalid_target", "This server only issues tokens for its MCP resource.");
    }
  }

  const scopes = negotiateScopes(params.scope);
  const state = typeof params.state === "string" ? params.state.slice(0, 512) : null;
  const requestId = `req_${randomToken(24)}`;

  const { error } = await database.from("oauth_auth_requests").insert({
    id: requestId,
    client_id: client.client_id,
    redirect_uri: redirectUri,
    state,
    scope: scopes.join(" "),
    resource,
    code_challenge: challenge,
    code_challenge_method: "S256",
    status: "pending",
    expires_at: isoIn(AUTH_REQUEST_TTL_SECONDS),
  });
  if (error) throw roomError("INTERNAL_ERROR");

  return {
    requestId,
    clientName: client.client_name,
    redirectUri,
    scopes,
  };
}

interface AuthRequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  scope: string;
  resource: string;
  code_challenge: string;
  status: string;
  expires_at: string;
}

async function loadAuthRequest(db: Db, requestId: unknown): Promise<AuthRequestRow | null> {
  if (typeof requestId !== "string" || !requestId.startsWith("req_")) return null;
  const { data, error } = await db
    .from("oauth_auth_requests")
    .select(
      "id, client_id, redirect_uri, state, scope, resource, code_challenge, status, expires_at",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw roomError("INTERNAL_ERROR");
  const row = (data as AuthRequestRow | null) ?? null;
  if (!row) return null;
  if (row.status !== "pending") return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

export interface ConsentDetails {
  request_id: string;
  client_name: string;
  client_uri: string | null;
  redirect_uri: string;
  scopes: string[];
  resource: string;
  expires_at: string;
}

export async function consentDetails(
  requestId: unknown,
  db?: Db,
): Promise<ConsentDetails | OAuthFailure> {
  const database = db ?? (await getDb());
  const request = await loadAuthRequest(database, requestId);
  if (!request) return oauthFailure("invalid_request", "Diese Anfrage ist abgelaufen.", 404);
  const client = await loadClient(database, request.client_id);
  return {
    request_id: request.id,
    client_name: client?.client_name ?? "Die verbundene Anwendung",
    client_uri: client?.client_uri ?? null,
    redirect_uri: request.redirect_uri,
    scopes: parseScope(request.scope),
    resource: request.resource,
    expires_at: request.expires_at,
  };
}

/**
 * Records the person's decision. `subjectId` is the *pseudonymous* identifier
 * of the browser session — the raw account id never enters this module.
 */
export async function decideAuthorization(
  requestId: unknown,
  decision: "approve" | "deny",
  subjectId: string,
  db?: Db,
): Promise<{ redirect_url: string } | OAuthFailure> {
  const database = db ?? (await getDb());
  const request = await loadAuthRequest(database, requestId);
  if (!request) return oauthFailure("invalid_request", "Diese Anfrage ist abgelaufen.", 404);

  const target = new URL(request.redirect_uri);
  if (request.state) target.searchParams.set("state", request.state);
  target.searchParams.set("iss", oauthIssuer());

  if (decision === "deny") {
    await database
      .from("oauth_auth_requests")
      .update({ status: "denied" })
      .eq("id", request.id)
      .eq("status", "pending");
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_description", "The person declined the connection.");
    return { redirect_url: target.toString() };
  }

  const code = randomToken(32);
  const { error: codeError } = await database.from("oauth_codes").insert({
    code_hash: await digest(code),
    client_id: request.client_id,
    redirect_uri: request.redirect_uri,
    scope: request.scope,
    resource: request.resource,
    code_challenge: request.code_challenge,
    subject_id: subjectId,
    expires_at: isoIn(CODE_TTL_SECONDS),
  });
  if (codeError) throw roomError("INTERNAL_ERROR");

  // Single-use: consuming the request closes it for any concurrent replay.
  const { data: closed, error: closeError } = await database
    .from("oauth_auth_requests")
    .update({ status: "approved" })
    .eq("id", request.id)
    .eq("status", "pending")
    .select("id");
  if (closeError || !closed || (closed as unknown[]).length === 0) {
    return oauthFailure("invalid_request", "Diese Anfrage wurde bereits verwendet.", 409);
  }

  target.searchParams.set("code", code);
  return { redirect_url: target.toString() };
}

/* -------------------------------- token step ------------------------------ */

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issueTokens(
  db: Db,
  input: { clientId: string; subjectId: string; scope: string; resource: string },
): Promise<TokenResponse> {
  const now = Math.floor(Date.now() / 1000);
  const claims: JwtClaims = {
    iss: new URL(input.resource).origin,
    sub: input.subjectId,
    aud: input.resource,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    iat: now,
    jti: randomToken(16),
    client_id: input.clientId,
    scope: input.scope,
    // RFC 8707 echo, kept for clients that inspect the binding themselves.
    resource: input.resource,
  };
  const accessToken = await signJwt(claims);

  const refresh = randomToken(32);
  const { error } = await db.from("oauth_refresh_tokens").insert({
    token_hash: await digest(refresh),
    client_id: input.clientId,
    subject_id: input.subjectId,
    scope: input.scope,
    resource: input.resource,
    expires_at: isoIn(REFRESH_TOKEN_TTL_SECONDS),
  });
  if (error) throw roomError("INTERNAL_ERROR");

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refresh,
    scope: input.scope,
  };
}

async function authenticateClient(
  db: Db,
  form: Record<string, string>,
): Promise<ClientRow | OAuthFailure> {
  const client = await loadClient(db, form["client_id"]);
  if (!client) return oauthFailure("invalid_client", "Unknown client_id.", 401);
  if (client.token_endpoint_auth_method === "client_secret_post") {
    const secret = form["client_secret"] ?? "";
    if (!secret || !client.client_secret_hash) {
      return oauthFailure("invalid_client", "client_secret is required.", 401);
    }
    if ((await digest(secret)) !== client.client_secret_hash) {
      return oauthFailure("invalid_client", "client_secret is wrong.", 401);
    }
  }
  return client;
}

export async function exchangeToken(
  form: Record<string, string>,
  requestOrigin?: string,
  db?: Db,
): Promise<TokenResponse | OAuthFailure> {
  const database = db ?? (await getDb());
  const client = await authenticateClient(database, form);
  if (isOAuthFailure(client)) return client;

  const resource = canonicalResource(requestOrigin);
  const requestedResource = (form["resource"] ?? "").trim().replace(/\/+$/, "");
  if (requestedResource && requestedResource !== resource) {
    return oauthFailure("invalid_target", "This server only issues tokens for its MCP resource.");
  }

  if (form["grant_type"] === "authorization_code") {
    const code = form["code"] ?? "";
    const verifier = form["code_verifier"] ?? "";
    if (!code || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) {
      return oauthFailure("invalid_grant", "code and a valid code_verifier are required.");
    }
    const codeHash = await digest(code);
    const { data, error } = await database
      .from("oauth_codes")
      .select(
        "code_hash, client_id, redirect_uri, scope, resource, code_challenge, subject_id, expires_at, used_at",
      )
      .eq("code_hash", codeHash)
      .maybeSingle();
    if (error) throw roomError("INTERNAL_ERROR");
    const row = data as {
      client_id: string;
      redirect_uri: string;
      scope: string;
      resource: string;
      code_challenge: string;
      subject_id: string;
      expires_at: string;
      used_at: string | null;
    } | null;
    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      return oauthFailure("invalid_grant", "The authorization code is invalid or expired.");
    }
    if (row.client_id !== client.client_id) {
      return oauthFailure("invalid_grant", "The authorization code belongs to another client.");
    }
    if ((form["redirect_uri"] ?? "") !== row.redirect_uri) {
      return oauthFailure("invalid_grant", "redirect_uri does not match the authorization.");
    }
    if ((await pkceChallenge(verifier)) !== row.code_challenge) {
      return oauthFailure("invalid_grant", "PKCE verification failed.");
    }

    // Atomic single use: only the first exchange flips `used_at`.
    const { data: consumed, error: consumeError } = await database
      .from("oauth_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code_hash", codeHash)
      .is("used_at", null)
      .select("code_hash");
    if (consumeError) throw roomError("INTERNAL_ERROR");
    if (!consumed || (consumed as unknown[]).length === 0) {
      return oauthFailure("invalid_grant", "This authorization code was already used.");
    }

    return issueTokens(database, {
      clientId: client.client_id,
      subjectId: row.subject_id,
      scope: row.scope,
      resource: row.resource,
    });
  }

  if (form["grant_type"] === "refresh_token") {
    const refresh = form["refresh_token"] ?? "";
    if (!refresh) return oauthFailure("invalid_grant", "refresh_token is required.");
    const hash = await digest(refresh);
    const { data, error } = await database
      .from("oauth_refresh_tokens")
      .select(
        "token_hash, client_id, subject_id, scope, resource, expires_at, revoked_at, replaced_by",
      )
      .eq("token_hash", hash)
      .maybeSingle();
    if (error) throw roomError("INTERNAL_ERROR");
    const row = data as {
      client_id: string;
      subject_id: string;
      scope: string;
      resource: string;
      expires_at: string;
      revoked_at: string | null;
    } | null;
    if (!row) return oauthFailure("invalid_grant", "Unknown refresh token.");
    if (row.client_id !== client.client_id) {
      return oauthFailure("invalid_grant", "This refresh token belongs to another client.");
    }
    if (row.revoked_at) {
      // Replay of a rotated token: revoke every token of this subject/client.
      await database
        .from("oauth_refresh_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("subject_id", row.subject_id)
        .eq("client_id", row.client_id)
        .is("revoked_at", null);
      return oauthFailure("invalid_grant", "This refresh token was already rotated.");
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      return oauthFailure("invalid_grant", "The refresh token is expired.");
    }

    const requestedScopes = parseScope(form["scope"]);
    const granted = parseScope(row.scope);
    // Down-scoping is allowed, widening never is.
    const scope = requestedScopes.length
      ? granted.filter((entry) => requestedScopes.includes(entry))
      : granted;
    if (scope.length === 0) return oauthFailure("invalid_scope", "No scope left to grant.");

    const tokens = await issueTokens(database, {
      clientId: client.client_id,
      subjectId: row.subject_id,
      scope: scope.join(" "),
      resource: row.resource,
    });
    const { error: rotateError } = await database
      .from("oauth_refresh_tokens")
      .update({
        revoked_at: new Date().toISOString(),
        replaced_by: await digest(tokens.refresh_token),
      })
      .eq("token_hash", hash)
      .is("revoked_at", null);
    if (rotateError) throw roomError("INTERNAL_ERROR");
    return tokens;
  }

  return oauthFailure("unsupported_grant_type", "Only authorization_code and refresh_token.");
}
