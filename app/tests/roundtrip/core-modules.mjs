// @ts-check
/**
 * @file Loader for the app's own pure core modules, imported by RELATIVE PATH from this repo (this
 * suite lives inside `app/`, so plain relative imports resolve against `app/node_modules` the
 * normal way - no `createRequire` trick needed, unlike the throwaway harness this suite was ported
 * from, which lived outside the repo it was testing).
 */
export * as stateMod from '../../src/customizer/core/state.js';
export * as presetsMod from '../../src/customizer/core/presets.js';
export * as emitCssMod from '../../src/customizer/core/emit-css.js';
export * as emitApplyMod from '../../src/customizer/core/emit-apply.js';
export * as manifestMod from '../../src/customizer/core/manifest.js';
export * as treatmentsMod from '../../src/customizer/core/treatments.js';
export * as colorMod from '../../src/customizer/core/color.js';
export * as versionMod from '../../src/customizer/core/version.js';
