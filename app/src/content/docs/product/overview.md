---
title: Product Overview
description: What Starlight Customizer is, and what it deliberately doesn't try to be.
---

Starlight Customizer is a visual theme editor that runs inside the Starlight documentation site it's theming. There's no separate design tool, no screenshot-based mockup, and no synced preview iframe that can drift from reality — the panel and the page it's editing are the same DOM.

## What it does

- Recolors, retypesets, and re-skins a Starlight site's built-in components (sidebar, TOC, asides, code blocks, badges, and more) using CSS custom properties Starlight already exposes.
- Lets you rearrange the sidebar's navigation tree without hand-editing a config array.
- Exports a single stylesheet and a short Markdown walkthrough you can drop straight into a real project.

## What it doesn't do

Starlight Customizer does not add new layout primitives, replace Starlight's Markdown pipeline, or let you redesign the underlying HTML structure of a page. If you need a fundamentally different layout, this tool isn't the right level of the stack — reach for a custom Starlight component override instead.
