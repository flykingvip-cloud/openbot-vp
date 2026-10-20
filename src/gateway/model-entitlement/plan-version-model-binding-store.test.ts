// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deletePlanVersionModelBinding,
  getPlanVersionModelBinding,
  listPlanVersionModelBindings,
  upsertPlanVersionModelBinding,
} from "./plan-version-model-binding-store.js";

let dir: string;
let storePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "plan-binding-"));
  storePath = path.join(dir, "binding.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("PlanVersionModelBindingStore", () => {
  it("upserts and reads a binding by planVersionId", async () => {
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-1",
        allowedModelIds: ["api-proxy-gpt/gpt-5.2", "api-proxy-gpt/gpt-5.2", " "],
      },
      storePath,
    );
    const got = await getPlanVersionModelBinding("pv-1", storePath);
    expect(got?.planVersionId).toBe("pv-1");
    // deduped + blanks dropped
    expect(got?.allowedModelIds).toEqual(["api-proxy-gpt/gpt-5.2"]);
  });

  it("returns null for unknown planVersionId", async () => {
    expect(await getPlanVersionModelBinding("nope", storePath)).toBeNull();
  });

  it("persists optional modelQuota and aorExecution", async () => {
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-2",
        allowedModelIds: ["api-proxy-claude/claude-4.5"],
        modelQuota: {
          "api-proxy-claude/claude-4.5": { maxRequests: 1000, maxTokens: 2_000_000 },
        },
        aorExecution: {
          taskTypeId: "chat",
          selectorStrategy: "balanced",
          evaluatorMode: "default",
        },
      },
      storePath,
    );
    const got = await getPlanVersionModelBinding("pv-2", storePath);
    expect(got?.modelQuota?.["api-proxy-claude/claude-4.5"]?.maxRequests).toBe(1000);
    expect(got?.modelQuota?.["api-proxy-claude/claude-4.5"]?.maxTokens).toBe(2_000_000);
    expect(got?.aorExecution?.selectorStrategy).toBe("balanced");
  });

  it("normalizes legacy single-value modelQuota (number) to { maxRequests } on read", async () => {
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-legacy",
        allowedModelIds: ["a/b"],
        // legacy 形态：Record<modelId, number>（单值 = maxRequests）。
        modelQuota: { "a/b": 500 } as never,
      },
      storePath,
    );
    const got = await getPlanVersionModelBinding("pv-legacy", storePath);
    expect(got?.modelQuota?.["a/b"]).toEqual({ maxRequests: 500 });
  });

  it("persists per-model budgets and drops entries with no caps on read", async () => {
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-budget",
        allowedModelIds: ["a/b", "c/d"],
        modelBudgets: {
          "a/b": { monthlyCreditsCap: 1000, spendCapCents: 5000 },
          // No caps -> normalized away on read.
          "c/d": {},
        },
      },
      storePath,
    );
    const got = await getPlanVersionModelBinding("pv-budget", storePath);
    expect(got?.modelBudgets).toEqual({ "a/b": { monthlyCreditsCap: 1000, spendCapCents: 5000 } });
  });

  it("lists all bindings", async () => {
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-1", allowedModelIds: ["a/b"] },
      storePath,
    );
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-2", allowedModelIds: ["c/d"] },
      storePath,
    );
    const all = await listPlanVersionModelBindings(storePath);
    expect(all.map((b) => b.planVersionId).toSorted()).toEqual(["pv-1", "pv-2"]);
  });

  it("deletes a binding by planVersionId", async () => {
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-1", allowedModelIds: ["a/b"] },
      storePath,
    );
    const deleted = await deletePlanVersionModelBinding("pv-1", storePath);
    expect(deleted?.planVersionId).toBe("pv-1");
    expect(await getPlanVersionModelBinding("pv-1", storePath)).toBeNull();
  });

  it("delete returns null for unknown planVersionId", async () => {
    expect(await deletePlanVersionModelBinding("missing", storePath)).toBeNull();
  });

  it("rejects blank planVersionId", async () => {
    await expect(
      upsertPlanVersionModelBinding({ planVersionId: "  ", allowedModelIds: [] }, storePath),
    ).rejects.toThrow();
  });
});
