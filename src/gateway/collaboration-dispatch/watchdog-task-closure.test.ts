/**
 * Watchdog task-closure regressions (fail-closed semantics).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  planHeartbeatActionForItem,
  progressFingerprint,
  type HeartbeatBoardItemLike,
} from "./group-task-heartbeat.js";
import type { CollaborationBotTarget } from "./types.js";

vi.mock("./round-runtime.js", async () => {
  const actual = await vi.importActual<typeof import("./round-runtime.js")>("./round-runtime.js");
  return {
    ...actual,
    executeCollaborationRound: vi.fn(),
  };
});

vi.mock("./legacy-production-executor.js", () => ({
  resolveProductionCollaborationExecutor: () => undefined,
}));

import { executeModeBWakeRound } from "./mode-b-wake-round-dispatcher.js";
import { executeCollaborationRound } from "./round-runtime.js";

function item(
  partial: Partial<HeartbeatBoardItemLike> &
    Pick<HeartbeatBoardItemLike, "itemId" | "taskId" | "groupId" | "status">,
): HeartbeatBoardItemLike {
  return {
    claimantId: "bot-executor",
    publishedBy: "bot-publisher",
    ...partial,
  };
}

describe("watchdog task-closure — review routing", () => {
  it("submitted_for_review nudges reviewer chain, not claimant", () => {
    const decision = planHeartbeatActionForItem({
      item: item({
        itemId: "i-review",
        groupId: "g1",
        taskId: "t1",
        status: "submitted_for_review",
        claimantId: "bot-executor",
        publishedBy: "bot-publisher",
        reviewerId: "bot-reviewer",
        submissionId: "sub-1",
        artifactVersion: "v2",
        submittedAt: 10,
      }),
      nowMs: 100,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(decision.action).toBe("nudge");
    expect(decision.toAgentIds).toContain("bot-reviewer");
    expect(decision.toAgentIds).not.toContain("bot-executor");
    expect(decision.reason).toContain("awaiting_review");
  });

  it("submitted_for_review falls back to publishedBy when responsibility missing", () => {
    const decision = planHeartbeatActionForItem({
      item: item({
        itemId: "i-review-2",
        groupId: "g1",
        taskId: "t1",
        status: "submitted_for_review",
        claimantId: "bot-executor",
        publishedBy: "bot-publisher",
        submittedAt: 10,
        submissionId: "sub-2",
      }),
      nowMs: 100,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(decision.action).toBe("nudge");
    expect(decision.toAgentIds).toEqual(["bot-publisher"]);
  });
});

describe("watchdog task-closure — escalate stage binding", () => {
  it("new fingerprint after prior escalate is still supervised", () => {
    const oldFp = progressFingerprint({
      status: "in_progress",
      claimantId: "bot-executor",
      inProgressAt: 1,
    });
    const decision = planHeartbeatActionForItem({
      item: item({
        itemId: "i1",
        groupId: "g1",
        taskId: "t1",
        status: "submitted_for_review",
        claimantId: "bot-executor",
        publishedBy: "bot-publisher",
        reviewerId: "bot-reviewer",
        submittedAt: 20,
        submissionId: "sub-new",
        artifactVersion: "v2",
      }),
      prior: {
        consecutiveNoResponse: 2,
        lastFingerprint: oldFp,
        lastEscalateAt: 50,
        lastEscalateFingerprint: oldFp,
        lastStatus: "in_progress",
      },
      nowMs: 100,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(decision.action).toBe("nudge");
    expect(decision.toAgentIds).toContain("bot-reviewer");
    expect(decision.reason).not.toContain("already_escalated");
  });

  it("same-stage successful escalate still anti-spams", () => {
    const fp = progressFingerprint({
      status: "in_progress",
      claimantId: "bot-executor",
      inProgressAt: 1,
    });
    const decision = planHeartbeatActionForItem({
      item: item({
        itemId: "i1",
        groupId: "g1",
        taskId: "t1",
        status: "in_progress",
        claimantId: "bot-executor",
        inProgressAt: 1,
      }),
      prior: {
        consecutiveNoResponse: 2,
        lastFingerprint: fp,
        lastEscalateAt: 50,
        lastEscalateFingerprint: fp,
      },
      nowMs: 100,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(decision.action).toBe("skip");
    expect(decision.reason).toContain("already_escalated_awaiting_progress");
  });

  it("legacy/observe lastEscalateAt without fingerprint does not suppress emit planning", () => {
    const fp = progressFingerprint({
      status: "in_progress",
      claimantId: "bot-executor",
      inProgressAt: 1,
    });
    const decision = planHeartbeatActionForItem({
      item: item({
        itemId: "i1",
        groupId: "g1",
        taskId: "t1",
        status: "in_progress",
        claimantId: "bot-executor",
        inProgressAt: 1,
      }),
      prior: {
        consecutiveNoResponse: 2,
        lastFingerprint: fp,
        lastEscalateAt: 50,
      },
      nowMs: 100,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(decision.action).toBe("escalate");
  });

  it("escalate failure exhaustion is bounded and clears on progress change", () => {
    const fp = progressFingerprint({
      status: "applied",
      claimantId: "bot-executor",
      appliedAt: 1,
    });
    const exhausted = planHeartbeatActionForItem({
      item: item({
        itemId: "i1",
        groupId: "g1",
        taskId: "t1",
        status: "applied",
        claimantId: "bot-executor",
        appliedAt: 1,
      }),
      prior: {
        consecutiveNoResponse: 2,
        lastFingerprint: fp,
        escalateFailCount: 3,
      },
      nowMs: 100,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(exhausted.action).toBe("skip");
    expect(exhausted.reason).toContain("escalate_failures_exhausted");

    const afterProgress = planHeartbeatActionForItem({
      item: item({
        itemId: "i1",
        groupId: "g1",
        taskId: "t1",
        status: "in_progress",
        claimantId: "bot-executor",
        appliedAt: 1,
        inProgressAt: 2,
      }),
      prior: {
        consecutiveNoResponse: 2,
        lastFingerprint: fp,
        escalateFailCount: 3,
      },
      nowMs: 100,
      escalateAfter: 2,
      escalateTo: ["coord"],
    });
    expect(afterProgress.action).toBe("nudge");
  });
});

describe("watchdog task-closure — Mode B abort ≠ success receipt", () => {
  const leadBot = {
    agentId: "bot-2",
    name: "Bot 2",
    sessionKey: "agent:bot-2:main",
    updatedAt: 1,
  } as CollaborationBotTarget;

  beforeEach(() => {
    vi.mocked(executeCollaborationRound).mockReset();
  });

  it("ROUND_ABORTED placeholder returns ok:false not_started (retryable failed path)", async () => {
    vi.mocked(executeCollaborationRound).mockResolvedValue({
      roundId: "wake_abort_1",
      state: "ROUND_ABORTED",
      abortReason: "fatal",
      completion: {
        responseStatus: "placeholder",
        hasConclusion: false,
        visibleReply: false,
        source: "heuristic",
      },
    } as never);

    const result = await executeModeBWakeRound({
      request: {
        groupId: "g1",
        fromAgentId: "system",
        toAgentIds: ["bot-2"],
        source: "nudge",
        reason: "test-abort",
      },
      context: {
        authority: { groupId: "g1" } as never,
        facts: { bots: [leadBot] } as never,
        sessionKey: "space:g1",
        leadBot,
        runBot: async () => undefined,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/^round_aborted:/);
      expect(result.sideEffectClass).toBe("not_started");
    }
  });

  it("ROUND_COMPLETE still returns ok:true completed_with_receipt", async () => {
    vi.mocked(executeCollaborationRound).mockResolvedValue({
      roundId: "wake_ok_1",
      state: "ROUND_COMPLETE",
      completion: {
        responseStatus: "complete",
        hasConclusion: true,
        visibleReply: true,
        source: "heuristic",
      },
    } as never);

    const result = await executeModeBWakeRound({
      request: {
        groupId: "g1",
        fromAgentId: "system",
        toAgentIds: ["bot-2"],
        source: "nudge",
        reason: "test-ok",
      },
      context: {
        authority: { groupId: "g1" } as never,
        facts: { bots: [leadBot] } as never,
        sessionKey: "space:g1",
        leadBot,
        runBot: async () => ({ text: "结论：完成。" }),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sideEffectClass).toBe("completed_with_receipt");
      expect(result.roundId).toBe("wake_ok_1");
    }
  });

  it("executeCollaborationRound throw maps to started_or_unknown (no blind completed)", async () => {
    vi.mocked(executeCollaborationRound).mockRejectedValue(new Error("model boom"));
    const result = await executeModeBWakeRound({
      request: {
        groupId: "g1",
        fromAgentId: "system",
        toAgentIds: ["bot-2"],
        source: "escalate",
        reason: "test-throw",
      },
      context: {
        authority: { groupId: "g1" } as never,
        facts: { bots: [leadBot] } as never,
        sessionKey: "space:g1",
        leadBot,
        runBot: async () => {
          throw new Error("should not run");
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("execute_collaboration_round_failed");
      expect(result.sideEffectClass).toBe("started_or_unknown");
    }
  });
});
