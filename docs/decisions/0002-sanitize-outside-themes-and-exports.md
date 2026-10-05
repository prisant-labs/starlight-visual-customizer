# 0002. Check every outside theme on entry, and guard export output again

- **Status:** Accepted
- **Date:** 2026-10-03

## Context

A theme can reach the studio three ways: a share link, the theme saved in the browser's local
storage, and an imported `state.json` file. None of these three paths checked the values they
carried, and the two exporters, `app/src/customizer/core/emit-css.js` and
`app/src/customizer/core/emit-apply.js`, printed those values as given.

This matters because an export does not stay inside the studio. `theme.css` and
`APPLY-THEME.md` end up in someone else's repository. `APPLY-THEME.md` opens by telling the
reader to hand its numbered steps to a coding agent, which then executes them in order. Before
the fix, a crafted share link could add a `<script>` tag to the generated config. It could also
add an extra numbered step that ran a downloaded shell script, or carry CSS rules through a role
color. Exploiting this needed only one victim. That victim opened a bad link, exported the
theme, and passed `APPLY-THEME.md` to an agent without reading it first. That is the exact
workflow the project promotes. `SECURITY.md` names share links, imported `state.json` files, and
exports as the project's real attack surface, separate from bugs in Starlight, Astro, or the
hosting platform.

## Decision

Every theme that arrives from outside the studio passes through `sanitizeState` in
`app/src/customizer/core/state.js` before it reaches anything else. Decoding a share link and
loading the saved theme both call it. Importing a `state.json` file calls it too.
`sanitizeState` rebuilds the theme field by field. Each value must fit its control. That means a
number inside its range, a listed option, a boolean, a hex color, or one line of text under a
length cap. Unknown controls and an unknown preset are dropped. Sidebar slugs and directories must be
plain paths inside `src/content/docs/`, checked against an allowlist. Sidebar link attributes
keep only one-line primitive values under attribute-shaped names.

The two exporters also guard their own output, as a second line of defense for any future code
path that skips the check. Configuration lines accept only numbers and booleans. String literals
escape line breaks and backticks. The site title is escaped wherever it appears in prose, and
role colors must be valid hex. PR #23 (export sanitizer) shipped this change. An adversarial
review of the first version found one blocker and four smaller issues, all fixed with regression
tests before merge. The blocker: sidebar attributes could close `APPLY-THEME.md`'s code fence.

## Consequences

- A crafted share link, saved theme, or imported file can no longer add code, an extra step, or a
  CSS rule to an export.
- The live studio runs the same code as `main`, so the fix protects people using the site today,
  not only future exports.
- Two layers of checking (the entry point and the exporters) cost more code than one. But the
  exporters stay safe even if a future caller forgets to sanitize first.
- The site title stays a residual, accepted risk. It is the user's own text, capped at 60
  characters, and it can appear inside quotes in `APPLY-THEME.md`. It cannot add a line, a step,
  a link, or a code span, and it shows in the preview before export.

## Alternatives considered

- Check only at the exporters, not at the three entry points. Rejected because a share link or an
  imported file could still crash the studio itself with a malformed value before export.
- Check only at the entry points, not at the exporters. Rejected because any future code path that
  builds an export without going through the shared state module would reopen the hole.
