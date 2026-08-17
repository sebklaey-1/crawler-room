/**
 * Canonical action / side-effect matrix of the single public Crawler Room tool.
 *
 * - `write`        — the action changes stored state.
 * - `publicEffect` — the result becomes visible to other people.
 * - `destructive`  — the action removes or irreversibly replaces state.
 */
export interface ActionEffect {
  write: boolean;
  publicEffect: boolean;
  destructive: boolean;
}

const READ: ActionEffect = { write: false, publicEffect: false, destructive: false };
const WRITE: ActionEffect = { write: true, publicEffect: false, destructive: false };
const PUBLIC_WRITE: ActionEffect = { write: true, publicEffect: true, destructive: false };

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
    idempotentHint: readOnly,
  };
}
