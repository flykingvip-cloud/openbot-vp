// @vitest-environment node
// Feature: model-entitlement-chain, P2 任务 11/12 视图模型
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EnterpriseModelEntitlement, SeatModelGrant } from "../types.ts";
import {
  buildEmployeeModelUsageView,
  buildEmployeeModelView,
  buildEnterpriseAuthorizationView,
  type ModelUsageInputRow,
} from "../view-model.ts";

function makeUsageRow(
  partial: Omit<Partial<ModelUsageInputRow>, "totals"> & {
    totals?: Partial<ModelUsageInputRow["totals"]>;
  },
): ModelUsageInputRow {
  return {
    ...(partial.provider ? { provider: partial.provider } : {}),
    ...(partial.model ? { model: partial.model } : {}),
    count: partial.count ?? 0,
    totals: {
      input: partial.totals?.input ?? 0,
      output: partial.totals?.output ?? 0,
      totalTokens: partial.totals?.totalTokens ?? 0,
      totalCost: partial.totals?.totalCost ?? 0,
    },
  };
}

function makeEntitlement(modelIds: string[]): EnterpriseModelEntitlement {
  return {
    tenantId: "tenant-a",
    allowedModelIds: modelIds,
    updatedAt: "2026-06-07T00:00:00.000Z",
  };
}

function makeGrant(partial: Partial<SeatModelGrant> & { subjectId: string }): SeatModelGrant {
  return {
    tenantId: "tenant-a",
    subjectType: "seat",
    grantedModelIds: [],
    status: "active",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...partial,
  };
}

