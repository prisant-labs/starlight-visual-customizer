---
title: API Keys
description: Starlight Customizer has no API, so there's nothing to authenticate.
---

Because the customizer runs client-side and writes only to `localStorage` and downloaded files, there is no server component and therefore no API surface to protect with a key. If a future hosted preset-sharing service is added, this page will document how to provision credentials for it.

## Embedding the emitter in your own tooling

If you want to call the pure emitter functions (`emitCss`, `emitApplyTheme`) from your own scripts, import them directly from the customizer's core modules. No key or token is required, since it's a local JavaScript import rather than a network call.
