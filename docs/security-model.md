# Security model

[`SECURITY.md`](../SECURITY.md) explains how to report a vulnerability and what is in scope. This document explains how the code defends itself. A contributor needs it to keep those defenses intact.

## The setting

The Starlight Visual Customizer is a static site. It has no server, no accounts and no database. A visitor's theme lives only in that visitor's own browser. The live deployment is a plain build served from GitHub Pages, as [`development.md`](development.md#the-live-deployment) describes. Nothing a visitor does reaches the maintainer or any other visitor.

Because there is no server, the usual server-side risks do not apply. There is no session to hijack, no database to inject into and no server log to poison. The real risk sits elsewhere.

A theme can arrive from outside the studio: a share link, a saved browser theme, or an imported file. That theme's values then flow into two kinds of output. One kind renders inside the browser, in the live preview. The other kind leaves the browser as files: `theme.css`, `APPLY-THEME.md` and the state file. A person or a coding agent follows `APPLY-THEME.md` step by step, inside whatever repository receives the export. [`SECURITY.md`](../SECURITY.md) names this as the scope that matters, and this document explains how the code protects it.

## Untrusted inputs

Input from outside the studio arrives in four ways. Each way skips the studio's own controls, so none of them can be trusted the way a clicked or dragged value can.

| Entry point | Carries | Read by |
|---|---|---|
| A share link's `#svc=` fragment | A whole encoded theme: values, sidebar structure, and the theme name | `tryDecodeState` in `app/src/customizer/core/state.js`, called from `resolveInitialTheme` in `app/src/customizer/core/share-link.js` |
| A share link's `?page=` parameter | Only the page to open; nothing else in the query string survives | `buildShareUrl` in `app/src/customizer/core/share-link.js` |
| The theme saved in this browser's `localStorage` | The same encoded theme a share link carries, written by an earlier visit to the studio | `loadInitialState` in `app/src/customizer/ui/panel.js`, which also calls `tryDecodeState` |
| An imported `state.json` file | The same theme shape, as plain JSON | `importStateFromJson` in `app/src/customizer/ui/panel.js`, reached through the file input in `app/src/customizer/ui/export.js` |

All four paths end at the same gate. That gate is `sanitizeState` in `app/src/customizer/core/state.js`. `tryDecodeState` calls it after decoding a share link or a saved theme. `importStateFromJson` calls it directly on a parsed `state.json`. No entry point may skip it.

`state.js` offers two decoders, and a new entry point should pick the right one:

- **`decodeState` is tolerant.** Any failure - bad base64, bad JSON or the wrong shape - falls back to `defaultState()`.
- **`tryDecodeState` is strict.** It returns `null` on the same failures, so a caller can tell a broken encoding from a real, empty theme.

The share-link path needs the strict decoder. A damaged link can then say so, instead of silently resetting a visitor's saved theme.

An imported state file gets the same treatment as a share link, not a lighter one. The comment on `importStateFromJson` in `app/src/customizer/ui/panel.js` says so: "An imported file is as untrusted as a share link: same checks (`sanitizeState`)." The import is also one undo step, so Undo reverses a bad import the same way it reverses an unwanted shared theme.

## What leaves the browser, and what reaches the page

Four kinds of output carry a theme's values somewhere they could do harm if left unchecked.

- **`theme.css`**, built by `emitCss` in `app/src/customizer/core/emit-css.js`. A visitor copies this file into their own site. It loads with no CSS layer, so it wins any tie against their own styles.
- **`APPLY-THEME.md`**, built by `emitApplyTheme` in `app/src/customizer/core/emit-apply.js`. It opens by telling the reader to paste the whole file to a coding agent, then let the agent run every step in order. Anything this file can make an agent do is in scope here, not only what it can make a browser render.
- **`state.json`**, the raw `ThemeState` object. The export dialog offers it for Copy and Download, and an import reads that same shape back in.
- **Share links**, built by `buildShareUrl` in `app/src/customizer/core/share-link.js`. Anyone who receives a link can open it, and anyone can hand-craft one without ever touching the studio.

A theme's values also reach the live preview's own DOM. The theme name shows in the top bar. The site title renders into `.site-title`. The sidebar's labels and links render through the Structure (advanced) editor. An unchecked value reaching any of these four outputs could inject CSS, add a Markdown step, add a script link, or add an event handler. PR #14 (share-link fixes) and PR #23 (export sanitizer) each found and fixed a real instance of this.

## The defenses

### The single entry gate: sanitizeState

`sanitizeState` in `app/src/customizer/core/state.js` rebuilds a theme field by field. Nothing passes through by being copied wholesale.

- **Control values** go through `sanitizeValue`. Each value must fit its own control's declared shape. A `range` value becomes a finite number, clamped to that control's min and max. It is not snapped to the control's step, since a preset can deliberately sit between steps. A `select` or `font` value must match one of that control's own listed options. A `toggle` must be a real boolean. A `color` must be the literal string `auto` or a six-digit hex code, checked by `isHexColor`. A `text` value becomes one line, cut to that control's own `maxLength`.
- **Unknown ids are dropped.** An id that names no real control never reaches `state.values`. An unknown preset id falls back to `starlight-default`.
- **The sidebar is rebuilt, never copied,** by `sanitizeIaItems` and `sanitizeIaItem`. A slug or an `autogenerate` directory must pass `isSafeDocPath` in `app/src/customizer/core/ia.js`. Every path segment must be letters, digits, marks, `.`, `_`, or `-`; the segments `.` and `..` are rejected outright. This is an allowlist, not a denylist, so nothing like `$(...)` can reach a path a coding agent might later put in a shell command. The tree is capped at 8 levels deep and 1000 items in total, so a crafted link cannot make the editor hang.
- **Text and labels pass through `toSingleLine`** in `app/src/customizer/core/ia.js`. It turns every control character, including a line break, into a space. A theme's text ends up inside `APPLY-THEME.md`, where a raw line break could start a new Markdown step.

A theme the studio itself produced comes back from `sanitizeState` byte for byte unchanged. `app/tests/core/sanitize.test.js` checks that property first, before it checks what a crafted theme loses.

### Link and attribute filtering

A sidebar link's `href` and its `attrs` get their own filter. That filter runs independently of `sanitizeState`, because it also runs on the live preview's rendered sidebar, not only on export.

- **`safeLinkHref`**, in `app/src/customizer/core/ia.js`, keeps a link unchanged when it is relative, root-relative, a fragment, or uses `http`, `https`, or `mailto`. It rewrites anything else to `#`: `javascript:`, `data:`, `vbscript:`, `file:`, and the rest. It reads a link's scheme the way a browser does. Leading control characters and spaces are stripped first, and tabs and newlines inside the scheme are removed too. That order stops a link like `java\tscript:alert(1)` from slipping past as some other scheme.
- **`safeLinkAttrs`**, in the same file, keeps only attribute-shaped keys. It drops every `on*` event handler, checked case-insensitively, and it drops a `__proto__` key. A kept value must be a one-line string, a number, or a boolean. A URL-valued attribute such as `href` or `src` is filtered through `safeLinkHref` too.
- **`safeSingleLineHref`** runs both steps in the order they need. It checks the link's scheme once before flattening the text to one line, and once after. Flattening can turn a hidden control character into a space. A browser skips a leading space the same way it skips the character that space replaced.

### The exporters' own guards

`sanitizeState` is the one gate every entry point must pass through. Even so, `emit-apply.js` and `emit-css.js` do not simply trust whatever `sanitizeState` already checked. Each one also guards its own output. That way, a future code path that skips the gate still cannot inject anything.

- `configBool` and `configInt`, in `app/src/customizer/core/emit-apply.js`, print only a real boolean or a real integer into a generated `astro.config.mjs` snippet. Any other value falls back to the control's own default instead of being printed as text.
- `jsStringLiteral`, and `formatStringLiteral` in `app/src/customizer/core/ia.js`, escape backslashes, quotes, line breaks, and backticks. This runs before a value becomes a JS string literal inside a Markdown code span. A raw backtick would otherwise close that span; a raw line break would otherwise start a new line inside it.
- `proseText`, in `app/src/customizer/core/emit-apply.js`, escapes Markdown's own special characters wherever a theme's own text appears in a sentence of `APPLY-THEME.md`. The site title is the clearest example. Without this, a title could open a link, a code span, or emphasis inside the generated document.
- `emit-css.js` only writes a role-color token once `isHexColor` confirms the value is a real hex color. That check lives in `buildRootTokens`'s loop over `ROLE_IDS`, so nothing but a color can reach `theme.css` through that path.

### Text rendering of names

A theme name can come from a share link. `app/src/customizer/ui/share-dialog.js` sets every name it shows - the shared theme's name, and the visitor's own saved theme's name - through `textContent`, never `innerHTML`. The file's own header comment states the reason directly. A crafted link must never be able to inject markup into the dialog that asks whether to open it.

### Ask before replacing a saved theme

`resolveInitialTheme`, in `app/src/customizer/core/share-link.js`, opens a share link's theme without asking only when nothing of the visitor's own is worth protecting. That covers three cases: no saved theme, the defaults every first visit saves, or the exact theme already saved, checked by `sameTheme` in `state.js`. Otherwise the saved theme stays in place. The only way to replace it is `share-dialog.js`'s "Open the shared theme?" question. Opening the link's theme from there is one undo step, so Undo reverses it. A link that cannot be decoded at all keeps the saved theme too. `tryDecodeState` returns `null` for one, usually because the link was cut off in transit. The studio then says the link is damaged, instead of quietly falling back to Starlight's own defaults.

## Tests that pin these defenses

- `app/tests/core/sanitize.test.js` (31 tests) checks both directions. It confirms that every theme the studio itself can produce comes back from `sanitizeState` unchanged. That covers every preset, a rich hand-built theme, the demo site's own sidebar, and every control at its default and at each range's ends. It also confirms that a crafted theme loses exactly what it should. That includes wrong-typed values, unknown ids, unsafe sidebar paths, script links hidden behind whitespace, and unsafe `attrs`. Its last two `describe` blocks run a full attack payload through `emitApplyTheme` and `emitCss` directly. Each one then separately feeds the exporter a theme that skipped `sanitizeState` entirely, to confirm the exporters' own guards still hold on their own.
- `app/tests/core/share-link.test.js` (12 tests) checks `resolveInitialTheme`'s rules. It checks when a link opens directly, and when it asks first. It also checks that a damaged link keeps the saved theme and reports the damage, rather than silently resetting it.
- `app/tests/core/ia.test.js` carries one dedicated block, "safeLinkHref and safeLinkAttrs" (4 tests). It checks the scheme allowlist against safe and unsafe links, including `javascript:` attempts hidden behind whitespace and control characters. It also confirms `safeLinkAttrs` strips a `__proto__` key without the result inheriting anything through it.
- `app/tests/e2e/share.mjs` sends a crafted link as part of its 43 browser checks. One section sends a theme carrying a `javascript:` sidebar link, both plain and hidden behind a space and a tab. It confirms the rendered link is `#`, while a real `https` link still works. A separate check in that section confirms a crafted link's config-code and extra-step payloads reach neither `APPLY-THEME.md` nor `theme.css`.

`.github/workflows/ci.yml` runs `npm test` on every pull request into `main`, as a required check (the workflow's own header comment says so directly). That run covers `sanitize.test.js`, `share-link.test.js`, and `ia.test.js`, so a change that weakens any of these defenses fails CI before it can merge. The workflow does not run `share.mjs` or any other browser suite; those stay a manual step for whoever is preparing a release.

## Checklist for contributors

**Adding a new way to load a theme into the studio.** Route it through `sanitizeState` before the state reaches anything else. Do this the same way `tryDecodeState` and `importStateFromJson` already do it. Never special-case a "trusted" source. A share link is already proof that any source can be forwarded by someone other than the person who built it.

**Adding a new control whose value reaches an export.** Give `sanitizeValue` a case for that control's `type`. Otherwise a crafted value for it falls through to the function's default branch, which returns `undefined` for any type it does not already recognize. If the control's value can appear in prose inside `APPLY-THEME.md`, or inside a JS string literal in a generated config snippet, reuse `proseText` or `jsStringLiteral`. Do not print the value directly.

**Changing an exporter.** Keep its own guard in place, even though `sanitizeState` already checked the value once. The exporters are tested on unsanitized input on purpose; see the "the export sinks hold even for a theme that skipped sanitizeState" block in `app/tests/core/sanitize.test.js`. An exporter that assumes clean input will fail that suite. Run `npm run golden:update` only after you have confirmed the diff is the change you intended. The script trusts the emitter's output completely, so it would write a regression into the golden files just as faithfully as a fix.

## Known limits

- **No Content-Security-Policy.** Neither `app/astro.config.mjs` nor any page under `app/src/pages/` sets a Content-Security-Policy header or meta tag. The defenses above rely on sanitizing and escaping values before they reach the DOM or an export. They do not rely on a browser-enforced policy as a backstop.
- **Third-party font requests.** The live preview's font-face rule, `fontFaceCss` in `app/src/customizer/ui/panel.js`, loads web fonts from jsDelivr's Fontsource CDN. So do the tile previews in `app/src/customizer/ui/tiles/fonts.js`. SECURITY.md lists this as out of scope, and `app/src/about/about.md` discloses it to visitors as the only third-party request the studio makes. An exported theme does not carry this dependency forward. The font step in `emitApplyTheme` installs the same fonts as self-hosted `@fontsource-variable` npm packages instead, so the site a visitor ships never calls jsDelivr itself.
- **The site title stays free text.** Its own control caps it at 60 characters (`manifest.js`'s `site.title` entry). `sanitizeState` flattens it to one line, and `proseText` escapes it everywhere it appears in `APPLY-THEME.md`'s prose. It can still carry any character that survives those two limits, so a visitor's own export can show an odd-looking title. PR #23's own write-up names this as accepted risk, not a bug.
- **The theme name has a separate, wider cap.** `state.js`'s `MAX_NAME_LENGTH` allows up to 100 characters for `meta.name`, shown in the top bar and in `share-dialog.js`'s text, always through `textContent`.
- **CI runs the unit suite, not the browser suite.** `.github/workflows/ci.yml` runs `npm test` on every pull request into `main`. It never runs `app/tests/e2e/share.mjs`, so the crafted-link browser checks only catch a regression when someone runs that suite locally before a release.
