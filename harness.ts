/**
 * `nextup serve` → `/harness` — the inspection surface for the views.
 *
 * A roadmap has to survive more than one shape: five view modes, every locale
 * the file declares, both audiences, a phone and a desktop, and both grounds.
 * That is a combinatorial space nobody checks by hand, so this renders one
 * combination in an iframe and puts the axes in a toolbar above it. The state
 * lives in the query string, which makes any single combination a link — the
 * useful currency when the answer is "look at THIS one".
 *
 * Pure: HTML strings in and out, no DOM and no data loading (`serve.ts` owns
 * both), so every axis can be asserted under node.
 */

import { esc, type ViewMode } from "./render-html";
import { STYLES } from "./styles";

export const VIEW_MODES: readonly ViewMode[] = [
  "phases",
  "list",
  "compact",
  "ledger",
  "bands",
] as const;

export type Theme = "light" | "dark";
export type Audience = "public" | "internal";

export interface Device {
  id: string;
  label: string;
  width: number;
  /** null means "as tall as the viewport allows". */
  height: number | null;
}

/** Widths that actually change a layout decision, not a catalogue of handsets. */
export const DEVICES: readonly Device[] = [
  { id: "phone", label: "Phone", width: 390, height: 844 },
  { id: "phone-l", label: "Phone L", width: 430, height: 932 },
  { id: "tablet", label: "Tablet", width: 768, height: 1024 },
  { id: "laptop", label: "Laptop", width: 1280, height: null },
  { id: "desktop", label: "Desktop", width: 1600, height: null },
  { id: "fit", label: "Fit", width: 0, height: null },
] as const;

export interface HarnessState {
  project: string;
  view: ViewMode;
  locale: string;
  audience: Audience;
  device: string;
  theme: Theme;
  landscape: boolean;
}

export interface HarnessOptions {
  projects: { id: string; title: string; locales: string[] }[];
  state: HarnessState;
}

export function parseHarnessState(
  params: URLSearchParams,
  opts: { projects: HarnessOptions["projects"] }
): HarnessState {
  const first = opts.projects[0];
  const project = params.get("project") ?? first?.id ?? "";
  const known = opts.projects.find((p) => p.id === project) ?? first;
  const view = params.get("view") as ViewMode | null;
  const device = params.get("device") ?? "laptop";
  const theme = params.get("theme");
  const locale = params.get("locale");
  return {
    project: known?.id ?? "",
    view: view && VIEW_MODES.includes(view) ? view : "ledger",
    locale: locale && known?.locales.includes(locale) ? locale : (known?.locales[0] ?? "en"),
    audience: params.get("audience") === "public" ? "public" : "internal",
    device: DEVICES.some((d) => d.id === device) ? device : "laptop",
    theme: theme === "dark" ? "dark" : "light",
    landscape: params.get("landscape") === "1",
  };
}

export function harnessFrameQuery(s: HarnessState): string {
  return new URLSearchParams({
    project: s.project,
    view: s.view,
    locale: s.locale,
    audience: s.audience,
    theme: s.theme,
  }).toString();
}

/**
 * The framed document: the roadmap and nothing else, so what the iframe
 * measures is the component's own behaviour at that width rather than the
 * harness chrome's.
 */
export function renderHarnessFrame(body: string, theme: Theme, locale: string): string {
  return `<!doctype html><html lang="${esc(locale)}" data-nextup-theme="${esc(theme)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
${STYLES}
html { color-scheme: ${theme}; }
body { margin: 0; padding: 20px; background: ${theme === "dark" ? "#0d0d0d" : "#ffffff"};
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
</style></head><body>${body}</body></html>`;
}

