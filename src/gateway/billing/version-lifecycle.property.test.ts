// @vitest-environment node
// Feature: cost-budget-billing
// Property 14: 版本状态机合法流转
// Property 15: 单一 active 不变量（含并发与幂等的纯函数部分）

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PlanPricing, PlanVersion, PlanVersionStatus } from "./types.ts";
import {
  assertValidTransition,
  comparePlanVersions,
  countActiveVersions,
  InvalidVersionTransitionError,
  isValidTransition,
  reduceVersionStatuses,
} from "./version-lifecycle.ts";

const STATUSES: PlanVersionStatus[] = ["draft", "active", "deprecated"];
const VALID = new Set(["draft→active", "active→deprecated"]);

function makeVersion(
  id: string,
  status: PlanVersionStatus,
  planId = "plan-1",
  pricing: PlanPricing[] = [],
): PlanVersion {
  return {
    id,
    planId,
    version: 1,
    status,
    snapshot: { basePriceCents: 0, seatQuota: {}, botQuota: 0, pricing },
    createdAt: "2026-03-01T00:00:00.000Z",
    createdByUserId: "admin",
  };
}

describe("Property 14: 状态机合法流转", () => {
  it("当且仅当属于 {draft→active, active→deprecated} 时合法", () => {
    fc.assert(
      fc.property(fc.constantFrom(...STATUSES), fc.constantFrom(...STATUSES), (from, to) => {
        const ok = isValidTransition(from, to);
        expect(ok).toBe(VALID.has(`${from}→${to}`));
      }),
      { numRuns: 100 },
    );
  });

  it("自反流转一律非法", () => {
    for (const s of STATUSES) {
      expect(isValidTransition(s, s)).toBe(false);
    }
  });

  it("deprecated 为终态：deprecated→active / deprecated→draft 非法", () => {
    expect(isValidTransition("deprecated", "active")).toBe(false);
    expect(isValidTransition("deprecated", "draft")).toBe(false);
    expect(() => assertValidTransition("deprecated", "active")).toThrow(
      InvalidVersionTransitionError,
    );
  });

  it("draft→deprecated（未激活直接废弃）非法", () => {
    expect(isValidTransition("draft", "deprecated")).toBe(false);
  });
});

describe("Property 15: 单一 active 不变量（纯归约）", () => {
  it("任意版本集合激活某 draft 后，active 版本数恰为 1", () => {
    const versionArb = fc.array(fc.constantFrom(...STATUSES), { minLength: 1, maxLength: 8 });
    fc.assert(
      fc.property(versionArb, fc.nat(), (statuses, pick) => {
        const versions = statuses.map((s, i) => makeVersion(`v${i}`, s));
        // 至多一个 active 的前置约束：把多余 active 归一为 deprecated（模拟合法历史）
        let seenActive = false;
        const normalized = versions.map((v) => {
          if (v.status === "active") {
            if (seenActive) {
              return { ...v, status: "deprecated" as const };
            }
            seenActive = true;
          }
          return v;
        });
        const drafts = normalized.filter((v) => v.status === "draft");
        if (drafts.length === 0) {
          return; // 无 draft 可激活
        }
        const target = drafts[pick % drafts.length];
        const { versions: next } = reduceVersionStatuses(
          normalized,
          { kind: "activate", versionId: target.id },
          "2026-03-02T00:00:00.000Z",
        );
        expect(countActiveVersions(next, "plan-1")).toBe(1);
        expect(next.find((v) => v.id === target.id)?.status).toBe("active");
      }),
      { numRuns: 200 },
    );
  });

  it("激活把既有 active 原子降级为 deprecated 并写 activatedAt/deprecatedAt", () => {
    const versions = [makeVersion("v1", "active"), makeVersion("v2", "draft")];
    const { versions: next, transitions } = reduceVersionStatuses(
      versions,
      { kind: "activate", versionId: "v2" },
      "2026-03-02T00:00:00.000Z",
    );
    expect(next.find((v) => v.id === "v1")?.status).toBe("deprecated");
    expect(next.find((v) => v.id === "v1")?.deprecatedAt).toBe("2026-03-02T00:00:00.000Z");
    expect(next.find((v) => v.id === "v2")?.status).toBe("active");
    expect(next.find((v) => v.id === "v2")?.activatedAt).toBe("2026-03-02T00:00:00.000Z");
    expect(transitions).toHaveLength(2);
  });

  it("激活非 draft 版本（active/deprecated）抛非法流转错误", () => {
    const versions = [makeVersion("v1", "active"), makeVersion("v2", "deprecated")];
    expect(() =>
      reduceVersionStatuses(versions, { kind: "activate", versionId: "v1" }, "t"),
    ).toThrow(InvalidVersionTransitionError);
    expect(() =>
      reduceVersionStatuses(versions, { kind: "activate", versionId: "v2" }, "t"),
    ).toThrow(InvalidVersionTransitionError);
  });

  it("纯函数无副作用：入参不被修改", () => {
    const versions = [makeVersion("v1", "active"), makeVersion("v2", "draft")];
    const snapshot = structuredClone(versions);
    reduceVersionStatuses(versions, { kind: "activate", versionId: "v2" }, "t");
    expect(versions).toEqual(snapshot);
  });
});

describe("comparePlanVersions diff", () => {
  it("正确识别 added/removed/changed/unchanged", () => {
    const from = makeVersion("v1", "active", "plan-1", [
      {
        id: "p1",
        planId: "plan-1",
        planVersionId: "v1",
        type: "seat",
        key: "viewer",
        priceCents: 1000,
      },
      {
        id: "p2",
        planId: "plan-1",
        planVersionId: "v1",
        type: "seat",
        key: "creator",
        priceCents: 3000,
      },
    ]);
    const to = makeVersion("v2", "draft", "plan-1", [
      {
        id: "p3",
        planId: "plan-1",
        planVersionId: "v2",
        type: "seat",
        key: "viewer",
        priceCents: 2000,
      }, // changed
      {
        id: "p4",
        planId: "plan-1",
        planVersionId: "v2",
        type: "usage",
        key: "ai_token",
        priceCents: 2,
      }, // added
      // creator removed
    ]);
    const diff = comparePlanVersions(from, to);
    const byKey = new Map(diff.entries.map((e) => [`${e.type}/${e.key}`, e]));
    expect(byKey.get("seat/viewer")?.change).toBe("changed");
    expect(byKey.get("seat/creator")?.change).toBe("removed");
    expect(byKey.get("usage/ai_token")?.change).toBe("added");
  });
});
