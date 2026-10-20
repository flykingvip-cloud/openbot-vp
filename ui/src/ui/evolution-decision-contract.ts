/**
 * Browser-safe boundary for the evolution Decision Surface contract.
 *
 * UI runtime code reaches the Decision Surface through this file only. It
 * re-exports the decision-surface entry and nothing else. The package root
 * (`@openbot/evolution-core`, `packages/evolution-core/src/index.ts`) also
 * re-exports Node-only modules, so the UI bundle must never import it at
 * runtime. Types that this entry does not export (for example
 * `AuthorityGrantView`, `EvolutionTarget`) may still come from the package
 * root through `import type`, which the build erases.
 *
 * Source contract tests keep the mounted employee surface and the enterprise
 * candidate on this boundary.
 */
export * from "../../../packages/evolution-core/src/decision-surface/index.ts";
