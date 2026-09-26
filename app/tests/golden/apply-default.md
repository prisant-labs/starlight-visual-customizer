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
   - If `customCss` already exists, add `'./src/styles/theme.css'` to the array **only if it is not already present** (idempotent: do not add a duplicate entry on a re-run).

## Verification

1. Run `npx astro build`. It must succeed (including the Pagefind index step).
2. Visual checks:
   - No visual controls were changed from Starlight’s defaults; the site should look unchanged aside from the (empty) theme CSS being loaded without errors.

## Rollback

Files touched by these steps (revert with `git checkout -- <file>` or `git diff` review):

- `src/styles/theme.css` (new file -- delete it)
- `astro.config.mjs` (or `.ts`): `customCss` entry
