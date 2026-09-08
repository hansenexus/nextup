// Prepend the node shebang to the bundled CLI and mark it executable.
// `bun build --target=node` emits plain JS; npx needs the banner to exec it.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const src = readFileSync(path, "utf8");
if (!src.startsWith("#!")) {
  writeFileSync(path, `#!/usr/bin/env node\n${src}`);
}
chmodSync(path, 0o755);
console.log("dist/cli.js: shebang + exec bit set");
