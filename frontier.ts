/**
 * `nextup next` — what is dispatchable now.
 *
 * An item is on the frontier when it sits in the current phase (or is
 * carry-over from an earlier one), is not done or dropped, and every item it
 * depends on is done. Within such an item, a task is dispatchable when it has
 * not been dispatched and every task it is blocked by has a CLOSED issue —
 * the same test fleetd applies before it promotes `ready`, applied one step
 * earlier so nothing gets opened that would sit blocked from birth.
 */

import { taskKey } from "./markers";
import { isClosed } from "./rollup";
import type { IssueSnapshot, Item, Roadmap, Rollup, Task } from "./types";

export interface FrontierTask {
  task: Task;
  /** Issue numbers of the blockers that are already dispatched (closed or not). */
  blockedByIssues: number[];
  /** Blockers not yet dispatched — cannot be expressed as `Blocked-by: #N` yet. */
  blockedByUndispatched: string[];
  /** True when every blocker is dispatched AND closed. */
  clear: boolean;
}

export interface FrontierItem {
  item: Item;
  status: string;
  horizon: string;
  unmetDependencies: string[];
  tasks: FrontierTask[];
}

export function frontier(
  roadmap: Roadmap,
  roll: Rollup,
  issues: readonly IssueSnapshot[]
): FrontierItem[] {
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const done = new Set(
    Object.values(roll.items)
      .filter((r) => r.status === "done")
      .map((r) => r.id)
  );
  const taskIssue = new Map<string, number>();
  for (const r of Object.values(roll.items)) {
    for (const t of r.tasks)
      if (t.dispatched !== null) taskIssue.set(taskKey(r.id, t.id), t.dispatched);
  }
  const out: FrontierItem[] = [];
  for (const item of roadmap.items) {
    const r = roll.items[item.id];
    if (!r) continue;
    if (r.status === "done" || r.status === "dropped") continue;
    if (r.horizon !== "now" && r.horizon !== "carry-over") continue;
    const unmet = item.depends_on.filter((d) => !done.has(d));
    const tasks: FrontierTask[] = [];
    for (const task of item.tasks) {
      if (taskIssue.has(taskKey(item.id, task.id))) continue;
      const blockedByIssues: number[] = [];
      const blockedByUndispatched: string[] = [];
      let clear = true;
      for (const b of task.blocked_by) {
        const key = b.includes("/") ? b : taskKey(item.id, b);
        const n = taskIssue.get(key);
        if (n === undefined) {
          blockedByUndispatched.push(key);
          clear = false;
          continue;
        }
        blockedByIssues.push(n);
        const issue = byNumber.get(n);
        if (!issue || !isClosed(issue, roadmap.meta.labels.done)) clear = false;
      }
      tasks.push({ task, blockedByIssues, blockedByUndispatched, clear });
    }
    out.push({ item, status: r.status, horizon: r.horizon, unmetDependencies: unmet, tasks });
  }
  return out;
}
