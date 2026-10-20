import { projectOperationalGrowth } from "./operational-growth.js";
/**
 * Compile-time gate: omitting installedSkillKeys must be a TypeScript error.
 * If this file typechecks cleanly, the required-parameter contract has regressed.
 */
import type { OperationalMetrics } from "./operational-metrics-store.js";
import type { GrowthStatus } from "./types.js";

declare const status: GrowthStatus;
declare const metrics: OperationalMetrics;

// @ts-expect-error installedSkillKeys is required — omission must fail typecheck
projectOperationalGrowth(status, metrics, Date.now());

// Valid call site (keeps the expect-error honest if arity changes).
projectOperationalGrowth(status, metrics, Date.now(), []);
