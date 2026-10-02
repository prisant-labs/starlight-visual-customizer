> **Paste this whole file to your coding agent inside the target Starlight repo, then let it execute every step below in order.**

# Apply theme

Target: `@astrojs/starlight@0.42.4` (this document was generated against that version's config and sidebar schema).

**STOP** if the installed `@astrojs/starlight` minor version differs from `0.42` (check `node_modules/@astrojs/starlight/package.json`'s `"version"` field). Ask the user how to proceed rather than applying config/CSS shaped for a different minor version.

This applies the "Starlight default" theme with no changes from Starlight’s own defaults.

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

## Verification

1. Run `npx astro build`. It must succeed (including the Pagefind index step). If `astro preview` is already running against this repo, just refresh the browser tab afterward -- no restart needed. `astro dev` picks up the change on its own; no rebuild required at all.
2. Visual checks. These describe the target site itself, not this tool -- open any page that contains the listed element (most exist on nearly every content page; a few, such as the table of contents, pagination links, or the splash-page hero, only appear on pages that have one). For each line, find an element matching the given CSS selector and confirm it now matches the target value. The exact CSS property/value is whatever the exported `theme.css` sets for that same selector -- read it there, or in a browser console run `getComputedStyle(document.querySelector(SELECTOR))` to check a specific property without eyeballing it.
   - No visual controls were changed from Starlight’s defaults; the site should look unchanged aside from the (empty) theme CSS being loaded without errors.

## Rollback

Files touched by these steps (revert with `git checkout -- <file>` or `git diff` review):

- `src/styles/theme.css` (new file -- delete it)
- `astro.config.mjs` (or `.ts`): `customCss` entry

Generated with the Starlight Visual Customizer: https://projects.prisantlabs.com/starlight-visual-customizer/
