# 0007. The Export dialog leads with two ways to reach your own site

- **Status:** Accepted
- **Date:** 2026-10-07

## Context

The old Export dialog was a tab list of textareas, one per file: `theme.css`, `APPLY-THEME.md`
and the settings file. Every export sat at the same weight. "Download all (.zip)" sat beside
Import, a screenshot action and the share-link action, with no separation between exports that
reach a user's own site and exports that only serve the customizer itself.

The design assumes that people bring one of two things to their own Astro project: a coding agent
they can paste a message into, or files they can download and unzip. The zip took one click, but
it also held the settings file, which a site never reads. The dialog had no agent message at all.
A person had to copy `theme.css` and `APPLY-THEME.md` separately and hand both to the agent.

## Decision

Redesign the dialog around that choice.

"For your Astro site" leads, with two ways, each one click:

- **"Copy for your coding agent"** copies one Markdown message with the setup steps and the whole
  stylesheet inlined at the end, ready to paste into a coding agent.
- **"Download the files (.zip)"** downloads `theme.css` and `APPLY-THEME.md` together, in one
  folder.

"Other exports" follows, in a quieter column: the customizer's own settings, as a file or a share
link, and a screenshot of the preview. A file viewer below still shows every file, each with its
own Copy and Download, so nothing is exported unseen.

The top bar's **Screenshot** and **Share** buttons open this same dialog, already showing their
own export. The zip drops the settings file, since the site that receives it never reads it.
**Import** moves out of the dialog entirely, into the top bar and into the overlay panel's own
toolbar, since it loads a theme rather than exporting one.

## Consequences

- The settings file's download name changes, from `starlight-theme.json` to
  `<theme-name>.customizer.json`. Any instructions that name the old file no longer match.
- The small screenshot preview costs one capture when the dialog opens. On the Document demo
  page, that capture first took about 30 seconds: the screenshot library waited for a lazy image
  below the fold that never loads on its own. A capture now loads such images first, which brings
  that page to about 3 seconds. Reusing the same capture for Download PNG, and skipping a capture
  that is no longer wanted by the time its turn comes, keeps the cost to one render instead of two.
- A capture can now run after the dialog closes, so the preview can move to another page during
  one. A capture of a page that has gone away never finishes, so the dialog gives it up when the
  page fires `pagehide`. Otherwise every later capture would wait behind it.
- The browser test suites changed to match. A new suite, `export.mjs`, covers the dialog as a
  whole. Six existing suites were updated for the dialog's new markup, the agent message, and the
  top bar's new width steps.

## Alternatives considered

- Several design rounds compared layouts for the same two ways, including a shorter dialog height
  that showed less of each file at once. The chosen design keeps a fixed height, so more of a file
  is visible without scrolling.
- A minimal text level, with less explanatory copy under each action, was tried and set aside, in
  favor of the one-line description each way now carries.
- Social share icons, for posting a theme directly to a platform, were left out. A Web Share
  button, which hands the choice of destination to the operating system, is a possible later
  addition.
