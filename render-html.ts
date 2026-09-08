/**
 * The web component's renderer: a view model in, an HTML string out. Pure and
 * DOM-free so it is testable under node and identical in the shadow root and
 * in a server-side snapshot. Every interpolated value passes through `esc`.
 */

import type { ItemView, MilestoneView, PhaseView, RoadmapView } from "./view-model";

/**
 * `phases`, `list` and `compact` share one markup and differ only by the
 * `is-view-*` class. `ledger` and `bands` do not: a ledger needs a status cell
 * of its own so the glyph, the title and the status word can hold three fixed
 * columns, and bands walk `statusGroups` instead of `phases`. Both are
 * additive — the three original modes emit exactly what they emitted before.
 */
export type ViewMode = "phases" | "list" | "compact" | "ledger" | "bands";

const CELL_MODES: ReadonlySet<ViewMode> = new Set<ViewMode>(["ledger", "bands"]);

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

function badge(label: string, cls: string): string {
  return `<span class="nextup-badge is-${esc(cls)}">${esc(label)}</span>`;
}

function renderItem(it: ItemView, view: RoadmapView, mode: ViewMode = "phases"): string {
  const cells = CELL_MODES.has(mode);
  const parts: string[] = [];
  parts.push(
    `<li class="nextup-item is-${esc(it.status)}" id="${esc(view.project)}-${esc(it.id)}" data-item="${esc(it.id)}">`
  );
  // The glyph is decorative: the status is already written out beside it.
  if (cells) parts.push('<span class="nextup-mark" aria-hidden="true"></span>');
  parts.push(
    `<div class="nextup-item-title">${esc(it.title)}${cells ? "" : badge(it.statusLabel, it.status)}`
  );
  if (it.internal && it.internal.visibility === "internal")
    parts.push(badge("internal", "internal"));
  parts.push("</div>");
  if (it.summary) parts.push(`<p class="nextup-item-summary">${esc(it.summary)}</p>`);
  if (cells) {
    if (mode === "bands")
      parts.push(
        `<span class="nextup-item-phase">${esc(it.phaseId)} · ${esc(it.phaseTitle)}</span>`
      );
    parts.push(`<span class="nextup-item-status">${esc(it.statusLabel)}</span>`);
  }
  if (it.links.length > 0) {
    parts.push('<ul class="nextup-links">');
    for (const l of it.links)
      parts.push(`<li><a href="${esc(l.url)}" rel="noopener">${esc(l.title)}</a></li>`);
    parts.push("</ul>");
  }
  if (it.internal) {
    const i = it.internal;
    parts.push('<div class="nextup-internal">');
    parts.push(`<div>${esc(i.because)}</div>`);
    if (i.issues.length > 0) {
      parts.push("<ul>");
      for (const iss of i.issues) {
        parts.push(
          `<li class="is-${esc(iss.state)}"><a href="${esc(iss.url)}" rel="noopener">#${iss.number}</a> ${esc(iss.title)} · ${esc(iss.state)}${iss.lane ? ` · ${esc(view.strings.lane)} ${esc(iss.lane)}` : ""}</li>`
        );
      }
      parts.push("</ul>");
    }
    const pending = i.tasks.filter((t) => t.dispatched === null);
    if (pending.length > 0)
      parts.push(
        `<div>${pending.length} task(s) not dispatched: ${esc(pending.map((t) => t.id).join(", "))}</div>`
      );
    for (const w of i.warnings) parts.push(`<div class="nextup-warning">${esc(w)}</div>`);
    parts.push("</div>");
  }
  parts.push("</li>");
  return parts.join("");
}

function renderMilestone(m: MilestoneView): string {
  return `<div class="nextup-milestone is-${esc(m.status)}"><span class="nextup-date">${esc(m.dateLabel)}</span><span>${esc(m.title)}</span>${badge(m.statusLabel, m.status)}</div>`;
}

function renderPhase(p: PhaseView, view: RoadmapView, mode: ViewMode = "phases"): string {
  const pct = p.progress.total > 0 ? Math.round((p.progress.done / p.progress.total) * 100) : 0;
  const parts: string[] = [];
  parts.push(
    `<section class="nextup-phase is-${esc(p.horizon)}${p.isCurrent ? " is-current" : ""}" data-phase="${esc(p.id)}">`
  );
  parts.push(
    `<div class="nextup-phase-head"><h3>${esc(p.title)}</h3><span class="nextup-horizon">${esc(p.horizonLabel)}${p.target ? ` · ${esc(p.target)}` : ""}</span></div>`
  );
  if (p.getsYou) parts.push(`<p class="nextup-gets">${esc(p.getsYou)}</p>`);
  if (p.goal) parts.push(`<p class="nextup-goal">${esc(p.goal)}</p>`);
  parts.push(`<div class="nextup-meta"><span>${esc(p.progress.label)}</span></div>`);
  parts.push(
    `<div class="nextup-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`
  );
  if (p.items.length === 0) parts.push(`<p class="nextup-empty">—</p>`);
  else {
    parts.push('<ul class="nextup-items">');
    for (const it of p.items) parts.push(renderItem(it, view, mode));
    parts.push("</ul>");
  }
  if (p.milestones.length > 0) {
    parts.push(`<div class="nextup-milestones"><h4>${esc(view.strings.milestones)}</h4>`);
    for (const m of p.milestones) parts.push(renderMilestone(m));
    parts.push("</div>");
  }
  parts.push("</section>");
  return parts.join("");
}

/**
 * One band per status. Empty groups are dropped, except the two that mean
 * something by their absence: a roadmap with nothing in progress and nothing
 * blocked should say so rather than quietly omit the row.
 */
function renderBands(view: RoadmapView): string {
  const parts: string[] = ['<div class="nextup-bands">'];
  for (const g of view.statusGroups) {
    if (g.items.length === 0 && g.status !== "in-progress" && g.status !== "blocked") continue;
    parts.push(`<section class="nextup-band is-${esc(g.status)}" data-status="${esc(g.status)}">`);
    parts.push(
      `<div class="nextup-band-head"><h3>${esc(g.label)}</h3><span class="nextup-count">${g.items.length}</span></div>`
    );
    if (g.items.length === 0) parts.push(`<p class="nextup-empty">—</p>`);
    else {
      parts.push('<ul class="nextup-items">');
      for (const it of g.items) parts.push(renderItem(it, view, "bands"));
      parts.push("</ul>");
    }
    parts.push("</section>");
  }
  parts.push("</div>");
  return parts.join("");
}

export function renderRoadmapHTML(view: RoadmapView, mode: ViewMode = "phases"): string {
  const parts: string[] = [];
  parts.push(
    `<div class="nextup-roadmap is-view-${esc(mode)} is-${esc(view.audience)}" lang="${esc(view.locale)}">`
  );
  parts.push(
    `<header class="nextup-header"><h2>${esc(view.title)}</h2><span class="nextup-version">${esc(view.versionLine)}</span>`
  );
  if (view.stale) parts.push(`<span class="nextup-stale">${esc(view.staleLabel)}</span>`);
  parts.push("</header>");
  if (mode === "bands") {
    parts.push(renderBands(view));
    parts.push("</div>");
    return parts.join("");
  }
  parts.push('<div class="nextup-phases">');
  for (const p of view.phases) parts.push(renderPhase(p, view, mode));
  parts.push("</div></div>");
  return parts.join("");
}
