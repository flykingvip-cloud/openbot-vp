/**
 * Maps 大白名录 catalogId → Growth templateId so agents.create can trigger
 * autoInstallCapabilitiesOnAgentCreate (TEMPLATE_AUTO_SKILL_KEYS).
 * Unknown / unmapped / custom paths fall back to generic_worker.
 *
 * Constants live in the gateway module so for-seat prefilter stays in sync.
 */

export {
  DAIBAI_CATALOG_TEMPLATE_ID,
  DAIBAI_DEFAULT_TEMPLATE_ID,
  resolveDaibaiCatalogTemplateId,
} from "../../../../../../src/gateway/enterprise-data/daibai-mcp-scan-hints.ts";
