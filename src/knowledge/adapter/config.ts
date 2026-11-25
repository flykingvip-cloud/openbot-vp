import type { AdapterConfig } from "./client.js";
/** Only the literal true opts in; production remains rejected by the client. */
export function adapterConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AdapterConfig {
  return {
    enabled: env.OPENBOT_KNOWLEDGE_SDK_V2_ENABLED === "true",
    environment: env.NODE_ENV === "production" ? "production" : "test",
    allowedTenantIds: (env.OPENBOT_KNOWLEDGE_SDK_V2_TEST_TENANTS ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    baseUrl: env.OPENBOT_KNOWLEDGE_SDK_V2_BASE_URL ?? "http://127.0.0.1:8088",
    timeoutMs: 5000,
    secret: env.OPENBOT_KNOWLEDGE_SDK_V2_SECRET ?? "",
  };
}
