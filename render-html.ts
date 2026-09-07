/**
 * The web component's renderer: a view model in, an HTML string out. Pure and
 * DOM-free so it is testable under node and identical in the shadow root and
 * in a server-side snapshot. Every interpolated value passes through `esc`.
 */

import type { ItemView, MilestoneView, PhaseView, RoadmapView } from "./view-model";

export type ViewMode = "phases" | "list" | "compact";

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

function badge(label: string, cls: string): string {
  return `<span class="nextup-badge is-${esc(cls)}">${esc(label)}</span>`;
}

function renderItem(it: ItemView, view: RoadmapView): string {
  const parts: string[] = [];
  parts.push(
    `<li class="nextup-item is-${esc(it.status)}" id="${esc(view.project)}-${esc(it.id)}" data-item="${esc(it.id)}">`
  );
  parts.push(`<div class="nextup-item-title">${esc(it.title)}${badge(it.statusLabel, it.status)}`);
  if (it.internal && it.internal.visibility === "internal")
    parts.push(badge("internal", "internal"));
  parts.push("</div>");
  if (it.summary) parts.push(`<p class="nextup-item-summary">${esc(it.summary)}</p>`);
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

function renderPhase(p: PhaseView, view: RoadmapView): string {
  const pct = p.progress.total > 0 ? Math.round((p.progress.done / p.progress.total) * 100) : 0;
  const parts: string[] = [];
  parts.push(
    `<section class="nextup-phase is-${esc(p.horizon)}${p.isCurrent ? " is-current" : ""}" data-phase="${esc(p.id)}">`
  );
  parts.push(
    `<div class="nextup-phase-head"><h3>${esc(p.title)}</h3><span class="nextup-horizon">${esc(p.horizonLabel)}${p.target ? ` · ${esc(p.target)}` : ""}</span></div>`
  );
  if (p.goal) parts.push(`<p class="nextup-goal">${esc(p.goal)}</p>`);
  parts.push(`<div class="nextup-meta"><span>${esc(p.progress.label)}</span></div>`);
  parts.push(
    `<div class="nextup-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`
  );
  if (p.items.length === 0) parts.push(`<p class="nextup-empty">—</p>`);
  else {
    parts.push('<ul class="nextup-items">');
    for (const it of p.items) parts.push(renderItem(it, view));
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
  parts.push('<div class="nextup-phases">');
  for (const p of view.phases) parts.push(renderPhase(p, view));
  parts.push("</div></div>");
  return parts.join("");
}
