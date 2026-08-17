/**
 * Canonical action / side-effect matrix of the seven public Crawler Room tools.
 *
 * This file is the single source of truth for the MCP tool annotations. Every
 * action of every tool is classified once:
 *
 * - `write`       — the action changes stored state (never side-effect free).
 * - `publicEffect` — the result becomes visible to other people (public post,
 *                    like, follow, public profile/room/community change) or an
 *                    external resource is contacted. Drives `openWorldHint`.
 * - `destructive` — the action removes, blocks or irreversibly replaces state.
 *
 * The annotations are derived, never hand-written, so a new action cannot
 * silently make a tool look read-only or non-destructive. Contract tests in
 * `annotations.test.ts` verify that the matrix covers exactly the actions the
 * input schemas accept.
 */
export interface ActionEffect {
  write: boolean;
  publicEffect: boolean;
  destructive: boolean;
}

const READ: ActionEffect = { write: false, publicEffect: false, destructive: false };
const WRITE: ActionEffect = { write: true, publicEffect: false, destructive: false };
const PUBLIC_WRITE: ActionEffect = { write: true, publicEffect: true, destructive: false };
const DESTRUCTIVE: ActionEffect = { write: true, publicEffect: false, destructive: true };
const PUBLIC_DESTRUCTIVE: ActionEffect = { write: true, publicEffect: true, destructive: true };

export const ACTION_MATRIX: Record<string, Record<string, ActionEffect>> = {
  universal_room: {
    // Joining records a membership/presence row but publishes nothing.
    enter: WRITE,
    read: READ,
    // A message becomes publicly readable for everyone.
    send: PUBLIC_WRITE,
    // A report is stored for moderation; nothing is deleted by one report.
    report: WRITE,
  },
  public_room: {
    mine: READ,
    open: READ,
    update: PUBLIC_WRITE,
    // Leaving removes the membership.
    leave: DESTRUCTIVE,
    send: PUBLIC_WRITE,
    report: WRITE,
  },
  profile: {
    get: READ,
    update: PUBLIC_WRITE,
    // The current public identifier changes. The previous handle stays reserved
    // for the same owner and redirects to them; it never becomes claimable by
    // anyone else. Destructive only in the sense that the public name changes.
    change_handle: PUBLIC_DESTRUCTIVE,
    // Fetches an external image URL and publishes the result.
    set_image: PUBLIC_WRITE,
    // Follows an external link target and counts the click.
    open_link: PUBLIC_WRITE,
    // Blocking removes the mutual interaction possibility.
    block: DESTRUCTIVE,
    unblock: WRITE,
    list_blocks: READ,
    report: WRITE,
  },
  followers_notifications: {
    // Following is a publicly visible interaction with another person's room.
    follow: PUBLIC_WRITE,
    unfollow: PUBLIC_DESTRUCTIVE,
    list_followers: READ,
    list_following: READ,
    list_notifications: READ,
    update_settings: WRITE,
  },
  likes: {
    // A like is publicly visible on the liked content.
    like: PUBLIC_WRITE,
    unlike: PUBLIC_DESTRUCTIVE,
  },
  analytics: {
    profile: READ,
  },
  communities_organizations: {
    list_communities: READ,
    get_community: READ,
    create_community: PUBLIC_WRITE,
    update_community: PUBLIC_WRITE,
    join_community: PUBLIC_WRITE,
    leave_community: PUBLIC_DESTRUCTIVE,
    read_community: READ,
    send_community: PUBLIC_WRITE,
    list_organizations: READ,
    get_organization: READ,
    create_organization: PUBLIC_WRITE,
    update_organization: PUBLIC_WRITE,
    list_members: READ,
    add_member: PUBLIC_WRITE,
    remove_member: PUBLIC_DESTRUCTIVE,
    report: WRITE,
  },
};

export interface ToolAnnotations extends Record<string, unknown> {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
  idempotentHint: boolean;
}

/** Derives the conservative MCP annotations of one tool from its actions. */
export function annotationsFor(tool: string): ToolAnnotations {
  const actions = Object.values(ACTION_MATRIX[tool] ?? {});
  if (actions.length === 0) throw new Error(`no action matrix for tool «${tool}»`);
  const readOnly = actions.every((effect) => !effect.write);
  return {
    readOnlyHint: readOnly,
    destructiveHint: actions.some((effect) => effect.destructive),
    openWorldHint: actions.some((effect) => effect.publicEffect),
    // Only a fully read-only tool may claim idempotency.
    idempotentHint: readOnly,
  };
}
