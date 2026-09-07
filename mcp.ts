/**
 * nextup MCP server — stdio, read-only.
 *
 *   nextup mcp
 *
 * Five questions an agent asks mid-task: what phases exist, what items are in
 * a phase, what is this item, what is dispatchable now, how far along is
 * everything. Answers are JSON so the caller can filter them.
 *
 * No write tool. Dispatch opens issues that a daemon will act on; that is a
 * judgment with a dry-run gate, and the gate is the CLI (`nextup dispatch`,
 * then `--apply`). A tool that let a model open work for other agents without
 * that step would be the one thing this server must not be.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { type LoadedStatus, loadStatus } from "./build";
import { frontier } from "./frontier";
import { toInternal } from "./project";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export interface McpOptions {
  cwd: string;
  /** Re-fetch GitHub at most this often. */
  ttlMs?: number;
}

export function createNextupMcpServer(options: McpOptions): McpServer {
  const server = new McpServer({ name: "nextup", version: "0.1.0" });
  const ttl = options.ttlMs ?? 5 * 60 * 1000;
  let cache: { at: number; value: LoadedStatus[] } | null = null;

  async function statuses(): Promise<LoadedStatus[]> {
    if (cache && Date.now() - cache.at < ttl) return cache.value;
    const value = await loadStatus({ cwd: options.cwd });
    cache = { at: Date.now(), value };
    return value;
  }

  const pick = (all: LoadedStatus[], project?: string): LoadedStatus | undefined =>
    project ? all.find((s) => s.roadmap.meta.project === project) : all[0];

  server.registerTool(
    "nextup_phases",
    {
      title: "Phases",
      description:
        "Ordered phases of a roadmap with horizon (done|now|next|later) and progress. Omit `project` for the first/only roadmap.",
      inputSchema: { project: z.string().optional() },
    },
    async ({ project }) => {
      const all = await statuses();
      const s = pick(all, project);
      if (!s)
        return fail(
          `no roadmap${project ? ` for project "${project}"` : ""}; known: ${all.map((x) => x.roadmap.meta.project).join(", ")}`
        );
      return json({
        project: s.roadmap.meta.project,
        current_phase: s.roadmap.meta.current_phase,
        stale: s.rollup.stale,
        phases: s.roadmap.phases.map((p) => ({ ...p, ...s.rollup.phases[p.id] })),
      });
    }
  );

  server.registerTool(
    "nextup_list_items",
    {
      title: "List items",
      description:
        "Items with derived status and horizon, optionally filtered by phase, status, visibility or area.",
      inputSchema: {
        project: z.string().optional(),
        phase: z.string().optional(),
        status: z
          .enum(["proposed", "planned", "in-progress", "blocked", "done", "dropped"])
          .optional(),
        visibility: z.enum(["public", "internal"]).optional(),
        area: z.string().optional(),
      },
    },
    async ({ project, phase, status, visibility, area }) => {
      const s = pick(await statuses(), project);
      if (!s) return fail("no roadmap found");
      const internal = toInternal(s.roadmap, s.rollup, s.file);
      const items = internal.items
        .filter((it) => !phase || it.phase === phase)
        .filter((it) => !status || it.derived_status === status)
        .filter((it) => !visibility || it.visibility === visibility)
        .filter((it) => !area || it.area === area)
        .map((it) => ({
          id: it.id,
          title: it.title,
          phase: it.phase,
          horizon: it.horizon,
          status: it.derived_status,
          because: it.because,
          issues: it.linked_issues.map((i) => i.number),
          tasks: it.task_rollup,
        }));
      return json({ project: s.roadmap.meta.project, stale: s.rollup.stale, items });
    }
  );

  server.registerTool(
    "nextup_item",
    {
      title: "Item",
      description:
        "One item in full: yaml fields, linked issues with state and labels, lanes, task dispatch state.",
      inputSchema: { id: z.string(), project: z.string().optional() },
    },
    async ({ id, project }) => {
      const s = pick(await statuses(), project);
      if (!s) return fail("no roadmap found");
      const internal = toInternal(s.roadmap, s.rollup, s.file);
      const item = internal.items.find((it) => it.id === id || it.aliases.includes(id));
      if (!item) return fail(`no item "${id}"`);
      return json(item);
    }
  );

  server.registerTool(
    "nextup_next",
    {
      title: "Frontier",
      description:
        "What is dispatchable now: items in the current phase with dependencies met, and their undispatched tasks whose blockers are closed.",
      inputSchema: { project: z.string().optional() },
    },
    async ({ project }) => {
      const s = pick(await statuses(), project);
      if (!s) return fail("no roadmap found");
      const f = frontier(s.roadmap, s.rollup, s.issues).map((fi) => ({
        item: fi.item.id,
        status: fi.status,
        horizon: fi.horizon,
        unmet_dependencies: fi.unmetDependencies,
        tasks: fi.tasks.map((t) => ({
          id: t.task.id,
          title: t.task.title,
          clear: t.clear,
          blocked_by_issues: t.blockedByIssues,
          blocked_by_undispatched: t.blockedByUndispatched,
        })),
      }));
      return json({ project: s.roadmap.meta.project, stale: s.rollup.stale, frontier: f });
    }
  );

  server.registerTool(
    "nextup_status",
    {
      title: "Status",
      description:
        "Per-item status table for every roadmap found from the working directory, plus orphans and warnings.",
      inputSchema: {},
    },
    async () => {
      const all = await statuses();
      return json(
        all.map((s) => ({
          project: s.roadmap.meta.project,
          file: s.file,
          stale: s.rollup.stale,
          stale_reason: s.rollup.staleReason,
          items: Object.values(s.rollup.items).map((r) => ({
            id: r.id,
            status: r.status,
            horizon: r.horizon,
            because: r.because,
          })),
          orphans: s.rollup.orphans,
          warnings: s.rollup.warnings,
        }))
      );
    }
  );

  return server;
}

export async function serveMcp(options: McpOptions): Promise<void> {
  const server = createNextupMcpServer(options);
  await server.connect(new StdioServerTransport());
}
