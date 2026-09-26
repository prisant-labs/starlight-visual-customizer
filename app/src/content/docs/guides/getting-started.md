---
title: Getting Started
description: Install Starlight Customizer and open the panel on your own docs site.
---

Starlight Customizer adds a single Astro component override to your existing Starlight project. There is no build plugin to configure and no new runtime dependency beyond the customizer's own pure JavaScript modules.

## Install the panel

Point your Starlight config's `components.Footer` at a footer override that renders Starlight's default footer and then mounts `<sl-customizer>`. The panel is a self-contained web component, so nothing else in your project needs to change.

## Open the panel

Load any page of your site in a browser and look for the floating gear button in the bottom-right corner. Click it to expand the drawer. The first thing you'll see is the preset gallery — start there if you want a finished look before you start tweaking individual tokens.

## Save your work

Every change you make is written to `localStorage` immediately, so a page reload never loses your progress. When you're ready to ship, open the export tab and copy `theme.css` and `APPLY-THEME.md` into your real project.
