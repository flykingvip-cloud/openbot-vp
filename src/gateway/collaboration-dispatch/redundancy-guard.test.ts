import { describe, expect, test } from "vitest";
import { shouldSuppressHighlyRedundantReply } from "./redundancy-guard.js";
import { buildSameRoundContext, type SameRoundContext } from "./same-round-context.js";

describe("collaboration redundancy guard", () => {
  test("suppresses highly overlapping supplement replies", () => {
    const sameRoundContext = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "端午节源于纪念屈原投江，人们赛龙舟、吃粽子并驱邪避疫。",
        messageId: "msg-a1",
      },
    ])!;
    expect(sameRoundContext.coveredClaims.length).toBeGreaterThan(0);
    expect(sameRoundContext.evidencePointers.some((p) => p.messageId === "msg-a1")).toBe(true);
    expect(
      shouldSuppressHighlyRedundantReply({
        candidateText: "端午节源于纪念屈原投江，人们赛龙舟、吃粽子并驱邪避疫。",
        contributionRole: "supplement",
        sameRoundContext,
      }),
    ).toBe(true);
    expect(
      shouldSuppressHighlyRedundantReply({
        candidateText: "从民俗学角度看，端午除纪念屈原外，也融合了南方驱瘟避疫的古老祈禳仪式。",
        contributionRole: "supplement",
        sameRoundContext,
      }),
    ).toBe(false);
  });

  test("suppresses executor claim acks", () => {
    expect(
      shouldSuppressHighlyRedundantReply({
        candidateText: "已认领：记忆盘点\n范围：特征\n资源：无\n预计交付：本轮内",
        contributionRole: "executor",
      }),
    ).toBe(true);
  });

  test("does not kill challenge under preserveConflict even with high overlap", () => {
    const sameRoundContext: SameRoundContext = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "端午节源于纪念屈原投江，人们赛龙舟、吃粽子并驱邪避疫。",
      },
    ])!;
    expect(
      shouldSuppressHighlyRedundantReply({
        candidateText: "端午节源于纪念屈原投江，人们赛龙舟、吃粽子并驱邪避疫。",
        contributionRole: "challenge",
        sameRoundContext,
        preserveConflict: true,
      }),
    ).toBe(false);
  });

  test("forces NO_REPLY for challenge that overlaps coverage without a recorded conflict", () => {
    const sameRoundContext = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "端午节源于纪念屈原投江，人们赛龙舟、吃粽子并驱邪避疫。",
      },
    ])!;
    expect(sameRoundContext.conflicts).toEqual([]);
    expect(
      shouldSuppressHighlyRedundantReply({
        candidateText: "端午节源于纪念屈原投江，人们赛龙舟、吃粽子并驱邪避疫。",
        contributionRole: "challenge",
        sameRoundContext,
        preserveConflict: false,
      }),
    ).toBe(true);
  });

  test("allows challenge when coverage map records a conflict", () => {
    const sameRoundContext = buildSameRoundContext([
      {
        agentId: "bot-a",
        agentName: "Bot A",
        contributionRole: "lead",
        text: "端午节源于纪念屈原投江，人们赛龙舟、吃粽子并驱邪避疫。",
      },
      {
        agentId: "bot-b",
        agentName: "Bot B",
        contributionRole: "challenge",
        text: "不对，端午主源是南方驱瘟祈禳，屈原纪念是后起附会。",
        messageId: "msg-b1",
      },
    ])!;
    expect(sameRoundContext.conflicts.length).toBeGreaterThan(0);
    expect(
      shouldSuppressHighlyRedundantReply({
        candidateText: "端午节源于纪念屈原投江，人们赛龙舟、吃粽子并驱邪避疫。",
        contributionRole: "challenge",
        sameRoundContext,
        preserveConflict: false,
      }),
    ).toBe(false);
  });
});
