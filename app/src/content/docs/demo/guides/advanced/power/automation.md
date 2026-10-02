---
title: Automation Recipes
description: Script the emitter directly instead of clicking through the panel.
---

Every control in the panel is backed by a pure function in `emit-css.js`, so you can skip the UI entirely and generate a `theme.css` from a script — useful for CI jobs that need to regenerate a theme after a design token changes upstream.

## Generate a theme from a state file

Keep a `state.json` checked into your repository, then feed it to the emitter as part of your build:

```sh
node scripts/emit-theme.mjs state.json > src/styles/theme.css
```

The script itself is a thin wrapper: import `emitCss` and `decodeState` from the customizer's core modules, decode the checked-in state, and write the result to disk.

## Regenerating on every commit

Because the emitter is deterministic — the same state always produces byte-identical CSS — you can safely run it in a pre-commit hook without worrying about noisy diffs from run to run.
