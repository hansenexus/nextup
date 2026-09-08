// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// The landing page at `/` is hand-written (src/pages/index.astro) and sits
// outside Starlight's route tree; Starlight owns the docs slugs only.
export default defineConfig({
  site: "https://nextup.hansenexus.dev",
  integrations: [
    starlight({
      title: "nextup",
      description:
        "Roadmaps as a committed roadmap.yaml: status rolled up from GitHub issues, tasks dispatched as issues, one file projected to an internal page, a public feed, a React component and a web component.",
      logo: { src: "./src/assets/mark.svg", replacesTitle: false },
      favicon: "/favicon.svg",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/hansenexus/nextup" },
        { icon: "npm", label: "npm", href: "https://www.npmjs.com/package/@hansenexus/nextup" },
      ],
      editLink: {
        baseUrl: "https://github.com/hansenexus/nextup/edit/main/site/",
      },
      customCss: ["./src/styles/tokens.css", "./src/styles/docs.css"],
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Getting started", slug: "getting-started" },
            { label: "The three rules", slug: "rules" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "roadmap.yaml", slug: "roadmap-yaml" },
            { label: "CLI", slug: "cli" },
            { label: "Status rollup", slug: "status" },
            { label: "Validation rules", slug: "validation" },
          ],
        },
        {
          label: "Agents",
          items: [
            { label: "Dispatch", slug: "dispatch" },
            { label: "MCP server", slug: "mcp" },
          ],
        },
        {
          label: "Sites",
          items: [
            { label: "Public sites", slug: "sites" },
            { label: "GitHub Pages", slug: "pages" },
            { label: "Monorepos and estates", slug: "monorepos" },
          ],
        },
      ],
      components: {
        Footer: "./src/components/DocsFooter.astro",
      },
      pagefind: true,
    }),
  ],
});
