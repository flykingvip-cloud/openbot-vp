import { describe, expect, it, vi } from "vitest";
import { maybeConfirmPlanFromChatSend } from "./chat-plan-confirm-hook.js";
import { parseChatPlanConfirmIntent, tryConfirmPlanFromChat } from "./chat-plan-confirm.js";

vi.mock("./claim-contract-entry.js", async () => {
  const actual = await vi.importActual<typeof import("./claim-contract-entry.js")>(
    "./claim-contract-entry.js",
  );
  return {
    ...actual,
    listCollaborationTodolists: vi.fn(async () => [
      {
        todolistId: "tl-1",
        taskId: "task-1",
        boardItemId: "board-1",
        version: 3,
        status: "proposed",
      },
    ]),
    confirmCollaborationTodolist: vi.fn(async (params: { expectedVersion: number }) => {
      if (params.expectedVersion !== 3) {
        const { ClaimContractEntryError } = actual;
        throw new ClaimContractEntryError("version_mismatch", "expected 3");
      }
      return {
        todolistId: "tl-1",
        taskId: "task-1",
        boardItemId: "board-1",
        version: 3,
        status: "confirmed",
      };
    }),
  };
});

describe("parseChatPlanConfirmIntent", () => {
  it("accepts standalone confirm phrases", () => {
    expect(parseChatPlanConfirmIntent("确认计划").kind).toBe("confirm");
    expect(parseChatPlanConfirmIntent("confirm plan").kind).toBe("confirm");
  });

  it("marks mixed content ambiguous", () => {
    expect(parseChatPlanConfirmIntent("确认计划，另外把范围改成商业化").kind).toBe("ambiguous");
  });
});

describe("tryConfirmPlanFromChat", () => {
  it("refuses to confirm without expectedVersion", async () => {
    const result = await tryConfirmPlanFromChat({
      groupId: "grp",
      taskId: "task-1",
      actor: "human:owner",
      message: "确认计划",
    });
    expect(result.confirmed).toBe(false);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("expected_version_required");
    }
  });

  it("confirms when expectedVersion matches the bound plan", async () => {
    const result = await tryConfirmPlanFromChat({
      groupId: "grp",
      taskId: "task-1",
      actor: "human:owner",
      message: "确认计划",
      expectedVersion: 3,
    });
    expect(result.status).toBe("confirmed");
    expect(result.confirmed).toBe(true);
  });

  it("blocks version mismatch instead of confirming a newer unseen plan", async () => {
    const result = await tryConfirmPlanFromChat({
      groupId: "grp",
      taskId: "task-1",
      actor: "human:owner",
      message: "确认计划",
      expectedVersion: 2,
    });
    expect(result.confirmed).toBe(false);
    expect(result.status).toBe("blocked");
  });

  it("blocks card binding alone without expectedVersion (todolist may have been revised)", async () => {
    const result = await tryConfirmPlanFromChat({
      groupId: "grp",
      taskId: "task-1",
      actor: "human:owner",
      message: "确认计划",
      todolistId: "tl-1",
      boardItemId: "board-1",
    });
    expect(result.confirmed).toBe(false);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.reason).toBe("expected_version_required");
    }
  });

  it("confirms when card binding AND expectedVersion match", async () => {
    const result = await tryConfirmPlanFromChat({
      groupId: "grp",
      taskId: "task-1",
      actor: "human:owner",
      message: "确认计划",
      todolistId: "tl-1",
      boardItemId: "board-1",
      expectedVersion: 3,
    });
    expect(result.status).toBe("confirmed");
    expect(result.confirmed).toBe(true);
  });
});

