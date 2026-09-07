/**
 * `<Roadmap>` for React 19 / Next.js. Hook-free and fetch-free: it takes the
 * JSON and renders, so it is a valid server component and a valid client
 * component alike. Load the data however the host loads data —
 * `loadPublicRoadmap()` from `@hansenexus/nextup` at build time is the usual
 * path — and import `@hansenexus/nextup/react/styles.css` once.
 */

import type * as React from "react";
import {
  type AnyRoadmap,
  buildViewModel,
  type ItemView,
  type MilestoneView,
  type PhaseView,
  type RoadmapView,
} from "../view-model";

export type { AnyRoadmap, ItemView, MilestoneView, PhaseView, RoadmapView };
export { buildViewModel };

export type RoadmapViewMode = "phases" | "list" | "compact";

export interface RoadmapProps {
  data: AnyRoadmap;
  locale?: string;
  view?: RoadmapViewMode;
  className?: string;
  /** Render something after the header (a link to the full page, say). */
  children?: React.ReactNode;
}

function Badge({ label, cls }: { label: string; cls: string }) {
  return <span className={`nextup-badge is-${cls}`}>{label}</span>;
}

function Item({ it, view }: { it: ItemView; view: RoadmapView }) {
  const i = it.internal;
  const pending = i ? i.tasks.filter((t) => t.dispatched === null) : [];
  return (
    <li className={`nextup-item is-${it.status}`} id={`${view.project}-${it.id}`} data-item={it.id}>
      <div className="nextup-item-title">
        {it.title}
        <Badge label={it.statusLabel} cls={it.status} />
        {i && i.visibility === "internal" ? <Badge label="internal" cls="internal" /> : null}
      </div>
      {it.summary ? <p className="nextup-item-summary">{it.summary}</p> : null}
      {it.links.length > 0 ? (
        <ul className="nextup-links">
          {it.links.map((l) => (
            <li key={l.url}>
              <a href={l.url} rel="noopener">
                {l.title}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {i ? (
        <div className="nextup-internal">
          <div>{i.because}</div>
          {i.issues.length > 0 ? (
            <ul>
              {i.issues.map((iss) => (
                <li key={iss.number} className={`is-${iss.state}`}>
                  <a href={iss.url} rel="noopener">
                    #{iss.number}
                  </a>{" "}
                  {iss.title} · {iss.state}
                  {iss.lane ? ` · ${view.strings.lane} ${iss.lane}` : null}
                </li>
              ))}
            </ul>
          ) : null}
          {pending.length > 0 ? (
            <div>{`${pending.length} task(s) not dispatched: ${pending.map((t) => t.id).join(", ")}`}</div>
          ) : null}
          {i.warnings.map((w) => (
            <div key={w} className="nextup-warning">
              {w}
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Milestone({ m }: { m: MilestoneView }) {
  return (
    <div className={`nextup-milestone is-${m.status}`}>
      <span className="nextup-date">{m.dateLabel}</span>
      <span>{m.title}</span>
      <Badge label={m.statusLabel} cls={m.status} />
    </div>
  );
}

function Phase({ p, view }: { p: PhaseView; view: RoadmapView }) {
  const pct = p.progress.total > 0 ? Math.round((p.progress.done / p.progress.total) * 100) : 0;
  return (
    <section
      className={`nextup-phase is-${p.horizon}${p.isCurrent ? " is-current" : ""}`}
      data-phase={p.id}
    >
      <div className="nextup-phase-head">
        <h3>{p.title}</h3>
        <span className="nextup-horizon">
          {p.horizonLabel}
          {p.target ? ` · ${p.target}` : null}
        </span>
      </div>
      {p.goal ? <p className="nextup-goal">{p.goal}</p> : null}
      <div className="nextup-meta">
        <span>{p.progress.label}</span>
      </div>
      <div
        className="nextup-progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      {p.items.length === 0 ? (
        <p className="nextup-empty">—</p>
      ) : (
        <ul className="nextup-items">
          {p.items.map((it) => (
            <Item key={it.id} it={it} view={view} />
          ))}
        </ul>
      )}
      {p.milestones.length > 0 ? (
        <div className="nextup-milestones">
          <h4>{view.strings.milestones}</h4>
          {p.milestones.map((m) => (
            <Milestone key={m.id} m={m} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function Roadmap({ data, locale, view = "phases", className, children }: RoadmapProps) {
  const fallback = "meta" in data ? data.meta.locales[0] : data.locales[0];
  const vm = buildViewModel(data, locale ?? fallback ?? "en");
  return (
    <div
      className={`nextup-roadmap is-view-${view} is-${vm.audience}${className ? ` ${className}` : ""}`}
      lang={vm.locale}
    >
      <header className="nextup-header">
        <h2>{vm.title}</h2>
        <span className="nextup-version">{vm.versionLine}</span>
        {vm.stale ? <span className="nextup-stale">{vm.staleLabel}</span> : null}
        {children}
      </header>
      <div className="nextup-phases">
        {vm.phases.map((p) => (
          <Phase key={p.id} p={p} view={vm} />
        ))}
      </div>
    </div>
  );
}

export default Roadmap;
