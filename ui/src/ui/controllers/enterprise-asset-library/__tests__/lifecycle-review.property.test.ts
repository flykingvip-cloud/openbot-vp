// @vitest-environment node
/**
 * Property-based tests for lifecycle & review rules.
 *
 * Covers:
 * - Property 2: Source completeness guard (canTransitionToPublished)
 * - Property 3: Source immutability invariant (enforceSourceImmutability)
 * - Property 4: Review opinion minimum length (validateReviewOpinion)
 * - Property 5: Duplicate review submission rejection (isDuplicateReviewAllowed)
 * - Property 6: Approval requires scope and domain (validateApprovalPayload)
 *
 * Validates: Requirements 1.2, 1.3, 1.6, 14.4, 14.5, 14.9, 19.2
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import type {
  ContributionRecord,
  ApplicableScope,
  CapabilityDomain,
  ReviewQueueItem,
  ReviewApprovalPayload,
  SourceInfo,
} from "../../../capability/enterprise-capability/types.ts";
import { canTransitionToPublished, enforceSourceImmutability } from "../lifecycle-rules.ts";
import {
  validateReviewOpinion,
  isDuplicateReviewAllowed,
  validateApprovalPayload,
} from "../review-rules.ts";

function countVisibleCharacters(value: string): number {
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
  let count = 0;
  for (const _segment of segmenter.segment(value)) {
    count += 1;
  }
  return count;
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/** Non-empty trimmed string (at least 1 visible char). */
const nonEmptyStringArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0);

/** Possibly empty or whitespace-only string. */
const emptyishStringArb: fc.Arbitrary<string> = fc.constantFrom("", " ", "  ", "\t", "\n");

/** Arbitrary for a valid ContributionRecord. */
const contributionRecordArb: fc.Arbitrary<ContributionRecord> = fc.record({
  id: fc.uuid(),
  employeeId: fc.uuid(),
  employeeName: nonEmptyStringArb,
  timestamp: fc.nat({ max: 2_000_000_000 }),
  type: fc.constantFrom("初始提交" as const, "内容修改" as const, "场景补充" as const),
  summary: fc.string({ minLength: 1, maxLength: 100 }),
});

/** Arbitrary for a valid SourceInfo with all ids filled. */
const filledSourceArb: fc.Arbitrary<SourceInfo> = fc.record({
  employee: fc.record({ id: nonEmptyStringArb, name: nonEmptyStringArb }),
  robot: fc.record({ id: nonEmptyStringArb, name: nonEmptyStringArb }),
  task: fc.record({ id: nonEmptyStringArb, summary: nonEmptyStringArb }),
});

/** Arbitrary for CapabilityDomain. */
const domainArb: fc.Arbitrary<CapabilityDomain> = fc.constantFrom(
  "销售" as const,
  "HR" as const,
  "客服" as const,
  "财务" as const,
  "法务" as const,
  "数据分析" as const,
);

/** Arbitrary for a valid ApplicableScope. */
const applicableScopeArb: fc.Arbitrary<ApplicableScope> = fc.oneof(
  fc.constant({ kind: "enterprise" as const }),
  fc.record({
    kind: fc.constant("department" as const),
    id: nonEmptyStringArb,
    name: nonEmptyStringArb,
  }),
  fc.record({
    kind: fc.constant("group" as const),
    id: nonEmptyStringArb,
    name: nonEmptyStringArb,
  }),
  fc.record({ kind: fc.constant("role" as const), id: nonEmptyStringArb, name: nonEmptyStringArb }),
);

/** Arbitrary for ReviewQueueItem. */
const reviewQueueItemArb: fc.Arbitrary<ReviewQueueItem> = fc.record({
  id: fc.uuid(),
  capabilityId: fc.uuid(),
  capabilityName: nonEmptyStringArb,
  capabilitySummary: nonEmptyStringArb,
  usageScenarios: fc.array(nonEmptyStringArb, { minLength: 0, maxLength: 3 }),
  sourceEmployee: fc.record({ id: fc.uuid(), name: nonEmptyStringArb }),
  sourceRobot: fc.record({ id: fc.uuid(), name: nonEmptyStringArb }),
  sourceTaskSummary: nonEmptyStringArb,
  usageCount: fc.nat({ max: 10000 }),
  robotCount: fc.nat({ max: 100 }),
  lastUsedAt: fc.oneof(fc.nat({ max: 2_000_000_000 }), fc.constant(null)),
  submittedAt: fc.nat({ max: 2_000_000_000 }),
  status: fc.constantFrom("待审核" as const, "审核中" as const),
});

// ─── Property 2: canTransitionToPublished ───────────────────────────────────

