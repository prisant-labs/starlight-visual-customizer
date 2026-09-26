---
title: Webhooks
description: There aren't any yet, and here's the workaround.
---

Starlight Customizer is a build-time and browser-time tool, not a running service, so it doesn't currently emit webhooks when a theme changes. If your workflow needs to react to theme updates — for example, to trigger a redeploy whenever `theme.css` changes — wire that up at the repository level instead.

## Recommended workaround

Most teams get the same result with a path filter on their existing CI trigger: configure your deploy job to run whenever `src/styles/theme.css` changes, the same way it already runs when content changes. This requires no integration with the customizer itself, since the exported file is just a normal file in your repository.
