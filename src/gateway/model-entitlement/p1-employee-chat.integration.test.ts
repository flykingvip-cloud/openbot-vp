// @vitest-environment node
/**
 * Task 7 – P1 端到端验收测试（Property 1、3、7）。
 *
 * 验证「员工调用模型时真的会被企业/seat 授权拦住」：
 * - 被授权模型可正常通过候选列表。
 * - 未授权模型（含 explicit fallback）被 hard deny。
 * - resolved-empty 时 runWithModelFallback 抛 ModelEntitlementEmptyError（零出网）。
 * - missing entitlement（missing-allow）时候选正常流通。
 * - 非 employee 入口不受影响。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyEntitlementHardDeny,
  ModelEntitlementEmptyError,
  runWithModelFallback,
} from "../../agents/model-fallback.js";
import { checkEntitlementMissing, checkModelKeyConflicts } from "./doctor-checks.js";
import { upsertEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import { resolveEffectiveModelSet } from "./resolve-effective-model-set.js";
import { grantEmployeeModels, grantSeatModels } from "./seat-model-grant-store.js";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "p1-e2e-"));
});
afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const entitlementStorePath = () => path.join(tempDir, "ent.json");
const seatGrantStorePath = () => path.join(tempDir, "grant.json");

const baseCfg = {
  models: {
    providers: {
      "api-proxy-deepseek": {
        baseUrl: "https://api.deepseek.com",
        api: "openai-completions",
        models: [{ id: "deepseek-chat" }],
      },
      "api-proxy-gpt": {
        baseUrl: "https://api.example.com/v1",
        api: "openai-completions",
        models: [{ id: "gpt-5.2" }],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "api-proxy-deepseek/deepseek-chat", fallbacks: ["api-proxy-gpt/gpt-5.2"] },
    },
  },
} as unknown as import("../../config/types.js").OpenBotConfig;

async function seedEntitlementAndGrant(
  tenantId: string,
  seatId: string,
  allowedModelIds: string[],
  grantedModelIds: string[],
) {
  await upsertEnterpriseModelEntitlement({ tenantId, allowedModelIds }, entitlementStorePath());
  await grantSeatModels({ tenantId, seatId, grantedModelIds }, seatGrantStorePath());
}

describe("Property 1 — 授权模型通过候选列表", () => {
  it("员工被授权 deepseek → EffectiveModelSet 含 deepseek", async () => {
    await seedEntitlementAndGrant(
      "t1",
      "s1",
      ["api-proxy-deepseek/deepseek-chat"],
      ["api-proxy-deepseek/deepseek-chat"],
    );
    const result = await resolveEffectiveModelSet({
      tenantId: "t1",
      seatId: "s1",
      cfg: baseCfg,
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      // Fixture models live in cfg; platform catalog is empty in unit tests.
      requirePlatformCatalog: false,
      platformConnectedModelIdsOverride: ["api-proxy-deepseek/deepseek-chat"],
    });
    expect(result.state).toBe("resolved");
    expect(result.allowedModelIds).toContain("api-proxy-deepseek/deepseek-chat");
  });
});

describe("Property 7 — explicit fallback 不能越过有效集合", () => {
  it("只授权 gpt，deepseek（primary）与 explicit fallback 均被剔除", () => {
    const candidates = applyEntitlementHardDeny(
      [
        { provider: "api-proxy-deepseek", model: "deepseek-chat" }, // primary，未授权
        { provider: "api-proxy-gpt", model: "gpt-5.2" }, // fallback，已授权
      ],
      ["api-proxy-gpt/gpt-5.2"],
    );
    expect(candidates).toEqual([{ provider: "api-proxy-gpt", model: "gpt-5.2" }]);
  });
});

describe("授权链优先候选顺序", () => {
  it("entitlement + preferredModelOrder 存在时直接按授权顺序执行", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("first failed"))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg: baseCfg,
      provider: "api-proxy-deepseek",
      model: "deepseek-chat",
      entitlementAllowlist: ["api-proxy-gpt/gpt-5.2", "api-proxy-deepseek/deepseek-chat"],
      preferredModelOrder: ["api-proxy-gpt/gpt-5.2", "api-proxy-deepseek/deepseek-chat"],
      run,
    });

    expect(result.result).toBe("ok");
    expect(run.mock.calls[0]).toEqual(["api-proxy-gpt", "gpt-5.2"]);
    expect(run.mock.calls[1]).toEqual(["api-proxy-deepseek", "deepseek-chat"]);
  });

  it("session-pinned ent/* stays primary even when AOR prefers platform models", async () => {
    const run = vi.fn().mockResolvedValue("byok-ok");
    const result = await runWithModelFallback({
      cfg: baseCfg,
      provider: "ent",
      model: "cea43bf898/deepseek-v4-flash",
      entitlementAllowlist: [
        "api-proxy-deepseek/deepseek-chat",
        "ent/cea43bf898/deepseek-v4-flash",
      ],
      preferredModelOrder: ["api-proxy-deepseek/deepseek-chat", "ent/cea43bf898/deepseek-v4-flash"],
      fallbacksOverride: ["api-proxy-deepseek/deepseek-chat"],
      run,
    });
    expect(result.result).toBe("byok-ok");
    expect(run.mock.calls[0]?.[0]).toBe("ent");
    expect(run.mock.calls[0]?.[1]).toBe("cea43bf898/deepseek-v4-flash");
  });
});

describe("Property 3 — resolved-empty 触发 ModelEntitlementEmptyError（零出网）", () => {
  it("entitlement 有记录但结果为空 → runWithModelFallback 抛 ModelEntitlementEmptyError", async () => {
    // 企业授权 deepseek，但 catalog 只有 gpt（交集为空）
    await seedEntitlementAndGrant(
      "t2",
      "s2",
      ["api-proxy-deepseek/deepseek-chat"],
      ["api-proxy-deepseek/deepseek-chat"],
    );
    const effective = await resolveEffectiveModelSet({
      tenantId: "t2",
      seatId: "s2",
      cfg: {
        ...baseCfg,
        models: { providers: { "api-proxy-gpt": baseCfg.models!.providers!["api-proxy-gpt"] } },
      } as unknown as import("../../config/types.js").OpenBotConfig,
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      requirePlatformCatalog: false,
    });
    expect(effective.state).toBe("resolved");
    expect(effective.allowedModelIds).toEqual([]);

    let providerCalled = false;
    await expect(
      runWithModelFallback({
        cfg: baseCfg,
        provider: "api-proxy-deepseek",
        model: "deepseek-chat",
        entitlementAllowlist: effective.allowedModelIds, // 空数组 → hard deny
        run: async () => {
          providerCalled = true;
          return "should-not-reach";
        },
      }),
    ).rejects.toBeInstanceOf(ModelEntitlementEmptyError);
    expect(providerCalled).toBe(false); // 零出网：run 函数从未被调用
  });
});

describe("missing-allow — 无 entitlement 记录时放行", () => {
  it("state=missing 且 allowlist=undefined → runWithModelFallback 正常执行 run", async () => {
    // 不写入 entitlement（state=missing）；allowlist=undefined 表示放行
    const effective = await resolveEffectiveModelSet({
      tenantId: "t-new",
      seatId: "s-new",
      cfg: baseCfg,
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
    });
    expect(effective.state).toBe("missing");

    let providerCalled = false;
    // 传 undefined（不强制）→ run 被正常调用
    const result = await runWithModelFallback({
      cfg: baseCfg,
      provider: "api-proxy-deepseek",
      model: "deepseek-chat",
      entitlementAllowlist: undefined,
      run: async () => {
        providerCalled = true;
        return "ok";
      },
    });
    expect(providerCalled).toBe(true);
    expect(result.result).toBe("ok");
  });
});

describe("seat / employee 授权粒度（item 4）", () => {
  it("employee 级 grant 优先于 seat 级 grant", async () => {
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "t3",
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "api-proxy-gpt/gpt-5.2"],
      },
      entitlementStorePath(),
    );
    // seat 级授权 deepseek；employee 级授权 gpt（应以 employee 为准）
    await grantSeatModels(
      { tenantId: "t3", seatId: "s3", grantedModelIds: ["api-proxy-deepseek/deepseek-chat"] },
      seatGrantStorePath(),
    );
    await grantEmployeeModels(
      { tenantId: "t3", employeeId: "u3", grantedModelIds: ["api-proxy-gpt/gpt-5.2"] },
      seatGrantStorePath(),
    );
    const result = await resolveEffectiveModelSet({
      tenantId: "t3",
      seatId: "s3",
      employeeId: "u3",
      cfg: baseCfg,
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      requirePlatformCatalog: false,
      platformConnectedModelIdsOverride: [
        "api-proxy-deepseek/deepseek-chat",
        "api-proxy-gpt/gpt-5.2",
      ],
    });
    // employee grant 优先 → 只剩 gpt
    expect(result.allowedModelIds).toEqual(["api-proxy-gpt/gpt-5.2"]);
  });

  it("无 employee 级 grant 时回退到 seat 级", async () => {
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "t4",
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "api-proxy-gpt/gpt-5.2"],
      },
      entitlementStorePath(),
    );
    await grantSeatModels(
      { tenantId: "t4", seatId: "s4", grantedModelIds: ["api-proxy-deepseek/deepseek-chat"] },
      seatGrantStorePath(),
    );
    const result = await resolveEffectiveModelSet({
      tenantId: "t4",
      seatId: "s4",
      employeeId: "u4-no-grant",
      cfg: baseCfg,
      entitlementStorePath: entitlementStorePath(),
      seatGrantStorePath: seatGrantStorePath(),
      requirePlatformCatalog: false,
      platformConnectedModelIdsOverride: [
        "api-proxy-deepseek/deepseek-chat",
        "api-proxy-gpt/gpt-5.2",
      ],
    });
    expect(result.allowedModelIds).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });
});

describe("Doctor 观测（任务 6）", () => {
  const subscriptionsStorePath = () => path.join(tempDir, "subs.json");

  async function seedActiveSubscription(tenantId: string) {
    // 直接写订阅 store JSON（active 订阅），驱动 per-tenant 缺失核查。
    await fs.writeFile(
      subscriptionsStorePath(),
      JSON.stringify({
        version: 1,
        subscriptions: {
          "sub-1": {
            id: "sub-1",
            enterpriseId: tenantId,
            planId: "plan-x",
            planVersionId: "pv-1",
            status: "active",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        },
        events: [],
      }),
      "utf8",
    );
  }

  it("单来源 key → 无 key 冲突告警", () => {
    const issues = checkModelKeyConflicts(baseCfg);
    expect(issues.filter((i) => i.code === "model_key_conflict")).toHaveLength(0);
  });

  it("租户有 active 订阅但无 entitlement → 检测到 entitlement_missing 告警（per-tenant）", async () => {
    await seedActiveSubscription("tenant-x");
    const issues = await checkEntitlementMissing(baseCfg, {
      entitlementStorePath: entitlementStorePath(),
      subscriptionsStorePath: subscriptionsStorePath(),
    });
    expect(issues.some((i) => i.code === "entitlement_missing" && i.tenantId === "tenant-x")).toBe(
      true,
    );
  });

  it("无任何订阅 → 不告警（不再因 store 全空而误报）", async () => {
    const issues = await checkEntitlementMissing(baseCfg, {
      entitlementStorePath: entitlementStorePath(),
      subscriptionsStorePath: subscriptionsStorePath(),
    });
    expect(issues.filter((i) => i.code === "entitlement_missing")).toHaveLength(0);
  });

  it("租户有订阅且已有 entitlement 记录 → 无 entitlement_missing 告警", async () => {
    await seedActiveSubscription("tenant-ok");
    await upsertEnterpriseModelEntitlement(
      { tenantId: "tenant-ok", allowedModelIds: ["api-proxy-deepseek/deepseek-chat"] },
      entitlementStorePath(),
    );
    const issues = await checkEntitlementMissing(baseCfg, {
      entitlementStorePath: entitlementStorePath(),
      subscriptionsStorePath: subscriptionsStorePath(),
    });
    expect(
      issues.filter((i) => i.code === "entitlement_missing" && i.tenantId === "tenant-ok"),
    ).toHaveLength(0);
  });
});
