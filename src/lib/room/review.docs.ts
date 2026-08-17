/**
 * Machine-generated review documentation blocks.
 *
 * The canonical source of the public MCP contract is
 * `src/lib/room/actions.matrix.ts` plus the live input schemas in
 * `src/lib/room/mcp.surface.ts`. Every review / submission document embeds the
 * derived tables between generated markers instead of restating them by hand,
 * so a stale document is a test failure rather than a review risk.
 *
 * Regenerate with `bun run docs:review`. Verified by `review-docs.test.ts` and
 * by `release:check`.
 */
import { ACTION_MATRIX } from "./actions.matrix";
import { PUBLIC_ACTIONS, SURFACE_TOOLS, TOOL_ANNOTATIONS } from "./mcp.surface";

export type GeneratedBlockId = "tool-actions" | "tool-annotations" | "tool-scopes" | "tool-detail";

export const GENERATED_BLOCK_IDS: GeneratedBlockId[] = [
  "tool-actions",
  "tool-annotations",
  "tool-scopes",
  "tool-detail",
];

/** Documents that embed at least one generated block. */
export const GENERATED_DOCS = [
  "docs/openai-review-checklist.md",
  "docs/openai-plugin-submission.md",
  "docs/openai-submission-ready.md",
  "docs/reviewer-test-plan.md",
] as const;

const begin = (id: string) => `<!-- generated:${id} -->`;
const end = (id: string) => `<!-- /generated:${id} -->`;

function toolNames(): string[] {
  return SURFACE_TOOLS.map((tool) => tool.name);
}

function actionsOf(tool: string): string[] {
  return Object.keys(ACTION_MATRIX[tool] ?? {});
}

function publicActionsOf(tool: string): string[] {
  return [...(PUBLIC_ACTIONS[tool] ?? [])];
}

/** All actions of all tools — used to detect invented actions in prose. */
export function allActions(): string[] {
  return [...new Set(toolNames().flatMap(actionsOf))];
}

function code(values: string[]): string {
  return values.length === 0 ? "—" : values.map((value) => `\`${value}\``).join(", ");
}

function toolActionsTable(): string {
  const rows = toolNames().map(
    (tool) => `| \`${tool}\` | ${code(actionsOf(tool))} | ${code(publicActionsOf(tool))} |`,
  );
  return [
    "| Tool | Actions | Public (no token) |",
    "| ---- | ------- | ----------------- |",
    ...rows,
  ].join("\n");
}

function reasonFor(tool: string): string {
  const entries = Object.entries(ACTION_MATRIX[tool] ?? {});
  const publicEffect = entries.filter(([, effect]) => effect.publicEffect).map(([name]) => name);
  const destructive = entries.filter(([, effect]) => effect.destructive).map(([name]) => name);
  const writes = entries.filter(([, effect]) => effect.write).map(([name]) => name);
  if (writes.length === 0) return "read-only, repeatable";
  const parts: string[] = [`writes: ${code(writes)}`];
  if (publicEffect.length > 0) parts.push(`publicly visible: ${code(publicEffect)}`);
  if (destructive.length > 0) parts.push(`removes state: ${code(destructive)}`);
  return parts.join("; ");
}

function hintsOf(tool: string) {
  const hints = TOOL_ANNOTATIONS[tool] as Record<string, boolean>;
  return {
    readOnly: hints["readOnlyHint"],
    destructive: hints["destructiveHint"],
    openWorld: hints["openWorldHint"],
    idempotent: hints["idempotentHint"],
  };
}

function annotationsTable(): string {
  const rows = toolNames().map((tool) => {
    const hints = hintsOf(tool);
    return `| \`${tool}\` | ${hints.readOnly} | ${hints.destructive} | ${hints.openWorld} | ${hints.idempotent} | ${reasonFor(tool)} |`;
  });
  return [
    "| Tool | readOnlyHint | destructiveHint | openWorldHint | idempotentHint | Derivation |",
    "| ---- | ------------ | --------------- | ------------- | -------------- | ---------- |",
    ...rows,
  ].join("\n");
}

function scopesTable(): string {
  const rows = toolNames().map((tool) => {
    const anonymous = publicActionsOf(tool).length > 0 ? "yes" : "no";
    return `| \`${tool}\` | none (no sign-in) | ${anonymous} |`;
  });
  return [
    "| Tool | Required scopes | Usable without any account |",
    "| ---- | --------------- | -------------------------- |",
    ...rows,
  ].join("\n");
}

function detailBlock(): string {
  return toolNames()
    .map((tool) => {
      const hints = hintsOf(tool);
      return [
        `### \`${tool}\``,
        "",
        `- Actions: ${code(actionsOf(tool))}`,
        `- Public without a token: ${code(publicActionsOf(tool))}`,
        "- Sign-in required: no (Crawler Room has no accounts)",
        `- Annotations: \`readOnlyHint: ${hints.readOnly}\`, \`destructiveHint: ${hints.destructive}\`, \`openWorldHint: ${hints.openWorld}\`, \`idempotentHint: ${hints.idempotent}\``,
        `- Derivation: ${reasonFor(tool)}`,
      ].join("\n");
    })
    .join("\n\n");
}

/** Renders one generated block body (without the markers). */
export function generatedBlockBody(id: GeneratedBlockId): string {
  switch (id) {
    case "tool-actions":
      return toolActionsTable();
    case "tool-annotations":
      return annotationsTable();
    case "tool-scopes":
      return scopesTable();
    case "tool-detail":
      return detailBlock();
  }
}

/** Replaces every generated block found in `markdown` with fresh content. */
export function applyGeneratedBlocks(markdown: string): string {
  let out = markdown;
  for (const id of GENERATED_BLOCK_IDS) {
    const pattern = new RegExp(`${begin(id)}[\\s\\S]*?${end(id)}`, "g");
    out = out.replace(pattern, `${begin(id)}\n\n${generatedBlockBody(id)}\n\n${end(id)}`);
  }
  return out;
}

/** The generated block ids present in a document. */
export function blocksIn(markdown: string): GeneratedBlockId[] {
  return GENERATED_BLOCK_IDS.filter((id) => markdown.includes(begin(id)));
}
