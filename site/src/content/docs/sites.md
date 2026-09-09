---
title: Public sites
description: Render a roadmap in React, in any HTML page, or as a static page.
---

The public projection is a whitelist. `roadmap.public.json` carries the
project, its phases with horizon and progress, the public items with title,
summary, phase, horizon, status and links, and the public milestones. No issue
numbers, owners, notes, lane state, tasks or internal items ever leave —
the package's own tests walk the output for forbidden keys. `blocked` is
shown as `in-progress` (or `planned`, per `presentation.show_blocked_as`).

Every projection carries `version`, `updated`, `generated_at` and `stale`;
the components render "v3 · Stand 2026-09-07" and a *Stand veraltet* badge
when the data is stale.

Item links arrive resolved: a relative `url` in the yaml is already a
`https://github.com/<repo>/blob/HEAD/…` URL by the time a component sees it
(see [roadmap.yaml → links](/roadmap-yaml/#links)), so a site never emits an
href that resolves against its own origin by accident.

Each phase's progress bar is a `role="progressbar"` counted in items
(`aria-valuenow` done, `aria-valuemax` total) and named in the requested
locale — "3 of 8 done" / "3 von 8 erledigt" — so a screen reader announces
the phase's progress rather than a bare bar.

## React

```tsx
import { loadPublicRoadmap } from "@hansenexus/nextup";
import { Roadmap } from "@hansenexus/nextup/react";
import "@hansenexus/nextup/react/styles.css";

export const revalidate = 3600;

export default async function Page() {
  const data = await loadPublicRoadmap({
    url: "https://org.github.io/repo/roadmap.public.json",
  });
  return <Roadmap data={data} locale="de" view="phases" />;
}
```

`<Roadmap>` is hook-free and fetch-free: it renders in a server component,
in a static export, anywhere. Props: `data`, `locale`, `view` (`phases` |
`list` | `compact`), `className`, and `children` rendered after the header
(a link to the full page, say).

`loadPublicRoadmap` takes either `{ url }` — an already-published projection,
validated on arrival — or `{ file, token? }` — the yaml in this repo, rolled
up from GitHub when a token is given, projected on the spot. Prefer `url`
for anything that builds in a container: an image build rarely holds a token,
and a build-time read freezes status until the next deploy.

## Any HTML page

```html
<script src="https://org.github.io/repo/nextup-roadmap.iife.js"></script>
<nextup-roadmap src="./roadmap.public.json" lang="en" view="phases"></nextup-roadmap>
```

The custom element fetches `src` (or takes `data` as a JSON attribute), renders
in a shadow root and reacts to attribute changes. Same markup, same class
names as the React component.

## Styling

Both renderers use the same CSS custom properties. Override them on a
wrapper:

```css
.my-roadmap {
  --nextup-fg: #ece9e2;
  --nextup-bg: transparent;
  --nextup-accent: #7ad38a;
}
```

Read `@hansenexus/nextup/react/styles.css` for the full list; it is
generated from the same source the web component embeds.

## Aggregating several projects

A site that shows more than one roadmap keeps a committed list of URLs and
fetches them with `Promise.allSettled`, rendering each with
`view="compact"` and a per-project "unavailable" note when one fails. A
projection is a static file on a CDN; the page needs no shared state and no
tokens.
