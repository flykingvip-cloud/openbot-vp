// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { createPlan } from "../billing/plans-store.js";
import {
  checkCredentialConvergenceReadiness,
  checkModelKeyConflicts,
  checkPlanBindingIntegrity,
} from "./doctor-checks.js";
import { upsertPlanVersionModelBinding } from "./plan-version-model-binding-store.js";

vi.mock("../../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(async () => [
    { id: "deepseek-chat", name: "DeepSeek Chat", provider: "api-proxy-deepseek", input: ["text"] },
    { id: "llama3.2", name: "Llama 3.2", provider: "ollama", input: ["text"] },
    { id: "gpt-4o", name: "GPT-4o", provider: "openai", input: ["text", "image"] },
  ]),
  findModelInCatalog: vi.fn(
    (catalog: Array<{ provider: string; id: string }>, provider: string, modelId: string) =>
      catalog.find(
        (entry) =>
          entry.provider.toLowerCase() === provider.toLowerCase() &&
          entry.id.toLowerCase() === modelId.toLowerCase(),
      ),
  ),
  modelSupportsVision: vi.fn((entry: { input?: string[] } | undefined) =>
    Boolean(entry?.input?.includes("image")),
  ),
}));

function cfgWith(providers: Record<string, unknown>): OpenBotConfig {
  return { models: { providers } } as unknown as OpenBotConfig;
}

let tmpDir: string;
let plansStorePath: string;
let bindingStorePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-entitlement-doctor-"));
  plansStorePath = path.join(tmpDir, "plans.json");
  bindingStorePath = path.join(tmpDir, "bindings.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkModelKeyConflicts (runtime-aligned sources)", () => {
  it("flags conflict when inline literal apiKey AND a canonical env var are both set", () => {
    const cfg = cfgWith({
      openai: {
        apiKey: "sk-literal-inline-key",
        models: [{ id: "gpt-5.2" }],
      },
    });
    const issues = checkModelKeyConflicts(cfg, { OPENAI_API_KEY: "sk-env-key" });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("model_key_conflict");
    expect(issues[0]?.modelId).toBe("openai/gpt-5.2");
    expect(issues[0]?.message).toContain("inline apiKey");
    expect(issues[0]?.message).toContain("env OPENAI_API_KEY");
  });

  it("does NOT flag when only inline apiKey is present (no env)", () => {
    const cfg = cfgWith({
      openai: { apiKey: "sk-literal-inline-key", models: [{ id: "gpt-5.2" }] },
    });
    expect(checkModelKeyConflicts(cfg, {})).toHaveLength(0);
  });

  it("does NOT flag when only env is present (no inline literal)", () => {
    const cfg = cfgWith({ openai: { models: [{ id: "gpt-5.2" }] } });
    expect(checkModelKeyConflicts(cfg, { OPENAI_API_KEY: "sk-env-key" })).toHaveLength(0);
  });

  it("does NOT treat an env-marker inline apiKey as an independent source", () => {
    // apiKey value is itself an env var name (marker), not a literal secret.
    const cfg = cfgWith({
      openai: { apiKey: "OPENAI_API_KEY", models: [{ id: "gpt-5.2" }] },
    });
    expect(checkModelKeyConflicts(cfg, { OPENAI_API_KEY: "sk-env-key" })).toHaveLength(0);
  });

  it("does NOT use secrets.providers as a key source (avoids false positive)", () => {
    const cfg = {
      models: { providers: { openai: { apiKey: "sk-literal", models: [{ id: "gpt-5.2" }] } } },
      secrets: { providers: { openai: { source: "file" } } },
    } as unknown as OpenBotConfig;
    // Only inline literal present, secrets.providers must be ignored → no conflict.
    expect(checkModelKeyConflicts(cfg, {})).toHaveLength(0);
  });

  it("resolves provider id aliases for env candidate lookup (zai)", () => {
    const cfg = cfgWith({
      "z.ai": { apiKey: "sk-literal", models: [{ id: "glm-4" }] },
    });
    const issues = checkModelKeyConflicts(cfg, { ZAI_API_KEY: "sk-env" });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("env ZAI_API_KEY");
  });
});

