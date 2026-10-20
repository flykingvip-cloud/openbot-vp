/**
 * @openbot/aor-backend-openbot
 *
 * The OpenBot implementation of the AOR ExecutionBackend. Couples to OpenBot
 * only through its public OpenAI-compatible HTTP / Gateway contract.
 */
export * from "./client.js";
export * from "./backend.js";
export * from "./gateway-rpc.js";
export * from "./billing-ingest.js";
export * from "./tools-invoke.js";
export * from "./openbot-capabilities.js";

export const AOR_BACKEND_OPENBOT_VERSION = "0.1.0";
