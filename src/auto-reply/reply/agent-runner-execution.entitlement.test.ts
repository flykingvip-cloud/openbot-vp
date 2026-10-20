// @vitest-environment node
/**
 * Task 5.1 – Entitlement Gate 作用域与拒绝路径单元测试（Property 1、3）。
 *
 * 策略：对 `resolveEmployeeEntitlementAllowlist`（gate 辅助函数）做黑盒断言，
 * 不直接测试 hot-path（runAgentTurnWithFallback），避免引入大量 env 依赖。
 * gate 辅助函数与 runWithModelFallback 的集成在 p1-employee-chat.e2e.test.ts 覆盖。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveEmployeeEntitlementAllowlist } from "../../gateway/model-entitlement/employee-model-gate.js";
import { upsertEnterpriseModelEntitlement } from "../../gateway/model-entitlement/enterprise-model-entitlement-store.js";
import { grantSeatModels } from "../../gateway/model-entitlement/seat-model-grant-store.js";

// Mock 知识上下文解析，隔离企业数据库查询
vi.mock("../../gateway/knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(),
}));
vi.mock("../../gateway/knowledge/reply-gateway-client.js", () => ({
  buildKnowledgeReplyGatewayClient: vi.fn(() => ({ user: "test@example.com" })),
}));

import { resolveKnowledgeSourceContext } from "../../gateway/knowledge/context.js";
const mockResolveCtx = vi.mocked(resolveKnowledgeSourceContext);

function makeCfg(enforce = "missing-allow"): OpenBotConfig {
  return {
    gateway: {
      platform: {
        models: {
          entitlement: { enforce },
        },
      },
    },
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
  } as unknown as OpenBotConfig;
}

let tempDir = "";
const storeOpts = () => ({
  entitlementStorePath: path.join(tempDir, "ent.json"),
  seatGrantStorePath: path.join(tempDir, "grant.json"),
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gate-test-"));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("Gate 作用域：非 employee 会话跳过", () => {
  it("无 sessionDomain → 返回 undefined（不强制）", async () => {
    const result = await resolveEmployeeEntitlementAllowlist({ cfg: makeCfg() });
    expect(result).toBeUndefined();
  });

  it("sessionDomain=platform → 跳过", async () => {
    const result = await resolveEmployeeEntitlementAllowlist({
      cfg: makeCfg(),
      gatewayClientUser: "admin@example.com",
      gatewayClientSessionDomain: "platform",
    });
    expect(result).toBeUndefined();
  });

  it("enforce=off → 始终返回 undefined（无论 session 类型）", async () => {
    const result = await resolveEmployeeEntitlementAllowlist({
      cfg: makeCfg("off"),
      gatewayClientUser: "user@example.com",
      gatewayClientSessionDomain: "employee",
    });
    expect(result).toBeUndefined();
  });
});

describe("Gate 作用域：知识上下文无法解析席位 → 跳过", () => {
  it("tenant/seatId 为 null → 返回 undefined（不阻断）", async () => {
    mockResolveCtx.mockResolvedValueOnce({
      tenantId: null,
      seatId: null,
      userId: null,
      hasEnterpriseScope: false,
    });
    const result = await resolveEmployeeEntitlementAllowlist({
      cfg: makeCfg(),
      gatewayClientUser: "user@example.com",
      gatewayClientSessionDomain: "employee",
    });
    expect(result).toBeUndefined();
  });
});

describe("Property 3 — 已解析空授权零出网", () => {
  it("entitlement 已配置但无交集 → 返回空数组（触发 hard deny）", async () => {
    mockResolveCtx.mockResolvedValueOnce({
      tenantId: "t1",
      seatId: "s1",
      userId: "u1",
      hasEnterpriseScope: true,
    });
    // 企业 entitlement 有 deepseek，但目录只有 gpt（两个模型不相交）
    await upsertEnterpriseModelEntitlement(
      { tenantId: "t1", allowedModelIds: ["api-proxy-deepseek/deepseek-chat"] },
      storeOpts().entitlementStorePath,
    );
    await grantSeatModels(
      { tenantId: "t1", seatId: "s1", grantedModelIds: ["api-proxy-deepseek/deepseek-chat"] },
      storeOpts().seatGrantStorePath,
    );
    // cfg 里只有 gpt（目录不含 deepseek）
    const cfgOnlyGpt = makeCfg();
    delete (cfgOnlyGpt as unknown as { models: { providers: Record<string, unknown> } }).models
      .providers["api-proxy-deepseek"];
    const result = await resolveEmployeeEntitlementAllowlist({
      cfg: cfgOnlyGpt,
      gatewayClientUser: "user@t1.com",
      gatewayClientSessionDomain: "employee",
      entitlementStorePath: storeOpts().entitlementStorePath,
      seatGrantStorePath: storeOpts().seatGrantStorePath,
    });
    expect(result).toEqual([]);
  });

  it("missing-allow 且无 entitlement 记录 → 返回 undefined（放行）", async () => {
    mockResolveCtx.mockResolvedValueOnce({
      tenantId: "t-new",
      seatId: "s-new",
      userId: "u-new",
      hasEnterpriseScope: true,
    });
    // 不写入任何 entitlement（state=missing）
    const result = await resolveEmployeeEntitlementAllowlist({
      cfg: makeCfg("missing-allow"),
      gatewayClientUser: "user@tnew.com",
      gatewayClientSessionDomain: "employee",
      entitlementStorePath: storeOpts().entitlementStorePath,
      seatGrantStorePath: storeOpts().seatGrantStorePath,
    });
    expect(result).toBeUndefined();
  });
});

describe("Property 1 — 返回的授权集 ⊆ 平台目录", () => {
  it("entitlement + grant + catalog 三方交集正确", async () => {
    mockResolveCtx.mockResolvedValueOnce({
      tenantId: "t2",
      seatId: "s2",
      userId: "u2",
      hasEnterpriseScope: true,
    });
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "t2",
        allowedModelIds: ["api-proxy-deepseek/deepseek-chat", "api-proxy-gpt/gpt-5.2"],
      },
      storeOpts().entitlementStorePath,
    );
    await grantSeatModels(
      {
        tenantId: "t2",
        seatId: "s2",
        // grant 只给 deepseek
        grantedModelIds: ["api-proxy-deepseek/deepseek-chat"],
      },
      storeOpts().seatGrantStorePath,
    );
    const result = await resolveEmployeeEntitlementAllowlist({
      cfg: makeCfg(),
      gatewayClientUser: "user@t2.com",
      gatewayClientSessionDomain: "employee",
      entitlementStorePath: storeOpts().entitlementStorePath,
      seatGrantStorePath: storeOpts().seatGrantStorePath,
    });
    // 结果：deepseek（在 entitlement ∩ grant ∩ catalog）；gpt 不在 grant 内
    expect(result).toEqual(["api-proxy-deepseek/deepseek-chat"]);
  });
});