function option(value: string, label: string, selected: string): string {
  return `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
}

export function renderHarnessPage(opts: HarnessOptions): string {
  const { projects, state } = opts;
  const project = projects.find((p) => p.id === state.project);
  const src = `/harness/frame?${harnessFrameQuery(state)}`;
  const sel = (name: string, html: string, label: string) =>
    `<label class="f"><span>${esc(label)}</span><select name="${esc(name)}">${html}</select></label>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>nextup harness · ${esc(project?.title ?? "")}</title><style>
:root { color-scheme: light dark; --bg:#fbfbfb; --fg:#1a1a1a; --mut:#6b6b6b; --line:#e0e0e0; --chrome:#fff; }
@media (prefers-color-scheme: dark) { :root { --bg:#151515; --fg:#ececec; --mut:#a0a0a0; --line:#303030; --chrome:#1d1d1d; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;
  display:flex; flex-direction:column; height:100vh; }
header { display:flex; flex-wrap:wrap; gap:14px 18px; align-items:flex-end; padding:10px 16px;
  background:var(--chrome); border-bottom:1px solid var(--line); }
.f { display:flex; flex-direction:column; gap:3px; }
.f > span { font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:var(--mut); }
select { font:inherit; padding:4px 6px; background:var(--chrome); color:var(--fg);
  border:1px solid var(--line); border-radius:4px; min-width:104px; }
.seg { display:flex; border:1px solid var(--line); border-radius:4px; overflow:hidden; }
.seg a { padding:5px 10px; text-decoration:none; color:var(--fg); background:var(--chrome); font-size:12px; }
.seg a + a { border-left:1px solid var(--line); }
.seg a.on { background:var(--fg); color:var(--chrome); }
.grow { flex:1; }
.dims { font-variant-numeric:tabular-nums; color:var(--mut); white-space:nowrap; }
.dims b { color:var(--fg); font-weight:600; }
main { flex:1; overflow:auto; display:flex; justify-content:center; padding:18px; }
.stage { background:var(--chrome); border:1px solid var(--line); border-radius:6px; overflow:hidden;
  box-shadow:0 1px 3px rgba(0,0,0,.07); height:fit-content; }
iframe { display:block; border:0; width:100%; height:100%; }
noscript { color:var(--mut); }
</style></head><body>
<header>
  <form id="ctl" class="f" style="flex-direction:row; gap:14px; align-items:flex-end; margin:0;">
    ${projects.length > 1 ? sel("project", projects.map((p) => option(p.id, p.title, state.project)).join(""), "Project") : ""}
    ${sel("view", VIEW_MODES.map((m) => option(m, m, state.view)).join(""), "View")}
    ${sel("locale", (project?.locales ?? ["en"]).map((l) => option(l, l, state.locale)).join(""), "Locale")}
    ${sel("audience", ["internal", "public"].map((a) => option(a, a, state.audience)).join(""), "Audience")}
    ${sel("device", DEVICES.map((d) => option(d.id, d.width ? `${d.label} · ${d.width}` : d.label, state.device)).join(""), "Device")}
    ${sel("theme", ["light", "dark"].map((t) => option(t, t, state.theme)).join(""), "Theme")}
  </form>
  <div class="f"><span>Orientation</span><div class="seg">
    <a href="#" data-set="landscape=0" class="${state.landscape ? "" : "on"}">Portrait</a>
    <a href="#" data-set="landscape=1" class="${state.landscape ? "on" : ""}">Landscape</a>
  </div></div>
  <div class="grow"></div>
  <div class="dims"><b id="wh">—</b> · <a href="${esc(src)}" target="_blank" rel="noopener">open frame</a></div>
</header>
<main><div class="stage" id="stage"><iframe id="f" src="${esc(src)}" title="roadmap preview"></iframe></div></main>
<script>
const DEVICES = ${JSON.stringify(DEVICES)};
const state = ${JSON.stringify(state)};
function apply() {
  const d = DEVICES.find((x) => x.id === state.device) || DEVICES[3];
  const stage = document.getElementById("stage");
  const main = document.querySelector("main");
  const avail = main.clientHeight - 36;
  let w = d.width, h = d.height;
  if (state.landscape && d.height) { w = d.height; h = d.width; }
  if (!d.width) { w = main.clientWidth - 36; h = avail; }
  stage.style.width = w + "px";
  stage.style.height = (h ? Math.min(h, avail) : avail) + "px";
  document.getElementById("wh").textContent = w + " × " + stage.clientHeight;
}
function go(patch) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) q.set(k, v);
  location.search = q.toString();
}
document.getElementById("ctl").addEventListener("change", (e) => {
  go({ [e.target.name]: e.target.value });
});
for (const a of document.querySelectorAll("[data-set]")) {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const [k, v] = a.dataset.set.split("=");
    go({ [k]: v });
  });
}
addEventListener("resize", apply);
apply();
// The server already streams reloads when a roadmap file changes; reload only
// the frame, so the toolbar keeps its scroll position and focus.
new EventSource("/events").addEventListener("reload", () => {
  const f = document.getElementById("f");
  f.src = f.src;
});
</script>
</body></html>`;
}
