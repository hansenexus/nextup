/**
 * Status rollup: from a roadmap, its issues, its wave files and the fleet's
 * lanes to one status + horizon per item. Pure — every input is a value, so
 * the algorithm is testable branch by branch against recorded fixtures and
 * runs identically in the CLI, the MCP server and the build.
 *
 * The rules, in order (first match wins):
 *
 *   dropped (manual)                                   → dropped
 *   nothing linked, nothing dispatched                 → manual status, else proposed
 *   any open issue in progress, or on a live lane      → in-progress
 *   open issues, every one of them blocked             → blocked
 *   open issues                                        → planned
 *   tasks still undispatched                           → in-progress if anything closed, else planned
 *   wave referenced and not all settled                → in-progress
 *   otherwise                                          → done
 *
 * "Closed" is GitHub's closed state OR a label from `meta.labels.done`, so a
 * board that closes by column and a repo that closes by merge both count.
 */

import { idIndex, parseMarkers, ROADMAP_LABEL, resolveMarker, taskKey } from "./markers";
import type {
  Horizon,
  IssueSnapshot,
  Item,
  ItemRollup,
  ItemStatus,
  Lane,
  OrphanIssue,
  PhaseRollup,
  Roadmap,
  Rollup,
  TaskRollup,
  WaveSummary,
} from "./types";

export interface RollupInput {
  roadmap: Roadmap;
  /** Repo-relative roadmap file path, as markers carry it. */
  file: string;
  /** Issues of the repo (open and closed). Empty array when offline. */
  issues: readonly IssueSnapshot[];
  /** Lanes from fleetd state; optional enrichment. */
  lanes?: readonly Lane[];
  /** Wave summaries keyed by wave slug; optional. */
  waves?: Record<string, WaveSummary>;
  /** When issues could not be fetched — the output says so instead of lying. */
  stale?: { reason: string } | null;
  now?: Date;
}

const hasAny = (labels: readonly string[], set: readonly string[]) =>
  labels.some((l) => set.includes(l));

export function isClosed(issue: IssueSnapshot, doneLabels: readonly string[]): boolean {
  return issue.state === "closed" || hasAny(issue.labels, doneLabels);
}

export function horizonFor(
  itemPhase: string,
  currentPhase: string,
  phaseOrder: readonly string[],
  status: ItemStatus
): Horizon {
  if (status === "done") return "shipped";
  const mine = phaseOrder.indexOf(itemPhase);
  const now = phaseOrder.indexOf(currentPhase);
  if (mine < 0 || now < 0) return "later";
  const delta = mine - now;
  if (delta < 0) return "carry-over";
  if (delta === 0) return "now";
  if (delta === 1) return "next";
  return "later";
}

export function phaseHorizon(
  phase: string,
  currentPhase: string,
  phaseOrder: readonly string[]
): PhaseRollup["horizon"] {
  const mine = phaseOrder.indexOf(phase);
  const now = phaseOrder.indexOf(currentPhase);
  if (mine < now) return "done";
  if (mine === now) return "now";
  if (mine === now + 1) return "next";
  return "later";
}

function waveSettled(wave: WaveSummary): boolean {
  return wave.total > 0 && wave.settled === wave.total;
}

/** Issues that belong to this roadmap: hand-linked numbers plus marker matches. */
export function linkIssues(
  roadmap: Roadmap,
  file: string,
  issues: readonly IssueSnapshot[]
): {
  byItem: Map<string, IssueSnapshot[]>;
  taskIssue: Map<string, number>;
  orphans: OrphanIssue[];
} {
  const index = idIndex(roadmap);
  const byItem = new Map<string, IssueSnapshot[]>();
  const taskIssue = new Map<string, number>();
  const orphans: OrphanIssue[] = [];
  const scopeLabel = roadmap.meta.scope.label;
  const add = (itemId: string, issue: IssueSnapshot) => {
    const list = byItem.get(itemId) ?? [];
    if (!list.some((i) => i.number === issue.number)) list.push(issue);
    byItem.set(itemId, list);
  };

  for (const item of roadmap.items) {
    for (const n of item.issues) {
      const found = issues.find((i) => i.number === n && !i.isPullRequest);
      if (found) add(item.id, found);
    }
  }
  for (const issue of issues) {
    if (issue.isPullRequest) continue;
    const markers = parseMarkers(issue.body);
    const mine = markers.filter((m) => m.file === file);
    if (mine.length === 0) {
      // An issue that carries the roadmap label but points nowhere we know is a drift signal.
      if (
        issue.labels.includes(ROADMAP_LABEL) &&
        markers.length === 0 &&
        (!scopeLabel || issue.labels.includes(scopeLabel))
      ) {
        orphans.push({
          number: issue.number,
          title: issue.title,
          url: issue.url,
          kind: "unlinked",
          detail: `labelled ${ROADMAP_LABEL} but has no Roadmap-item marker`,
        });
      }
      continue;
    }
    for (const marker of mine) {
      const itemId = resolveMarker(marker, file, index);
      if (!itemId) {
        orphans.push({
          number: issue.number,
          title: issue.title,
          url: issue.url,
          kind: "unknown-marker",
          detail: `marker points at "${marker.itemId}" which is not an item or alias`,
        });
        continue;
      }
      add(itemId, issue);
      if (marker.kind === "task" && marker.taskId)
        taskIssue.set(taskKey(itemId, marker.taskId), issue.number);
    }
  }
  return { byItem, taskIssue, orphans };
}