describe("checkCredentialConvergenceReadiness (P4 task 15)", () => {
  const conflictCfg = () =>
    ({
      models: {
        providers: { openai: { apiKey: "sk-literal", models: [{ id: "gpt-5.2" }] } },
      },
    }) as unknown as OpenBotConfig;

  const catalogCfg = () =>
    ({
      gateway: { platform: { models: { credentials: { mode: "catalog" } } } },
      models: {
        providers: { openai: { apiKey: "sk-literal", models: [{ id: "gpt-5.2" }] } },
      },
    }) as unknown as OpenBotConfig;

  it("legacy + no conflict → no readiness issue", () => {
    expect(checkCredentialConvergenceReadiness(conflictCfg(), {})).toEqual([]);
  });

  it("legacy + conflict → info-level converge-first hint", () => {
    const issues = checkCredentialConvergenceReadiness(conflictCfg(), {
      OPENAI_API_KEY: "sk-env",
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("credential_convergence");
    expect(issues[0]?.severity).toBe("info");
    expect(issues[0]?.message).toContain("catalog");
  });

  it("catalog + residual env shadow → warning to remove stale env", () => {
    const issues = checkCredentialConvergenceReadiness(catalogCfg(), {
      OPENAI_API_KEY: "sk-env",
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.message).toContain("catalog");
  });

  it("catalog + clean (no env shadow) → no issue", () => {
    expect(checkCredentialConvergenceReadiness(catalogCfg(), {})).toEqual([]);
  });
});

describe("checkPlanBindingIntegrity", () => {
  const catalogCfg = () =>
    cfgWith({
      "api-proxy-deepseek": { models: [{ id: "deepseek-chat" }] },
      ollama: { models: [{ id: "llama3.2" }] },
    });

  it("flags current active version missing a binding", async () => {
    const plan = await createPlan(
      {
        name: "Starter",
        billingCycle: "monthly",
        basePriceCents: 9900,
        seatQuota: {},
        botQuota: 5,
        pricing: [],
        createdByUserId: "platform-admin",
      },
      plansStorePath,
    );
    const issues = await checkPlanBindingIntegrity(catalogCfg(), {
      plansStorePath,
      planBindingStorePath: bindingStorePath,
    });
    expect(issues.some((issue) => issue.code === "plan_binding_missing")).toBe(true);
    expect(issues.find((issue) => issue.code === "plan_binding_missing")?.planVersionId).toBe(
      plan.currentVersionId,
    );
  });

  it("flags orphan bindings that reference no plan version", async () => {
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-orphan", allowedModelIds: ["ollama/llama3.2"] },
      bindingStorePath,
    );
    const issues = await checkPlanBindingIntegrity(catalogCfg(), {
      plansStorePath,
      planBindingStorePath: bindingStorePath,
    });
    expect(issues.some((issue) => issue.code === "plan_binding_orphan")).toBe(true);
  });

  it("flags bindings that contain models outside the active catalog", async () => {
    const plan = await createPlan(
      {
        name: "Growth",
        billingCycle: "monthly",
        basePriceCents: 19900,
        seatQuota: {},
        botQuota: 10,
        pricing: [],
        createdByUserId: "platform-admin",
      },
      plansStorePath,
    );
    await upsertPlanVersionModelBinding(
      { planVersionId: plan.currentVersionId, allowedModelIds: ["legacy/removed"] },
      bindingStorePath,
    );
    const issues = await checkPlanBindingIntegrity(catalogCfg(), {
      plansStorePath,
      planBindingStorePath: bindingStorePath,
    });
    expect(issues.some((issue) => issue.code === "plan_binding_invalid_catalog")).toBe(true);
  });

  it("flags bindings missing a vision-capable model", async () => {
    const plan = await createPlan(
      {
        name: "TextOnly",
        billingCycle: "monthly",
        basePriceCents: 9900,
        seatQuota: {},
        botQuota: 5,
        pricing: [],
        createdByUserId: "platform-admin",
      },
      plansStorePath,
    );
    await upsertPlanVersionModelBinding(
      {
        planVersionId: plan.currentVersionId,
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
      },
      bindingStorePath,
    );
    const issues = await checkPlanBindingIntegrity(catalogCfg(), {
      plansStorePath,
      planBindingStorePath: bindingStorePath,
    });
    expect(issues.some((issue) => issue.code === "plan_binding_missing_vision")).toBe(true);
  });
});
