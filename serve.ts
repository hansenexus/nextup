/**
 * `nextup serve` — a loopback-only dev server.
 *
 * Two modes. `--static <dir>` serves a directory `build` produced (that is how
 * the tailnet host publishes the internal site: build on a timer, serve the
 * files, forward the port with `tailscale serve`). Without it, the server
 * renders the internal view of the roadmap(s) under the working directory:
 * `/index.json` and `/<project>/roadmap.internal.json` are recomputed when the
 * yaml changes or every five minutes, and `/events` is a Server-Sent-Events
 * stream the page listens to for reloads.
 *
 * It binds 127.0.0.1 and nothing else. There is no flag for that on purpose:
 * an internal projection carries issue numbers, owners and lane state, and the
 * safe way to share it is a tailnet forward in front of a loopback port.
 */

import { promises as fs, watch } from "node:fs";
import http from "node:http";
import path from "node:path";
import { type LoadedStatus, loadStatus, packageAsset, projectionFor } from "./build";
import {
  type LoadedSkin,
  parseHarnessState,
  renderHarnessFrame,
  renderHarnessPage,
} from "./harness";
import { resolveText } from "./i18n";
import { locate } from "./load";
import { toInternal, toPublic } from "./project";
import { renderRoadmapHTML } from "./render-html";
import type { Skin } from "./types";
import { buildViewModel } from "./view-model";

export interface ServeOptions {
  port: number;
  cwd: string;
  staticDir?: string;
  fleetStatePath?: string | null;
  ttlMs?: number;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function send(
  res: http.ServerResponse,
  status: number,
  body: string | Buffer,
  type = "text/plain; charset=utf-8"
): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function serveFile(root: string, urlPath: string, res: http.ServerResponse): Promise<void> {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  let file = path.join(root, clean);
  if (!file.startsWith(path.resolve(root))) return send(res, 403, "forbidden");
  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) file = path.join(file, "index.html");
    const body = await fs.readFile(file);
    send(res, 200, body, TYPES[path.extname(file)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "not found");
  }
}

/**
 * Read a skin's stylesheets. A skin names paths in a config file, so they are
 * resolved against the repo root and refused if they escape it: `serve` is a
 * dev server, but it should not become a way to read `~/.ssh` through a config
 * someone pasted in. Concatenated in declared order — a host's token file
 * before the file that maps those tokens onto the component.
 */
async function loadSkin(root: string, skin: Skin): Promise<LoadedSkin | null> {
  const parts: string[] = [];
  for (const rel of skin.css) {
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root))) return null;
    try {
      parts.push(await fs.readFile(file, "utf8"));
    } catch {
      // A skin that names a moved file should degrade to the defaults, not 500.
      return null;
    }
  }
  return {
    id: skin.id,
    label: skin.label ?? skin.id,
    css: parts.join("\n"),
    wrapper: skin.wrapper ?? null,
    dark: skin.dark ?? null,
    links: [...(skin.links ?? [])],
  };
}

