import { describe, expect, it } from "vitest";
import {
  broadcastMustNotStealBoardLead,
  claimInquiryUsesMemberProgress,
  resolveBoardResponsibleAgentIds,
  resolveClaimInquiryCandidatesFromMemberProgress,
  selectModeBLead,
} from "./mode-b-member-selection.js";

describe("P4 Mode B member selection", () => {
  it("prefers board claimant over intended and broadcast", () => {
    const sel = selectModeBLead({
      boardItems: [
        {
          status: "in_progress",
          claimantId: "bot:analyst",
          intendedClaimantIds: ["bot:other"],
        },
      ],
      hasBroadcastMention: true,
      explicitMentionAgentIds: ["bot:mentioned"],
      bots: [
        { agentId: "bot:analyst", name: "分析师", sessionKey: "s1", updatedAt: 1 },
        { agentId: "bot:other", name: "其他", sessionKey: "s2", updatedAt: 1 },
        { agentId: "bot:mentioned", name: "被点名", sessionKey: "s3", updatedAt: 1 },
      ],
    });
    expect(sel.leadAgentId).toBe("bot:analyst");
    expect(sel.reason).toBe("board_claimant");
    expect(sel.broadcastDidNotStealLead).toBe(true);
    expect(broadcastMustNotStealBoardLead()).toBe(true);
  });

  it("@所有人 alone does not invent a Mode B lead", () => {
    const sel = selectModeBLead({
      hasBroadcastMention: true,
      bots: [{ agentId: "bot:a", name: "A", sessionKey: "s", updatedAt: 1 }],
    });
    expect(sel.leadAgentId).toBeNull();
    expect(sel.reason).toBe("none");
    expect(sel.broadcastDidNotStealLead).toBe(true);
  });

  it("falls back to intendedClaimantIds then member progress", () => {
    expect(
      resolveBoardResponsibleAgentIds([
        { status: "applied", intendedClaimantIds: ["bot:intended"] },
      ]),
    ).toEqual(["bot:intended"]);

    const fromProgress = resolveClaimInquiryCandidatesFromMemberProgress([
      { agentId: "bot:idle", activeItemCount: 0 },
      { agentId: "bot:busy", inProgressCount: 2, activeItemCount: 1 },
      { memberId: "bot:claimed", claimedItemCount: 1 },
    ]);
    expect(fromProgress[0]).toBe("bot:busy");
    expect(claimInquiryUsesMemberProgress()).toBe(true);

    const sel = selectModeBLead({
      memberProgress: [{ agentId: "bot:busy", inProgressCount: 1 }],
      hasBroadcastMention: true,
    });
    expect(sel.leadAgentId).toBe("bot:busy");
    expect(sel.reason).toBe("member_progress");
  });
  it("published board uses intendedClaimantIds as Mode B lead", () => {
    const sel = selectModeBLead({
      boardItems: [
        {
          status: "published",
          intendedClaimantIds: ["bot:intended", "bot:other"],
          publishedBy: "cli",
        },
      ],
      hasBroadcastMention: true,
    });
    expect(sel.leadAgentId).toBe("bot:intended");
    expect(sel.reason).toBe("board_intended");
    expect(sel.broadcastDidNotStealLead).toBe(true);
    expect(
      resolveBoardResponsibleAgentIds([
        { status: "published", intendedClaimantIds: ["bot:intended"] },
      ]),
    ).toEqual(["bot:intended"]);
  });
});
