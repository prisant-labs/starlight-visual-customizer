# Documentation

Most people who use Starlight Visual Customizer never need this folder. The
[live studio](https://projects.prisantlabs.com/starlight-visual-customizer/studio/), the
[README](../README.md) and the `APPLY-THEME.md` file in every export cover using it. This folder
is for people who want to understand, change or maintain the code.

## Start here

| If you want to | Read |
|---|---|
| Understand what the studio does, part by part | [`studio.md`](studio.md) |
| Know exactly what an export contains | [`export-format.md`](export-format.md) |
| Run the app on your machine | [`development.md`](development.md) |
| Find the code that does something | [`architecture.md`](architecture.md) |
| Run or extend the tests | [`testing.md`](testing.md) |
| Change anything that reads a theme or writes an export | [`security-model.md`](security-model.md) |
| Learn why something is built the way it is | [`decisions/`](decisions/README.md) |
| Make a release | [`releasing.md`](releasing.md), then [`releases/`](releases/README.md) |

## Reading paths

- **A first contribution:** [`CONTRIBUTING.md`](../CONTRIBUTING.md), then
  [`development.md`](development.md), then the [`testing.md`](testing.md) section for the suites
  your change touches.
- **A change to a control or the studio's interface:** [`studio.md`](studio.md), then
  [`architecture.md`](architecture.md).
- **A change to export output or to how themes load:** [`export-format.md`](export-format.md), then
  [`security-model.md`](security-model.md), then the golden-file section of
  [`testing.md`](testing.md#golden-files).
- **A coding agent:** [`AGENTS.md`](../AGENTS.md) at the repository root.

## Project policies

These files sit at the repository root, where GitHub looks for them:

- [`CONTRIBUTING.md`](../CONTRIBUTING.md): how to propose a change.
- [`SUPPORT.md`](../SUPPORT.md): where to ask a question or report a bug.
- [`SECURITY.md`](../SECURITY.md): how to report a vulnerability privately.
- [`ACCESSIBILITY.md`](../ACCESSIBILITY.md): accessibility goals, known barriers, and how to report
  one.
- [`CHANGELOG.md`](../CHANGELOG.md): the notable changes in each release.
- [`LICENSE`](../LICENSE) and [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md): the MIT license
  and the licenses of everything the app bundles.

## Images

[`images/`](images/) holds the screenshots that the README shows. After a visible change to the
studio, regenerate them with `app/scripts/capture-readme-shots.mjs`. The script's header comment
gives the steps. `app/scripts/social-card/` regenerates the social preview card,
`app/public/og.png`.
