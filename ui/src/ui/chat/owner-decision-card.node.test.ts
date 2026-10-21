// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOwnerDecisionDeliveryStateForTest,
  clearOwnerDecisionDismissalsForTest,
  collapseOwnerDecisionCardsForBoardItem,
  collectOwnerDecisionHydrationTargets,
  dismissOwnerDecisionCard,
  formatOwnerDecisionMentionHint,
  formatOwnerDecisionStatusCopy,
  formatOwnerDecisionSummaryLine,
  getOwnerDecisionReviseDraft,
  getOwnerDecisionTodolistStatus,
  isOwnerDecisionDismissed,
  isOwnerDecisionReviseExpanded,
  isOwnerDecisionTodolistActionable,
  noteOwnerDecisionDelivery,
  ownerDecisionStatusCalloutClass,
  parseOwnerDecisionStatusGateError,
  readOwnerDecision,
  readOwnerDecisionRow,
  renderOwnerDecisionCards,
  selectLatestOwnerDecisionPerBoardItem,
  setOwnerDecisionActionError,
  setOwnerDecisionTodolistStatus,
  splitOwnerDecisionPlanStep,
} from "./owner-decision-card.ts";

describe("owner-decision-card UI", () => {
  afterEach(() => {
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
    render(renderOwnerDecisionCards([message], { onDecide, onUIChange }), container);
    const root = container.querySelector("[data-owner-decision]") as HTMLElement;
    expect(root.getAttribute("data-owner-decision-status")).toBe("confirmed");
    expect(root.hasAttribute("data-owner-decision-terminal")).toBe(true);
    expect(container.querySelector("[data-owner-decision-status-copy]")?.textContent?.trim()).toBe(
      "执行计划已确认",
    );
    expect(
      container.querySelector("[data-owner-decision-status-copy]")?.classList.contains("success"),
    ).toBe(true);
    expect(container.querySelectorAll("[role='listitem']").length).toBe(1);
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
    expect(stale).not.toBeNull();
    expect(isOwnerDecisionDismissed("dec-super")).toBe(false);
    expect(stale?.textContent).toContain("旧版本已失效");
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
    expect(container.querySelectorAll("[data-owner-decision]").length).toBe(3);
    expect(container.querySelector("[data-owner-decision='dec-new']")).not.toBeNull();
    expect(container.querySelector("[data-owner-decision='dec-old']")?.textContent).toContain(
      "旧版本已失效",
    );
    expect(container.querySelector("[data-owner-decision='dec-mid']")?.textContent).toContain(
      "旧版本已失效",
    );
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
  });

  it("confirm success keeps card for review; only collapses other board lookalikes", () => {
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
    // Simulate render mapping boardItemId → decisionId (as renderOwnerDecisionCards does).
    renderOwnerDecisionCards([
      { role: "assistant", ownerDecision: oldCard },
      { role: "assistant", ownerDecision: confirmedCard },
    ]);
    // App confirm-success path: mark confirmed, collapse others, do NOT dismiss this card.
    setOwnerDecisionTodolistStatus(confirmedCard.todolistId, "confirmed");
    collapseOwnerDecisionCardsForBoardItem(confirmedCard.boardItemId, {
      keepDecisionId: confirmedCard.decisionId,
    });
    expect(isOwnerDecisionDismissed("dec-old-keep")).toBe(true);
    expect(isOwnerDecisionDismissed("dec-confirmed-keep")).toBe(false);

    const container = document.createElement("div");
    render(
      renderOwnerDecisionCards([
        { role: "assistant", ownerDecision: oldCard },
        { role: "assistant", ownerDecision: confirmedCard },
      ]),
      container,
    );
    expect(container.querySelectorAll("[data-owner-decision]").length).toBe(1);
    const root = container.querySelector(
      "[data-owner-decision='dec-confirmed-keep']",
    ) as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute("data-owner-decision-status")).toBe("confirmed");
    expect(container.querySelector("[data-owner-decision-status-copy]")?.textContent?.trim()).toBe(
      "执行计划已确认",
    );
    expect(container.querySelectorAll("[role='listitem']").length).toBe(2);
    expect(container.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();
    expect(container.querySelector('[data-owner-decision-action="revise"]')).toBeNull();
    expect(container.querySelector('[data-owner-decision-action="later"]')).toBeNull();
    expect(container.querySelector(".employee-workbench__assistant-prelude-toolbar")).toBeNull();
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
    render(renderOwnerDecisionCards([message]), container);
    expect(container.querySelector("[data-owner-decision-status-copy]")?.textContent?.trim()).toBe(
      "执行计划已确认",
    );
    expect(container.querySelector("[data-owner-decision-error]")).toBeNull();
    expect(container.querySelector('[data-owner-decision-action="confirm"]')).toBeNull();

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
    expect(stale).not.toBeNull();
    expect(stale?.textContent).toContain("旧版本已失效");
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
