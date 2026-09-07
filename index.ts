/**
 * Read-only barrel for consumers (Next.js sites, dashboards, tests). Nothing
 * here spawns a process or writes a file: the CLI does that, in `cli.ts`.
 */

export type {
  Audience,
  BuildOptions,
  BuildReport,
  IndexEntry,
  LoadedStatus,
  LoadStatusOptions,
} from "./build";
export { guardInternalOut, LoadError, loadStatus, projectionFor, writeBuild } from "./build";
export type {
  DispatchOptions,
  DispatchPlan,
  DispatchResult,
  PlannedIssue,
  RepoState,
} from "./dispatch";
export { applyDispatch, DispatchRefused, planDispatch, renderPlan } from "./dispatch";
export { loadFleetState, parseFleetState } from "./fleet-state";
export type { FrontierItem, FrontierTask } from "./frontier";
export { frontier } from "./frontier";
export type { ClientOptions, CreateIssueInput, GitHubClient } from "./github";
export { createGitHubClient, fetchRoadmapIssues, GitHubError } from "./github";
export { reachable, topoSort } from "./graph";
export { localesOf, missingLocale, resolveText } from "./i18n";
export type { LoadAllResult, LoadedRoadmap, Located, ParseResult } from "./load";
export {
  expandGlobs,
  loadAll,
  loadRoadmap,
  locate,
  parseConfig,
  parseEstate,
  parseRoadmap,
} from "./load";
export {
  BLOCKED_BY_RE,
  issueTitle,
  itemMarker,
  MARKER_RE,
  parseBlockedBy,
  parseMarkers,
  ROADMAP_LABEL,
  renderIssueBody,
  taskKey,
  taskMarker,
} from "./markers";
export { loadWaves, summarizeWaveText } from "./mechanics-waves";
export {
  FORBIDDEN_PUBLIC_KEYS,
  findForbiddenKeys,
  isPubliclyVisible,
  toInternal,
  toPublic,
} from "./project";
export type { LoadPublicOptions } from "./public-loader";
export { loadPublicRoadmap } from "./public-loader";
export type { ViewMode } from "./render-html";
export { esc, renderRoadmapHTML } from "./render-html";
export type { RollupInput } from "./rollup";
export { horizonFor, isClosed, linkIssues, phaseHorizon, rollup, rollupItem } from "./rollup";
export * from "./schema";
export { STYLES } from "./styles";
export type * from "./types";
export { formatFindings, LEAK_RE, validateRoadmap } from "./validate";
export type { AnyRoadmap, ItemView, MilestoneView, PhaseView, RoadmapView } from "./view-model";
export { buildViewModel, stringsFor } from "./view-model";
