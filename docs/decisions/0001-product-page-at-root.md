# 0001. The root URL serves a product page; the studio stays at /studio/

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

The root URL needs an owner. For a while it showed the demo site's own splash page, under the
demo's old name. A script on that page forwarded other top-level visits to `/studio/`. The splash
page's main button opened a getting-started guide, not the studio, so a visitor who landed there
directly could miss the studio.

An earlier plan picked a different fix. It would rename `app/src/pages/studio.astro` to
`app/src/pages/index.astro`, so the studio itself took over the root. The splash page would move
to its own path, and `/studio/` would forward back to `/`. The maintainer approved this plan
first. Before it was built, the maintainer compared five layouts for the root URL. That
comparison led to a different choice, and the earlier plan was dropped.

## Decision

The root URL (`app/src/pages/index.astro`) serves a product page instead. It has a headline, an
"Open the studio" link, a "View on GitHub" link, and the studio shown in several presets behind
tabs.
The studio keeps its own address at `/studio/` (`app/src/pages/studio.astro`). Two pull requests
built this in order. PR #10 (demo under /demo/) moved the demo site, named "Orbit Docs", under
`/demo/`, and made the root forward to `/studio/` as a temporary step. PR #12 (product page at
the root) then replaced that temporary forward with the actual product page.

A root link whose hash starts with `#svc=` (a shared theme) still forwards straight to the studio
with its query string and hash. Every other visit to `/` renders the product page.

## Consequences

- The pitch ("what is this") and the tool ("use it") are two pages. So each can be designed for
  its own job, rather than one page serving both.
- The demo site can carry a fictional name and pretend product content, such as a sample pricing
  page. That content never attaches to the real product's name.
- A shared theme link still opens directly in the studio, so existing share links keep working.
- The product page adds one more surface to maintain. That includes its own screenshots, its own
  end-to-end suite (`home.mjs`), and a recapture step whenever the studio's chrome changes. That
  happened once already, after PR #13 (studio chrome).

## Alternatives considered

- Move the studio to the root URL and forward `/studio/` back to it. Decided on 2026-09-30,
  then reversed on 2026-10-01 after comparing five layouts side by side.
- Leave the demo site's splash page at the root. Rejected because its title doubled the demo's
  old product name, and its main action led away from the studio.
