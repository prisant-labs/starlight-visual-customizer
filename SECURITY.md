# Security policy

## Supported versions

The live studio at <https://projects.prisantlabs.com/starlight-visual-customizer/> always runs the
latest code on `main`, and security fixes land there first. Before 1.0, only the newest release
receives fixes.

| Version | Supported |
|---|---|
| `main`, and the live studio | Yes |
| The latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately instead:

1. Open the repository's [Security tab](https://github.com/prisant-labs/starlight-visual-customizer/security).
2. Choose **Report a vulnerability**. This opens a private advisory that only the maintainers can
   see.

Include the steps to reproduce the problem and the browser you used. If a share link triggers it,
include the link: a share link carries a whole theme, so it usually reproduces the problem exactly.

We will acknowledge your report, work on a fix, and credit you in the advisory unless you would
rather stay anonymous. This is a small project, so a reply can take a few days.

## What is in scope

The studio runs entirely in your browser and has no server. Its real risks lie in what it reads
and in what it writes:

- **Share links.** A share link carries a theme in its `#svc=` fragment, and anyone can craft one.
  Anything that a link can make the studio run or load is in scope.
- **Imported theme files.** The same applies to a `state.json` file opened with **Import
  state.json**.
- **Exports.** `theme.css` and `APPLY-THEME.md` end up in other people's repositories, and coding
  agents follow `APPLY-THEME.md` step by step. A theme name, a site title or a sidebar label ends
  up in that file. Any theme that makes an export carry unexpected code, configuration or
  instructions is in scope.

## What is out of scope

- **Bugs in Starlight or Astro themselves.** Please report those to
  [withastro/starlight](https://github.com/withastro/starlight) or
  [withastro/astro](https://github.com/withastro/astro).
- **Third-party services.** These are the web fonts that the studio loads from jsDelivr, and GitHub
  Pages, which hosts the site.
- **Dependency advisories that only affect a server,** such as shared HTTP cache issues. The site
  is a static build with no server of its own.