export function rollupItem(
  item: Item,
  roadmap: Roadmap,
  linked: readonly IssueSnapshot[],
  taskIssue: Map<string, number>,
  lanes: readonly Lane[],
  wave: WaveSummary | null
): Omit<ItemRollup, "horizon"> {
  const labels = roadmap.meta.labels;
  const warnings: string[] = [];
  const tasks: TaskRollup[] = item.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    dispatched: taskIssue.get(taskKey(item.id, t.id)) ?? null,
  }));
  const linkedNumbers = new Set(linked.map((i) => i.number));
  const itemLanes = lanes.filter((l) => linkedNumbers.has(l.issue));
  const base = { id: item.id, issues: [...linked], lanes: itemLanes, tasks, wave, warnings };
  const undispatched = tasks.filter((t) => t.dispatched === null).length;

  if (item.status === "dropped") {
    return {
      ...base,
      status: "dropped",
      because: item.reason ? `dropped: ${item.reason}` : "dropped",
    };
  }
  if (linked.length === 0 && undispatched === tasks.length) {
    const status: ItemStatus = item.status ?? "proposed";
    return {
      ...base,
      status,
      because: item.status ? `manual status since ${item.since ?? "?"}` : "nothing linked yet",
    };
  }
  if (item.status) {
    warnings.push(`manual status "${item.status}" ignored: issues are linked`);
  }
  const open = linked.filter((i) => !isClosed(i, labels.done));
  const closed = linked.length - open.length;
  const inProgress = open.filter(
    (i) => hasAny(i.labels, labels.in_progress) || itemLanes.some((l) => l.issue === i.number)
  );
  if (inProgress.length > 0) {
    const n = inProgress[0]?.number;
    return {
      ...base,
      status: "in-progress",
      because: `#${n} in progress (${open.length} open, ${closed} closed)`,
    };
  }
  if (open.length > 0 && open.every((i) => hasAny(i.labels, labels.blocked))) {
    return { ...base, status: "blocked", because: `all ${open.length} open issues blocked` };
  }
  if (open.length > 0) {
    return {
      ...base,
      status: "planned",
      because: `${open.length} open, none started (${closed} closed)`,
    };
  }
  if (undispatched > 0) {
    const status: ItemStatus = closed > 0 ? "in-progress" : "planned";
    return {
      ...base,
      status,
      because: `${undispatched} task(s) not dispatched yet (${closed} closed)`,
    };
  }
  if (wave && !waveSettled(wave)) {
    warnings.push(`wave ${wave.wave} not green: ${wave.settled}/${wave.total} settled`);
    return {
      ...base,
      status: "in-progress",
      because: `all issues closed, wave ${wave.wave} ${wave.settled}/${wave.total}`,
    };
  }
  return { ...base, status: "done", because: `${closed} closed, nothing open` };
}

export function rollup(input: RollupInput): Rollup {
  const { roadmap, file } = input;
  const lanes = input.lanes ?? [];
  const waves = input.waves ?? {};
  const phaseOrder = roadmap.phases.map((p) => p.id);
  const { byItem, taskIssue, orphans } = linkIssues(roadmap, file, input.issues);
  const items: Record<string, ItemRollup> = {};
  const warnings: string[] = [];

  for (const item of roadmap.items) {
    const wave = item.mechanics_wave ? (waves[item.mechanics_wave] ?? null) : null;
    if (item.mechanics_wave && !wave)
      warnings.push(`${item.id}: wave ${item.mechanics_wave} not loaded`);
    const partial = rollupItem(item, roadmap, byItem.get(item.id) ?? [], taskIssue, lanes, wave);
    items[item.id] = {
      ...partial,
      horizon: horizonFor(item.phase, roadmap.meta.current_phase, phaseOrder, partial.status),
    };
  }

  const phases: Record<string, PhaseRollup> = {};
  for (const phase of roadmap.phases) {
    const mine = roadmap.items.filter(
      (it) => it.phase === phase.id && items[it.id]?.status !== "dropped"
    );
    phases[phase.id] = {
      id: phase.id,
      horizon: phaseHorizon(phase.id, roadmap.meta.current_phase, phaseOrder),
      progress: {
        done: mine.filter((it) => items[it.id]?.status === "done").length,
        total: mine.length,
      },
    };
  }

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    stale: Boolean(input.stale),
    staleReason: input.stale?.reason ?? null,
    items,
    phases,
    orphans,
    warnings,
  };
}
