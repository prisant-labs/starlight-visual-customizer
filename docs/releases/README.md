# Release notes

This folder holds the full release notes for each version, one file per release. Each file is the
source of that version's page on GitHub's
[Releases page](https://github.com/prisant-labs/starlight-visual-customizer/releases). The page is
published from the file, so the two always match.

| Version | Date | Targets | Notes | Release page |
|---|---|---|---|---|
| 0.1.0 | 2026-10-03 | Starlight 0.42.4, Astro 7.3.5 | [v0.1.0.md](v0.1.0.md) | [v0.1.0](https://github.com/prisant-labs/starlight-visual-customizer/releases/tag/v0.1.0) |

## How these files relate to the changelog

- **[`CHANGELOG.md`](../../CHANGELOG.md)** is the short technical list of changes in each version.
  Contributors add to it in the same pull request as each change.
- **The files in this folder** tell people who use the studio what changed and why it matters.
  They are written once per release, in the release-prep pull request.

## Writing the notes for a release

1. Copy [`_template.md`](_template.md) to `vX.Y.Z.md` in this folder.
2. Fill it in from the `CHANGELOG.md` section for that version.
3. Add a row to the table above.
4. Publish the GitHub release from the file, as [`docs/releasing.md`](../releasing.md) describes.

If a published release needs a correction, fix the file in a pull request. Then run
`gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md` so the release page matches it
again.
