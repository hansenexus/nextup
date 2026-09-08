// Write react/styles.css from styles.ts so React consumers can import a plain stylesheet.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { STYLES } from "../styles";

const out = fileURLToPath(new URL("../ui-react/styles.css", import.meta.url));
writeFileSync(out, `${STYLES.trim()}\n`);
console.log(`wrote ${out}`);
