---
title: Theming Deep Dive
description: How Orbit turns a handful of sliders into a full OKLCH color system.
---

Most theme editors let you pick a single accent color and call it a day. Orbit instead asks for a hue and a chroma, then derives an entire ramp — low, base, and high variants for both light and dark mode — using the same OKLCH color math as Starlight's own official theme designer.

## Why OKLCH instead of hex

Hex and HSL both distort perceived lightness as hue changes: a hue-120 green at 50% lightness looks much brighter than a hue-300 magenta at the same numeric lightness. OKLCH corrects for this, so a single lightness value produces consistent contrast across the entire hue wheel.

### Contrast floors

Every derived color is checked against a contrast floor you choose — AA or AAA — against both the light and dark background it will actually sit on. If a derived shade would fail, the customizer nudges its lightness until it passes, rather than emitting a color you'd have to fix by hand later.

## Semantic hues

Beyond the accent color, five semantic hues (orange, green, blue, purple, red) back every aside, badge, and diff marker on the site. Changing the "danger" hue updates caution asides, danger badges, and deleted-line code markers all at once, because they all resolve to the same underlying token.
