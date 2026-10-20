// @vitest-environment node
// Feature: cost-budget-billing
// Property 9: 用量采集幂等性
// Property 12: 成本控制闸口拦截不变量

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dedupeUsage, evaluateGate } from "./control.ts";
import type { BudgetCheckLevel, BudgetControls, UsageRecord } from "./types.ts";

function rec(enterpriseId: string, eventId: string, quantity = 1): UsageRecord {
  return {
    id: eventId,
    enterpriseId,
    userId: "user",
    eventId,
    key: "ai_token",
    quantity,
    occurredAt: "2026-03-10T00:00:00.000Z",
    ingestedAt: "2026-03-10T00:00:00.000Z",
  };
}

describe("Property 9: 用量幂等（按 (enterpriseId,eventId) 去重）", () => {
  it("同 event 多次上报只记一次，计费量不增", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 1, max: 5 }),
        (eventId, quantity, times) => {
          let records: UsageRecord[] = [];
          let dedupedCount = 0;
          for (let i = 0; i < times; i += 1) {
            const result = dedupeUsage(records, rec("ent-1", eventId, quantity));
            records = result.records;
            if (result.deduped) {
              dedupedCount += 1;
            }
          }
          // 只保留一条
          expect(records.filter((r) => r.eventId === eventId)).toHaveLength(1);
          // 第一次外的都被去重
          expect(dedupedCount).toBe(times - 1);
          // 计费量 = 单次量
          const billable = records
            .filter((r) => r.eventId === eventId)
            .reduce((acc, r) => acc + r.quantity, 0);
          expect(billable).toBe(quantity);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("不同 enterpriseId 下相同 eventId 互不去重（租户隔离）", () => {
    let records: UsageRecord[] = [];
    records = dedupeUsage(records, rec("ent-A", "same")).records;
    const r = dedupeUsage(records, rec("ent-B", "same"));
    expect(r.deduped).toBe(false);
    expect(r.records).toHaveLength(2);
  });
});

const levelArb: fc.Arbitrary<BudgetCheckLevel> = fc.constantFrom("ok", "alert", "exceeded");
const controlsArb: fc.Arbitrary<BudgetControls> = fc.record({
  limitAiCalls: fc.boolean(),
  limitBotCreation: fc.boolean(),
  autoDowngrade: fc.boolean(),
});

describe("Property 12: 控制闸口拦截不变量", () => {
  it("仅『控制启用 ∧ 预算超限』时拒绝；否则放行", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ai" as const, "bot" as const),
        levelArb,
        controlsArb,
        (action, budgetLevel, controls) => {
          const decision = evaluateGate({ action, budgetLevel, controls });
          const controlOn = action === "ai" ? controls.limitAiCalls : controls.limitBotCreation;
          const shouldReject = budgetLevel === "exceeded" && controlOn;
          expect(decision.allowed).toBe(!shouldReject);
          if (shouldReject) {
            expect(decision.allowed).toBe(false);
            if (!decision.allowed) {
              expect(decision.reason.length).toBeGreaterThan(0);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("未启用任何控制项 → 一律放行（最多提醒）", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ai" as const, "bot" as const),
        levelArb,
        (action, budgetLevel) => {
          const decision = evaluateGate({
            action,
            budgetLevel,
            controls: { limitAiCalls: false, limitBotCreation: false, autoDowngrade: false },
          });
          expect(decision.allowed).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
