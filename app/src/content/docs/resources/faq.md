---
title: Frequently Asked Questions
description: Common questions about how Starlight Customizer works.
---

## Does this modify my Starlight version?

No. The customizer pins against a specific Starlight version (0.42.4) and reads its DOM structure and CSS custom properties, but it doesn't patch or fork any Starlight source. If you upgrade Starlight and a selector changes, the customizer's treatment options may stop matching until it's updated for the new version.

## Can I use it without the panel, just for the emitted CSS?

Yes. `emitCss` is a pure function — hand it a `ThemeState` and it returns a CSS string with no dependency on a browser, `localStorage`, or the DOM. Several teams generate their theme entirely from a checked-in state file in CI and never open the panel at all.

## What happens if I edit the sidebar and then edit `astro.config.mjs` by hand?

The IA editor's tree and your config file are two independent representations of the same shape. If you hand-edit the config after using the IA editor, re-import it with "reset to fixture," or by pasting the config source back in, so the panel doesn't overwrite your manual changes on the next export.

## Does it work with a custom Expressive Code theme?

The panel lets you pick from a short list of bundled Shiki themes, but changing that control only shows a note in the preview rather than live-swapping the syntax highlighting — Expressive Code themes are applied at build time, not runtime.
