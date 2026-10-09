# Releasing

A release is a tagged snapshot of `main`, with notes for people who use the studio. Releases do not
deploy anything. The live site deploys on every merge to `main` that changes `app/`, so it always
runs the newest code, and [`SECURITY.md`](../SECURITY.md) relies on that.

Versions follow [semantic versioning](https://semver.org/). Before 1.0, a minor release can change
behavior, and the release notes must say so.

## What a release consists of

| Piece | Where it lives | Written when |
|---|---|---|
| The version number | `version` in `app/package.json` and `app/package-lock.json` | In the release-prep pull request |
| The technical list of changes | The version's section in [`CHANGELOG.md`](../CHANGELOG.md) | Throughout the cycle, folded in the release-prep pull request |
| The release notes | `docs/releases/vX.Y.Z.md`, from [`docs/releases/_template.md`](releases/_template.md) | In the release-prep pull request |
| The tag | An annotated tag `vX.Y.Z` on the release-prep merge commit | After that pull request merges |
| The GitHub release | The [Releases page](https://github.com/prisant-labs/starlight-visual-customizer/releases), published from the notes file | After the tag |

## Steps

### 1. Prepare the release in one pull request

Branch from `main`, for example `chore/release-v0.2.0`, and make these changes:

1. Set the new version in `app/` without creating a tag:

   ```bash
   cd app
   npm version 0.2.0 --no-git-tag-version
   ```

2. In `CHANGELOG.md`, rename the `## Unreleased` heading to `## [0.2.0] - YYYY-MM-DD`. Add the
   matching link at the bottom of the file:

   ```markdown
   [0.2.0]: https://github.com/prisant-labs/starlight-visual-customizer/releases/tag/v0.2.0
   ```

3. Write `docs/releases/v0.2.0.md` from the template, and add its row to
   [`docs/releases/README.md`](releases/README.md).
4. If the release targets a new Starlight or Astro version, update every place that names the old
   one. [`CONTRIBUTING.md`](../CONTRIBUTING.md) explains how to find them all.

### 2. Check it

CI runs the unit tests and a build on the pull request. It does not run the browser suites, so
run the full set yourself before a release, as [`docs/testing.md`](testing.md) describes:

- `npm test`
- all 14 browser suites, one at a time, against the production preview
- `npm run test:roundtrip`

### 3. Merge, then tag the merge commit

Merge the pull request as a merge commit, the only merge method the repository allows. Then tag
that merge commit with an annotated tag, and push the tag:

```bash
git switch main
git pull
git log --merges --oneline -1     # confirm this is the release-prep merge
git tag -a v0.2.0 -m "v0.2.0: <the release title>" <merge-commit>
git push origin v0.2.0
```

Name the merge commit explicitly. If another pull request merged after the release-prep one, the
tip of `main` is no longer the release.

Only a repository admin can push the tag. The "Protect release tags" ruleset stops everyone else
from creating, moving or deleting any tag whose name starts with `v`. Admins bypass the ruleset,
because a release tag is pushed directly, not through a pull request. The same rule covers moving
a tag later, for example to fold a fix into a release that is still a draft.

### 4. Publish the GitHub release from the notes file

```bash
gh release create v0.2.0 --verify-tag --title "v0.2.0: <the release title>" \
  --notes-file docs/releases/v0.2.0.md --draft
```

The `--verify-tag` flag stops the command if the tag is not on GitHub yet, so the release never
creates a tag of its own. The `--draft` flag lets you read the rendered page before anyone else
can see it. Open the draft
on the Releases page and check the images and links. Then publish it:

```bash
gh release edit v0.2.0 --draft=false
```

Share the release link only after you publish it. A draft lives at a temporary `untagged-...`
address that stops working when the release is published.

### 5. Check the result

- The release page shows the notes, and the README's release badge shows the new version. The
  badge image is cached, so it can lag for a few minutes.
- The live site already runs this code, because the release-prep merge deployed it. The
  [Actions tab](https://github.com/prisant-labs/starlight-visual-customizer/actions) shows that
  deploy.

## Fixing published notes

Edit `docs/releases/vX.Y.Z.md` in a pull request. After it merges, sync the release page:

```bash
gh release edit vX.Y.Z --notes-file docs/releases/vX.Y.Z.md
```

## A list of merged pull requests

[`.github/release.yml`](../.github/release.yml) groups merged pull requests by label for GitHub's
"Generate release notes" button. The generated list is a useful checklist while you write the
notes. It is not the notes: the notes file is written for people who use the studio, and a list
of pull request titles is not.