export function createServer(options: ServeOptions): http.Server {
  const ttl = options.ttlMs ?? 5 * 60 * 1000;
  let cache: { at: number; value: LoadedStatus[] } | null = null;
  const clients = new Set<http.ServerResponse>();

  async function statuses(force = false): Promise<LoadedStatus[]> {
    if (!force && cache && Date.now() - cache.at < ttl) return cache.value;
    const value = await loadStatus({ cwd: options.cwd, fleetStatePath: options.fleetStatePath });
    cache = { at: Date.now(), value };
    return value;
  }

  function notify(): void {
    cache = null;
    for (const c of clients) c.write("event: reload\ndata: {}\n\n");
  }

  if (!options.staticDir) {
    // Watch the roadmap files for edits; debounce because editors write twice.
    void locate(options.cwd).then((located) => {
      if (!located) return;
      let timer: ReturnType<typeof setTimeout> | null = null;
      for (const f of located.files) {
        try {
          watch(path.join(located.root, f), () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(notify, 150);
          });
        } catch {
          // a missing file is reported by loadStatus, not here
        }
      }
    });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (options.staticDir) return serveFile(options.staticDir, url.pathname, res);

    try {
      if (url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        res.write("event: hello\ndata: {}\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const template = await packageAsset("site-template/index.html");
        if (!template) return send(res, 500, "site-template missing");
        const html = (await fs.readFile(template, "utf8"))
          .replaceAll("__AUDIENCE__", "internal")
          .replace(
            "</body>",
            `<script>new EventSource("/events").addEventListener("reload",()=>location.reload())</script></body>`
          );
        return send(res, 200, html, TYPES[".html"]);
      }
      // The harness: one view mode, locale, audience, width and ground at a
      // time, with the axes in the query string so a combination is a link.
      if (url.pathname === "/harness" || url.pathname === "/harness/frame") {
        const all = await statuses();
        const projects = all.map((x) => ({
          id: x.roadmap.meta.project,
          // Chrome only, so the file's own first locale is the right one.
          title: resolveText(x.roadmap.meta.title, x.roadmap.meta.locales[0] ?? "en", [
            ...x.roadmap.meta.locales,
          ]),
          locales: [...x.roadmap.meta.locales],
        }));
        if (projects.length === 0) return send(res, 404, "no roadmap under this directory");
        const located = await locate(options.cwd);
        const declared = located?.skins ?? [];
        const state = parseHarnessState(url.searchParams, { projects, skins: declared });
        if (url.pathname === "/harness")
          return send(
            res,
            200,
            renderHarnessPage({
              projects,
              skins: declared.map((k) => ({ id: k.id, label: k.label ?? k.id })),
              state,
            }),
            TYPES[".html"]
          );
        const found = all.find((x) => x.roadmap.meta.project === state.project);
        if (!found) return send(res, 404, "no such project");
        // `projectionFor` erases the type for the JSON routes; the harness
        // renders it, so it takes the typed projection instead.
        const projection =
          state.audience === "public"
            ? toPublic(found.roadmap, found.rollup)
            : toInternal(found.roadmap, found.rollup, found.file);
        const vm = buildViewModel(projection, state.locale);
        const chosen = declared.find((k) => k.id === state.skin);
        const skin = chosen && located ? await loadSkin(located.root, chosen) : null;
        return send(
          res,
          200,
          renderHarnessFrame(renderRoadmapHTML(vm, state.view), state.theme, state.locale, skin),
          TYPES[".html"]
        );
      }
      if (url.pathname === "/nextup-roadmap.iife.js") {
        const bundle = await packageAsset("dist/wc/nextup-roadmap.iife.js");
        if (!bundle) return send(res, 500, "bundle not built — run `bun run build:wc`");
        return send(res, 200, await fs.readFile(bundle), TYPES[".js"]);
      }
      if (url.pathname === "/index.json") {
        const all = await statuses(url.searchParams.has("refresh"));
        const single = all.length === 1;
        return send(
          res,
          200,
          JSON.stringify(
            all.map((s) => ({
              project: s.roadmap.meta.project,
              title: s.roadmap.meta.title,
              path: single
                ? "roadmap.internal.json"
                : `${s.roadmap.meta.project}/roadmap.internal.json`,
              version: s.roadmap.meta.version,
              updated: s.roadmap.meta.updated,
              stale: s.rollup.stale,
              audience: "internal",
            })),
            null,
            2
          ),
          TYPES[".json"]
        );
      }
      const m = url.pathname.match(/^\/(?:([^/]+)\/)?roadmap\.internal\.json$/);
      if (m) {
        const all = await statuses();
        const s = m[1] ? all.find((x) => x.roadmap.meta.project === m[1]) : all[0];
        if (!s) return send(res, 404, "no such project");
        return send(
          res,
          200,
          JSON.stringify(projectionFor(s, "internal"), null, 2),
          TYPES[".json"]
        );
      }
      return send(res, 404, "not found");
    } catch (e) {
      return send(res, 500, String(e));
    }
  });
}

export function listen(server: http.Server, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve(`http://127.0.0.1:${p}`);
    });
  });
}
