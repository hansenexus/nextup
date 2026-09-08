/**
 * Copy the generated JSON Schema into the site so it is served at
 * https://nextup.hansenexus.dev/schema/roadmap.schema.json — the URL the
 * scaffolded roadmap.yaml names in its `yaml-language-server` comment.
 * Not committed twice: `schema/roadmap.schema.json` is generated in the
 * repo root and drift-tested there.
 */
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FROM = path.resolve(HERE, "../../schema/roadmap.schema.json");
const TO = path.resolve(HERE, "../public/schema/roadmap.schema.json");

await mkdir(path.dirname(TO), { recursive: true });
await cp(FROM, TO);
console.log("assets: schema/roadmap.schema.json → site/public/schema/");
