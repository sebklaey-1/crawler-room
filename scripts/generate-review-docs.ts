/**
 * Regenerates every machine-generated block inside the review / submission
 * documents from the canonical action matrix and the live MCP schemas.
 *
 *   bun run docs:review
 */
import { readFileSync, writeFileSync } from "node:fs";

import { applyGeneratedBlocks, blocksIn, GENERATED_DOCS } from "../src/lib/room/review.docs";

let changed = 0;
for (const doc of GENERATED_DOCS) {
  const current = readFileSync(doc, "utf8");
  const blocks = blocksIn(current);
  if (blocks.length === 0) {
    console.log(`SKIP  ${doc} — no generated block markers`);
    continue;
  }
  const next = applyGeneratedBlocks(current);
  if (next !== current) {
    writeFileSync(doc, next);
    changed += 1;
    console.log(`WRITE ${doc} — ${blocks.join(", ")}`);
  } else {
    console.log(`OK    ${doc} — ${blocks.join(", ")}`);
  }
}
console.log(`\n${changed} document(s) updated.`);
