---
title: state.js
description: The immutable ThemeState shape and its helper functions.
sidebar:
  order: 2
---

`state.js` defines the `ThemeState` shape that every other module reads and writes: a version number, the id of the last-applied preset, a `values` map of control id to value, and an optional sidebar IA tree.

## Immutability

`setValue` and `applyPreset` both return a new state object rather than mutating their input. This makes it straightforward to keep an undo stack in the UI layer without `state.js` knowing anything about undo.

## Round-tripping

`encodeState` and `decodeState` are inverses of each other for any state that only uses values already present in `manifest.js`. `decodeState` is intentionally tolerant of malformed input — a corrupted `location.hash` should never crash the page, it should just fall back to defaults.
