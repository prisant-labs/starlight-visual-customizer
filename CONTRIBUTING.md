# Contributing

Thanks for your interest in Starlight Visual Customizer. Bug reports, ideas, themes and code are
all welcome.

## Ways to help

- **Report a bug.** Use the bug form under
  [Issues](https://github.com/prisant-labs/starlight-visual-customizer/issues/new/choose). Please
  include a share link: in the studio, open **Export** and choose **Copy share link**. The link
  reproduces your exact theme and page.
- **Suggest an idea.** Start a thread in
  [Discussions, under Ideas](https://github.com/prisant-labs/starlight-visual-customizer/discussions/categories/ideas).
  Once an idea is specific and agreed, it becomes an issue.
- **Share a theme.** Post its share link in
  [Show and tell](https://github.com/prisant-labs/starlight-visual-customizer/discussions/categories/show-and-tell).
- **Report a security problem privately,** as [`SECURITY.md`](SECURITY.md) describes. Please do not
  open a public issue for it.

## Before you open a pull request

For anything larger than a small fix, please open an issue or a discussion first. That way we can
agree on the approach before you spend time on it.

Two kinds of change always need that agreement first, because users' sites depend on them:

- **Upgrading Starlight or Astro.** The studio targets one Starlight version, currently 0.42.4,
  and `APPLY-THEME.md` tells users which version it was built for. A unit test checks that
  `app/src/customizer/core/version.js` matches the installed Starlight. The docs, badges and
  issue form name the version too, so search the repository for the old version string and
  update every match.
- **Changing what an export contains.** Golden files in `app/tests/golden/` pin the exact output,
  and the round-trip test checks that an export reproduces the studio's preview.

## Run it locally

You need Node 22. The app lives in `app/`:

```bash
cd app
npm install
npm run dev:bg   # a dev server in the background, on http://localhost:4700
```

Open <http://localhost:4700/studio/>, and stop the server with `npm run dev:stop` when you are
done.

The browser suites run against a production build instead:

```bash
npm run build
npm run preview:bg   # serves dist/ in the background, on http://localhost:4420
```

## Tests

| Command | What it checks | Needs a browser |
|---|---|---|
| `npm test` | Unit tests for the CSS and `APPLY-THEME.md` generators, state, share links, color math, the sidebar parser and undo | No |
| `npm run test:e2e` | The browser suites, against the preview on port 4420 | Yes |
| `npm run test:roundtrip` | That an export applied to a fresh Starlight site matches the studio's preview | Yes |

- The browser suites use Playwright's Chromium. Install it once with
  `npx playwright-core install chromium`.
- Run the browser suites one at a time, against one preview server.
  [`app/README.md`](app/README.md) describes each suite, and the `SVC_BROWSER` switch that runs six
  of them on Firefox and WebKit.
- If you change export output on purpose, run `npm run golden:update` and review the diff in
  `app/tests/golden/`.

CI runs the unit tests and a build on every pull request, and a pull request cannot merge until
that check passes. CI does not run the browser suites, so please run the ones that cover your
change, and list them in the pull request.

## Pull requests

- Keep each pull request to one change, and explain why in its description.
- Write commit messages in the style of the history: `fix(app): ...`, `feat(app): ...`,
  `docs: ...`, `test(app): ...` or `chore: ...`.
- Add an entry under "Unreleased" in [`CHANGELOG.md`](CHANGELOG.md) for any change that users will
  notice.
- Pull requests merge as merge commits once CI passes.

## License

By contributing, you agree that your contribution is licensed under the project's
[MIT license](LICENSE).
