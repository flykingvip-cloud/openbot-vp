// @vitest-environment jsdom
import { render } from "lit";
import { html } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  groupTodosEntriesByOrigin,
  renderWorkbenchSignalsSurface,
  resolveParallelRailLabelMode,
  shouldShowTodosOriginChip,
} from "./workbench-signals-surface.ts";

describe("groupTodosEntriesByOrigin", () => {
  it("keeps knowledge / task / collaboration / meeting-notice order and drops empty sections", () => {
    const grouped = groupTodosEntriesByOrigin([
      { id: "meeting:1", title: "纪要", origin: "meeting-notice" },
      { id: "task:1", title: "审批", origin: "task" },
      { id: "k1", title: "冲突", origin: "knowledge" },
      { id: "g1", title: "产品组", origin: "collaboration" },
      { id: "x", title: "未分类" },
    ]);
    expect(grouped.sections.map((section) => section.origin)).toEqual([
      "knowledge",
      "task",
      "collaboration",
      "meeting-notice",
    ]);
    expect(grouped.uncategorized).toEqual([{ id: "x", title: "未分类" }]);
  });
});

const scheduleCard = {
  key: "schedule",
  title: "Schedule",
  badgeCount: 0,
  primary: "No upcoming jobs",
  secondary: "",
  timeLabel: null,
  pillLabel: "Ready",
  tone: "ready",
  iconKey: "clipboardCheck",
  actionId: "openCron",
} as const;

const todosCardBase = {
  key: "todos",
  title: "To-dos",
  badgeCount: 0,
  primary: "No to-dos",
  secondary: "",
  timeLabel: null,
  pillLabel: "Low",
  tone: "low",
  iconKey: "fileText",
  actionId: "openTodos",
} as const;

describe("resolveParallelRailLabelMode", () => {
  it("uses vertical rails for zh-CN titles", () => {
    expect(resolveParallelRailLabelMode("日程管理")).toBe("vertical");
    expect(resolveParallelRailLabelMode("待办事项")).toBe("vertical");
  });

  it("uses horizontal rails for long Latin titles", () => {
    expect(resolveParallelRailLabelMode("Today's schedule")).toBe("horizontal");
    expect(resolveParallelRailLabelMode("To-do Items")).toBe("horizontal");
  });
});

