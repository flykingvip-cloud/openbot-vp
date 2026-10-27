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

  it("handles confirm intent and requires task binding", async () => {
    const result = await maybeConfirmPlanFromChatSend({
      groupId: "grp",
      actor: "human:owner",
      message: "确认计划",
    });
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(result.result.confirmed).toBe(false);
    }
  });
});
