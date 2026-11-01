import { describe, expect, it } from "vitest";
import {
  ACTIVATE_SUCCESS_DISPATCHED,
  dispatcherTrulyAccepted,
  factsFromFormalStages,
  oralMentionDoesNotAdvanceChain,
  projectFormalResponsibilityChain,
  type FormalChainFacts,
} from "./formal-responsibility-chain.js";

function facts(patch: Partial<FormalChainFacts> = {}): FormalChainFacts {
  return {
    boardPublished: true,
    claimReceiptRef: null,
    planReceiptRef: null,
    confirmAuthorized: false,
    confirmReceiptRef: null,
    wakeReceiptRef: null,
    dispatcher: null,
    ...patch,
  };
}

describe("formal responsibility chain", () => {
  it("after board publish the next entry is claim and activate stays undispatched", () => {
    const chain = projectFormalResponsibilityChain(facts());
    expect(chain.nextEntryPoint).toBe("claimCollaborationBoardItem");
    expect(chain.receipts.filter((row) => row.ok)).toEqual([]);
    expect(chain.dispatched).toBe(false);
    expect(chain.activateDispatched).toBe(false);
    expect(ACTIVATE_SUCCESS_DISPATCHED).toBe(false);
    expect(chain.mintedClaim).toBe(false);
    expect(chain.mintedHumanConfirmed).toBe(false);
  });

  it("mention and 催办 write no receipt and do not report dispatched", () => {
    const oral = oralMentionDoesNotAdvanceChain("@高级秘书 @市场助手 催办\n闭环完成");
    expect(oral.substituted).toBe(false);
    expect(oral.receiptsWritten).toBe(0);
    expect(oral.dispatched).toBe(false);
    expect(oral.mintedClaim).toBe(false);
    expect(oral.mintedHumanConfirmed).toBe(false);
    const chain = projectFormalResponsibilityChain(facts());
    expect(chain.receipts.every((row) => !row.ok)).toBe(true);
  });

  it("requires claim then plan then authorized confirm then wake, each with a receipt", () => {
    const claimed = projectFormalResponsibilityChain(
      facts({ claimReceiptRef: "board-jsonl:claimed" }),
    );
    expect(claimed.receipts.find((row) => row.segment === "claim")?.ok).toBe(true);
    expect(claimed.nextEntryPoint).toBe("proposeCollaborationTodolist");

    const planned = projectFormalResponsibilityChain(
      facts({
        claimReceiptRef: "board-jsonl:claimed",
        planReceiptRef: "todolist:proposed",
      }),
    );
    expect(planned.nextEntryPoint).toBe("confirmCollaborationTodolist");

    const unauthorized = projectFormalResponsibilityChain(
      facts({
        claimReceiptRef: "board-jsonl:claimed",
        planReceiptRef: "todolist:proposed",
        confirmAuthorized: false,
        confirmReceiptRef: "todolist:self-confirm",
      }),
    );
    expect(unauthorized.receipts.find((row) => row.segment === "confirm")).toMatchObject({
      ok: false,
      reason: "confirmer_not_authorized",
    });
    expect(unauthorized.dispatched).toBe(false);

    const confirmed = projectFormalResponsibilityChain(
      facts({
        claimReceiptRef: "board-jsonl:claimed",
        planReceiptRef: "todolist:proposed",
        confirmAuthorized: true,
        confirmReceiptRef: "todolist:confirmed",
      }),
    );
    expect(confirmed.nextEntryPoint).toBe("triggerPostPlanConfirmAdvance");
    expect(confirmed.dispatched).toBe(false);
  });

  it("reports dispatched only after wake receipt and dispatcher accept", () => {
    const ready = {
      claimReceiptRef: "board-jsonl:claimed",
      planReceiptRef: "todolist:proposed",
      confirmAuthorized: true,
      confirmReceiptRef: "todolist:confirmed",
      wakeReceiptRef: "wake:nudge:op",
    };
    expect(
      projectFormalResponsibilityChain(
        facts({ ...ready, dispatcher: { ok: false, roundId: "r1" } }),
      ).dispatched,
    ).toBe(false);
    expect(
      projectFormalResponsibilityChain(facts({ ...ready, dispatcher: { ok: true, roundId: "" } }))
        .dispatched,
    ).toBe(false);
    expect(
      projectFormalResponsibilityChain(
        facts({ ...ready, wakeReceiptRef: null, dispatcher: { ok: true, roundId: "round-1" } }),
      ).dispatched,
    ).toBe(false);
    const accepted = projectFormalResponsibilityChain(
      facts({ ...ready, dispatcher: { ok: true, roundId: "round-1" } }),
    );
    expect(accepted.dispatched).toBe(true);
    expect(accepted.activateDispatched).toBe(false);
    expect(accepted.nextEntryPoint).toBeNull();
    expect(dispatcherTrulyAccepted({ ok: true, roundId: "round-1" })).toBe(true);
    expect(dispatcherTrulyAccepted({ ok: true })).toBe(false);
  });

  it("does not treat an unknown stage as a receipt, so chat rounds stay undispatched", () => {
    const chain = projectFormalResponsibilityChain(
      factsFromFormalStages({
        boardPublished: true,
        responsibilityAccepted: "unknown",
        planProposed: "unknown",
        planConfirmed: "unknown",
      }),
    );
    expect(chain.nextEntryPoint).toBe("claimCollaborationBoardItem");
    expect(chain.dispatched).toBe(false);
    expect(chain.activateDispatched).toBe(false);
  });

  it("refuses to skip claim even if a plan ref is already present", () => {
    const chain = projectFormalResponsibilityChain(
      facts({ planReceiptRef: "todolist:orphan", confirmAuthorized: true, confirmReceiptRef: "x" }),
    );
    expect(chain.receipts.find((row) => row.segment === "plan")).toMatchObject({
      ok: false,
      reason: "claim_required",
    });
    expect(chain.nextEntryPoint).toBe("claimCollaborationBoardItem");
  });
});
