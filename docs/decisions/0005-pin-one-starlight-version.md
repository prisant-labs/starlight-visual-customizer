# 0005. Pin each release to one Starlight version, enforced by a test

- **Status:** Accepted
- **Date:** 2026-09-25

## Context

The studio previews real Starlight pages and generates CSS that relies on Starlight's own class
names, CSS layers, and color-palette algorithm. The installed Starlight package could drift from
the version the studio's code assumed. If it did, an export could silently stop matching what a
user's own site renders. No error would flag the mismatch.

## Decision

Each release targets exactly one Starlight version. The version string lives in a single
constant, `STARLIGHT_VERSION` in `app/src/customizer/core/version.js`. Both the browser bundle
and the Node-based test suites read that one constant. A unit test,
`app/tests/core/version.test.js`, compares it against the version actually installed in the
Starlight package's own manifest, under `node_modules`. `npm test` fails if the two disagree. The
current pinned version is 0.42.4, alongside Astro 7.3.5.

`CONTRIBUTING.md` lists upgrading Starlight or Astro as one of two kinds of change that always
need agreement before a pull request. Users' sites depend on them. A contributor who
bumps the version must also update every doc, badge, and issue form that names it. No test
checks those other copies.

## Consequences

- An accidental or partial Starlight upgrade fails `npm test` immediately, instead of surfacing
  later as a subtle export mismatch that only a round-trip check would catch.
- `APPLY-THEME.md` and the project's docs and badges can state a single, trustworthy version
  number. The constant and the installed package are kept in lockstep by the test.
- Every Starlight upgrade becomes a deliberate, reviewed event rather than a side effect of
  `npm install`. Each one costs a dedicated upgrade pass: bump the version, run every test suite,
  and update every doc that names the old number.
- Keeping up with new Starlight releases becomes an ongoing maintenance cost, not a one-time
  decision made once and forgotten.

## Alternatives considered

- Let `package.json`'s semver range float to any compatible Starlight release. Rejected, because
  a floating range gives no signal when Starlight's markup or CSS changes underneath it.
- Check the version only in documentation, with no automated test. Rejected, because a comment or
  a README line can go stale silently, while a failing test cannot be missed.
