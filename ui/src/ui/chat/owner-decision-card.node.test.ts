// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOwnerDecisionDeliveryStateForTest,
  clearOwnerDecisionDismissalsForTest,
  collapseOwnerDecisionCardsForBoardItem,
  OWNER_DECISION_PEER_ACK_COPY,
  collectOwnerDecisionHydrationTargets,
  releaseOwnerDecisionHydrationAttempt,
  markOwnerDecisionHydrationAttempted,
  dismissOwnerDecisionCard,
  formatOwnerDecisionMentionHint,
  formatOwnerDecisionStatusCopy,
  formatPostPlanConfirmAdvanceUserMessage,
  formatOwnerDecisionSummaryLine,
  getOwnerDecisionReviseDraft,
  getOwnerDecisionTodolistStatus,
  isOwnerDecisionDismissed,
  isOwnerDecisionReviseExpanded,
  isOwnerDecisionTodolistActionable,
  noteOwnerDecisionDelivery,
  ownerDecisionStatusCalloutClass,
  parseOwnerDecisionStatusGateError,
  parseOwnerDecisionVersionRefusal,
  readOwnerDecision,
  readOwnerDecisionRow,
  renderOwnerDecisionCards,
  selectLatestOwnerDecisionPerBoardItem,
  selectHumanConfirmReceiptCards,
  selectStickyOwnerDecisionCards,
  isOwnerDecisionTodolistTerminal,
  setOwnerDecisionActionError,
  setOwnerDecisionTodolistStatus,
  splitOwnerDecisionPlanStep,
} from "./owner-decision-card.ts";