describe("maybeConfirmPlanFromChatSend", () => {
  it("does not handle ordinary chat", async () => {
    const result = await maybeConfirmPlanFromChatSend({
      groupId: "grp",
      actor: "human:owner",
      message: "继续讨论范围",
      taskId: "task-1",
    });
    expect(result.handled).toBe(false);
  });

  it("handles confirm intent and requires actor-accessible binding", async () => {
    const result = await maybeConfirmPlanFromChatSend({
      groupId: "grp",
      actor: "human:owner",
      message: "确认计划",
    });
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.result.confirmed).toBe(false);
      expect(result.autoAdvanceWired).toBe(false);
      expect(
        result.userMessage.includes("尚未确认") || result.userMessage.includes("计划已确认"),
      ).toBe(true);
    }
  });

  it("surfaces UI-visible message and refuses group-currentTaskId alone", async () => {
    const result = await maybeConfirmPlanFromChatSend({
      groupId: "grp",
      actor: "human:owner",
      message: "确认计划",
      taskId: "stale-group-current",
      taskIdFromGroupCurrent: true,
    });
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.result.confirmed).toBe(false);
      expect(result.userMessage.length).toBeGreaterThan(0);
      // chat.send puts this on respond().message — UI-visible, not RPC-only.
      expect(result.autoAdvanceWired).toBe(false);
    }
  });
});

describe("selectPendingPlanConfirmCandidates collapse and actor", () => {
  it("does not revive a delivery after consumed/stale for the same decision", async () => {
    const { selectPendingPlanConfirmCandidates } = await import("./chat-plan-confirm.js");
    const card = {
      kind: "todolist_confirm" as const,
      decisionId: "dec-1",
      groupId: "grp",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "tl-1",
      title: "计划",
      summary: [] as string[],
      options: [] as [],
      mentionMemberIds: ["human:owner"],
      version: 3,
    };
    const rows = [
      {
        ok: true,
        stage: "push_completed" as const,
        historyReloadable: true,
        deliveryTracked: true,
        clientPresented: false as const,
        retryable: false,
        userFacing: "waiting_confirmation" as const,
        groupId: "grp",
        taskId: "task-1",
        boardItemId: "board-1",
        todolistId: "tl-1",
        version: 3,
        card,
      },
      {
        ok: true,
        stage: "confirmation_consumed" as const,
        historyReloadable: true,
        deliveryTracked: true,
        clientPresented: false as const,
        retryable: false,
        userFacing: "consumed" as const,
        groupId: "grp",
        taskId: "task-1",
        boardItemId: "board-1",
        todolistId: "tl-1",
        version: 3,
        card,
      },
    ];
    const candidates = selectPendingPlanConfirmCandidates({
      rows,
      actor: "human:owner",
    });
    expect(candidates).toEqual([]);
  });

  it("refuses actor not on mention list and refuses multi-candidate guess", async () => {
    const { selectPendingPlanConfirmCandidates } = await import("./chat-plan-confirm.js");
    const mk = (decisionId: string, mentions: string[]) => ({
      ok: true,
      stage: "push_completed" as const,
      historyReloadable: true,
      deliveryTracked: true,
      clientPresented: false as const,
      retryable: false,
      userFacing: "waiting_confirmation" as const,
      groupId: "grp",
      taskId: "task-1",
      boardItemId: `board-${decisionId}`,
      todolistId: `tl-${decisionId}`,
      version: 1,
      card: {
        kind: "todolist_confirm" as const,
        decisionId,
        groupId: "grp",
        taskId: "task-1",
        boardItemId: `board-${decisionId}`,
        todolistId: `tl-${decisionId}`,
        title: "计划",
        summary: [] as string[],
        options: [] as [],
        mentionMemberIds: mentions,
        version: 1,
      },
    });
    expect(
      selectPendingPlanConfirmCandidates({
        rows: [mk("dec-a", ["human:owner"])],
        actor: "human:stranger",
      }),
    ).toEqual([]);
    const multi = selectPendingPlanConfirmCandidates({
      rows: [mk("dec-a", ["human:owner"]), mk("dec-b", ["human:owner"])],
      actor: "human:owner",
    });
    expect(multi).toHaveLength(2);
  });
});
