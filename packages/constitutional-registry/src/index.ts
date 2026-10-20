/**
 * Registry scaffold. Re-exports adapter and read-model vocabulary from
 * `@openbot/constitutional-contracts`. Source ledger ids stay distinct.
 * Not an independent deployable and not a physical ledger merge.
 */

export {
  CONSTITUTIONAL_REGISTRY_PRODUCT,
  PHASE_D_PRODUCT_SPLIT_SCOPE,
  REGISTRY_SCAFFOLD_BOUNDARY,
} from "./boundary.js";
export {
  DOMAIN_WRITE_AUTHORITY_LABELS,
  EVOLUTION_LEDGER,
  EVOLUTION_RECEIPT_ONLY_EVENT_TYPES,
  EXECUTION_TRACE_LEDGER,
  NON_EQUIVALENCE,
  PLUGIN_REGISTRY_LEDGER,
  VALIDATION_RECEIPT_LEDGER,
  adaptCapabilityGrant,
  adaptDomainContract,
  adaptEvolutionLedgerEvent,
  adaptExecutionTrace,
  adaptPluginInstall,
  adaptValidationReceipt,
  projectConstitutionalLedgerView,
  projectConstitutionalViewFromSources,
  type CapabilityGrantSource,
  type ConstitutionalLedgerView,
  type ConstitutionalSourceSnapshot,
  type EvolutionLedgerSourceEvent,
  type ExecutionTraceSource,
  type PluginInstallSource,
  type ValidationReceiptSource,
} from "@openbot/constitutional-contracts";
