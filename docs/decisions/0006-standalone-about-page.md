# 0006. The About page is a standalone Astro page, not Starlight content

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

The project needed a page at `/about/` that explains the tool and links to Starlight's own docs.
It had to be reachable by a direct link, as well as from a dialog inside the studio. The obvious
place for a new page in an Astro Starlight project is `app/src/content/docs/`, alongside the
demo site's own pages. That is where Starlight content normally lives.

## Decision

`/about/` is its own Astro page, `app/src/pages/about.astro`, built outside Starlight's content
collection. Its header comment states the reason directly. A page under `src/content/docs/`
joins the demo site. The studio's no-flash theme-preload script would then paint the visitor's
current theme preview over it. The page would also show up in the demo site's sidebar and
search results. The page frame in `about.astro` reuses the studio's own light-chrome tokens. The
body text lives separately, in `app/src/about/about.md`, rendered through
`app/src/about/AboutBody.astro`. That lets the same text also appear in the studio's in-app
About dialog, opened from the top bar and built in PR #3 (studio branding). The product page at
the root URL followed the same reasoning, once it needed a standalone page of its own. See
[0001 (product page at root)](0001-product-page-at-root.md).

## Consequences

- The About page never shows the visitor's own in-progress theme preview, because it sits outside
  the preload script's reach. It also stays out of the demo site's sidebar and search index.
- The body text (`app/src/about/about.md`) is the single source for both the dialog and the
  standalone page, so the two never drift apart.
- The page frame duplicates some chrome tokens and basic styles that a Starlight content page
  would otherwise inherit for free. It does this since it opts out of Starlight's layout entirely.
- The page's `<head>` is its own to maintain. Meta tags such as the social preview card must be
  added to `about.astro` by hand, because Starlight's head handling does not reach it.

## Alternatives considered

- A Starlight content page at `src/content/docs/about.md`. Rejected because it would join the
  demo site's sidebar and search, and because the theme-preview preload script would run on it.
- Only the in-studio dialog, with no standalone page. Rejected because the project wanted a page
  that works as a direct, shareable link outside the studio.
