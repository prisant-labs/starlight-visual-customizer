---
title: manifest.js
description: The data-only list of every control the panel renders.
sidebar:
  order: 1
  badge:
    text: Core
    variant: note
---

`manifest.js` exports `controls`, an array of plain objects — no functions — describing every control the panel can render: its id, label, type, default value, and which of the twelve `GROUPS` it belongs to.

## Control shape

Each control carries a dotted, stable `id` such as `color.accent.hue` or `layout.contentWidth`. The id is the only thing referenced by `state.js`, `emit-css.js`, and the UI, so renaming a control after it ships is a breaking change for anyone with a saved `state.json`.

## Tiers

Every control also carries a `tier` — `1`, `1.5`, `2`, or `'build'` — that the UI uses to decide which controls to show by default versus behind an "advanced" toggle.