describe("buildEnterpriseAuthorizationView", () => {
  it("无 entitlement 时给出 notice 且 hasEntitlement=false", () => {
    const view = buildEnterpriseAuthorizationView({
      entitlement: null,
      allowedModelIds: [],
      grants: [],
    });
    expect(view.hasEntitlement).toBe(false);
    expect(view.notice).not.toBeNull();
    expect(view.entitlementModelIds).toEqual([]);
    expect(view.subjects).toEqual([]);
  });

  it("行的 granted/withinEntitlement 反映授权与上限", () => {
    const view = buildEnterpriseAuthorizationView({
      entitlement: makeEntitlement(["p/a", "p/b", "p/c"]),
      allowedModelIds: ["p/a", "p/b", "p/c"],
      grants: [makeGrant({ subjectId: "seat-1", seatId: "seat-1", grantedModelIds: ["p/a"] })],
    });
    expect(view.hasEntitlement).toBe(true);
    expect(view.notice).toBeNull();
    const subject = view.subjects[0];
    const rowA = subject.rows.find((r) => r.modelId === "p/a")!;
    const rowB = subject.rows.find((r) => r.modelId === "p/b")!;
    expect(rowA.granted).toBe(true);
    expect(rowA.withinEntitlement).toBe(true);
    expect(rowB.granted).toBe(false);
    expect(rowB.withinEntitlement).toBe(true);
  });

  it("越界已授予模型仍可见但标记为不在 entitlement 内", () => {
    const view = buildEnterpriseAuthorizationView({
      entitlement: makeEntitlement(["p/a"]),
      allowedModelIds: ["p/a"],
      grants: [
        makeGrant({
          subjectId: "emp-1",
          subjectType: "employee",
          grantedModelIds: ["p/a", "p/legacy"],
        }),
      ],
    });
    const subject = view.subjects[0];
    const legacy = subject.rows.find((r) => r.modelId === "p/legacy")!;
    expect(legacy.granted).toBe(true);
    expect(legacy.withinEntitlement).toBe(false);
  });

  it("omits hidden platform models from rows and from the overreach list", () => {
    const view = buildEnterpriseAuthorizationView({
      entitlement: makeEntitlement(["p/online", "p/offline"]),
      allowedModelIds: ["p/online"],
      hiddenModelIds: ["p/offline"],
      grants: [
        makeGrant({
          subjectId: "seat-1",
          seatId: "seat-1",
          grantedModelIds: ["p/online", "p/offline", "p/legacy"],
        }),
      ],
    });
    const ids = view.subjects[0]?.rows.map((row) => row.modelId) ?? [];
    expect(ids).toEqual(["p/legacy", "p/online"]);
    expect(view.entitlementModelIds).toEqual(["p/online"]);
  });

  it("属性：每个 subject 行集合 = entitlement ∪ 已授予，去重且排序", () => {
    const arbModel = fc.constantFrom("p/a", "p/b", "p/c", "p/d", "p/legacy");
    fc.assert(
      fc.property(
        fc.uniqueArray(arbModel),
        fc.uniqueArray(arbModel),
        (entitlementIds, grantedIds) => {
          const view = buildEnterpriseAuthorizationView({
            entitlement: makeEntitlement(entitlementIds),
            allowedModelIds: entitlementIds,
            grants: [makeGrant({ subjectId: "s", grantedModelIds: grantedIds })],
          });
          const subject = view.subjects[0];
          const rowIds = subject.rows.map((r) => r.modelId);
          const expected = [...new Set([...entitlementIds, ...grantedIds])].toSorted();
          expect(rowIds).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("buildEmployeeModelView", () => {
  it("missing 状态标注未配置而非被拒", () => {
    const view = buildEmployeeModelView({
      modelIds: [],
      state: "missing",
      reason: "尚未配置",
    });
    expect(view.statusLabel).toBe("未配置授权");
    expect(view.hasModels).toBe(false);
  });

  it("resolved 且空集 = 被拒绝", () => {
    const view = buildEmployeeModelView({
      modelIds: [],
      state: "resolved",
      reason: "授权为空",
    });
    expect(view.statusLabel).toBe("已被拒绝");
    expect(view.hasModels).toBe(false);
  });

  it("resolved 且有模型 = 可用，去重排序并透传 seatId", () => {
    const view = buildEmployeeModelView({
      modelIds: ["p/b", "p/a", "p/a"],
      state: "resolved",
      reason: "可用",
      seatId: "seat-9",
    });
    expect(view.statusLabel).toBe("可用");
    expect(view.hasModels).toBe(true);
    expect(view.modelIds).toEqual(["p/a", "p/b"]);
    expect(view.models.map((model) => model.title)).toEqual(["a", "b"]);
    expect(view.seatId).toBe("seat-9");
  });

  it("企业自供模型用人读名称，而不是 ent/ 运行时 id", () => {
    const runtimeId = "ent/abc123def4/mimo-v2.6-flash";
    const fromId = buildEmployeeModelView({
      modelIds: [runtimeId],
      state: "resolved",
      reason: "可用",
    });
    expect(fromId.models).toEqual([
      { modelId: runtimeId, title: "Mimo V2.6 Flash", sourceLabel: "企业自供" },
    ]);

    const fromServer = buildEmployeeModelView({
      modelIds: [runtimeId],
      models: [{ modelId: runtimeId, title: "Mimo V2.6 Flash", sourceLabel: "企业自供" }],
      state: "resolved",
      reason: "可用",
    });
    expect(fromServer.models[0]?.title).toBe("Mimo V2.6 Flash");
    expect(fromServer.models[0]?.sourceLabel).toBe("企业自供");
  });
});

describe("buildEmployeeModelUsageView", () => {
  it("按 tokens 降序合并、计算占比与总计", () => {
    const view = buildEmployeeModelUsageView({
      entitlementModelIds: ["openai/gpt-4o", "openai/gpt-4o-mini"],
      byModel: [
        makeUsageRow({
          provider: "openai",
          model: "gpt-4o-mini",
          count: 10,
          totals: { input: 50, output: 50, totalTokens: 100, totalCost: 0.01 },
        }),
        makeUsageRow({
          provider: "openai",
          model: "gpt-4o",
          count: 3,
          totals: { input: 100, output: 200, totalTokens: 300, totalCost: 0.5 },
        }),
      ],
      windowDays: 30,
    });
    expect(view.hasUsage).toBe(true);
    expect(view.usedModelCount).toBe(2);
    expect(view.totalTokens).toBe(400);
    expect(view.totalCost).toBeCloseTo(0.51, 5);
    expect(view.totalRequests).toBe(13);
    // 排序：gpt-4o（300）在前，占比 1；gpt-4o-mini（100）占比 1/3。
    expect(view.rows[0].label).toBe("openai/gpt-4o");
    expect(view.rows[0].share).toBeCloseTo(1, 5);
    expect(view.rows[0].entitled).toBe(true);
    expect(view.rows[1].label).toBe("openai/gpt-4o-mini");
    expect(view.rows[1].share).toBeCloseTo(1 / 3, 5);
  });

  it("为未消费到的可用模型补零行且不重复", () => {
    const view = buildEmployeeModelUsageView({
      entitlementModelIds: ["p/a", "p/b"],
      byModel: [
        makeUsageRow({
          provider: "p",
          model: "a",
          count: 2,
          totals: { totalTokens: 20, totalCost: 0.02 },
        }),
      ],
      windowDays: 30,
    });
    const labels = view.rows.map((r) => r.label);
    expect(labels).toContain("p/a");
    expect(labels).toContain("p/b");
    // p/a 只出现一次（消费行覆盖，不重复补零）。
    expect(labels.filter((l) => l === "p/a")).toHaveLength(1);
    const unused = view.rows.find((r) => r.label === "p/b")!;
    expect(unused.used).toBe(false);
    expect(unused.entitled).toBe(true);
    expect(unused.totalTokens).toBe(0);
    expect(view.usedModelCount).toBe(1);
  });

  it("裸模型名 entitlement 也能匹配 provider/model 消费行", () => {
    const view = buildEmployeeModelUsageView({
      entitlementModelIds: ["gpt-4o"],
      byModel: [
        makeUsageRow({
          provider: "openai",
          model: "gpt-4o",
          count: 1,
          totals: { totalTokens: 10, totalCost: 0.01 },
        }),
      ],
      windowDays: 30,
    });
    // 只有一行（不因裸名 entitlement 而重复补零），且标记为可用。
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].label).toBe("openai/gpt-4o");
    expect(view.rows[0].entitled).toBe(true);
  });

  it("provider-qualified entitlement 不匹配其他 provider 的同名模型", () => {
    const view = buildEmployeeModelUsageView({
      entitlementModelIds: ["openai/gpt-4o"],
      byModel: [
        makeUsageRow({
          provider: "azure",
          model: "gpt-4o",
          count: 1,
          totals: { totalTokens: 10, totalCost: 0.01 },
        }),
      ],
      windowDays: 30,
    });

    const foreign = view.rows.find((row) => row.label === "azure/gpt-4o")!;
    expect(foreign.entitled).toBe(false);
    expect(foreign.used).toBe(true);
    const allowed = view.rows.find((row) => row.label === "openai/gpt-4o")!;
    expect(allowed.entitled).toBe(true);
    expect(allowed.used).toBe(false);
  });

  it("消费但不在授权内的模型标记 entitled=false", () => {
    const view = buildEmployeeModelUsageView({
      entitlementModelIds: ["p/a"],
      byModel: [
        makeUsageRow({
          provider: "x",
          model: "y",
          count: 1,
          totals: { totalTokens: 10, totalCost: 0.01 },
        }),
      ],
      windowDays: 30,
    });
    const used = view.rows.find((r) => r.label === "x/y")!;
    expect(used.entitled).toBe(false);
    expect(used.used).toBe(true);
    // p/a 补零，可用但未使用。
    const zero = view.rows.find((r) => r.label === "p/a")!;
    expect(zero.entitled).toBe(true);
    expect(zero.used).toBe(false);
  });

  it("unavailable 状态不把陈旧行计入 totals", () => {
    const view = buildEmployeeModelUsageView({
      entitlementModelIds: ["p/a"],
      byModel: [
        makeUsageRow({
          provider: "p",
          model: "a",
          count: 3,
          totals: { totalTokens: 30, totalCost: 0.03 },
        }),
      ],
      windowDays: 30,
      status: "unavailable",
      unavailableReason: "请稍后重试",
    });

    expect(view.status).toBe("unavailable");
    expect(view.unavailableReason).toBe("请稍后重试");
    expect(view.hasUsage).toBe(false);
    expect(view.totalTokens).toBe(0);
    expect(view.totalRequests).toBe(0);
  });

  it("无任何消费时 hasUsage=false，仅展示补零可用模型", () => {
    const view = buildEmployeeModelUsageView({
      entitlementModelIds: ["p/a"],
      byModel: [],
      windowDays: 7,
    });
    expect(view.hasUsage).toBe(false);
    expect(view.usedModelCount).toBe(0);
    expect(view.totalTokens).toBe(0);
    expect(view.windowDays).toBe(7);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].label).toBe("p/a");
    expect(view.rows[0].used).toBe(false);
  });

  it("企业自供补零行展示登记名称，运行时 id 留在 label", () => {
    const runtimeId = "ent/abc123def4/mimo-v2.6-flash";
    const view = buildEmployeeModelUsageView({
      entitlementModelIds: [runtimeId],
      displayLabels: { [runtimeId]: "Mimo V2.6 Flash" },
      byModel: [],
      windowDays: 30,
    });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]?.label).toBe(runtimeId);
    expect(view.rows[0]?.displayLabel).toBe("Mimo V2.6 Flash");
    expect(view.rows[0]?.entitled).toBe(true);
  });

  it("不展示网关注入模型，也不展示未授权且未使用的行", () => {
    const view = buildEmployeeModelUsageView({
      entitlementModelIds: ["openai/gpt-4o"],
      byModel: [
        makeUsageRow({
          provider: "openclaw",
          model: "gateway-injected",
          count: 0,
          totals: { totalTokens: 0, totalCost: 0 },
        }),
        makeUsageRow({
          provider: "ghost",
          model: "unused",
          count: 0,
          totals: { totalTokens: 0, totalCost: 0 },
        }),
      ],
      windowDays: 30,
    });
    expect(view.rows.map((row) => row.label)).toEqual(["openai/gpt-4o"]);
    expect(view.rows.some((row) => row.label.includes("gateway-injected"))).toBe(false);
    expect(view.rows.some((row) => row.label === "ghost/unused")).toBe(false);
  });
});