describe("owner-decision-card UI", () => {
  afterEach(() => {
    localStorage.clear();
    clearOwnerDecisionDismissalsForTest();
    clearOwnerDecisionDeliveryStateForTest();
  });

  it("reads ownerDecision field and fence from messages", () => {
    const card = {
      kind: "todolist_confirm",
      decisionId: "dec-ui-1",
      groupId: "grp-a",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      title: "请确认执行计划",
      summary: ["1. 起草；"],
      options: [
        { id: "confirm", label: "确认计划", style: "primary" },
        { id: "revise", label: "退回修订", style: "default" },
        { id: "later", label: "稍后", style: "ghost" },
      ],
      mentionMemberIds: ["owner@x.com"],
      mentionLabels: ["CEO"],
    };
    expect(
      readOwnerDecision({
        role: "assistant",
        content: [{ type: "text", text: "ignored" }],
        ownerDecision: card,
      })?.decisionId,
    ).toBe("dec-ui-1");

    const fenceText = ["@CEO 需要你确认", "```owner-decision", JSON.stringify(card), "```"].join(
      "\n",
    );
    expect(
      readOwnerDecision({
        role: "assistant",
        content: [{ type: "text", text: fenceText }],
      })?.todolistId,
    ).toBe("td-1");
  });

  it("renders display names without emails, numbered lines without ul bullets, and errors", () => {
    const container = document.createElement("div");
    const onDecide = vi.fn();
    const card = {
      kind: "todolist_confirm" as const,
      decisionId: "dec-ui-2",
      groupId: "grp-a",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      title: "请确认执行计划",
      summary: ["1. 起草；", "2. 核对；"],
      options: [
        { id: "confirm" as const, label: "确认计划", style: "primary" as const },
        { id: "revise" as const, label: "退回修订", style: "default" as const },
        { id: "later" as const, label: "稍后", style: "ghost" as const },
      ],
      mentionMemberIds: ["daniel.hhd@gmail.com", "bot"],
      mentionLabels: ["CEO", "高级秘书"],
    };
    setOwnerDecisionActionError("dec-ui-2", "actor_not_authenticated");
    render(
      renderOwnerDecisionCards(
        [
          {
            role: "assistant",
            content: [{ type: "text", text: "请确认" }],
            ownerDecision: card,
          },
        ],
        { onDecide },
      ),
      container,
    );
    const el = container.querySelector("[data-owner-decision='dec-ui-2']");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("employee-workbench__steward-confirm-card")).toBe(true);
    expect(el?.textContent).toContain("@CEO");
    expect(el?.textContent).toContain("@高级秘书");
    expect(el?.textContent).not.toContain("daniel.hhd@gmail.com");
    expect(el?.querySelector("ul")).toBeNull();
    expect(el?.querySelectorAll("[role='listitem']").length).toBe(2);
    expect(el?.querySelector("[data-owner-decision-error]")?.textContent).toContain(
      "actor_not_authenticated",
    );
    (el?.querySelector("button.primary") as HTMLButtonElement | null)?.click();
    expect(onDecide).toHaveBeenCalledWith(
      "confirm",
      expect.objectContaining({ decisionId: "dec-ui-2" }),
    );
  });

  it("formatOwnerDecisionMentionHint sanitizes emails when labels missing", () => {
    expect(
      formatOwnerDecisionMentionHint({
        kind: "todolist_confirm",
        decisionId: "d",
        groupId: "g",
        taskId: "t",
        boardItemId: "b",
        todolistId: "td",
        title: "x",
        summary: ["y"],
        options: [],
        mentionMemberIds: ["a@b.com", "bot"],
      }),
    ).toBe("@主答 @bot");
  });

  it("formats summary lines with ； and hang-indent structure", () => {
    expect(formatOwnerDecisionSummaryLine("1. 起草")).toBe("1. 起草；");
    expect(formatOwnerDecisionSummaryLine("1. 已有；")).toBe("1. 已有；");
    expect(splitOwnerDecisionPlanStep("1. 由秘书起草一页纸；")).toEqual({
      index: "1.",
      body: "由秘书起草一页纸；",
    });

    const container = document.createElement("div");
    render(
      renderOwnerDecisionCards([
        {
          role: "assistant",
          ownerDecision: {
            kind: "todolist_confirm",
            decisionId: "dec-hang",
            groupId: "g",
            taskId: "t",
            boardItemId: "b",
            todolistId: "td",
            title: "请确认执行计划",
            summary: ["1. 由高级秘书起草一页纸摘要", "2. 交叉核对"],
            options: [
              { id: "confirm", label: "确认计划", style: "primary" },
              { id: "revise", label: "退回修订", style: "default" },
              { id: "later", label: "稍后", style: "ghost" },
            ],
            mentionMemberIds: ["owner"],
            mentionLabels: ["CEO"],
          },
        },
      ]),
      container,
    );
    const steps = container.querySelectorAll(".employee-workbench__owner-decision-step");
    expect(steps.length).toBe(2);
    expect(
      steps[0]?.querySelector(".employee-workbench__owner-decision-step-index")?.textContent,
    ).toBe("1.");
    expect(
      steps[0]?.querySelector(".employee-workbench__owner-decision-step-body")?.textContent,
    ).toBe("由高级秘书起草一页纸摘要；");
    expect(steps[1]?.textContent).toContain("交叉核对；");
  });

  it("expands in-card revise textarea; cancel collapses; submit passes reason", () => {
    const container = document.createElement("div");
    const onDecide = vi.fn();
    const cardMsg = {
      role: "assistant",
      ownerDecision: {
        kind: "todolist_confirm" as const,
        decisionId: "dec-revise",
        groupId: "g",
        taskId: "t",
        boardItemId: "b",
        todolistId: "td",
        title: "请确认执行计划",
        summary: ["1. 起草；"],
        options: [
          { id: "confirm" as const, label: "确认计划", style: "primary" as const },
          { id: "revise" as const, label: "退回修订", style: "default" as const },
          { id: "later" as const, label: "稍后", style: "ghost" as const },
        ],
        mentionMemberIds: ["owner"],
        mentionLabels: ["CEO"],
      },
    };
    const onUIChange = vi.fn(() => {
      render(renderOwnerDecisionCards([cardMsg], { onDecide, onUIChange }), container);
    });
    onUIChange();
    expect(container.querySelector("[data-owner-decision-revise]")).toBeNull();
    (container.querySelector('[data-owner-decision-action="revise"]') as HTMLButtonElement).click();
    expect(onDecide).not.toHaveBeenCalled();
    expect(isOwnerDecisionReviseExpanded("dec-revise")).toBe(true);
    expect(container.querySelector("[data-owner-decision-revise]")).not.toBeNull();

    const input = container.querySelector(
      "[data-owner-decision-revise-input]",
    ) as HTMLTextAreaElement;
    input.value = "请改成两页纸";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(getOwnerDecisionReviseDraft("dec-revise")).toBe("请改成两页纸");
    (
      container.querySelector('[data-owner-decision-action="revise-submit"]') as HTMLButtonElement
    ).click();
    expect(onDecide).toHaveBeenCalledWith(
      "revise",
      expect.objectContaining({ decisionId: "dec-revise" }),
      { reason: "请改成两页纸" },
    );

    clearOwnerDecisionDismissalsForTest();
    onDecide.mockClear();
    onUIChange();
    (container.querySelector('[data-owner-decision-action="revise"]') as HTMLButtonElement).click();
    (
      container.querySelector('[data-owner-decision-action="revise-cancel"]') as HTMLButtonElement
    ).click();
    expect(isOwnerDecisionReviseExpanded("dec-revise")).toBe(false);
    expect(container.querySelector("[data-owner-decision-revise]")).toBeNull();
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("hides dismissed cards", () => {
    dismissOwnerDecisionCard("dec-gone");
    const container = document.createElement("div");
    render(
      renderOwnerDecisionCards([
        {
          role: "assistant",
          ownerDecision: {
            kind: "todolist_confirm",
            decisionId: "dec-gone",
            groupId: "g",
            taskId: "t",
            boardItemId: "b",
            todolistId: "td",
            title: "x",
            summary: ["y"],
            options: [{ id: "later", label: "稍后", style: "ghost" }],
            mentionMemberIds: ["owner"],
          },
        },
      ]),
      container,
    );
    expect(container.querySelector("[data-owner-decision]")).toBeNull();
  });

  it("parses status-gate RPC errors and maps friendly copy", () => {
    expect(
      parseOwnerDecisionStatusGateError(
        "todolist status is confirmed; expected proposed|revise_requested",
      ),
    ).toBe("confirmed");
    expect(
      parseOwnerDecisionStatusGateError(
        "Error: todolist status is superseded; expected proposed|revise_requested",
      ),
    ).toBe("superseded");
    expect(parseOwnerDecisionStatusGateError("unrelated failure")).toBeNull();
    expect(formatOwnerDecisionStatusCopy("confirmed")).toBe("执行计划已确认");
    expect(ownerDecisionStatusCalloutClass("confirmed")).toBe("callout success");
    expect(ownerDecisionStatusCalloutClass("superseded")).toBe("callout");
    expect(formatOwnerDecisionStatusCopy("superseded")).toBe("旧版本已失效");
    expect(formatOwnerDecisionStatusCopy("superseded")).not.toContain("过期");
    expect(isOwnerDecisionTodolistActionable("proposed")).toBe(true);
    expect(isOwnerDecisionTodolistActionable("revise_requested")).toBe(true);
    expect(isOwnerDecisionTodolistActionable("confirmed")).toBe(false);
    expect(isOwnerDecisionTodolistActionable("superseded")).toBe(false);
    expect(isOwnerDecisionTodolistActionable(null)).toBe(true);
  });

  it("hides all actions after confirmed; superseded auto-collapses", () => {
    setOwnerDecisionTodolistStatus("td-terminal", "confirmed");
    expect(getOwnerDecisionTodolistStatus("td-terminal")).toBe("confirmed");
    const onDecide = vi.fn();
    const onUIChange = vi.fn();
    const container = document.createElement("div");
    const message = {
      role: "assistant",
      ownerDecision: {
        kind: "todolist_confirm" as const,
        decisionId: "dec-terminal",
        groupId: "g",
        taskId: "t",
        boardItemId: "b",
        todolistId: "td-terminal",
        title: "请确认执行计划",
        summary: ["1. 起草；"],
        options: [
          { id: "confirm" as const, label: "确认计划", style: "primary" as const },
          { id: "revise" as const, label: "退回修订", style: "default" as const },
          { id: "later" as const, label: "稍后", style: "ghost" as const },
        ],
        mentionMemberIds: ["ceo"],
        mentionLabels: ["CEO"],
      },
    };
    noteOwnerDecisionDelivery("td-terminal", "peer_confirmed", 1);
    render(renderOwnerDecisionCards([message], { onDecide, onUIChange }), container);
    const root = container.querySelector("[data-owner-decision]") as HTMLElement;
    expect(root.getAttribute("data-owner-decision-status")).toBe("confirmed");
    expect(root.hasAttribute("data-owner-decision-terminal")).toBe(true);
    expect(root.hasAttribute("data-owner-decision-peer-ack")).toBe(true);
    expect(root.getAttribute("data-owner-decision-confirm-source")).toBe("peer");
    expect(
      container
        .querySelector(
          "[data-owner-decision-peer-ack-copy], .employee-workbench__owner-decision-peer-ack-copy",
        )
        ?.textContent?.trim(),
    ).toBe(OWNER_DECISION_PEER_ACK_COPY);
    // Peer confirmed: no plan body, no actions.
    expect(container.querySelectorAll("[role='listitem']").length).toBe(0);
    expect(container.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();
    expect(container.querySelector('[data-owner-decision-action="revise"]')).toBeNull();
    expect(container.querySelector('[data-owner-decision-action="later"]')).toBeNull();
    expect(container.querySelector(".employee-workbench__assistant-prelude-toolbar")).toBeNull();
    expect(onDecide).not.toHaveBeenCalled();

    clearOwnerDecisionDismissalsForTest();
    setOwnerDecisionTodolistStatus("td-super", "superseded");
    const c2 = document.createElement("div");
    render(
      renderOwnerDecisionCards([
        {
          ...message,
          ownerDecision: {
            ...message.ownerDecision,
            decisionId: "dec-super",
            todolistId: "td-super",
          },
        },
      ]),
      c2,
    );
    const stale = c2.querySelector("[data-owner-decision='dec-super']");
    expect(stale).toBeNull();
    expect(isOwnerDecisionDismissed("dec-super")).toBe(false);
    expect(c2.textContent).not.toContain("请确认执行计划");
    expect(c2.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();
    expect(c2.querySelector('[data-owner-decision-action="revise"]')).toBeNull();
  });

  it("parses status-gate errors even with confirmTodolist: prefix", () => {
    expect(
      parseOwnerDecisionStatusGateError(
        "confirmTodolist: todolist status is confirmed; expected proposed|revise_requested",
      ),
    ).toBe("confirmed");
  });

  it("keeps only the newest version per boardItemId and dismisses lookalikes", () => {
    const mk = (decisionId: string, todolistId: string, version: number) => ({
      role: "assistant" as const,
      ownerDecision: {
        kind: "todolist_confirm" as const,
        decisionId,
        groupId: "g",
        taskId: "t",
        boardItemId: "board-same",
        todolistId,
        title: "请确认执行计划",
        summary: ["1. 步骤；"],
        version,
        options: [
          { id: "confirm" as const, label: "确认计划", style: "primary" as const },
          { id: "revise" as const, label: "退回修订", style: "default" as const },
          { id: "later" as const, label: "稍后", style: "ghost" as const },
        ],
        mentionMemberIds: ["ceo"],
        mentionLabels: ["CEO"],
      },
    });
    const messages = [
      mk("dec-old", "td-old", 1),
      mk("dec-mid", "td-mid", 2),
      mk("dec-new", "td-new", 3),
    ];
    const selected = selectLatestOwnerDecisionPerBoardItem(messages.map((m) => m.ownerDecision));
    expect(selected.map((c) => c.decisionId)).toEqual(["dec-new"]);
    expect(isOwnerDecisionDismissed("dec-old")).toBe(false);
    expect(isOwnerDecisionDismissed("dec-mid")).toBe(false);

    const container = document.createElement("div");
    render(renderOwnerDecisionCards(messages), container);
    // Sticky pile keeps latest per board only (older versions stay in transcript
    // history, not in the confirm stack — avoids ghost walls on long threads).
    expect(container.querySelectorAll("[data-owner-decision]").length).toBe(1);
    expect(container.querySelector("[data-owner-decision='dec-new']")).not.toBeNull();
    expect(container.querySelector("[data-owner-decision='dec-old']")).toBeNull();
    expect(container.querySelector("[data-owner-decision='dec-mid']")).toBeNull();
    expect(
      container.querySelector(
        "[data-owner-decision='dec-old'] [data-owner-decision-action='confirm']",
      ),
    ).toBeNull();
    expect(container.querySelector("[data-owner-decision='dec-new']")?.textContent).toContain(
      "等待确认",
    );
    expect(collectOwnerDecisionHydrationTargets(selected).map((t) => t.todolistId)).toEqual([
      "td-new",
    ]);
    dismissOwnerDecisionCard("dec-new");
    render(renderOwnerDecisionCards(messages), container);
    expect(container.querySelectorAll("[data-owner-decision]").length).toBe(0);
  });

  it("confirm success folds dialog away; peer residual shows compact ack only", () => {
    const mk = (decisionId: string, todolistId: string, version: number) => ({
      kind: "todolist_confirm" as const,
      decisionId,
      groupId: "g",
      taskId: "t",
      boardItemId: "board-confirm-keep",
      todolistId,
      title: "请确认执行计划",
      summary: ["1. 起草；", "2. 核对；"],
      version,
      options: [
        { id: "confirm" as const, label: "确认计划", style: "primary" as const },
        { id: "revise" as const, label: "退回修订", style: "default" as const },
        { id: "later" as const, label: "稍后", style: "ghost" as const },
      ],
      mentionMemberIds: ["ceo"],
      mentionLabels: ["CEO"],
    });
    const oldCard = mk("dec-old-keep", "td-old-keep", 1);
    const confirmedCard = mk("dec-confirmed-keep", "td-confirmed-keep", 2);
    renderOwnerDecisionCards([
      { role: "assistant", ownerDecision: oldCard },
      { role: "assistant", ownerDecision: confirmedCard },
    ]);
    // App confirm-success path: mark confirmed, fold dialog (dismiss), collapse siblings.
    setOwnerDecisionTodolistStatus(confirmedCard.todolistId, "confirmed");
    collapseOwnerDecisionCardsForBoardItem(confirmedCard.boardItemId);
    dismissOwnerDecisionCard(confirmedCard.decisionId);
    expect(isOwnerDecisionDismissed("dec-old-keep")).toBe(true);
    expect(isOwnerDecisionDismissed("dec-confirmed-keep")).toBe(true);

    // Undismissed peer residual → compact「收到，并确认」only (not human confirm copy).
    clearOwnerDecisionDismissalsForTest();
    setOwnerDecisionTodolistStatus(confirmedCard.todolistId, "confirmed");
    noteOwnerDecisionDelivery(confirmedCard.todolistId, "peer_confirmed", confirmedCard.version);
    const container = document.createElement("div");
    render(
      renderOwnerDecisionCards([{ role: "assistant", ownerDecision: confirmedCard }]),
      container,
    );
    expect(container.querySelector("[data-owner-decision-peer-ack]")).not.toBeNull();
    expect(
      container
        .querySelector(".employee-workbench__owner-decision-peer-ack-copy")
        ?.textContent?.trim(),
    ).toBe(OWNER_DECISION_PEER_ACK_COPY);
    expect(container.querySelectorAll("[role='listitem']").length).toBe(0);
    expect(container.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();

    // Human confirmed residual (consumed, not peer) →「执行计划已确认」, never peer ack.
    clearOwnerDecisionDeliveryStateForTest();
    clearOwnerDecisionDismissalsForTest();
    setOwnerDecisionTodolistStatus(confirmedCard.todolistId, "confirmed");
    noteOwnerDecisionDelivery(confirmedCard.todolistId, "consumed", confirmedCard.version);
    const humanBox = document.createElement("div");
    render(
      renderOwnerDecisionCards([{ role: "assistant", ownerDecision: confirmedCard }]),
      humanBox,
    );
    expect(humanBox.querySelector("[data-owner-decision-peer-ack]")).toBeNull();
    expect(humanBox.querySelector("[data-owner-decision-status-copy]")?.textContent?.trim()).toBe(
      "执行计划已确认",
    );
  });

  it("formatPostPlanConfirmAdvanceUserMessage separates queue/blocked/dispatch failures", () => {
    expect(
      formatPostPlanConfirmAdvanceUserMessage({
        wakeRecorded: false,
        wakeConsumed: false,
        dispatched: false,
        reason: "confirm_board_not_active:published",
      }),
    ).toMatch(/^计划已确认，但自动推进未开始：/);
    expect(
      formatPostPlanConfirmAdvanceUserMessage({
        wakeRecorded: true,
        wakeConsumed: false,
        dispatched: false,
        reason: "wake_queued",
      }),
    ).toMatch(/^计划已确认，推进已排队但未消费：/);
    expect(
      formatPostPlanConfirmAdvanceUserMessage({
        wakeRecorded: true,
        wakeConsumed: true,
        dispatched: false,
        reason: "self_advance_not_execute",
      }),
    ).toMatch(/^计划已确认，推进受阻：/);
    expect(
      formatPostPlanConfirmAdvanceUserMessage({
        wakeRecorded: true,
        wakeConsumed: true,
        dispatched: false,
        reason: "dispatch_failed:execute_collaboration_round_failed",
      }),
    ).toMatch(/^计划已确认，但派发失败：/);
    expect(
      formatPostPlanConfirmAdvanceUserMessage({
        wakeRecorded: true,
        wakeConsumed: true,
        dispatched: true,
        reason: "dispatched",
      }),
    ).toBeNull();
  });

  it("turns status-gate RPC errors into status copy / superseded collapse", () => {
    const message = {
      role: "assistant",
      ownerDecision: {
        kind: "todolist_confirm" as const,
        decisionId: "dec-gate",
        groupId: "g",
        taskId: "t",
        boardItemId: "b",
        todolistId: "td-gate",
        title: "请确认执行计划",
        summary: ["1. 起草；"],
        options: [
          { id: "confirm" as const, label: "确认计划", style: "primary" as const },
          { id: "revise" as const, label: "退回修订", style: "default" as const },
          { id: "later" as const, label: "稍后", style: "ghost" as const },
        ],
        mentionMemberIds: ["ceo"],
        mentionLabels: ["CEO"],
      },
    };
    const container = document.createElement("div");
    render(renderOwnerDecisionCards([message]), container);
    // Simulate app-render catch path writing the raw RPC error onto the card.
    setOwnerDecisionActionError(
      "dec-gate",
      "todolist status is confirmed; expected proposed|revise_requested",
    );
    expect(getOwnerDecisionTodolistStatus("td-gate")).toBe("confirmed");
    // confirmed auto-collapses (dismisses) the actionable dialog — SoT stays confirmed.
    expect(isOwnerDecisionDismissed("dec-gate")).toBe(true);
    render(renderOwnerDecisionCards([message]), container);
    expect(container.querySelector("[data-owner-decision]")).toBeNull();

    clearOwnerDecisionDismissalsForTest();
    const message2 = {
      ...message,
      ownerDecision: {
        ...message.ownerDecision,
        decisionId: "dec-gate-2",
        todolistId: "td-gate-2",
      },
    };
    render(renderOwnerDecisionCards([message2]), container);
    setOwnerDecisionActionError(
      "dec-gate-2",
      "todolist status is superseded; expected proposed|revise_requested",
    );
    expect(getOwnerDecisionTodolistStatus("td-gate-2")).toBe("superseded");
    render(renderOwnerDecisionCards([message2]), container);
    const stale = container.querySelector("[data-owner-decision='dec-gate-2']");
    expect(stale).toBeNull();
    expect(container.textContent).not.toContain("请确认执行计划");
    expect(container.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();

    clearOwnerDecisionDismissalsForTest();
    const message3 = {
      ...message,
      ownerDecision: {
        ...message.ownerDecision,
        decisionId: "dec-gate-3",
        todolistId: "td-gate-3",
        version: 1,
      },
    };
    render(renderOwnerDecisionCards([message3]), container);
    setOwnerDecisionActionError("dec-gate-3", "confirmTodolist: version_mismatch: 计划版本不匹配");
    expect(
      parseOwnerDecisionVersionRefusal("confirmTodolist: version_mismatch: 计划版本不匹配"),
    ).toBe("version_mismatch");
    expect(parseOwnerDecisionVersionRefusal("confirmTodolist: stale_version: 旧版本已失效")).toBe(
      "stale_version",
    );
    expect(parseOwnerDecisionVersionRefusal("confirmTodolist: card_invalid: 旧版本已失效")).toBe(
      "card_invalid",
    );
    expect(getOwnerDecisionTodolistStatus("td-gate-3")).toBeNull();
    render(renderOwnerDecisionCards([message3]), container);
    const mismatched = container.querySelector("[data-owner-decision='dec-gate-3']");
    expect(mismatched).toBeNull();
    expect(container.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();
  });

  it("shows 等待确认 for a structured card and not for a fence-only copy", () => {
    const card = {
      kind: "todolist_confirm" as const,
      decisionId: "dec-wait",
      groupId: "g",
      taskId: "t",
      boardItemId: "b-wait",
      todolistId: "td-wait",
      title: "请确认执行计划",
      summary: ["1. 起草；"],
      options: [
        { id: "confirm" as const, label: "确认计划", style: "primary" as const },
        { id: "revise" as const, label: "退回修订", style: "default" as const },
        { id: "later" as const, label: "稍后", style: "ghost" as const },
      ],
      mentionMemberIds: ["ceo"],
      mentionLabels: ["CEO"],
    };
    expect(readOwnerDecisionRow({ role: "assistant", ownerDecision: card })?.authority).toBe(
      "structured",
    );
    const structured = document.createElement("div");
    render(renderOwnerDecisionCards([{ role: "assistant", ownerDecision: card }]), structured);
    expect(structured.textContent).toContain("等待确认");

    const fenceText = [
      "@CEO",
      "```owner-decision",
      JSON.stringify({ ...card, decisionId: "dec-fence" }),
      "```",
    ].join("\n");
    expect(
      readOwnerDecisionRow({
        role: "assistant",
        content: [{ type: "text", text: fenceText }],
      })?.authority,
    ).toBe("fence");
    const fenced = document.createElement("div");
    render(
      renderOwnerDecisionCards([
        { role: "assistant", content: [{ type: "text", text: fenceText }] },
      ]),
      fenced,
    );
    expect(fenced.textContent).not.toContain("等待确认");
  });

  it("shows a retryable delivery failure without confirming the plan", () => {
    noteOwnerDecisionDelivery("td-fail", "delivery_failed_retryable", 1);
    const onDecide = vi.fn();
    const onRetryDelivery = vi.fn();
    const container = document.createElement("div");
    render(
      renderOwnerDecisionCards(
        [
          {
            role: "assistant",
            ownerDecision: {
              kind: "todolist_confirm",
              decisionId: "dec-fail",
              groupId: "g",
              taskId: "t",
              boardItemId: "b-fail",
              todolistId: "td-fail",
              version: 1,
              title: "请确认执行计划",
              summary: ["1. 起草；"],
              options: [
                { id: "confirm", label: "确认计划", style: "primary" },
                { id: "revise", label: "退回修订", style: "default" },
                { id: "later", label: "稍后", style: "ghost" },
              ],
              mentionMemberIds: ["ceo"],
              mentionLabels: ["CEO"],
            },
          },
        ],
        { onDecide, onRetryDelivery },
      ),
      container,
    );
    expect(container.textContent).toContain("确认请求发送失败，可重试");
    expect(container.textContent).not.toContain("等待确认");
    const retry = container.querySelector(
      '[data-owner-decision-action="retry-delivery"]',
    ) as HTMLButtonElement;
    expect(retry).not.toBeNull();
    retry.click();
    expect(onRetryDelivery).toHaveBeenCalledTimes(1);
    expect(onDecide).not.toHaveBeenCalled();
  });
});

describe("selectStickyOwnerDecisionCards", () => {
  beforeEach(() => {
    clearOwnerDecisionDismissalsForTest();
    clearOwnerDecisionDeliveryStateForTest();
  });

  it("keeps unknown-status cards and at most one terminal review card", () => {
    const proposed = {
      kind: "todolist_confirm" as const,
      decisionId: "owner-decision-a-v1",
      groupId: "grp-test",
      taskId: "task-a",
      boardItemId: "board-a",
      todolistId: "todo-a",
      title: "请确认执行计划",
      summary: ["1. do a；"],
      options: [
        { id: "confirm" as const, label: "确认计划", style: "primary" as const },
        { id: "revise" as const, label: "退回修订", style: "default" as const },
        { id: "later" as const, label: "稍后", style: "ghost" as const },
      ],
      version: 1,
      mentionMemberIds: [],
    };
    const confirmedOlder = {
      ...proposed,
      decisionId: "owner-decision-b-v2",
      todolistId: "todo-b",
      boardItemId: "board-b",
      version: 2,
    };
    const confirmedNewer = {
      ...proposed,
      decisionId: "owner-decision-c-v1",
      todolistId: "todo-c",
      boardItemId: "board-c",
      version: 1,
    };
    setOwnerDecisionTodolistStatus("todo-b", "confirmed");
    setOwnerDecisionTodolistStatus("todo-c", "confirmed");
    const sticky = selectStickyOwnerDecisionCards([proposed, confirmedOlder, confirmedNewer]);
    expect(sticky.map((c) => c.decisionId)).toEqual(["owner-decision-a-v1", "owner-decision-c-v1"]);
    expect(isOwnerDecisionTodolistTerminal("confirmed")).toBe(true);
  });

  it("drops confirmation_consumed delivery rows from the sticky pile", () => {
    const card = {
      kind: "todolist_confirm" as const,
      decisionId: "owner-decision-consumed",
      groupId: "grp-test",
      taskId: "task-z",
      boardItemId: "board-z",
      todolistId: "todo-z",
      title: "请确认执行计划",
      summary: ["1. done；"],
      options: [
        { id: "confirm" as const, label: "确认计划", style: "primary" as const },
        { id: "revise" as const, label: "退回修订", style: "default" as const },
        { id: "later" as const, label: "稍后", style: "ghost" as const },
      ],
      version: 1,
      mentionMemberIds: [],
    };
    noteOwnerDecisionDelivery("todo-z", "consumed");
    expect(selectStickyOwnerDecisionCards([card])).toEqual([]);
  });

  it("dedupes to latest per board item before sticky filter", () => {
    const v1 = {
      kind: "todolist_confirm" as const,
      decisionId: "owner-decision-x-v1",
      groupId: "grp-test",
      taskId: "task-x",
      boardItemId: "board-x",
      todolistId: "todo-x1",
      title: "请确认执行计划",
      summary: ["1. old；"],
      options: [
        { id: "confirm" as const, label: "确认计划", style: "primary" as const },
        { id: "revise" as const, label: "退回修订", style: "default" as const },
        { id: "later" as const, label: "稍后", style: "ghost" as const },
      ],
      version: 1,
      mentionMemberIds: [],
    };
    const v2 = { ...v1, decisionId: "owner-decision-x-v2", todolistId: "todo-x2", version: 2 };
    const sticky = selectStickyOwnerDecisionCards([v1, v2]);
    expect(sticky.map((c) => c.decisionId)).toEqual(["owner-decision-x-v2"]);
  });
});

describe("selectHumanConfirmReceiptCards", () => {
  afterEach(() => {
    clearOwnerDecisionDismissalsForTest();
    clearOwnerDecisionDeliveryStateForTest();
  });

  const baseCard = {
    kind: "todolist_confirm" as const,
    decisionId: "owner-decision-receipt",
    groupId: "grp-test",
    taskId: "task-r",
    boardItemId: "board-r",
    todolistId: "todo-r",
    title: "请确认执行计划",
    summary: ["1. ship；"],
    options: [
      { id: "confirm" as const, label: "确认计划", style: "primary" as const },
      { id: "revise" as const, label: "退回修订", style: "default" as const },
      { id: "later" as const, label: "稍后", style: "ghost" as const },
    ],
    version: 1,
    mentionMemberIds: ["ceo"],
    mentionLabels: ["CEO"],
  };

  it("keeps compact human confirm receipts for consumed+confirmed (history, not sticky)", () => {
    setOwnerDecisionTodolistStatus("todo-r", "confirmed");
    noteOwnerDecisionDelivery("todo-r", "consumed");
    const receipts = selectHumanConfirmReceiptCards([baseCard]);
    expect(receipts.map((c) => c.decisionId)).toEqual(["owner-decision-receipt"]);
    // Sticky must still drop consumed — todo clears card wall.
    expect(selectStickyOwnerDecisionCards([baseCard])).toEqual([]);
  });

  it("excludes peer_confirmed from human receipt helper (peer has dedicated copy)", () => {
    setOwnerDecisionTodolistStatus("todo-r", "confirmed");
    noteOwnerDecisionDelivery("todo-r", "peer_confirmed");
    expect(selectHumanConfirmReceiptCards([baseCard])).toEqual([]);
  });

  it("renderOwnerDecisionCards shows human receipt with confirm-source=human", () => {
    setOwnerDecisionTodolistStatus(baseCard.todolistId, "confirmed");
    noteOwnerDecisionDelivery(baseCard.todolistId, "consumed", baseCard.version);
    const container = document.createElement("div");
    render(renderOwnerDecisionCards([{ role: "assistant", ownerDecision: baseCard }]), container);
    const receipt = container.querySelector(".employee-workbench__owner-decision-human-receipt");
    expect(receipt).not.toBeNull();
    expect(receipt?.getAttribute("data-owner-decision-confirm-source")).toBe("human");
    expect(receipt?.getAttribute("data-owner-decision-delivery")).toBe("consumed");
    expect(container.querySelector("[data-owner-decision-status-copy]")?.textContent?.trim()).toBe(
      "执行计划已确认",
    );
    // Sticky/todo cleared; no actionable confirm on receipt.
    expect(container.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();
    expect(container.querySelector("[data-owner-decision-peer-ack]")).toBeNull();
  });
});

describe("confirm success continuous history receipt (dismiss kept)", () => {
  afterEach(() => {
    clearOwnerDecisionDismissalsForTest();
    clearOwnerDecisionDeliveryStateForTest();
  });

  const mk = (decisionId: string, todolistId: string, version: number) => ({
    kind: "todolist_confirm" as const,
    decisionId,
    groupId: "g",
    taskId: "t",
    boardItemId: "board-continuous",
    todolistId,
    title: "请确认执行计划",
    summary: ["1. 起草；", "2. 核对；"],
    version,
    options: [
      { id: "confirm" as const, label: "确认计划", style: "primary" as const },
      { id: "revise" as const, label: "退回修订", style: "default" as const },
      { id: "later" as const, label: "稍后", style: "ghost" as const },
    ],
    mentionMemberIds: ["ceo"],
    mentionLabels: ["CEO"],
  });

  it("confirm success → without clearDismissals: sticky gone, history shows 执行计划已确认", () => {
    const card = mk("dec-continuous", "td-continuous", 2);
    // Warm maps the way a live render would.
    renderOwnerDecisionCards([{ role: "assistant", ownerDecision: card }]);

    // Mirror app-render confirm-success path (no clearDismissals / no refresh).
    setOwnerDecisionTodolistStatus(card.todolistId, "confirmed");
    noteOwnerDecisionDelivery(card.todolistId, "consumed", card.version);
    collapseOwnerDecisionCardsForBoardItem(card.boardItemId);
    dismissOwnerDecisionCard(card.decisionId);

    expect(isOwnerDecisionDismissed(card.decisionId)).toBe(true);
    expect(getOwnerDecisionTodolistStatus(card.todolistId)).toBe("confirmed");

    const container = document.createElement("div");
    render(renderOwnerDecisionCards([{ role: "assistant", ownerDecision: card }]), container);

    // Sticky/todo/dialog folded — no confirm buttons.
    expect(container.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();
    expect(container.querySelector("[data-owner-decision-dialog]")).toBeNull();
    expect(
      container.querySelector(
        ".employee-workbench__steward-confirm-card:not(.employee-workbench__owner-decision-human-receipt)",
      ),
    ).toBeNull();

    // History compact receipt still present despite dismiss.
    const receipt = container.querySelector(".employee-workbench__owner-decision-human-receipt");
    expect(receipt).not.toBeNull();
    expect(receipt?.getAttribute("data-owner-decision-confirm-source")).toBe("human");
    expect(container.querySelector("[data-owner-decision-status-copy]")?.textContent?.trim()).toBe(
      "执行计划已确认",
    );
    // Peer copy stays independent — not shown on human confirm path.
    expect(container.querySelector("[data-owner-decision-peer-ack]")).toBeNull();
  });

  it("稍后 dismiss alone does not invent a confirm receipt", () => {
    const card = mk("dec-later-only", "td-later-only", 1);
    renderOwnerDecisionCards([{ role: "assistant", ownerDecision: card }]);
    // Mirror app-render "later" path — dismiss only, no confirmed/consumed.
    dismissOwnerDecisionCard(card.decisionId);

    const container = document.createElement("div");
    render(renderOwnerDecisionCards([{ role: "assistant", ownerDecision: card }]), container);
    expect(container.querySelector(".employee-workbench__owner-decision-human-receipt")).toBeNull();
    expect(container.textContent ?? "").not.toContain("执行计划已确认");
    expect(container.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();
  });

  it("peer_confirmed residual stays dedicated copy; advance-failure helper independent", () => {
    const card = mk("dec-peer-cont", "td-peer-cont", 1);
    setOwnerDecisionTodolistStatus(card.todolistId, "confirmed");
    noteOwnerDecisionDelivery(card.todolistId, "peer_confirmed", card.version);
    // Peer residuals are not auto-dismissed; sticky shows compact ack.
    const container = document.createElement("div");
    render(renderOwnerDecisionCards([{ role: "assistant", ownerDecision: card }]), container);
    expect(container.querySelector("[data-owner-decision-peer-ack]")).not.toBeNull();
    expect(
      container
        .querySelector(".employee-workbench__owner-decision-peer-ack-copy")
        ?.textContent?.trim(),
    ).toBe(OWNER_DECISION_PEER_ACK_COPY);
    expect(container.querySelector(".employee-workbench__owner-decision-human-receipt")).toBeNull();
    // Advance-failure copy remains a separate surface (not folded into receipt/peer).
    expect(
      formatPostPlanConfirmAdvanceUserMessage({
        wakeRecorded: true,
        wakeConsumed: true,
        dispatched: false,
        reason: "dispatch_failed:execute_collaboration_round_failed",
      }),
    ).toMatch(/^计划已确认，但派发失败：/);
  });
});

it("remembers a deferred card after module memory is cleared", () => {
  dismissOwnerDecisionCard("persist-decision");
  clearOwnerDecisionDismissalsForTest(true);
  expect(isOwnerDecisionDismissed("persist-decision")).toBe(true);
  expect(isOwnerDecisionDismissed("other-decision")).toBe(false);
});

it("retries failed hydration after backoff rather than trusting the historical card", () => {
  vi.useFakeTimers();
  try {
    const card = {
      kind: "todolist_confirm",
      decisionId: "retry-decision",
      groupId: "g",
      taskId: "t",
      boardItemId: "b",
      todolistId: "retry-plan",
      title: "请确认执行计划",
      summary: ["1. 合成计划；"],
      options: [
        { id: "confirm", label: "确认计划", style: "primary" },
        { id: "revise", label: "退回修订", style: "default" },
        { id: "later", label: "稍后", style: "ghost" },
      ],
      mentionMemberIds: ["ceo"],
      version: 1,
    } as Parameters<typeof selectStickyOwnerDecisionCards>[0][number];
    markOwnerDecisionHydrationAttempted(card.todolistId);
    expect(collectOwnerDecisionHydrationTargets([card])).toEqual([]);
    releaseOwnerDecisionHydrationAttempt(card.todolistId);
    expect(collectOwnerDecisionHydrationTargets([card])).toEqual([]);
    vi.advanceTimersByTime(5000);
    expect(collectOwnerDecisionHydrationTargets([card])).toHaveLength(1);
    const host = document.createElement("div");
    render(
      renderOwnerDecisionCards([{ role: "assistant", ownerDecision: card }], {
        onHydrateStatuses: vi.fn(),
      }),
      host,
    );
    expect(host.textContent).toContain("计划状态尚未核实");
    expect(host.querySelectorAll("button").length).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
