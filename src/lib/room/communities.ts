/**
 * Communities and organizations.
 *
 * Communities are public rooms (`rooms.kind = 'community'`), optionally owned
 * by an organization. Every ownership, role and edit check runs server-side
 * against the pseudonymous subject from MCP `_meta` — never against input.
 * No prices, plans, billing, ads or campaigns are involved.
 */
import { generateAlias } from "./alias";
import { config } from "./config";
import { roomError } from "./errors";
import { encodeMessageId, encodeRoomId } from "./ids";
import { normalizeHandleInput } from "./personal";
import { countOnline, getCustomAlias, type Db } from "./store";
import { validateMessage } from "./validation";

const COMMUNITY_CAPACITY = 5000;
const COMMUNITY_TEXT_RETENTION = 100;

export type OrgRole = "owner" | "admin" | "member";

export function slugify(raw: string): string {
  const slug = String(raw ?? "")
    .toLowerCase()
    .normalize("NFC")
    // German umlauts transliterate before accents are stripped.
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug;
}

/** Pure permission rule, unit-testable without a database. */
export function canManage(input: {
  myAccountId: string | null;
  ownerAccountId: string | null;
  orgRole: OrgRole | null;
}): boolean {
  if (input.myAccountId && input.ownerAccountId && input.myAccountId === input.ownerAccountId)
    return true;
  return input.orgRole === "owner" || input.orgRole === "admin";
}

/* -------------------------------- accounts -------------------------------- */

/** Every pseudonymous subject can own organizations through a lazy account row. */
export async function ensureAccount(db: Db, subjectHash: string): Promise<string> {
  const { data: identity } = await db
    .from("anonymous_identities")
    .select("subject_hash, account_id, custom_alias")
    .eq("subject_hash", subjectHash)
    .maybeSingle();

  const existing = (identity as any)?.account_id as string | null | undefined;
  if (existing) return existing;

  const alias = (identity as any)?.custom_alias ?? generateAlias(`${subjectHash}:account`);
  const id = crypto.randomUUID();
  const { error } = await db.from("accounts").insert({ id, display_alias: alias });
  if (error) throw roomError("INTERNAL_ERROR");

  if (identity) {
    await db
      .from("anonymous_identities")
      .update({ account_id: id })
      .eq("subject_hash", subjectHash);
  } else {
    await db.from("anonymous_identities").insert({ subject_hash: subjectHash, account_id: id });
  }
  return id;
}

export async function accountIdFor(db: Db, subjectHash: string): Promise<string | null> {
  const { data } = await db
    .from("anonymous_identities")
    .select("account_id")
    .eq("subject_hash", subjectHash)
    .maybeSingle();
  return ((data as any)?.account_id as string | null) ?? null;
}

async function aliasFor(db: Db, subjectHash: string): Promise<string> {
  return (await getCustomAlias(db, subjectHash)) ?? generateAlias(`${subjectHash}:member`);
}

async function subjectHashForHandle(db: Db, rawHandle: unknown): Promise<string> {
  const handle = normalizeHandleInput(rawHandle);
  const { data } = await db
    .from("user_rooms")
    .select("owner_subject_hash")
    .ilike("handle", handle)
    .maybeSingle();
  if (!data) throw roomError("NOT_FOUND", `Ich finde kein Profil mit dem Handle @${handle}.`);
  return (data as any).owner_subject_hash as string;
}

/* ------------------------------ organizations ------------------------------ */

