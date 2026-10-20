// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applyModelCostDefaultsToCatalog } from "./apply-cost-defaults.js";
import {
  listResourceModelCatalog,
  upsertResourceModelCatalogEntry,
} from "./models-catalog-store.js";

const tmpDir = path.join(os.tmpdir(), `openbot-apply-cost-${Date.now()}`);
const storePath = path.join(tmpDir, "models.json");

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
});

describe("applyModelCostDefaultsToCatalog", () => {
  it("backfills unpriced entries from the default table and corrects tier", async () => {
    // 模拟线上：seed 出来的 0/0、tier_b。
    await upsertResourceModelCatalogEntry(
      { modelId: "anthropic/claude-3-7-sonnet", tier: "tier_b" },
      storePath,
    );
    await upsertResourceModelCatalogEntry(
      { modelId: "deepseek/deepseek-chat", tier: "tier_b" },
      storePath,
    );
    await upsertResourceModelCatalogEntry({ modelId: "acme/mystery", tier: "tier_b" }, storePath);

    const result = await applyModelCostDefaultsToCatalog({ storePath });

    expect(result.updated.map((u) => u.modelId).toSorted()).toEqual([
      "anthropic/claude-3-7-sonnet",
      "deepseek/deepseek-chat",
    ]);
    expect(result.skippedNoDefault).toEqual(["acme/mystery"]);

    const catalog = await listResourceModelCatalog(storePath);
    const sonnet = catalog.find((m) => m.modelId === "anthropic/claude-3-7-sonnet");
    expect(sonnet?.inputCostPer1MCents).toBe(2160);
    expect(sonnet?.outputCostPer1MCents).toBe(10800);
    const deepseek = catalog.find((m) => m.modelId === "deepseek/deepseek-chat");
    expect(deepseek?.tier).toBe("tier_a"); // 修正 tier_b → tier_a
    expect(deepseek?.inputCostPer1MCents).toBeGreaterThan(0);
  });

  it("skips already-priced entries unless overwriteExisting", async () => {
    await upsertResourceModelCatalogEntry(
      {
        modelId: "anthropic/claude-3-7-sonnet",
        tier: "tier_b",
        inputCostPer1MCents: 999,
        outputCostPer1MCents: 1234,
      },
      storePath,
    );

    const noOverwrite = await applyModelCostDefaultsToCatalog({ storePath });
    expect(noOverwrite.updated).toEqual([]);
    expect(noOverwrite.skippedAlreadyPriced).toEqual(["anthropic/claude-3-7-sonnet"]);

    const overwrite = await applyModelCostDefaultsToCatalog({ storePath, overwriteExisting: true });
    expect(overwrite.updated.map((u) => u.modelId)).toEqual(["anthropic/claude-3-7-sonnet"]);
    const catalog = await listResourceModelCatalog(storePath);
    expect(
      catalog.find((m) => m.modelId === "anthropic/claude-3-7-sonnet")?.inputCostPer1MCents,
    ).toBe(2160);
  });

  it("dry-run reports changes without persisting", async () => {
    await upsertResourceModelCatalogEntry(
      { modelId: "deepseek/deepseek-chat", tier: "tier_b" },
      storePath,
    );
    const result = await applyModelCostDefaultsToCatalog({ storePath, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.updated).toHaveLength(1);
    const catalog = await listResourceModelCatalog(storePath);
    expect(catalog[0].inputCostPer1MCents).toBe(0); // 未落盘
  });
});
