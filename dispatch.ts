/**
 * `nextup dispatch <item>` — turn an item's tasks into GitHub issues that
 * fleetd will pick up.
 *
 * Dry-run by default. `--apply` is the only thing that writes, and what it
 * writes is exactly what the dry run printed. The dispatcher never edits an
 * existing issue, never removes a label, never touches roadmap.yaml: the file
 * is reviewed by people, the issues are opened by the tool, and the marker in
 * the body is where they meet.
 *
 * Idempotent: a task whose `Roadmap-task:` marker already exists on any issue
 * (open or closed) is skipped, so re-running after a partial failure creates
 * only what is missing.
 */

import type { GitHubClient } from "./github";
import {
  issueTitle,
  ROADMAP_LABEL,
  ROADMAP_LABEL_COLOR,
  renderIssueBody,
  taskKey,
} from "./markers";
import { isClosed, linkIssues } from "./rollup";
import type { IssueSnapshot, Item, Roadmap, Task } from "./types";

export interface DispatchOptions {
  itemId: string;
  /** Only these task ids; default all. */
  tasks?: string[];
  fleetEnv?: string | null;
  autoMerge?: boolean;
  interactive?: boolean;
  /** Skip the "dependencies done" precondition. */
  forceFrontier?: boolean;
  /** Repos fleetd watches, when known; used for a warning only. */
  fleetAllowlist?: string[] | null;
}

export interface PlannedIssue {
  task: Task;
  title: string;
  body: string;
  labels: string[];
  /** Issue numbers this task is blocked by (already existing). */
  blockedBy: number[];
  /** Task keys blocked-by that are created in this same run (resolved to numbers at apply time). */
  blockedByPending: string[];
  ready: boolean;
}

export interface DispatchPlan {
  item: Item;
  repo: string;
  file: string;
  create: PlannedIssue[];
  skipped: Array<{ task: Task; issue: number }>;
  needsLabel: boolean;
  warnings: string[];
}

export class DispatchRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DispatchRefused";
  }
}

export interface RepoState {
  labels: string[];
  issues: IssueSnapshot[];
}

export function planDispatch(
  roadmap: Roadmap,
  file: string,
  state: RepoState,
  options: DispatchOptions
): DispatchPlan {
  const item = roadmap.items.find(
    (it) => it.id === options.itemId || it.aliases.includes(options.itemId)
  );
  if (!item) throw new DispatchRefused(`no item "${options.itemId}" in ${file}`);
  if (item.status === "dropped") throw new DispatchRefused(`item "${item.id}" is dropped`);
  if (item.tasks.length === 0)
    throw new DispatchRefused(
      `item "${item.id}" has no tasks to dispatch — add tasks[] with acceptance + verify`
    );

  const warnings: string[] = [];
  const readyLabel = roadmap.meta.labels.ready[0] ?? "ready";
  if (!state.labels.includes(readyLabel)) {
    throw new DispatchRefused(
      `label "${readyLabel}" does not exist in ${roadmap.meta.repo} — run /setup-repo (fleet labels) first`
    );
  }
  const needsLabel = !state.labels.includes(ROADMAP_LABEL);

  const { byItem, taskIssue } = linkIssues(roadmap, file, state.issues);

  // Dependencies: every depends_on item must be done (all its issues closed).
  if (!options.forceFrontier) {
    const unmet: string[] = [];
    for (const dep of item.depends_on) {
      const depItem = roadmap.items.find((it) => it.id === dep || it.aliases.includes(dep));
      if (!depItem) continue;
      const linked = byItem.get(depItem.id) ?? [];
      const allDispatched = depItem.tasks.every((t) => taskIssue.has(taskKey(depItem.id, t.id)));
      const done =
        linked.length > 0 &&
        allDispatched &&
        linked.every((i) => isClosed(i, roadmap.meta.labels.done));
      if (!done) unmet.push(dep);
    }
    if (unmet.length > 0) {
      throw new DispatchRefused(
        `item "${item.id}" depends on ${unmet.join(", ")} which is not done (use --force-frontier to override)`
      );
    }
  }

  const wanted = options.tasks
    ? item.tasks.filter((t) => options.tasks?.includes(t.id))
    : item.tasks;
  if (options.tasks) {
    for (const id of options.tasks)
      if (!item.tasks.some((t) => t.id === id))
        throw new DispatchRefused(`no task "${id}" in item "${item.id}"`);
  }

  const skipped: DispatchPlan["skipped"] = [];
  const create: PlannedIssue[] = [];
  const creatingKeys = new Set<string>();
  for (const task of wanted) {
    const existing = taskIssue.get(taskKey(item.id, task.id));
    if (existing !== undefined) {
      skipped.push({ task, issue: existing });
      continue;
    }
    creatingKeys.add(taskKey(item.id, task.id));
  }

  const byNumber = new Map(state.issues.map((i) => [i.number, i]));
  for (const task of wanted) {
    if (!creatingKeys.has(taskKey(item.id, task.id))) continue;
    const blockedBy: number[] = [];
    const blockedByPending: string[] = [];
    let allBlockersClosed = true;
    for (const b of task.blocked_by) {
      const key = b.includes("/") ? b : taskKey(item.id, b);
      const n = taskIssue.get(key);
      if (n !== undefined) {
        blockedBy.push(n);
        const issue = byNumber.get(n);
        if (!issue || !isClosed(issue, roadmap.meta.labels.done)) allBlockersClosed = false;
      } else if (creatingKeys.has(key)) {
        blockedByPending.push(key);
        allBlockersClosed = false;
      } else {
        warnings.push(
          `${task.id}: blocked_by ${key} is neither dispatched nor part of this run — edge omitted`
        );
      }
    }
    const env = options.fleetEnv ?? task.fleet_env ?? roadmap.meta.fleet_env;
    const labels = [ROADMAP_LABEL, ...task.labels];
    if (roadmap.meta.scope.label) labels.push(roadmap.meta.scope.label);
    if (env) labels.push(`fleet-${env}`);
    if (task.interactive || options.interactive) labels.push("interactive");
    if (options.autoMerge) labels.push("auto-merge-ok");
    const ready = allBlockersClosed;
    if (ready) labels.push(readyLabel);
    const missing = labels.filter((l) => l !== ROADMAP_LABEL && !state.labels.includes(l));
    if (missing.length > 0)
      throw new DispatchRefused(
        `labels missing in ${roadmap.meta.repo}: ${missing.join(", ")} — create them first`
      );
    create.push({
      task,
      title: issueTitle(item, task),
      body: "", // rendered at apply time once pending blockers have numbers
      labels: [...new Set(labels)],
      blockedBy,
      blockedByPending,
      ready,
    });
  }

  if (
    options.fleetAllowlist &&
    !options.fleetAllowlist.includes(roadmap.meta.repo.split("/")[1] ?? "")
  ) {
    warnings.push(
      `${roadmap.meta.repo} is not in the fleetd allowlist — issues will be created but no lane will pick them up`
    );
  }

  // Topological order among the ones we create, so Blocked-by numbers exist when needed.
  const order = topoPlanned(create, item.id);
  return { item, repo: roadmap.meta.repo, file, create: order, skipped, needsLabel, warnings };
}