async function uniqueSlug(db: Db, table: "organizations" | "rooms", base: string): Promise<string> {
  const root = slugify(base) || "org";
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const { data } = await db.from(table).select("id").ilike("slug", candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function orgRoleOf(
  db: Db,
  organizationId: string,
  accountId: string | null,
): Promise<OrgRole | null> {
  if (!accountId) return null;
  const { data: org } = await db
    .from("organizations")
    .select("owner_account_id")
    .eq("id", organizationId)
    .maybeSingle();
  if ((org as any)?.owner_account_id === accountId) return "owner";

  const { data } = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("account_id", accountId)
    .maybeSingle();
  const role = (data as any)?.role as string | undefined;
  if (role === "owner" || role === "admin" || role === "member") return role;
  return role ? "member" : null;
}

function serializeOrg(row: any, role: OrgRole | null) {
  return {
    id: row.id as string,
    slug: row.slug as string | null,
    name: row.name as string,
    description: row.description ?? "",
    website: row.website ?? "",
    verified: Boolean(row.verified),
    created_at: row.created_at as string,
    my_role: role,
    can_manage: role === "owner" || role === "admin",
  };
}

export async function createOrganization(
  db: Db,
  subjectHash: string,
  input: { name: string; description?: string; website?: string; slug?: string },
) {
  const accountId = await ensureAccount(db, subjectHash);
  const slug = await uniqueSlug(db, "organizations", input.slug || input.name);

  const { data, error } = await db
    .from("organizations")
    .insert({
      owner_account_id: accountId,
      name: input.name.trim(),
      slug,
      description: input.description?.trim() ?? null,
      website: input.website?.trim() ?? null,
    })
    .select("*")
    .single();
  if (error || !data) throw roomError("INTERNAL_ERROR");

  await db
    .from("organization_members")
    .insert({ organization_id: (data as any).id, account_id: accountId, role: "owner" });

  return serializeOrg(data, "owner");
}

export async function listOrganizations(db: Db, subjectHash: string, limit = 50) {
  const accountId = await accountIdFor(db, subjectHash);
  const { data, error } = await db
    .from("organizations")
    .select("*")
    .is("suspended_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw roomError("INTERNAL_ERROR");

  const rows = (data ?? []) as any[];
  const out = [];
  for (const row of rows) out.push(serializeOrg(row, await orgRoleOf(db, row.id, accountId)));
  return out;
}

async function findOrg(db: Db, reference: string) {
  const value = String(reference ?? "")
    .trim()
    .replace(/^@/, "");
  if (!value) throw roomError("INVALID_INPUT");
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const query = db.from("organizations").select("*");
  const { data } = isUuid
    ? await query.eq("id", value).maybeSingle()
    : await query.ilike("slug", value).maybeSingle();
  if (!data) throw roomError("NOT_FOUND", "Diese Organisation gibt es nicht.");
  return data as any;
}

export async function getOrganization(db: Db, subjectHash: string, reference: string) {
  const org = await findOrg(db, reference);
  const accountId = await accountIdFor(db, subjectHash);
  const role = await orgRoleOf(db, org.id, accountId);

  const { data: communities } = await db
    .from("rooms")
    .select("id, slug, title, description, created_at")
    .eq("organization_id", org.id)
    .eq("kind", "community")
    .is("archived_at", null)
    .limit(50);

  const list = [];
  for (const room of (communities ?? []) as any[]) {
    list.push({
      id: await encodeRoomId(room.id),
      slug: room.slug,
      title: room.title,
      description: room.description ?? "",
    });
  }

  return { organization: serializeOrg(org, role), communities: list };
}

export async function updateOrganization(
  db: Db,
  subjectHash: string,
  reference: string,
  patch: { name?: string; description?: string; website?: string },
) {
  const org = await findOrg(db, reference);
  const accountId = await accountIdFor(db, subjectHash);
  const role = await orgRoleOf(db, org.id, accountId);
  if (!canManage({ myAccountId: accountId, ownerAccountId: org.owner_account_id, orgRole: role })) {
    throw roomError("FORBIDDEN", "Nur Besitzer oder Admins dürfen diese Organisation ändern.");
  }

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update["name"] = patch.name.trim();
  if (patch.description !== undefined) update["description"] = patch.description.trim() || null;
  if (patch.website !== undefined) update["website"] = patch.website.trim() || null;
  if (!Object.keys(update).length) return serializeOrg(org, role);

  const { data, error } = await db
    .from("organizations")
    .update(update)
    .eq("id", org.id)
    .select("*")
    .single();
  if (error || !data) throw roomError("INTERNAL_ERROR");
  return serializeOrg(data, role);
}

export async function listOrgMembers(db: Db, subjectHash: string, reference: string) {
  const org = await findOrg(db, reference);
  const accountId = await accountIdFor(db, subjectHash);
  const role = await orgRoleOf(db, org.id, accountId);

  const { data } = await db
    .from("organization_members")
    .select("account_id, role, created_at, accounts(display_alias)")
    .eq("organization_id", org.id)
    .order("created_at", { ascending: true })
    .limit(200);

  return {
    organization: serializeOrg(org, role),
    members: ((data ?? []) as any[]).map((row) => ({
      alias: row.accounts?.display_alias ?? "Mitglied",
      role: row.account_id === org.owner_account_id ? "owner" : (row.role as string),
      since: row.created_at as string,
      is_owner: row.account_id === org.owner_account_id,
    })),
  };
}

export async function addOrgMember(
  db: Db,
  subjectHash: string,
  reference: string,
  username: unknown,
  role: OrgRole,
) {
  const org = await findOrg(db, reference);
  const accountId = await accountIdFor(db, subjectHash);
  const myRole = await orgRoleOf(db, org.id, accountId);
  if (
    !canManage({ myAccountId: accountId, ownerAccountId: org.owner_account_id, orgRole: myRole })
  ) {
    throw roomError("FORBIDDEN", "Nur Besitzer oder Admins dürfen Mitglieder hinzufügen.");
  }

  const targetSubject = await subjectHashForHandle(db, username);
  const targetAccount = await ensureAccount(db, targetSubject);
  const safeRole: OrgRole = role === "owner" ? "admin" : role;

  const { data: existing } = await db
    .from("organization_members")
    .select("id")
    .eq("organization_id", org.id)
    .eq("account_id", targetAccount)
    .maybeSingle();

  if (existing) {
    await db
      .from("organization_members")
      .update({ role: safeRole })
      .eq("id", (existing as any).id);
  } else {
    const { error } = await db
      .from("organization_members")
      .insert({ organization_id: org.id, account_id: targetAccount, role: safeRole });
    if (error) throw roomError("INTERNAL_ERROR");
  }

  return {
    added: !existing,
    role: safeRole,
    alias: await aliasFor(db, targetSubject),
    organization: serializeOrg(org, myRole),
  };
}

export async function removeOrgMember(
  db: Db,
  subjectHash: string,
  reference: string,
  username: unknown,
) {
  const org = await findOrg(db, reference);
  const accountId = await accountIdFor(db, subjectHash);
  const myRole = await orgRoleOf(db, org.id, accountId);
  if (
    !canManage({ myAccountId: accountId, ownerAccountId: org.owner_account_id, orgRole: myRole })
  ) {
    throw roomError("FORBIDDEN", "Nur Besitzer oder Admins dürfen Mitglieder entfernen.");
  }

  const targetSubject = await subjectHashForHandle(db, username);
  const targetAccount = await accountIdFor(db, targetSubject);
  if (!targetAccount) throw roomError("NOT_FOUND", "Diese Person ist kein Mitglied.");
  if (targetAccount === org.owner_account_id) {
    throw roomError("FORBIDDEN", "Der Besitzer der Organisation kann nicht entfernt werden.");
  }

  await db
    .from("organization_members")
    .delete()
    .eq("organization_id", org.id)
    .eq("account_id", targetAccount);

  return {
    removed: true,
    alias: await aliasFor(db, targetSubject),
    organization: serializeOrg(org, myRole),
  };
}

/* ------------------------------- communities ------------------------------- */

export interface CommunityRow {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  organization_id: string | null;
  owner_account_id: string | null;
  capacity: number;
  created_at: string;
}

async function findCommunityRow(db: Db, reference: unknown): Promise<CommunityRow> {
  const raw = String(reference ?? "")
    .trim()
    .replace(/^@/, "");
  if (!raw) throw roomError("INVALID_INPUT");

  const { decodeRoomId } = await import("./ids");
  const decoded = await decodeRoomId(raw);
  const base = db
    .from("rooms")
    .select("id, slug, title, description, organization_id, owner_account_id, capacity, created_at")
    .eq("kind", "community")
    .is("archived_at", null);

  const { data } = decoded
    ? await base.eq("id", decoded).maybeSingle()
    : await base.ilike("slug", raw).maybeSingle();
  if (!data) throw roomError("NOT_FOUND", "Diese Community gibt es nicht.");
  return data as unknown as CommunityRow;
}

async function serializeCommunity(db: Db, row: CommunityRow, subjectHash: string) {
  const accountId = await accountIdFor(db, subjectHash);
  const role = row.organization_id ? await orgRoleOf(db, row.organization_id, accountId) : null;

  const { count } = await db
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("room_id", row.id)
    .is("left_at", null);

  const { data: mine } = await db
    .from("memberships")
    .select("id")
    .eq("room_id", row.id)
    .eq("subject_hash", subjectHash)
    .is("left_at", null)
    .maybeSingle();

  let organization: { id: string; name: string; slug: string | null } | null = null;
  if (row.organization_id) {
    const { data: org } = await db
      .from("organizations")
      .select("id, name, slug")
      .eq("id", row.organization_id)
      .maybeSingle();
    if (org) organization = org as any;
  }

  return {
    id: await encodeRoomId(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description ?? "",
    organization,
    members: count ?? 0,
    capacity: row.capacity,
    people_here_now: await countOnline(db, row.id),
    created_at: row.created_at,
    is_member: Boolean(mine),
    can_manage: canManage({
      myAccountId: accountId,
      ownerAccountId: row.owner_account_id,
      orgRole: role,
    }),
  };
}

export async function createCommunity(
  db: Db,
  subjectHash: string,
  input: { title: string; description?: string; organization?: string; slug?: string },
) {
  const accountId = await ensureAccount(db, subjectHash);

  let organizationId: string | null = null;
  if (input.organization) {
    const org = await findOrg(db, input.organization);
    const role = await orgRoleOf(db, org.id, accountId);
    if (
      !canManage({ myAccountId: accountId, ownerAccountId: org.owner_account_id, orgRole: role })
    ) {
      throw roomError(
        "FORBIDDEN",
        "Nur Besitzer oder Admins dürfen Communities dieser Organisation anlegen.",
      );
    }
    organizationId = org.id;
  }

  const slug = await uniqueSlug(db, "rooms", input.slug || input.title);
  const { data, error } = await db
    .from("rooms")
    .insert({
      topic_id: null,
      room_number: 1,
      kind: "community",
      visibility: "public",
      capacity: COMMUNITY_CAPACITY,
      title: input.title.trim(),
      description: input.description?.trim() ?? null,
      slug,
      owner_account_id: accountId,
      organization_id: organizationId,
      retention_texts: COMMUNITY_TEXT_RETENTION,
    })
    .select("id, slug, title, description, organization_id, owner_account_id, capacity, created_at")
    .single();
  if (error || !data) throw roomError("INTERNAL_ERROR");

  await joinCommunityRow(db, data as unknown as CommunityRow, subjectHash, "owner");
  return serializeCommunity(db, data as unknown as CommunityRow, subjectHash);
}

export async function listCommunities(
  db: Db,
  subjectHash: string,
  options: { query?: string; limit?: number } = {},
) {
  let request = db
    .from("rooms")
    .select("id, slug, title, description, organization_id, owner_account_id, capacity, created_at")
    .eq("kind", "community")
    .eq("visibility", "public")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 25, 1), 50));

  if (options.query) request = request.ilike("title", `%${options.query}%`);

  const { data, error } = await request;
  if (error) throw roomError("INTERNAL_ERROR");

  const out = [];
  for (const row of (data ?? []) as any[]) {
    out.push(await serializeCommunity(db, row as CommunityRow, subjectHash));
  }
  return out;
}

export async function getCommunity(db: Db, subjectHash: string, reference: unknown) {
  const row = await findCommunityRow(db, reference);
  return serializeCommunity(db, row, subjectHash);
}

export async function updateCommunity(
  db: Db,
  subjectHash: string,
  reference: unknown,
  patch: { title?: string; description?: string },
) {
  const row = await findCommunityRow(db, reference);
  const summary = await serializeCommunity(db, row, subjectHash);
  if (!summary.can_manage) {
    throw roomError(
      "FORBIDDEN",
      "Nur Besitzer oder autorisierte Organisationsmitglieder dürfen diese Community ändern.",
    );
  }

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update["title"] = patch.title.trim();
  if (patch.description !== undefined) update["description"] = patch.description.trim() || null;
  if (!Object.keys(update).length) return summary;

  const { data, error } = await db
    .from("rooms")
    .update(update)
    .eq("id", row.id)
    .select("id, slug, title, description, organization_id, owner_account_id, capacity, created_at")
    .single();
  if (error || !data) throw roomError("INTERNAL_ERROR");
  return serializeCommunity(db, data as unknown as CommunityRow, subjectHash);
}

async function joinCommunityRow(
  db: Db,
  row: CommunityRow,
  subjectHash: string,
  role: "owner" | "participant" = "participant",
) {
  const { data: existing } = await db
    .from("memberships")
    .select("id, alias")
    .eq("room_id", row.id)
    .eq("subject_hash", subjectHash)
    .is("left_at", null)
    .maybeSingle();

  if (existing) {
    await db
      .from("memberships")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", (existing as any).id);
    return {
      membershipId: (existing as any).id as string,
      alias: (existing as any).alias as string,
      joinedNow: false,
    };
  }

  const alias = await aliasFor(db, subjectHash);
  const { data, error } = await db
    .from("memberships")
    .insert({ room_id: row.id, topic_id: null, subject_hash: subjectHash, alias, role })
    .select("id, alias")
    .single();
  if (error || !data) throw roomError("ROOM_UNAVAILABLE");
  return {
    membershipId: (data as any).id as string,
    alias: (data as any).alias as string,
    joinedNow: true,
  };
}

export async function joinCommunity(db: Db, subjectHash: string, reference: unknown) {
  const row = await findCommunityRow(db, reference);
  const membership = await joinCommunityRow(db, row, subjectHash);
  return {
    community: await serializeCommunity(db, row, subjectHash),
    alias: membership.alias,
    joined_now: membership.joinedNow,
  };
}

export async function leaveCommunity(db: Db, subjectHash: string, reference: unknown) {
  const row = await findCommunityRow(db, reference);
  const { data } = await db
    .from("memberships")
    .update({ left_at: new Date().toISOString() })
    .eq("room_id", row.id)
    .eq("subject_hash", subjectHash)
    .is("left_at", null)
    .select("id");
  return {
    left: ((data ?? []) as any[]).length > 0,
    community: await serializeCommunity(db, row, subjectHash),
  };
}

export async function readCommunity(db: Db, subjectHash: string, reference: unknown, limit = 20) {
  const row = await findCommunityRow(db, reference);
  const { data, error } = await db
    .from("messages")
    .select("id, body, created_at, membership_id, memberships(alias, subject_hash)")
    .eq("room_id", row.id)
    .gt("expires_at", new Date().toISOString())
    .order("id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) throw roomError("INTERNAL_ERROR");

  const messages = [];
  for (const message of ((data ?? []) as any[]).reverse()) {
    messages.push({
      id: await encodeMessageId(message.id),
      alias: message.memberships?.alias ?? "Unbekannt",
      text: message.body as string,
      created_at: new Date(message.created_at).toISOString(),
      is_self: message.memberships?.subject_hash === subjectHash,
    });
  }

  return { community: await serializeCommunity(db, row, subjectHash), messages };
}

export async function sendCommunityMessage(
  db: Db,
  subjectHash: string,
  reference: unknown,
  rawText: unknown,
) {
  const row = await findCommunityRow(db, reference);
  const membership = await joinCommunityRow(db, row, subjectHash);
  const settings = config();
  const body = validateMessage(rawText, {
    maxLength: settings.maxMessageLength,
    maxLinks: settings.maxLinksPerMessage,
  });

  const { enforceRateLimit, WINDOWS } = await import("./ratelimit");
  await enforceRateLimit(
    db,
    subjectHash,
    "message",
    WINDOWS.message(settings.rateLimitPerMinute, settings.rateLimitPerHour),
  );

  const now = new Date();
  const { error } = await db.from("messages").insert({
    room_id: row.id,
    membership_id: membership.membershipId,
    body,
    created_at: now.toISOString(),
    expires_at: new Date(
      now.getTime() + settings.messageRetentionHours * 3600 * 1000,
    ).toISOString(),
  });
  if (error) throw roomError("INTERNAL_ERROR");

  await db.rpc("enforce_text_retention", { p_room_id: row.id });
  const read = await readCommunity(db, subjectHash, reference);
  return { sent: true, ...read };
}
