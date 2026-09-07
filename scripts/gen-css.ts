// Write react/styles.css from styles.ts so React consumers can import a plain stylesheet.
import { writeFileSync } from "node:fs";
import { STYLES } from "../styles";

const out = new URL("../ui-react/styles.css", import.meta.url).pathname;
writeFileSync(out, `${STYLES.trim()}\n`);
console.log(`wrote ${out}`);
