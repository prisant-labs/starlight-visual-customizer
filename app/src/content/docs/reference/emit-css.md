---
title: emit-css.js
description: The single function that turns a ThemeState into CSS.
sidebar:
  order: 3
---

`emitCss(state, options)` is the only place in the codebase that knows how a control id becomes a line of CSS. Everywhere else treats a control as opaque data.

## Output order

The function always emits, in order: a header comment naming the tool and the pinned Starlight version, font `@import` statements (skipped in preview mode, where fonts are injected separately), dark-mode `:root` tokens, light-mode `:root[data-theme='light']` tokens, component-scoped tokens, and finally treatment rules.

## What gets skipped

A default `ThemeState` — one where every control still has its manifest default — emits only the header comment. Nothing else is written unless a value actually differs from its default, which keeps exported stylesheets small even for sites that only tweak one or two things.
