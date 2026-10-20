// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "../server-methods/types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-resource-catalog-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    models: {
      providers: {
        "api-proxy-deepseek": { models: [{ id: "deepseek-chat" }] },
      },
    },
  }),
}));

const { resourceCatalogHandlers } = await import("../server-methods/resource-catalog.js");

type HandlerError = { code?: string; message?: string };

async function invoke<P = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; payload: P; error: HandlerError }> {
  const handler = resourceCatalogHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: { ok: boolean; payload: P; error: HandlerError } | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "admin@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload: payload as P, error: (error ?? {}) as HandlerError };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("platform-resource-catalog.*", () => {
  it("overview seeds default tiers and credit weights", async () => {
    const res = await invoke<{
      tiers: Array<{ id: string }>;
      creditWeights: Array<{ tier: string; creditCost: number }>;
    }>("platform-resource-catalog.overview");
    expect(res.ok).toBe(true);
    expect(res.payload.tiers.map((t) => t.id)).toEqual(["tier_a", "tier_b", "tier_c"]);
    expect(res.payload.creditWeights).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tier: "tier_a", creditCost: 1 }),
        expect.objectContaining({ tier: "tier_c", creditCost: 20 }),
      ]),
    );
  });

  it("overview includes tier usage stats from ledger window", async () => {
    const res = await invoke<{
      tierUsageStats: Array<{ tierId: string; taskCount: number }>;
      tierUsageWindow: { startTime: string; endTime: string };
    }>("platform-resource-catalog.overview");
    expect(res.ok).toBe(true);
    expect(res.payload.tierUsageWindow.startTime).toBeTruthy();
    expect(res.payload.tierUsageStats.length).toBeGreaterThan(0);
    expect(res.payload.tierUsageStats.every((row) => typeof row.taskCount === "number")).toBe(true);
  });

  it("seed-from-config creates catalog entries from cfg", async () => {
    const seed = await invoke<{
      seed: { created: number; skipped: number };
    }>("platform-resource-catalog.models.seed-from-config");
    expect(seed.ok).toBe(true);
    expect(seed.payload.seed.created).toBe(1);

    const list = await invoke<{ models: Array<{ modelId: string; tier: string }> }>(
      "platform-resource-catalog.models.list",
    );
    expect(list.payload.models[0]?.modelId).toBe("api-proxy-deepseek/deepseek-chat");
    expect(list.payload.models[0]?.tier).toBe("tier_b");
  });

  it("upsert model and resolve tiers", async () => {
    await invoke("platform-resource-catalog.models.seed-from-config");
    const upsert = await invoke<{ model: { modelId: string; tier: string } }>(
      "platform-resource-catalog.models.upsert",
      {
        modelId: "api-proxy-deepseek/deepseek-chat",
        tier: "tier_a",
        inputCostPer1MCents: 50,
        outputCostPer1MCents: 150,
      },
    );
    expect(upsert.ok).toBe(true);
    expect(upsert.payload.model.tier).toBe("tier_a");

    const resolved = await invoke<{
      pool: { modelIds: string[] };
    }>("platform-resource-catalog.resolve-tiers", { tierIds: ["tier_a"] });
    expect(resolved.payload.pool.modelIds).toContain("api-proxy-deepseek/deepseek-chat");
  });

  it("failover-rules upsert persists tier rule", async () => {
    const res = await invoke<{ failoverRule: { tier: string; enabled: boolean; mode: string } }>(
      "platform-resource-catalog.failover-rules.upsert",
      {
        tier: "tier_a",
        enabled: true,
        failureRateThreshold: 0.15,
        minSampleSize: 10,
        maxConsecutiveFailures: 2,
        latencyThresholdMs: 5000,
        cooldownSeconds: 120,
        mode: "fallback_tier",
        fallbackTierId: "tier_b",
      },
    );
    expect(res.ok).toBe(true);
    expect(res.payload.failoverRule).toMatchObject({
      tier: "tier_a",
      enabled: true,
      mode: "fallback_tier",
    });

    const overview = await invoke<{
      failoverRules: Array<{ tier: string; fallbackTierId: string | null }>;
    }>("platform-resource-catalog.overview");
    expect(overview.payload.failoverRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tier: "tier_a", fallbackTierId: "tier_b" }),
      ]),
    );
  });
});
