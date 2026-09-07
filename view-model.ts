/**
 * One view model for both renderers. The React component and the web
 * component are deliberately thin: everything that decides WHAT to show —
 * grouping by phase, resolving locales, wording of statuses, the
 * "vN · Stand <date>" line, the stale badge — lives here, once, and is tested
 * once. Pure: no DOM, no fetch.
 */

import { resolveText } from "./i18n";
import type { InternalRoadmap, ItemStatus, Link, LocalizedString, PublicRoadmap } from "./types";

export type AnyRoadmap = PublicRoadmap | InternalRoadmap;

export interface Strings {
  asOf: string;
  stale: string;
  undated: string;
  removed: string;
  milestones: string;
  horizon: Record<string, string>;
  status: Record<ItemStatus, string>;
  milestone: Record<string, string>;
  progress: (done: number, total: number) => string;
  issues: (n: number) => string;
  lane: string;
}

const EN: Strings = {
  asOf: "as of",
  stale: "status may be stale",
  undated: "undated",
  removed: "removed",
  milestones: "Milestones",
  horizon: {
    done: "shipped",
    now: "now",
    next: "next",
    later: "later",
    shipped: "shipped",
    "carry-over": "carry-over",
  },
  status: {
    proposed: "proposed",
    planned: "planned",
    "in-progress": "in progress",
    blocked: "blocked",
    done: "done",
    dropped: "removed",
  },
  milestone: { draft: "draft", planned: "planned", reached: "reached", dropped: "dropped" },
  progress: (d, t) => `${d} of ${t} done`,
  issues: (n) => (n === 1 ? "1 issue" : `${n} issues`),
  lane: "lane",
};

const DE: Strings = {
  asOf: "Stand",
  stale: "Stand veraltet",
  undated: "ohne Termin",
  removed: "entfernt",
  milestones: "Meilensteine",
  horizon: {
    done: "erledigt",
    now: "jetzt",
    next: "als Nächstes",
    later: "später",
    shipped: "erledigt",
    "carry-over": "Übertrag",
  },
  status: {
    proposed: "vorgeschlagen",
    planned: "geplant",
    "in-progress": "in Arbeit",
    blocked: "blockiert",
    done: "erledigt",
    dropped: "entfernt",
  },
  milestone: { draft: "Entwurf", planned: "geplant", reached: "erreicht", dropped: "verworfen" },
  progress: (d, t) => `${d} von ${t} erledigt`,
  issues: (n) => (n === 1 ? "1 Issue" : `${n} Issues`),
  lane: "Lane",
};

const STRINGS: Record<string, Strings> = { en: EN, de: DE };

export function stringsFor(locale: string): Strings {
  const lang = locale.split("-")[0] ?? "en";
  return STRINGS[lang] ?? EN;
}

export interface ItemView {
  id: string;
  title: string;
  summary: string;
  status: ItemStatus;
  statusLabel: string;
  horizon: string;
  horizonLabel: string;
  kind: string;
  area: string | null;
  dependsOn: string[];
  links: Link[];
  since: string | null;
  /** Internal audience only. */
  internal: {
    because: string;
    issues: Array<{
      number: number;
      title: string;
      state: string;
      url: string;
      lane: string | null;
    }>;
    tasks: Array<{ id: string; title: string; dispatched: number | null }>;
    owners: string[];
    warnings: string[];
    visibility: string;
  } | null;
}

export interface MilestoneView {
  id: string;
  title: string;
  summary: string;
  status: string;
  statusLabel: string;
  date: string | null;
  dateLabel: string;
  reachedAt: string | null;
}

export interface PhaseView {
  id: string;
  title: string;
  goal: string;
  getsYou: string;
  target: string | null;
  horizon: string;
  horizonLabel: string;
  isCurrent: boolean;
  progress: { done: number; total: number; label: string };
  items: ItemView[];
  milestones: MilestoneView[];
}

export interface RoadmapView {
  project: string;
  title: string;
  audience: "public" | "internal";
  locale: string;
  versionLine: string;
  stale: boolean;
  staleLabel: string;
  currentPhase: string;
  phases: PhaseView[];
  strings: Strings;
}

function text(
  value: LocalizedString | undefined,
  locale: string,
  fallbacks: readonly string[]
): string {
  return resolveText(value, locale, fallbacks);
}

export function buildViewModel(data: AnyRoadmap, locale: string): RoadmapView {
  const s = stringsFor(locale);
  const isInternal = data.audience === "internal";
  const meta = isInternal ? data.meta : data;
  const fallbacks = meta.locales;
  const versionLine = `v${meta.version} · ${s.asOf} ${meta.updated}`;

  const phases: PhaseView[] = data.phases.map((p) => {
    const rawItems = isInternal
      ? data.items.filter((it) => it.phase === p.id)
      : data.items.filter((it) => it.phase === p.id);
    const items: ItemView[] = rawItems.map((it) => {
      const status: ItemStatus = isInternal
        ? (it as InternalRoadmap["items"][number]).derived_status
        : (it as PublicRoadmap["items"][number]).status;
      const horizon = it.horizon;
      const internalItem = isInternal ? (it as InternalRoadmap["items"][number]) : null;
      return {
        id: it.id,
        title: text(it.title, locale, fallbacks),
        summary: text(it.summary, locale, fallbacks),
        status,
        statusLabel: s.status[status],
        horizon,
        horizonLabel: s.horizon[horizon] ?? horizon,
        kind: it.kind,
        area: it.area ?? null,
        dependsOn: it.depends_on,
        links: it.links,
        since: it.since ?? null,
        internal: internalItem
          ? {
              because: internalItem.because,
              issues: internalItem.linked_issues.map((i) => ({
                number: i.number,
                title: i.title,
                state: i.state,
                url: i.url,
                lane: i.lane ? `${i.lane.runtime ?? "?"}/${i.lane.phase ?? "?"}` : null,
              })),
              tasks: internalItem.task_rollup,
              owners: internalItem.owners,
              warnings: internalItem.warnings,
              visibility: internalItem.visibility,
            }
          : null,
      };
    });
    const milestones: MilestoneView[] = data.milestones
      .filter((m) => m.phase === p.id)
      .map((m) => {
        const status = m.status;
        const date = status === "planned" || status === "reached" ? (m.date ?? null) : null;
        return {
          id: m.id,
          title: text(m.title, locale, fallbacks),
          summary: text(m.summary, locale, fallbacks),
          status,
          statusLabel: s.milestone[status] ?? status,
          date,
          dateLabel: date ?? s.undated,
          reachedAt: "reached_at" in m ? (m.reached_at ?? null) : null,
        };
      });
    const counted = items.filter((it) => it.status !== "dropped");
    const done = counted.filter((it) => it.status === "done").length;
    const horizon = "horizon" in p ? p.horizon : "later";
    return {
      id: p.id,
      title: text(p.title, locale, fallbacks),
      goal: text(p.goal, locale, fallbacks),
      getsYou: text(p.gets_you, locale, fallbacks),
      target: p.target ?? null,
      horizon,
      horizonLabel: s.horizon[horizon] ?? horizon,
      isCurrent: p.id === meta.current_phase,
      progress: { done, total: counted.length, label: s.progress(done, counted.length) },
      items,
      milestones,
    };
  });

  return {
    project: meta.project,
    title: text(meta.title, locale, fallbacks),
    audience: data.audience,
    locale,
    versionLine,
    stale: data.stale,
    staleLabel: s.stale,
    currentPhase: meta.current_phase,
    phases,
    strings: s,
  };
}
