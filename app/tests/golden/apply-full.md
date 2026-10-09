> **Use these steps with the `theme.css` file in this folder. Make the changes yourself, or ask a coding agent in your Starlight project to read this file and follow every step in order.**

# Apply theme

Target: `@astrojs/starlight@0.42.6` (this document was generated against that version's config and sidebar schema).

**STOP** if the installed `@astrojs/starlight` minor version differs from `0.42` (check `node_modules/@astrojs/starlight/package.json`'s `"version"` field). Ask the user how to proceed rather than applying config/CSS shaped for a different minor version.

This applies the "Demo Rich" theme with an accent color at OKLCH hue 200° / chroma 0.2, custom fonts (body: Lora, headings: Playfair Display, code: Fira Code), 1 component treatment customized (Active item style), a restructured sidebar navigation.

## Preconditions

1. Confirm `@astrojs/starlight` is a dependency (check `package.json` / `node_modules/@astrojs/starlight`). If it is missing, stop -- this is not a Starlight project.
2. Locate the Starlight config file: `astro.config.mjs` or `astro.config.ts` at the project root, containing a `starlight({ ... })` call inside `integrations: [...]`.
3. Note whether a `customCss` array already exists on the `starlight({ ... })` options object (read it now; the CSS step below needs to know).

## Steps

1. **Add the theme CSS.**
   - Copy the `theme.css` file (exported alongside this document) to `src/styles/theme.css` in the target repo, creating `src/styles/` if it does not exist.
   - Open `astro.config.mjs` (or `astro.config.ts`) and find the `starlight({ ... })` options object.
   - If `customCss` does not exist yet, add `customCss: ['./src/styles/theme.css']`.
   - If `customCss` already exists, **keep every entry already there** and add `'./src/styles/theme.css'` **as the LAST item in the array** -- only if it is not already present (idempotent: do not add a duplicate entry on a re-run). This theme's CSS is intentionally unlayered, so for any selector another stylesheet also styles, array order decides the tie; adding it last is what makes it win.

2. **Install the chosen fonts.**
   - Run: `npm i @fontsource-variable/lora @fontsource-variable/playfair-display @fontsource-variable/fira-code`
   - The theme CSS already begins with these `@import` lines (added by the exporter, not by you) -- installing the packages is what makes them resolve:
     ```css
     @import '@fontsource-variable/lora';
     @import '@fontsource-variable/playfair-display';
     @import '@fontsource-variable/fira-code';
     ```
   - Nothing else to edit for fonts; re-running `npm i` on an already-installed package is a no-op.
   - **If a package fails to install** (no network access, or it was renamed/removed on the registry), `npx astro build` will FAIL, not silently degrade: Vite resolves every `@import` at build time, so a missing package produces an error like `[vite] Unable to resolve @import "@fontsource-variable/<pkg>" from .../src/styles` (often followed by a `[postcss] ENOENT`). To recover, remove that package’s `@import` line from `src/styles/theme.css` (the one you just copied in) and rebuild -- every font-family declaration this theme emits already ends in a fallback stack (e.g. a system serif, sans, or monospace font), so the site still works once that line is gone, just with that fallback instead of the chosen web font. Confirm the exact package name first with `npm view <pkg> version` before retrying the install.

3. **Update Starlight config options.** In the same `starlight({ ... })` options object, set (each of these differs from Starlight’s default, so only the ones listed are added -- an already-correct key is left as-is, making this idempotent):
   - `tableOfContents: { minHeadingLevel: 1, maxHeadingLevel: 3 }`
   - `pagination: false`
   - `lastUpdated: true`
   - `credits: true`
   - `markdown: { headingLinks: false }`
   - `expressiveCode: { themes: ['nord', 'min-light'], useStarlightUiThemeColors: true }`
     (`useStarlightUiThemeColors: true` keeps the code block frame and UI chrome on your Starlight accent/gray palette instead of the Shiki theme's own chrome colors -- only the syntax highlighting comes from `nord`. Verify `nord`/`min-light` are still valid bundled Shiki theme ids for the installed Expressive Code version; adjust if not.)

4. **Replace the sidebar navigation.** In the same `starlight({ ... })` options object, replace the entire `sidebar` array with the one below (a full replacement each time keeps this idempotent -- applying it twice yields the same array):
   ```js
   [
     {
       label: 'Guides',
       items: [
         {
           slug: 'guides/example',
           label: 'Example Guide',
         },
         {
           autogenerate: {
             directory: 'guides',
           },
         },
       ],
     },
     {
       label: 'Reference',
       items: [
         {
           autogenerate: {
             directory: 'reference',
           },
         },
       ],
     },
   ]
   ```

   The following pages live inside a directory covered by an `autogenerate` group above but must not appear through it -- either because they are also pinned explicitly elsewhere in the array (their label/badge there already wins) or because they were marked hidden. Without `sidebar.hidden: true` in their frontmatter, autogenerate has no way to know that and will list them anyway (a pinned page would then render twice). Set the flag on each (idempotent: setting `hidden: true` twice is a no-op; merge it into any existing frontmatter without removing unrelated keys like `title`):

   | file | sidebar.hidden |
   | --- | --- |
   | `src/content/docs/guides/example.md` | true |

   (Note: if a listed file is `.mdx` rather than `.md`, or is a folder’s `index` page living at a different path, edit that actual file instead -- the path above assumes the common case.)

## Verification

1. Run `npx astro build`. It must succeed (including the Pagefind index step). If `astro preview` is already running against this repo, just refresh the browser tab afterward -- no restart needed. `astro dev` picks up the change on its own; no rebuild required at all.
2. Visual checks. These describe the target site itself, not this tool -- open any page that contains the listed element (most exist on nearly every content page; a few, such as the table of contents, pagination links, or the splash-page hero, only appear on pages that have one). For each line, find an element matching the given CSS selector and confirm it now matches the target value. The exact CSS property/value is whatever the exported `theme.css` sets for that same selector -- read it there, or in a browser console run `getComputedStyle(document.querySelector(SELECTOR))` to check a specific property without eyeballing it.
   - **Colors → Accent color** (custom properties on `:root`, from the generated palette): `--sl-color-accent-low` = `#002a2c` in dark mode / `#b1e1e4` in light mode; `--sl-color-accent` = `#00797e` in dark mode / `#007479` in light mode; `--sl-color-accent-high` = `#94d6da` in dark mode / `#003a3d` in light mode.
   - **Sidebar → Active item style** (now "Left bar"): on `.sidebar-content a[aria-current='page']`, the computed `border-left-width` should compute to `2px` (`theme.css` declares `border-inline-start: 2px solid var(--sl-color-text-accent)` for this selector).
   - The sidebar navigation matches the new structure (labels, order, groups, badges).

## Rollback

Files touched by these steps (revert with `git checkout -- <file>` or `git diff` review):

- `src/styles/theme.css` (new file -- delete it)
- `astro.config.mjs` (or `.ts`): `customCss` entry, config options, and `sidebar`
- `package.json` / `package-lock.json`: Fontsource packages added via `npm i` (run `npm uninstall <pkg>` for each to fully roll back)
- Frontmatter in 1 content file under `src/content/docs/` (listed in the sidebar step above)

Made with the Starlight Visual Customizer: https://projects.prisantlabs.com/starlight-visual-customizer/
