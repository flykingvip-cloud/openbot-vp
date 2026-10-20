// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildWorkbenchNotices } from "./notices-read-model.js";

describe("workbench notices read model", () => {
  it("returns an empty result when governance is absent", () => {
    expect(buildWorkbenchNotices({})).toEqual({
      totalCount: 0,
      conflictCount: 0,
      attentionCount: 0,
      meetingInviteReviewCount: 0,
      meetingMinutesConfirmCount: 0,
      meetingTodoItems: [],
      items: [],
    });
    expect(buildWorkbenchNotices({ governance: null })).toEqual({
      totalCount: 0,
      conflictCount: 0,
      attentionCount: 0,
      meetingInviteReviewCount: 0,
      meetingMinutesConfirmCount: 0,
      meetingTodoItems: [],
      items: [],
    });
  });

  it("merges meeting invite-review items additively without touching governance counts", () => {
    const result = buildWorkbenchNotices({
      governance: {
        openConflictCount: 1,
        openClaimConflictCount: 0,
        openDuplicateCount: 0,
        openStaleCount: 0,
        openOrphanCount: 0,
      },
      meetings: { inviteReviewCount: 2, minutesConfirmCount: 0 },
    });
    // Governance counts are unchanged by the meeting merge.
    expect(result.conflictCount).toBe(1);
    expect(result.attentionCount).toBe(0);
    expect(result.meetingInviteReviewCount).toBe(2);
    expect(result.totalCount).toBe(3); // 1 conflict + 2 invite-review
    expect(result.items).toEqual([
      { id: "governance:conflict", kind: "governance-conflict", severity: "warning", count: 1 },
      { id: "meeting:invite-review", kind: "meeting-invite-review", severity: "info", count: 2 },
    ]);
  });

  it("surfaces meeting items even when governance is absent", () => {
    const result = buildWorkbenchNotices({ meetings: { inviteReviewCount: 3 } });
    expect(result.conflictCount).toBe(0);
    expect(result.meetingInviteReviewCount).toBe(3);
    expect(result.totalCount).toBe(3);
    expect(result.items).toEqual([
      { id: "meeting:invite-review", kind: "meeting-invite-review", severity: "info", count: 3 },
    ]);
  });

  it("omits the meeting item when the invite-review count is zero", () => {
    const result = buildWorkbenchNotices({ meetings: { inviteReviewCount: 0 } });
    expect(result.meetingInviteReviewCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("folds chunk + claim conflicts into conflictCount and duplicate/stale/orphan into attentionCount", () => {
    const result = buildWorkbenchNotices({
      governance: {
        openConflictCount: 2,
        openClaimConflictCount: 1,
        openDuplicateCount: 3,
        openStaleCount: 4,
        openOrphanCount: 5,
      },
    });
    expect(result.conflictCount).toBe(3); // 2 + 1
    expect(result.attentionCount).toBe(12); // 3 + 4 + 5
    expect(result.totalCount).toBe(15);
    expect(result.items).toEqual([
      { id: "governance:conflict", kind: "governance-conflict", severity: "warning", count: 3 },
      { id: "governance:attention", kind: "governance-attention", severity: "info", count: 12 },
    ]);
  });

  it("emits no items when all governance counts are zero", () => {
    const result = buildWorkbenchNotices({
      governance: {
        openConflictCount: 0,
        openClaimConflictCount: 0,
        openDuplicateCount: 0,
        openStaleCount: 0,
        openOrphanCount: 0,
      },
    });
    expect(result.totalCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("only emits the conflict item when there are conflicts but no attention items", () => {
    const result = buildWorkbenchNotices({
      governance: {
        openConflictCount: 1,
        openClaimConflictCount: 0,
        openDuplicateCount: 0,
        openStaleCount: 0,
        openOrphanCount: 0,
      },
    });
    expect(result.conflictCount).toBe(1);
    expect(result.attentionCount).toBe(0);
    expect(result.items).toEqual([
      { id: "governance:conflict", kind: "governance-conflict", severity: "warning", count: 1 },
    ]);
  });
});
