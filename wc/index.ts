/**
 * `<nextup-roadmap>` — framework-free custom element.
 *
 *   <script src="https://…/nextup-roadmap.iife.js"></script>
 *   <nextup-roadmap src="./roadmap.public.json" lang="de" view="phases"></nextup-roadmap>
 *
 * Or hand it data from script: `el.data = json`. Styles live in the shadow
 * root and are driven by `--nextup-*` variables, which inherit through the
 * shadow boundary, so a host page restyles it with plain CSS custom
 * properties on the element.
 */

import { renderRoadmapHTML, type ViewMode } from "../render-html";
import { STYLES } from "../styles";
import { type AnyRoadmap, buildViewModel } from "../view-model";

const MODES = new Set<ViewMode>(["phases", "list", "compact"]);

export class NextupRoadmapElement extends HTMLElement {
  static readonly observedAttributes = ["src", "lang", "view"];
  private _data: AnyRoadmap | null = null;
  private _abort: AbortController | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  get data(): AnyRoadmap | null {
    return this._data;
  }

  set data(value: AnyRoadmap | null) {
    this._data = value;
    this.render();
  }

  connectedCallback(): void {
    if (this.getAttribute("src")) void this.load();
    else this.render();
  }

  disconnectedCallback(): void {
    this._abort?.abort();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (name === "src" && newValue) void this.load();
    else this.render();
  }

  async load(): Promise<void> {
    const src = this.getAttribute("src");
    if (!src) return;
    this._abort?.abort();
    this._abort = new AbortController();
    try {
      const res = await fetch(src, { signal: this._abort.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${src}`);
      this._data = (await res.json()) as AnyRoadmap;
      this.render();
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      this.renderError(String(e));
    }
  }

  private locale(): string {
    return (
      this.getAttribute("lang") ||
      (typeof document !== "undefined" ? document.documentElement.lang : "") ||
      "en"
    );
  }

  private mode(): ViewMode {
    const v = this.getAttribute("view") as ViewMode | null;
    return v && MODES.has(v) ? v : "phases";
  }

  render(): void {
    const root = this.shadowRoot;
    if (!root) return;
    if (!this._data) {
      root.innerHTML = `<style>${STYLES}</style><div class="nextup-roadmap"><p class="nextup-empty">…</p></div>`;
      return;
    }
    const view = buildViewModel(this._data, this.locale());
    root.innerHTML = `<style>${STYLES}</style>${renderRoadmapHTML(view, this.mode())}`;
  }

  private renderError(message: string): void {
    const root = this.shadowRoot;
    if (!root) return;
    const safe = message.replace(/[<>&]/g, "");
    root.innerHTML = `<style>${STYLES}</style><div class="nextup-roadmap"><p class="nextup-empty nextup-warning">${safe}</p></div>`;
  }
}

export function defineNextupRoadmap(tag = "nextup-roadmap"): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(tag)) customElements.define(tag, NextupRoadmapElement);
}

defineNextupRoadmap();
