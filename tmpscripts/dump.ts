import { SURFACE_TOOLS, PUBLIC_ACTIONS, TOOL_ANNOTATIONS } from "../src/lib/room/mcp.surface";
import { ACTION_MATRIX } from "../src/lib/room/actions.matrix";
for (const t of SURFACE_TOOLS) {
  const s:any = t.inputSchema;
  console.log(t.name, JSON.stringify(s.properties?.action?.enum), "| matrix:", JSON.stringify(Object.keys(ACTION_MATRIX[t.name]||{})), "| public:", JSON.stringify(PUBLIC_ACTIONS[t.name]||[]), "|", JSON.stringify(TOOL_ANNOTATIONS[t.name]));
}
