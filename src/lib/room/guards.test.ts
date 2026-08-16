import { describe, expect, it } from "vitest";

import { fakeDb } from "@/test/fake-db";
import {
  canManage,
  publicGetOrganization,
  publicListOrganizations,
  removeOrgMember,
  slugify,
  updateCommunity,
  updateOrganization,
} from "./communities";
import { followRoom, unfollowRoom, type PersonalRoom } from "./personal";
import { addLike } from "./profile";
import { publicRoomView } from "./tools.personal";
import { publicProfileView } from "./tools.profile";
import { isPublicAction } from "./mcp.surface";
import { validateMessage } from "./validation";
import { profileCard, analyticsCard } from "./mcp.render";

const room: PersonalRoom = {
  roomId: "11111111-1111-4111-8111-111111111111",
  ownerSubjectHash: "owner-hash",
  handle: "owner",
  roomName: "Owner's Room",
  description: null,
  ownerAlias: "Owner",
  createdAt: new Date().toISOString(),
} as PersonalRoom;

describe("follow guards", () => {
  it("blocks following your own room", async () => {
    await expect(followRoom(fakeDb(), room, "owner-hash")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("never counts a duplicate follow twice", async () => {
    const db = fakeDb({ room_followers: { data: { id: "f1" }, count: 1 } });
    const result = await followRoom(db, room, "visitor-hash");
    expect(result.already).toBe(true);
    expect(result.followers).toBe(1);
  });

  it("unfollow keeps the follower count authoritative", async () => {
    const db = fakeDb({ room_followers: { data: null, count: 0 } });
    await expect(unfollowRoom(db, room, "visitor-hash")).resolves.toMatchObject({ followers: 0 });
  });
});

describe("like guards", () => {
  it("blocks liking your own content", async () => {
    await expect(addLike(fakeDb(), "me", "message", "1", "me", null)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("treats a unique violation as an existing like", async () => {
    const db = fakeDb({ content_likes: { error: { code: "23505" }, count: 1 } });
    const result = await addLike(db, "me", "message", "1", "other", null);
    expect(result.already).toBe(true);
    expect(result.likes).toBe(1);
  });
});

describe("communities and organizations", () => {
  it("computes management rights from ownership and org role", () => {
    expect(canManage({ myAccountId: "a", ownerAccountId: "a", orgRole: null })).toBe(true);
    expect(canManage({ myAccountId: "a", ownerAccountId: "b", orgRole: "admin" })).toBe(true);
    expect(canManage({ myAccountId: "a", ownerAccountId: "b", orgRole: "member" })).toBe(false);
    expect(canManage({ myAccountId: null, ownerAccountId: null, orgRole: null })).toBe(false);
  });

  it("builds stable, url-safe slugs", () => {
    expect(slugify("Berner Künstler & Freunde")).toBe("berner-kuenstler-freunde");
    expect(slugify("  ")).toBe("");
  });

  it("refuses removing the organization owner", async () => {
    const db = fakeDb({
      organizations: { data: { id: "org-1", owner_account_id: "acc-1", name: "Org", slug: "org" } },
      anonymous_identities: { data: { account_id: "acc-1" } },
      user_rooms: { data: { owner_subject_hash: "owner-hash" } },
    });
    await expect(removeOrgMember(db, "me", "org", "@owner")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses organization updates from non-managers", async () => {
    const db = fakeDb({
      organizations: {
        data: { id: "org-1", owner_account_id: "acc-owner", name: "Org", slug: "org" },
      },
      anonymous_identities: { data: { account_id: "acc-other" } },
      organization_members: { data: { role: "member" } },
    });
    await expect(updateOrganization(db, "me", "org", { name: "Hack" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses community updates from non-managers", async () => {
    const db = fakeDb({
      rooms: {
        data: {
          id: "22222222-2222-4222-8222-222222222222",
          slug: "community",
          title: "Community",
          description: null,
          organization_id: null,
          owner_account_id: "acc-owner",
          capacity: 5000,
          created_at: new Date().toISOString(),
        },
      },
      anonymous_identities: { data: { account_id: "acc-other" } },
      memberships: { data: null, count: 0 },
    });
    await expect(updateCommunity(db, "me", "community", { title: "Hack" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("content safety and rendering", () => {
  it("keeps message validation limits", () => {
    expect(() => validateMessage("", { maxLength: 500, maxLinks: 2 })).toThrow();
    expect(() => validateMessage("x".repeat(501), { maxLength: 500, maxLinks: 2 })).toThrow();
    expect(() =>
      validateMessage("a https://a.io https://b.io https://c.io", { maxLength: 500, maxLinks: 2 }),
    ).toThrow();
    expect(validateMessage("  hallo  ", { maxLength: 500, maxLinks: 2 })).toBe("hallo");
  });

  it("renders profile cards with real image markdown", () => {
    const card = profileCard({
      profile: {
        handle: "sam",
        display_name: "Sam",
        banner_image_url: "https://img/banner.jpg",
        profile_image_url: "https://img/avatar.jpg",
        followers: 3,
        following: 1,
        likes_received: 2,
        people_here_now: 1,
      },
      tabs: { messages: [], images: [] },
    });
    expect(card).toContain("![Banner von @sam](https://img/banner.jpg)");
    expect(card).toContain("![Profilbild von @sam](https://img/avatar.jpg)");
  });

  it("hides private profiles from visitors", () => {
    const card = profileCard({
      profile: { handle: "sam", visibility: "private", is_owner: false },
      message: "Dieses Profil ist privat.",
    });
    expect(card).toBe("Dieses Profil ist privat.");
  });

  it("renders analytics as a text chart", () => {
    const card = analyticsCard({ handle: "sam", range_days: 7, profile_views: 5, daily: [] });
    expect(card).toContain("Statistik für @sam");
    expect(card).toContain("```text");
  });
});

describe("public reads never write", () => {
  const WRITE_METHODS = ["insert", "update", "upsert", "delete"];

  it("keeps the public room view read-only", async () => {
    const db = fakeDb({
      user_rooms: {
        data: {
          room_id: "11111111-1111-4111-8111-111111111111",
          owner_subject_hash: "owner-hash",
          handle: "owner",
          room_name: "Owner's Room",
          description: null,
          created_at: new Date().toISOString(),
        },
      },
    });
    await publicRoomView(db, "owner").catch(() => undefined);
    expect(db.methods.filter((method: string) => WRITE_METHODS.includes(method))).toEqual([]);
    expect(db.methods.some((method: string) => method.startsWith("rpc:"))).toBe(false);
  });

  it("keeps the public profile view read-only", async () => {
    const db = fakeDb();
    await publicProfileView(db, "someone").catch(() => undefined);
    expect(db.methods.filter((method: string) => WRITE_METHODS.includes(method))).toEqual([]);
    expect(db.methods.some((method: string) => method.startsWith("rpc:"))).toBe(false);
  });

  it("keeps the public organization reads read-only and free of personal data", async () => {
    const row = {
      id: "22222222-2222-4222-8222-222222222222",
      slug: "acme",
      name: "Acme",
      description: "Public org",
      website: "https://acme.test",
      logo_path: null,
      verified: true,
      created_at: new Date().toISOString(),
      owner_account_id: "secret-account",
      suspended_at: null,
    };

    const listDb = fakeDb({ organizations: { data: [row] } });
    const orgs = await publicListOrganizations(listDb).catch(() => []);
    expect(listDb.methods.filter((method: string) => WRITE_METHODS.includes(method))).toEqual([]);
    for (const org of orgs) {
      expect(org.owner_account_id).toBeUndefined();
      expect(org.my_role).toBeUndefined();
      expect(org.is_member).toBeUndefined();
      expect(org.can_manage).toBeUndefined();
      expect(JSON.stringify(org)).not.toContain("secret-account");
    }

    const getDb = fakeDb({ organizations: { data: row } });
    const single = (await publicGetOrganization(getDb, "acme").catch(() => null));
    expect(getDb.methods.filter((method: string) => WRITE_METHODS.includes(method))).toEqual([]);
    expect(getDb.methods.some((method: string) => method.startsWith("rpc:"))).toBe(false);
    if (single) {
      expect(single.owner_account_id).toBeUndefined();
      expect(single.members).toBeUndefined();
      expect(JSON.stringify(single)).not.toContain("secret-account");
    }
  });

  it("serves the public organization actions without a token", async () => {
    for (const action of ["list_organizations", "get_organization"]) {
      expect(isPublicAction("communities_organizations", action)).toBe(true);
    }
  });
});
