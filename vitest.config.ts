import { defineConfig } from "vitest/config";

// DOM tests (ui-react/, wc/) opt in per file with `// @vitest-environment happy-dom`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["*.test.ts", "ui-react/*.test.tsx", "wc/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "dist", "**/*.test.ts", "cli.ts"],
    },
  },
});