function topoPlanned(planned: PlannedIssue[], itemId: string): PlannedIssue[] {
  const byKey = new Map(planned.map((p) => [taskKey(itemId, p.task.id), p]));
  const out: PlannedIssue[] = [];
  const done = new Set<string>();
  let guard = 0;
  while (out.length < planned.length && guard++ < planned.length + 1) {
    for (const p of planned) {
      const key = taskKey(itemId, p.task.id);
      if (done.has(key)) continue;
      if (p.blockedByPending.every((k) => done.has(k) || !byKey.has(k))) {
        out.push(p);
        done.add(key);
      }
    }
  }
  // a cycle would have been caught by validate; append leftovers rather than drop them
  for (const p of planned) if (!out.includes(p)) out.push(p);
  return out;
}

export interface DispatchResult {
  created: Array<{ task: string; number: number; url: string; ready: boolean }>;
  skipped: Array<{ task: string; issue: number }>;
  labelCreated: boolean;
}

export async function applyDispatch(
  plan: DispatchPlan,
  roadmap: Roadmap,
  client: GitHubClient
): Promise<DispatchResult> {
  let labelCreated = false;
  if (plan.needsLabel) {
    await client.createLabel(
      plan.repo,
      ROADMAP_LABEL,
      ROADMAP_LABEL_COLOR,
      "Linked to a roadmap.yaml item (nextup)"
    );
    labelCreated = true;
  }
  const numbers = new Map<string, number>();
  const created: DispatchResult["created"] = [];
  for (const p of plan.create) {
    const blockedBy = [...p.blockedBy];
    for (const key of p.blockedByPending) {
      const n = numbers.get(key);
      if (n !== undefined) blockedBy.push(n);
    }
    const body = renderIssueBody({
      file: plan.file,
      item: plan.item,
      task: p.task,
      blockedBy,
      publicUrl: roadmap.meta.public ? roadmap.meta.public_url : null,
    });
    const res = await client.createIssue(plan.repo, { title: p.title, body, labels: p.labels });
    numbers.set(taskKey(plan.item.id, p.task.id), res.number);
    created.push({ task: p.task.id, number: res.number, url: res.url, ready: p.ready });
  }
  return {
    created,
    skipped: plan.skipped.map((s) => ({ task: s.task.id, issue: s.issue })),
    labelCreated,
  };
}

/** The dry-run text: what `--apply` would do, nothing more. */
export function renderPlan(plan: DispatchPlan, roadmap: Roadmap): string {
  const lines: string[] = [];
  lines.push(`dispatch ${plan.item.id} → ${plan.repo}`);
  if (plan.needsLabel) lines.push(`  + label ${ROADMAP_LABEL} (missing in repo)`);
  for (const s of plan.skipped) lines.push(`  = ${s.task.id}: already #${s.issue}`);
  for (const p of plan.create) {
    const edges = [...p.blockedBy.map((n) => `#${n}`), ...p.blockedByPending.map((k) => `(${k})`)];
    lines.push(
      `  + ${p.task.id}: "${p.title}" [${p.labels.join(", ")}]${edges.length ? ` blocked-by ${edges.join(" ")}` : ""}${p.ready ? " READY" : ""}`
    );
  }
  for (const w of plan.warnings) lines.push(`  ! ${w}`);
  if (plan.create.length === 0) lines.push("  nothing to create");
  else lines.push(`  ${plan.create.length} issue(s) to create — add --apply to do it`);
  if (roadmap.meta.public && roadmap.meta.public_url)
    lines.push(`  public link: ${roadmap.meta.public_url}#${plan.item.id}`);
  return lines.join("\n");
}
