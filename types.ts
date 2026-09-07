/**
 * Types inferred from the schemas, plus the shapes that only exist at runtime:
 * issue snapshots, lanes, rollup results, projections.
 *
 * Pure vocabulary — no imports beyond zod inference, so the React component and
 * the web component can depend on it without dragging in node modules.
 */

import type { z } from "zod";
import type {
  configSchema,
  estateSchema,
  horizonSchema,
  itemKindSchema,
  itemSchema,
  itemStatusSchema,
  labelsSchema,
  linkSchema,
  localizedStringSchema,
  metaSchema,
  milestoneSchema,
  milestoneStatusSchema,
  phaseSchema,
  publicItemSchema,
  publicMilestoneSchema,
  publicPhaseSchema,
  publicRoadmapSchema,
  roadmapSchema,
  sourceKindSchema,
  sourceSchema,
  taskSchema,
  visibilitySchema,
} from "./schema";

export type LocalizedString = z.infer<typeof localizedStringSchema>;
export type Visibility = z.infer<typeof visibilitySchema>;
export type ItemKind = z.infer<typeof itemKindSchema>;
export type ItemStatus = z.infer<typeof itemStatusSchema>;
export type Horizon = z.infer<typeof horizonSchema>;
export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type Labels = z.infer<typeof labelsSchema>;
export type Link = z.infer<typeof linkSchema>;
export type Source = z.infer<typeof sourceSchema>;

export type Meta = z.infer<typeof metaSchema>;
export type Phase = z.infer<typeof phaseSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export type Roadmap = z.infer<typeof roadmapSchema>;

/** The raw (pre-default) input shape — what a yaml file literally contains. */
export type RoadmapInput = z.input<typeof roadmapSchema>;

export type NextupConfig = z.infer<typeof configSchema>;
export type EstateConfig = z.infer<typeof estateSchema>;

export type PublicPhase = z.infer<typeof publicPhaseSchema>;
export type PublicItem = z.infer<typeof publicItemSchema>;
export type PublicMilestone = z.infer<typeof publicMilestoneSchema>;
export type PublicRoadmap = z.infer<typeof publicRoadmapSchema>;

/** One finding from `validate` or `rollup`. `path` is JSON-pointer-ish. */
export interface Finding {
  rule: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  errors: Finding[];
  warnings: Finding[];
}

/** What nextup needs to know about one GitHub issue. Never the whole API object. */
export interface IssueSnapshot {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
  body: string;
  url: string;
  /** Present when GitHub says the "issue" is a pull request. Those are skipped. */
  isPullRequest?: boolean;
  updatedAt?: string;
}

/** One Orca lane as fleetd records it (`~/.claude/fleet/state.json`, schema 1). */
export interface Lane {
  issue: number;
  repo?: string;
  runtime?: string;
  phase?: string;
  updatedAt?: string;
}

/** A mechanics wave file, reduced to what `done` needs. */
export interface WaveSummary {
  wave: string;
  status: string;
  total: number;
  passing: number;
  /** pass + n-a: what counts as "nothing left to prove". */
  settled: number;
}

export interface TaskRollup {
  id: string;
  title: string;
  /** Issue number when a `Roadmap-task:` marker matched, else null. */
  dispatched: number | null;
}

export interface ItemRollup {
  id: string;
  status: ItemStatus;
  horizon: Horizon;
  /** Why the status is what it is — one sentence, for the table and the UI. */
  because: string;
  issues: IssueSnapshot[];
  lanes: Lane[];
  tasks: TaskRollup[];
  wave: WaveSummary | null;
  warnings: string[];
}

export interface PhaseRollup {
  id: string;
  horizon: "done" | "now" | "next" | "later";
  progress: { done: number; total: number };
}

export interface OrphanIssue {
  number: number;
  title: string;
  url: string;
  kind: "unknown-marker" | "unlinked";
  detail: string;
}

export interface Rollup {
  generatedAt: string;
  stale: boolean;
  staleReason: string | null;
  items: Record<string, ItemRollup>;
  phases: Record<string, PhaseRollup>;
  orphans: OrphanIssue[];
  warnings: string[];
}

/** Everything the internal site and `status --json` show. */
export interface InternalRoadmap {
  schema: 1;
  audience: "internal";
  file: string;
  meta: Meta;
  generated_at: string;
  stale: boolean;
  stale_reason: string | null;
  phases: Array<Phase & PhaseRollup>;
  items: Array<
    Item & {
      horizon: Horizon;
      derived_status: ItemStatus;
      because: string;
      linked_issues: Array<{
        number: number;
        title: string;
        state: "open" | "closed";
        labels: string[];
        url: string;
        lane: Lane | null;
      }>;
      task_rollup: TaskRollup[];
      wave: WaveSummary | null;
      warnings: string[];
    }
  >;
  milestones: Milestone[];
  orphans: OrphanIssue[];
  warnings: string[];
}