describe("Property 2: canTransitionToPublished — source completeness guard", () => {
  /**
   * **Validates: Requirements 1.2**
   *
   * Rejects when any of source.employee.id, source.robot.id, source.task.id
   * is empty, or when contributionHistory is empty.
   */
  it("rejects when source ids are empty or contributionHistory is empty", () => {
    // Strategy: generate an asset with at least one missing field
    const incompleteAssetArb = fc.oneof(
      // employee.id empty
      fc.record({
        source: fc.record({
          employee: fc.record({ id: emptyishStringArb, name: nonEmptyStringArb }),
          robot: fc.record({ id: nonEmptyStringArb, name: nonEmptyStringArb }),
          task: fc.record({ id: nonEmptyStringArb, summary: nonEmptyStringArb }),
        }),
        contributionHistory: fc.array(contributionRecordArb, { minLength: 1, maxLength: 3 }),
      }),
      // robot.id empty
      fc.record({
        source: fc.record({
          employee: fc.record({ id: nonEmptyStringArb, name: nonEmptyStringArb }),
          robot: fc.record({ id: emptyishStringArb, name: nonEmptyStringArb }),
          task: fc.record({ id: nonEmptyStringArb, summary: nonEmptyStringArb }),
        }),
        contributionHistory: fc.array(contributionRecordArb, { minLength: 1, maxLength: 3 }),
      }),
      // task.id empty
      fc.record({
        source: fc.record({
          employee: fc.record({ id: nonEmptyStringArb, name: nonEmptyStringArb }),
          robot: fc.record({ id: nonEmptyStringArb, name: nonEmptyStringArb }),
          task: fc.record({ id: emptyishStringArb, summary: nonEmptyStringArb }),
        }),
        contributionHistory: fc.array(contributionRecordArb, { minLength: 1, maxLength: 3 }),
      }),
      // contributionHistory empty
      fc.record({
        source: filledSourceArb,
        contributionHistory: fc.constant([] as ContributionRecord[]),
      }),
    );

    fc.assert(
      fc.property(incompleteAssetArb, (asset) => {
        const result = canTransitionToPublished(asset);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2**
   *
   * Accepts when all source ids are filled and contributionHistory is non-empty.
   */
  it("accepts when all source ids are filled and contributionHistory is non-empty", () => {
    const completeAssetArb = fc.record({
      source: filledSourceArb,
      contributionHistory: fc.array(contributionRecordArb, { minLength: 1, maxLength: 5 }),
    });

    fc.assert(
      fc.property(completeAssetArb, (asset) => {
        const result = canTransitionToPublished(asset);
        expect(result.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 3: enforceSourceImmutability ──────────────────────────────────

describe("Property 3: enforceSourceImmutability — source immutability invariant", () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * Rejects when source fields are changed.
   */
  it("rejects when source fields change", () => {
    const mutatedSourceArb = fc
      .tuple(filledSourceArb, filledSourceArb)
      .filter(
        ([a, b]) =>
          a.employee.id !== b.employee.id ||
          a.employee.name !== b.employee.name ||
          a.robot.id !== b.robot.id ||
          a.robot.name !== b.robot.name ||
          a.task.id !== b.task.id ||
          a.task.summary !== b.task.summary,
      );

    fc.assert(
      fc.property(
        mutatedSourceArb,
        fc.array(contributionRecordArb, { minLength: 1, maxLength: 3 }),
        ([existingSource, incomingSource], history) => {
          const existing = { source: existingSource, contributionHistory: history };
          const incoming = { source: incomingSource, contributionHistory: history };
          const result = enforceSourceImmutability(existing, incoming);
          expect(result.ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * Rejects when contribution entries are modified or removed.
   */
  it("rejects when contribution entries are modified or removed", () => {
    fc.assert(
      fc.property(
        filledSourceArb,
        fc.array(contributionRecordArb, { minLength: 1, maxLength: 5 }),
        fc.boolean(),
        fc.nat({ max: 4 }),
        (source, history, shouldRemove, requestedIndex) => {
          const existing = { source, contributionHistory: history };
          const targetIndex = requestedIndex % history.length;

          if (shouldRemove) {
            const modifiedHistory = history.filter((_, i) => i !== targetIndex);
            const incoming = { source, contributionHistory: modifiedHistory };
            const result = enforceSourceImmutability(existing, incoming);
            expect(result.ok).toBe(false);
          } else {
            const modifiedHistory = history.map((record, i) =>
              i === targetIndex ? { ...record, summary: record.summary + "_changed" } : record,
            );
            const incoming = { source, contributionHistory: modifiedHistory };
            const result = enforceSourceImmutability(existing, incoming);
            expect(result.ok).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   *
   * Accepts when only new entries are appended (existing entries unchanged).
   */
  it("accepts when only new entries are appended", () => {
    fc.assert(
      fc.property(
        filledSourceArb,
        fc.array(contributionRecordArb, { minLength: 1, maxLength: 3 }),
        fc.array(contributionRecordArb, { minLength: 0, maxLength: 3 }),
        (source, existingHistory, newEntries) => {
          // Ensure new entries have unique ids not in existing
          const existingIds = new Set(existingHistory.map((r) => r.id));
          const uniqueNewEntries = newEntries
            .filter((entry) => !existingIds.has(entry.id))
            .map((entry, i) => ({ ...entry, id: `new-${i}-${entry.id}` }));

          const existing = { source, contributionHistory: existingHistory };
          const incoming = {
            source,
            contributionHistory: [...existingHistory, ...uniqueNewEntries],
          };
          const result = enforceSourceImmutability(existing, incoming);
          expect(result.ok).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: validateReviewOpinion ──────────────────────────────────────

describe("Property 4: validateReviewOpinion — review opinion minimum length", () => {
  /** Generate a string with < 10 code points (after trim). */
  const shortOpinionArb: fc.Arbitrary<string> = fc
    .string({ minLength: 0, maxLength: 9 })
    .map((s) => s.trim())
    .filter((s) => countVisibleCharacters(s) < 10);

  /** Generate a string with >= 10 code points (after trim). */
  const longOpinionArb: fc.Arbitrary<string> = fc
    .string({ minLength: 10, maxLength: 50 })
    .filter((s) => countVisibleCharacters(s.trim()) >= 10);

  const rejectResultArb = fc.constantFrom("拒绝" as const, "需修改" as const);

  /**
   * **Validates: Requirements 14.5**
   *
   * Rejects "拒绝"/"需修改" with opinion < 10 chars.
   */
  it("rejects 拒绝/需修改 with opinion < 10 chars", () => {
    fc.assert(
      fc.property(rejectResultArb, shortOpinionArb, (result, opinion) => {
        const validation = validateReviewOpinion(result, opinion);
        expect(validation.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 14.5**
   *
   * Accepts "拒绝"/"需修改" with opinion >= 10 chars.
   */
  it("accepts 拒绝/需修改 with opinion >= 10 chars", () => {
    fc.assert(
      fc.property(rejectResultArb, longOpinionArb, (result, opinion) => {
        const validation = validateReviewOpinion(result, opinion);
        expect(validation.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 14.5**
   *
   * Always accepts "通过" regardless of opinion length.
   */
  it("always accepts 通过 regardless of opinion length", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 50 }), (opinion) => {
        const validation = validateReviewOpinion("通过", opinion);
        expect(validation.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 5: isDuplicateReviewAllowed ───────────────────────────────────

describe("Property 5: isDuplicateReviewAllowed — duplicate review submission rejection", () => {
  /**
   * **Validates: Requirements 14.4**
   *
   * Rejects when a matching capabilityId exists in "待审核"/"审核中" status.
   */
  it("rejects when matching capabilityId exists in 待审核/审核中", () => {
    fc.assert(
      fc.property(
        reviewQueueItemArb,
        fc.array(reviewQueueItemArb, { minLength: 0, maxLength: 5 }),
        (matchingItem, otherItems) => {
          // Ensure the matching item has status 待审核 or 审核中 (already guaranteed by arb)
          const queue = [...otherItems, matchingItem];
          const result = isDuplicateReviewAllowed(queue, matchingItem.capabilityId);
          expect(result.ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 14.4**
   *
   * Accepts when no matching capabilityId exists in the queue.
   */
  it("accepts when no matching capabilityId exists in queue", () => {
    fc.assert(
      fc.property(
        fc.array(reviewQueueItemArb, { minLength: 0, maxLength: 5 }),
        fc.uuid(),
        (queue, capabilityId) => {
          // Ensure none of the queue items match the capabilityId
          const filteredQueue = queue.filter((item) => item.capabilityId !== capabilityId);
          const result = isDuplicateReviewAllowed(filteredQueue, capabilityId);
          expect(result.ok).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: validateApprovalPayload ────────────────────────────────────

describe("Property 6: validateApprovalPayload — approval requires scope and domain", () => {
  /**
   * **Validates: Requirements 14.9**
   *
   * Rejects null/undefined payload.
   */
  it("rejects null or undefined payload", () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined), (payload) => {
        const result = validateApprovalPayload(payload);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 14.9**
   *
   * Rejects when scope or domain is missing.
   */
  it("rejects when scope or domain is missing", () => {
    const missingPayloadArb: fc.Arbitrary<ReviewApprovalPayload> = fc.oneof(
      // Missing domain (empty string)
      fc.record({
        applicableScope: applicableScopeArb,
        domain: fc.constant("" as CapabilityDomain),
      }),
      // Missing scope (kind with empty id)
      fc.record({
        applicableScope: fc.oneof(
          fc.record({
            kind: fc.constantFrom("department" as const, "group" as const, "role" as const),
            id: emptyishStringArb,
            name: nonEmptyStringArb,
          }),
        ),
        domain: domainArb,
      }),
    );

    fc.assert(
      fc.property(missingPayloadArb, (payload) => {
        const result = validateApprovalPayload(payload);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 14.9**
   *
   * Accepts when both scope and domain are present.
   */
  it("accepts when both scope and domain are present", () => {
    const validPayloadArb: fc.Arbitrary<ReviewApprovalPayload> = fc.record({
      applicableScope: applicableScopeArb,
      domain: domainArb,
    });

    fc.assert(
      fc.property(validPayloadArb, (payload) => {
        const result = validateApprovalPayload(payload);
        expect(result.ok).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