describe("renderWorkbenchSignalsSurface", () => {
  it("renders parallel two-column grid without horizontal accordion", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [
          scheduleCard,
          {
            ...todosCardBase,
            badgeCount: 1,
            entries: [{ id: "task:1", title: "审批", origin: "task" }],
          },
        ],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        null,
        [
          {
            id: "a",
            title: "Standup",
            startAtMs: Date.now() + 30 * 60_000,
            kind: "personal",
            cronDerived: false,
          },
        ],
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__signals-overview--flat")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__signals-grid--parallel")).toBeTruthy();
    expect(container.querySelector(".employee-workbench__signals-grid--has-expanded")).toBeFalsy();
    expect(container.querySelector(".employee-workbench__signal-card--expanded")).toBeFalsy();
  });

  it("does not render the steward tip bar on the daily overview strip", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [],
        {},
        { text: "有 2 项待确认任务需要你先处理", kind: "ack", source: "template" },
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__steward-bar")).toBeFalsy();
    expect(container.textContent ?? "").not.toContain("有 2 项待确认任务需要你先处理");
  });

  it("does not wrap parallel cards in a steward-bar signals-stack root", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [
          scheduleCard,
          {
            ...todosCardBase,
            badgeCount: 1,
            entries: [{ id: "task:1", title: "审批", origin: "task" }],
          },
        ],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        { text: "5 处知识待关注", kind: "attention", source: "template" },
        [
          {
            id: "soon",
            title: "Standup",
            startAtMs: Date.now() + 20 * 60_000,
            kind: "personal",
            cronDerived: false,
          },
        ],
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__steward-bar")).toBeFalsy();
    expect(container.querySelector(".employee-workbench__signals-stack")).toBeFalsy();
    expect(container.querySelector(".employee-workbench__signals-overview")).toBeTruthy();
    expect(container.querySelectorAll(".employee-workbench__signal-card--parallel")).toHaveLength(
      2,
    );
  });

  it("ignores steward suggestion callbacks when the tip bar is removed", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenStewardSuggestion = vi.fn();

    render(
      html`${renderWorkbenchSignalsSurface(
        [],
        { onOpenStewardSuggestion },
        { text: "5 处知识待关注", kind: "attention", source: "template" },
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__steward-bar")).toBeFalsy();
    expect(onOpenStewardSuggestion).not.toHaveBeenCalled();
  });

  it("shows schedule entries without requiring expand click", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface([scheduleCard], { onOpenCron: vi.fn() }, null, [
        {
          id: "a",
          title: "Standup",
          startAtMs: Date.now() + 30 * 60_000,
          kind: "personal",
          cronDerived: false,
        },
        {
          id: "c",
          title: "Cron",
          startAtMs: Date.now() + 2 * 60 * 60_000,
          kind: "cron-derived",
          cronDerived: true,
        },
      ])}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelectorAll(".employee-workbench__signal-card-entry").length).toBe(2);
    expect(container.querySelector(".employee-workbench__signal-card-primary")).toBeFalsy();
  });

  it("entry rows route through onOpenSignalEntry without expanding", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onOpenSignalEntry = vi.fn();
    const onOpenAssistantSettings = vi.fn();

    render(
      html`${renderWorkbenchSignalsSurface(
        [
          {
            ...todosCardBase,
            badgeCount: 1,
            entries: [{ id: "governance:deliv-1", title: "待治理成果", origin: "task" }],
          },
        ],
        { onOpenAssistantSettings, onOpenSignalEntry },
      )}`,
      container,
    );
    await Promise.resolve();

    const entry = container.querySelector(".employee-workbench__signal-card-entry") as HTMLElement;
    expect(entry).toBeTruthy();
    entry.click();
    expect(onOpenSignalEntry).toHaveBeenCalledWith("todos", "governance:deliv-1");
    expect(onOpenAssistantSettings).not.toHaveBeenCalled();
  });

  it("sorts todos by urgency in a flat list with origin chips", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [
          {
            ...todosCardBase,
            badgeCount: 3,
            entries: [
              { id: "task:1", title: "审批预算", origin: "task" },
              { id: "g1", title: "产品组", origin: "collaboration" },
              {
                id: "meeting:invite-review",
                title: "Meeting invites",
                origin: "meeting-notice",
              },
            ],
          },
        ],
        { onOpenAssistantSettings: vi.fn() },
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__signal-card-partition")).toBeFalsy();
    const titles = Array.from(
      container.querySelectorAll(".employee-workbench__signal-card-entry-title"),
      (node) => node.textContent?.trim(),
    );
    expect(titles[0]).toContain("Meeting invites");
    expect(container.querySelectorAll(".employee-workbench__signal-card-entry-origin").length).toBe(
      3,
    );
  });

  it("omits the origin chip when the title already starts with that label", async () => {
    expect(shouldShowTodosOriginChip("知识库有 8 处冲突待解决", "Knowledge", "knowledge")).toBe(
      false,
    );
    expect(shouldShowTodosOriginChip("知識庫有 8 处冲突待解决", "知识库", "knowledge")).toBe(false);
    expect(shouldShowTodosOriginChip("审批预算", "任务", "task")).toBe(true);

    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`${renderWorkbenchSignalsSurface(
        [
          {
            ...todosCardBase,
            badgeCount: 1,
            entries: [{ id: "k1", title: "知识库有 8 处冲突待解决", origin: "knowledge" }],
          },
        ],
        { onOpenAssistantSettings: vi.fn() },
      )}`,
      container,
    );
    await Promise.resolve();
    expect(container.querySelector(".employee-workbench__signal-card-entry-origin")).toBeNull();
    expect(container.textContent).toContain("知识库有 8 处冲突待解决");
  });

  it("does not render a separate next-up bar", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const now = Date.now();

    render(
      html`${renderWorkbenchSignalsSurface(
        [
          scheduleCard,
          {
            ...todosCardBase,
            badgeCount: 2,
            entries: [{ id: "task:1", title: "Later task", origin: "task" }],
          },
        ],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        null,
        [
          {
            id: "soon",
            title: "Standup",
            startAtMs: now + 20 * 60_000,
            kind: "personal",
            cronDerived: false,
          },
        ],
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__signals-next-up")).toBeFalsy();
  });

  it("keeps the signals strip visible with empty states when both lists are empty", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [scheduleCard, todosCardBase],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        null,
        [],
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelector(".employee-workbench__signals-overview")).toBeTruthy();
    expect(container.querySelectorAll(".employee-workbench__signal-card").length).toBe(2);
  });

  it("shows schedule entries and todos empty state side by side", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [scheduleCard, todosCardBase],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        null,
        [
          {
            id: "price-check",
            title: "竞品价格巡检",
            startAtMs: Date.now() + 60 * 60_000,
            kind: "cron-derived",
            cronDerived: true,
          },
        ],
      )}`,
      container,
    );
    await Promise.resolve();

    expect(container.querySelectorAll(".employee-workbench__signal-card--parallel").length).toBe(2);
    expect(container.textContent).toContain("竞品价格巡检");
    const emptyCard = container.querySelector(".employee-workbench__signal-card--empty");
    expect(emptyCard).toBeTruthy();
    expect(emptyCard?.textContent).toContain(todosCardBase.primary);
  });

  it("shows card titles in the rail with horizontal layout for Latin copy", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [
          { ...scheduleCard, title: "Today's Schedule" },
          {
            ...todosCardBase,
            title: "To-do Items",
            badgeCount: 1,
            entries: [{ id: "task:1", title: "审批", origin: "task" }],
          },
        ],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        null,
        [],
      )}`,
      container,
    );
    await Promise.resolve();

    const rails = Array.from(
      container.querySelectorAll(".employee-workbench__signal-card-rail-label"),
      (node) => node.textContent?.trim(),
    );
    expect(rails).toEqual(["Today's Schedule", "To-do Items"]);
    expect(
      container.querySelectorAll(".employee-workbench__signal-card-rail-label--horizontal").length,
    ).toBe(2);
    expect(container.querySelectorAll(".employee-workbench__signal-card-title").length).toBe(0);
  });

  it("lists schedule entries beside the rail without a summary row", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [scheduleCard, todosCardBase],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        null,
        [
          {
            id: "price-check",
            title: "竞品价格巡检",
            startAtMs: Date.now() + 60 * 60_000,
            kind: "cron-derived",
            cronDerived: true,
          },
        ],
      )}`,
      container,
    );
    await Promise.resolve();

    const scheduleCardEl = container.querySelector(".employee-workbench__signal-card--parallel");
    expect(scheduleCardEl?.querySelector(".employee-workbench__signal-card-main")).toBeTruthy();
    expect(scheduleCardEl?.querySelector(".employee-workbench__signal-card-head")).toBeFalsy();
    const main = scheduleCardEl?.querySelector(".employee-workbench__signal-card-main");
    expect(main?.querySelector(".employee-workbench__signal-section-summary")).toBeFalsy();
    expect(main?.querySelector(".employee-workbench__signal-card-entry--timed")).toBeTruthy();
    expect(
      main?.querySelector(".employee-workbench__signal-card-entry-meta")?.textContent,
    ).toBeTruthy();
    expect(
      main?.querySelector(".employee-workbench__signal-card-entry-title")?.textContent,
    ).toContain("竞品价格巡检");
  });

  it("keeps both cards at equal width when only one list has content", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [
          scheduleCard,
          {
            ...todosCardBase,
            badgeCount: 1,
            entries: [{ id: "task:1", title: "审批", origin: "task" }],
          },
        ],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        null,
        [],
      )}`,
      container,
    );
    await Promise.resolve();

    expect(
      container.querySelector(".employee-workbench__signals-grid--schedule-collapsed"),
    ).toBeFalsy();
    expect(
      container.querySelector(".employee-workbench__signals-grid--todos-collapsed"),
    ).toBeFalsy();
    expect(container.querySelectorAll(".employee-workbench__signal-card--parallel").length).toBe(2);
    expect(container.querySelector(".employee-workbench__signal-card--empty")).toBeTruthy();
    expect(
      container.querySelector(".employee-workbench__signal-card--empty")?.textContent,
    ).toContain(scheduleCard.primary);
  });

  it("only keeps future schedule entries and excludes past records", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface([scheduleCard], { onOpenCron: vi.fn() }, null, [
        {
          id: "soon",
          title: "Upcoming",
          startAtMs: Date.now() + 10 * 60_000,
          kind: "personal",
          cronDerived: false,
        },
        {
          id: "past",
          title: "Past",
          startAtMs: Date.now() - 10 * 60_000,
          kind: "personal",
          cronDerived: false,
        },
      ])}`,
      container,
    );
    await Promise.resolve();

    const titles = Array.from(
      container.querySelectorAll(".employee-workbench__signal-card-entry-title"),
      (node) => node.textContent?.trim(),
    );
    expect(titles).toContain("Upcoming");
    expect(titles).not.toContain("Past");
  });

  it("shows two parallel cards simultaneously for schedule and todos", async () => {
    const container = document.createElement("div");
    document.body.append(container);

    render(
      html`${renderWorkbenchSignalsSurface(
        [
          scheduleCard,
          {
            ...todosCardBase,
            badgeCount: 1,
            entries: [{ id: "task:1", title: "审批", origin: "task" }],
          },
        ],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        null,
        [
          {
            id: "soon",
            title: "Standup",
            startAtMs: Date.now() + 20 * 60_000,
            kind: "personal",
            cronDerived: false,
          },
        ],
      )}`,
      container,
    );
    await Promise.resolve();

    const grid = container.querySelector(".employee-workbench__signals-grid--parallel");
    expect(grid).toBeTruthy();
    expect(grid?.querySelectorAll(".employee-workbench__signal-card--parallel").length).toBe(2);
    expect(container.querySelector(".employee-workbench__signal-card-viewall")).toBeFalsy();
    expect(container.querySelector(".employee-workbench__signal-card-pill")).toBeFalsy();
  });

  it("keeps long todo lists inside the scrollable card body without dropping entries", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const manyTodos = Array.from({ length: 8 }, (_, index) => ({
      id: `task:${index + 1}`,
      title: `待办事项 ${index + 1}`,
      origin: "task" as const,
    }));

    render(
      html`${renderWorkbenchSignalsSurface(
        [
          scheduleCard,
          {
            ...todosCardBase,
            badgeCount: manyTodos.length,
            entries: manyTodos,
          },
        ],
        { onOpenCron: vi.fn(), onOpenAssistantSettings: vi.fn() },
        null,
        [
          {
            id: "soon",
            title: "Standup",
            startAtMs: Date.now() + 20 * 60_000,
            kind: "personal",
            cronDerived: false,
          },
        ],
      )}`,
      container,
    );
    await Promise.resolve();

    const cards = container.querySelectorAll(".employee-workbench__signal-card--parallel");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.querySelector(".employee-workbench__signal-card-body")).toBeTruthy();
    }
    const todosCard = cards[1];
    const todosBody = todosCard?.querySelector(".employee-workbench__signal-card-body");
    expect(todosBody?.querySelectorAll(".employee-workbench__signal-card-entry").length).toBe(8);
    expect(container.textContent).toContain("待办事项 8");
  });
});
