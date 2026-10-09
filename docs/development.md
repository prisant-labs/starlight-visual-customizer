# Development

This guide covers running the app on your machine, serving it under a sub-path, how the live site
deploys, and which GitHub Actions the workflows may use. [`docs/testing.md`](testing.md) covers
the tests, and
[`docs/architecture.md`](architecture.md) explains where the code lives.

## Requirements

- **Node 22.** The CI and deploy workflows use the same version.
- **The pinned packages.** `app/package.json` pins `@astrojs/starlight` 0.42.6 and Astro 7.3.8
  exactly, because the studio targets one Starlight version. Do not upgrade either one without
  agreement first; [`CONTRIBUTING.md`](../CONTRIBUTING.md) explains why.

All commands below run from the `app/` folder.

## Two ways to run the app

| | Dev server | Production preview |
|---|---|---|
| Serves | The source files, with hot reload | The built `dist/` folder |
| Port | **4700** | **4420** |
| Start in the background | `npm run dev:bg` | `npm run build`, then `npm run preview:bg` |
| Start in the foreground (Ctrl+C stops it) | `npm run dev` | `npm run preview` |
| Status, stop and logs | `npm run dev:status`, `dev:stop`, `dev:logs` | `npm run preview:status`, `preview:stop`, `preview:logs` |
| Picks up code edits | Immediately | After `npm run build`, then a page refresh, with no restart |
| Use it for | Editing the customizer | Checking the real build and running the browser tests |

A first run looks like this:

```bash
cd app
npm install
npm run build
npm run preview:bg
```

Then open <http://localhost:4420/> for the product page, or <http://localhost:4420/studio/> for
the studio. The studio opens on the demo site's Style guide page, `/demo/specimen/`.

Each port is its own browser origin. So the dev server and the preview keep separate saved themes
and settings.

### Background servers

Background mode needs Astro 7.2 or later. It works per folder: `status`, `stop` and `logs` act on
the server that was started from this folder. Astro tracks that server in `.astro/dev.json` or
`.astro/preview.json`. Starting a second time reports the running server instead of launching a
duplicate.

If `npm run preview:stop` does not stop the preview, stop whatever listens on its port. In
PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 4420 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

## Serving under a sub-path

By default the app builds for `/`. It can also be served under a sub-path, such as a GitHub Pages
project site at `https://<user>.github.io/<repo>/`. The root build does not change when you do
this.

Two environment variables control it. Only `app/astro.config.mjs` reads them, at build time.

| Variable | Default | Meaning |
|---|---|---|
| `SVC_SITE_BASE` | `/` | The base path to deploy under, such as `/starlight-visual-customizer/`. Include the trailing slash. Astro's `trailingSlash` setting stays at its default, so `import.meta.env.BASE_URL` keeps that slash too. |
| `SVC_SITE_URL` | unset | The deployed origin, such as `https://projects.prisantlabs.com`. It is optional. Only canonical URLs and sitemaps use it, and internal navigation never depends on it. |

**Never set a plain `BASE_URL` when you build this app.** It is a different variable, and
`app/astro.config.mjs` never reads it. If it leaks in from a parent shell, `astro build` silently
turns its internal links absolute.

To build and preview under a sub-path in PowerShell:

```powershell
npm run preview:stop   # if the root preview is still running from this folder
$env:SVC_SITE_BASE = '/starlight-visual-customizer/'
npx astro build
npx astro preview --port 4420
Remove-Item Env:SVC_SITE_BASE
```

Keep `SVC_SITE_BASE` set until the preview has started. `astro preview` reads
`app/astro.config.mjs` again. Without the variable, it serves the sub-path build at plain `/`,
where every link points under the sub-path and breaks.

In Git Bash, prefix both commands with `MSYS_NO_PATHCONV=1`. Otherwise MSYS rewrites a value that
starts with a slash into a Windows path. `/starlight-visual-customizer/` would become
`C:/Program Files/Git/starlight-visual-customizer/`, and the build would break.

```bash
MSYS_NO_PATHCONV=1 SVC_SITE_BASE=/starlight-visual-customizer/ npx astro build
MSYS_NO_PATHCONV=1 SVC_SITE_BASE=/starlight-visual-customizer/ npx astro preview --port 4420
```

Then open <http://localhost:4420/starlight-visual-customizer/>. The product page's links point at
the studio and the About page under the same base. When you finish, stop the preview and run a
plain `npm run build` with no variable set, so the next root preview serves a root build.

### How the code handles the base path

Every internal URL that the customizer builds at runtime goes through one helper. That helper is
`withBase()` and `stripBase()` in `app/src/customizer/core/base-path.js`, built on Astro's resolved
`import.meta.env.BASE_URL`. It covers the studio's page tabs, frame navigation, "Open in Studio"
and the sidebar that re-renders after a Structure edit.

Two things stay free of the base on purpose: the studio's `?page=` value and its
`sessionStorage['svc-ui']` state. So a saved link, a shared screenshot or a bookmark looks the
same at any base.

The demo site's hand-written links are relative instead. These are the links in `specimen.mdx`,
`kitchen-sink.mdx`, the hero actions in `index.mdx`, and a few `prev` and `next` overrides.
Starlight adds the base to its own sidebar and pagination links, but not to a link written by hand
in Markdown or frontmatter.

## The live deployment

`.github/workflows/deploy.yml` builds the app on every merge to `main` that changes `app/`. It
sets `SVC_SITE_BASE=/starlight-visual-customizer/` and `SVC_SITE_URL=https://projects.prisantlabs.com`,
then deploys to GitHub Pages.

The site appears at <https://projects.prisantlabs.com/starlight-visual-customizer/> for this
reason: the organization's own Pages site, `prisant-labs/prisant-labs.github.io`, carries the
custom domain `projects.prisantlabs.com`. GitHub then serves every other Pages site in the
organization under that domain, at `/<repo-name>/`.

So the base must equal the repository's name. Renaming the repository means changing
`SVC_SITE_BASE` and the workflow's `if:` guard to match.

The workflow's jobs run only in `prisant-labs/starlight-visual-customizer`. A fork deploys nothing
until it changes that guard and the two variables for its own address.

## Actions the workflows may use

The repository runs only GitHub Actions on its allow-list. The list holds GitHub's own actions,
such as `actions/checkout`, plus four others:

- `withastro/action`, which `deploy.yml` uses to build the site.
- `pnpm/action-setup`, `oven-sh/setup-bun` and `denoland/setup-deno`. No workflow here calls them
  directly. `withastro/action` refers to them in its own steps, and GitHub checks every action
  that a job refers to before the job starts, even one whose step will be skipped.

A new third-party action must join the list before a workflow uses it, along with any action it
refers to internally. Otherwise the job fails at its "Set up job" step, before anything runs. An
admin edits the list under **Settings**, **Actions**, **General**.

A fork has its own Actions settings, so this list applies only to this repository.
