/**
 * Structural subsets of existing source ledgers.
 *
 * Callers inject records they already read. This package does not import
 * Gateway, evolution-core, plugin registry, or domain stores, and it does
 * not merge those ledgers into one physical store.
 */

/** Subset of `packages/evolution-core` `EvolutionLedgerEvent`. */
export type EvolutionLedgerSourceEvent = {
  eventId: string;
  type: string;
  proposalId: string;
  surfaceId: string;
  tenantScope: string | null;
  principalRef: string;
  /**
   * Optional effect-proof label already computed by the evolution lineage
   * projection. Honored only for `verification.completed`. Receipt-only
   * event types ignore it.
   */
  effectProof?: "none" | "linked-only" | "verified";
};

/** Subset of `src/agents/execution-preflight` `ValidationReceipt`. */
export type ValidationReceiptSource = {
  taskId: string;
  artifactHash: string;
  validatorId: string;
  timestamp: string;
  result: "passed" | "failed";
};

/** Subset of `src/agents/execution-preflight` `ExecutionTraceRecord`. */
export type ExecutionTraceSource = {
  taskId: string;
  sessionId: string;
  decisionCode: string;
  decisionStage: string;
};

/**
 * Subset of `src/plugins/registry-types` `PluginRecord`.
 * Loaded/enabled means installed into the trust base, not authorized.
 */
export type PluginInstallSource = {
  id: string;
  name: string;
  version?: string;
  enabled: boolean;
  status: "loaded" | "disabled" | "error";
  source: string;
};

/**
 * A grant ledger that is not the plugin registry.
 * `sourceLedger` must name that other ledger.
 */
export type CapabilityGrantSource = {
  grantId: string;
  capabilityId: string;
  principalRef: string;
  tenantScope: string | null;
  status: "granted" | "revoked" | "pending";
  sourceLedger: string;
};

export const PLUGIN_REGISTRY_LEDGER = "plugin-registry";
export const EVOLUTION_LEDGER = "evolution-ledger";
export const VALIDATION_RECEIPT_LEDGER = "execution-preflight-validation-receipt";
export const EXECUTION_TRACE_LEDGER = "execution-preflight-trace";
