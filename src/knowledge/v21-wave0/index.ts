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
export {
  MODELS_EMBED_PROVIDER_TRACK,
  MODELS_EMBED_PROXY_ENABLED_DEFAULT,
  createControlledModelsEmbedProxy,
} from "./models-embed-proxy.js";
export {
  createSemanticObjectStoreCatalogReader,
  redactSemanticObjectRecord,
} from "./semantic-object-catalog-read-adapter.js";
export {
  COGNIWEAVE_CHANNEL_4,
  REVOCATION_PURGE_CHANNELS,
  REVOCATION_PURGE_RECEIPT_ENABLED_DEFAULT,
  computeChannelReceiptHash,
  computeRevocationPurgeReceiptHash,
  createRevocationPurgeReceiptValidator,
} from "./revocation-purge-receipt.js";

export { canonicalJsonBytes, canonicalJsonText, canonicalSha256Hex } from "./canonical-json.js";

export {
  PRE03_AUTH_V21_04_PRODUCTION_EXPORT_AUTHORIZED,
  PRE03_ZERO_PII_VALIDATOR_IO,
  validatePre03Candidate,
} from "./pre03-zero-pii-validator.js";
export {
  PRE04_LEAVER_POLICY_GUARD_ENABLED_DEFAULT,
  evaluatePre04LeaverPolicy,
} from "./pre04-leaver-policy-guard.js";
export {
  FORMAL_T01_T27_ACCEPTED,
  SCHEMA_V7_PROD_MIGRATION_AUTHORIZED,
  SPACE_C03_PHASE_ONE_ORG_TEAM_TO_TEAM_SPACE,
  SPACE_FAVORITES_V7_ADAPTER_ENABLED_DEFAULT,
  addFavorite,
  resolveAuthorizedFavorites,
} from "./space-favorites-v7-adapter.js";
