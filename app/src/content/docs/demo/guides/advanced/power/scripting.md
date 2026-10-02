---
title: Scripting API
description: The handful of pure functions that make up the customizer's public surface.
---

The customizer's core is deliberately small. Four modules — `state.js`, `emit-css.js`, `emit-apply.js`, and `ia.js` — cover everything the panel does, and none of them touch the DOM.

## State helpers

`defaultState()` returns the starting `ThemeState`. `getValue(state, id)` reads a control's current value or falls back to its manifest default. `setValue(state, id, value)` returns a new state object with one value changed, leaving the original untouched.

## Encoding for sharing

`encodeState(state)` produces a compact, URL-safe string containing only the values that differ from the defaults, so a shared link stays short even for a heavily customized theme. `decodeState(str)` reverses this, and tolerates garbage input by falling back to `defaultState()` rather than throwing.

## Sidebar IA helpers

`iaFromStarlightConfig` and `iaToStarlightConfig` round-trip between Starlight's `sidebar` config array and the editor's internal tree shape, so the same data structure powers both the live site and the in-panel IA editor.
