// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertPlanVersionModelBinding } from "../model-entitlement/plan-version-model-binding-store.js";
import { checkResourceCatalogIntegrity } from "./doctor-checks.js";
import { upsertResourceModelCatalogEntry } from "./models-catalog-store.js";

const tmpDir = path.join(os.tmpdir(), `openbot-resource-doctor-${Date.now()}`);
const catalogPath = path.join(tmpDir, "catalog.json");
const bindingPath = path.join(tmpDir, "binding.json");

const cfg = {
  models: {
    providers: {
      "api-proxy-deepseek": { models: [{ id: "deepseek-chat" }] },
      ollama: { models: [{ id: "llama3.2" }] },
    },
  },
} as never;

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkResourceCatalogIntegrity (Phase 3 derived-health framing)", () => {
  it("flags a stale derived cache as info, not a manual mismatch", async () => {
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-deepseek/deepseek-chat", tier: "tier_a", enabled: true },
      catalogPath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "ollama/llama3.2", tier: "tier_a", enabled: true },
      catalogPath,
    );
    // Cached allowedModelIds lags the current tier_a projection (missing llama3.2).
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-stale",
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
        allowedTiers: ["tier_a"],
      },
      bindingPath,
    );

    const issues = await checkResourceCatalogIntegrity(cfg, {
      modelCatalogStorePath: catalogPath,
      planBindingStorePath: bindingPath,
    });
    const stale = issues.find((i) => i.code === "binding_tier_mismatch");
    expect(stale).toBeTruthy();
    expect(stale?.severity).toBe("info");
    expect(stale?.planVersionId).toBe("pv-stale");
    expect(stale?.hint).toContain("derived cache");
  });

  it("flags an empty tier projection as a health warning", async () => {
    // tier_a has only a disabled model -> projection resolves to empty.
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-deepseek/deepseek-chat", tier: "tier_a", enabled: false },
      catalogPath,
    );
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-empty",
        allowedModelIds: [],
        allowedTiers: ["tier_a"],
      },
      bindingPath,
    );

    const issues = await checkResourceCatalogIntegrity(cfg, {
      modelCatalogStorePath: catalogPath,
      planBindingStorePath: bindingPath,
    });
    const empty = issues.find((i) => i.code === "binding_tier_empty_projection");
    expect(empty).toBeTruthy();
    expect(empty?.severity).toBe("warning");
    expect(empty?.planVersionId).toBe("pv-empty");
  });

  it("emits no binding issue when the derived cache matches the current projection", async () => {
    await upsertResourceModelCatalogEntry(
      { modelId: "api-proxy-deepseek/deepseek-chat", tier: "tier_a", enabled: true },
      catalogPath,
    );
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-fresh",
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat"],
        allowedTiers: ["tier_a"],
      },
      bindingPath,
    );

    const issues = await checkResourceCatalogIntegrity(cfg, {
      modelCatalogStorePath: catalogPath,
      planBindingStorePath: bindingPath,
    });
    expect(issues.some((i) => i.planVersionId === "pv-fresh")).toBe(false);
  });
});
