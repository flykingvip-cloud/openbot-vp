/**
 * Wave-V21-0 default-off adapters. Do not import from Gateway default method
 * tables. OPENBOT_KNOWLEDGE_SDK_V2_ENABLED must remain unset / not "true".
 */
export {
  AI_EXECUTION_TRACE_HEADER_KEYS,
  AI_EXECUTION_TRACE_HEADER_PROPAGATOR_ENABLED_DEFAULT,
  createAiExecutionTraceHeaderPropagator,
} from "./ai-execution-trace-header-propagator.js";
export {
  CONTROLLED_DATA_BRIDGE_UNLOCKED,
  evaluateControlledDataBridge,
} from "./controlled-data-bridge-guard.js";
export {
  SEMANTIC_OBJECT_CATALOG_READ_ADAPTER_ENABLED_DEFAULT,
  SEMANTIC_OBJECT_STORE_FILENAME,
  createSemanticObjectCatalogReadAdapter,
} from "./semantic-object-catalog-read-adapter.js";
