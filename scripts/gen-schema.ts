// Regenerate schema/roadmap.schema.json from the Zod schema.
// `schema.test.ts` fails when the committed file disagrees with this output.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { roadmapJsonSchema } from "../schema";

const out = fileURLToPath(new URL("../schema/roadmap.schema.json", import.meta.url));
writeFileSync(out, `${JSON.stringify(roadmapJsonSchema(), null, 2)}\n`);
console.log(`wrote ${out}`);
