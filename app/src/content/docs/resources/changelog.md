---
title: Changelog
description: Notable changes to Starlight Customizer, newest first.
banner:
  content: |
    Starlight Customizer is in active development. Control ids listed in the reference section may still shift before v1.
lastUpdated: 2026-09-01
prev:
  # D3a: relative, not root-absolute - see specimen.mdx's comment (Starlight's frontmatter prev/next
  # override bypasses its usual base-path prefixing).
  label: Back to the Kitchen Sink
  link: ../../guides/kitchen-sink/
next:
  label: Emitter Reference
  link: ../../reference/emit-css/
---

## 0.3.0 — Sidebar IA editor

Added the tree editor for `state.ia`, including reordering (move up, move down, indent, outdent), inline badge editing, and a "paste a file listing" importer for teams migrating from a flat `ls -R` of `src/content/docs`.

## 0.2.0 — Contrast readout

The panel now shows a live WCAG contrast ratio for text-on-background and link-on-background, computed for both light and dark mode as you drag the accent hue slider.

## 0.1.0 — Initial preset gallery

Shipped the five official Starlight theme designer presets alongside four original character presets: editorial serif, dense technical, soft rounded, and high-contrast mono.
