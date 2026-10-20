// @vitest-environment node
// Feature: employee-schedule-meeting-lifecycle (Phase C, C0)
// 候选域安全不变量（属性测试）：
//   - 校验通过的候选绝不携带 LLM 注入的权威字段（id/ownerUserId/status/sourceRef）
//   - 确认映射的 ownerUserId 永远来自调用方上下文，绝非候选
//   - endAt 早于 startAt 永远被拒
//   - 校验是确定性的（同输入同结果）

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  scheduleEntryCandidateToConfirmedInput,
  validateScheduleEntryCandidate,
} from "./lifecycle-candidates.ts";

const ALLOWED_KEYS = new Set(["kind", "title", "startAt", "endAt", "timezone", "sourceText"]);
const MIN_MS = 1_000_000;
const MAX_MS = 4_102_444_800_000; // 2100-01-01

const nonEmptyText = fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0);

describe("Property: 候选域安全不变量", () => {
  it("校验通过的候选只含白名单字段（剥离注入的权威字段）", () => {
    fc.assert(
      fc.property(
        fc.record({
          title: nonEmptyText,
          startMs: fc.integer({ min: MIN_MS, max: MAX_MS }),
          injectedOwner: fc.string(),
          injectedId: fc.string(),
          injectedStatus: fc.string(),
        }),
        ({ title, startMs, injectedOwner, injectedId, injectedStatus }) => {
          const res = validateScheduleEntryCandidate({
            title,
            startAt: new Date(startMs).toISOString(),
            ownerUserId: injectedOwner,
            id: injectedId,
            status: injectedStatus,
            sourceRef: { kind: "manual", id: "x" },
            tenantId: "evil-tenant",
          });
          if (res.ok) {
            for (const key of Object.keys(res.value)) {
              expect(ALLOWED_KEYS.has(key)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("确认映射的 ownerUserId 永远来自上下文而非候选", () => {
    fc.assert(
      fc.property(
        fc.record({
          title: nonEmptyText,
          startMs: fc.integer({ min: MIN_MS, max: MAX_MS }),
          ctxOwner: nonEmptyText,
          injectedOwner: fc.string(),
        }),
        ({ title, startMs, ctxOwner, injectedOwner }) => {
          const res = validateScheduleEntryCandidate({
            title,
            startAt: new Date(startMs).toISOString(),
            ownerUserId: injectedOwner,
          });
          if (res.ok) {
            const input = scheduleEntryCandidateToConfirmedInput(res.value, {
              ownerUserId: ctxOwner,
            });
            expect(input.ownerUserId).toBe(ctxOwner);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("endAt 早于 startAt 永远被拒", () => {
    fc.assert(
      fc.property(
        fc.record({
          title: nonEmptyText,
          startMs: fc.integer({ min: MIN_MS, max: MAX_MS }),
          gapMs: fc.integer({ min: 1, max: MIN_MS - 1 }),
        }),
        ({ title, startMs, gapMs }) => {
          const res = validateScheduleEntryCandidate({
            title,
            startAt: new Date(startMs).toISOString(),
            endAt: new Date(startMs - gapMs).toISOString(),
          });
          expect(res.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("校验是确定性的（同输入同结果）", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(validateScheduleEntryCandidate(input)).toEqual(
          validateScheduleEntryCandidate(input),
        );
      }),
      { numRuns: 300 },
    );
  });
});
