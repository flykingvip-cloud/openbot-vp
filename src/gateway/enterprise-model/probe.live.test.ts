/**
 * Optional live probe against a real upstream provider.
 *
 * Enable with:
 *   ENTERPRISE_MODEL_LIVE_PROBE=1
 *   ENTERPRISE_MODEL_PROBE_API_KEY=sk-...
 * Optional:
 *   ENTERPRISE_MODEL_PROBE_BASE_URL=https://api.openai.com/v1
 *   ENTERPRISE_MODEL_PROBE_PROVIDER=openai|openai-compatible|anthropic
 *
 * Does NOT charge inference (GET /models only). Skipped by default in CI.
 */
import { describe, expect, it } from "vitest";
import { isTruthyEnvValue } from "../../infra/env.js";
import { probeEnterpriseModelConnection } from "./probe.js";
import type { EnterpriseModelProviderType } from "./types.js";

const LIVE = isTruthyEnvValue(process.env.ENTERPRISE_MODEL_LIVE_PROBE);
const API_KEY = process.env.ENTERPRISE_MODEL_PROBE_API_KEY?.trim() ?? "";
const BASE_URL = process.env.ENTERPRISE_MODEL_PROBE_BASE_URL?.trim() || "https://api.openai.com/v1";
const PROVIDER = (process.env.ENTERPRISE_MODEL_PROBE_PROVIDER?.trim() ||
  "openai") as EnterpriseModelProviderType;

const describeLive = LIVE && API_KEY ? describe : describe.skip;

describeLive("enterprise-model live probe (real upstream)", () => {
  it("lists models via GET /models without inference cost", async () => {
    const result = await probeEnterpriseModelConnection({
      providerType: PROVIDER,
      protocol: PROVIDER === "anthropic" ? "anthropic-messages" : "openai-completions",
      baseUrl: BASE_URL,
      secret: { apiKey: API_KEY },
      timeoutMs: 30_000,
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("OK");
    expect(result.discoveredModels.length).toBeGreaterThan(0);
    // Never echo secrets into assertions/logs via expect messages
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  }, 35_000);
});
