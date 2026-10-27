// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderMemoryCenterPanel } from "./memory-center-page.ts";

describe("renderMemoryCenterPanel", () => {
  it("shows managed hosting copy without forget actions", () => {
    const container = document.createElement("div");
    render(renderMemoryCenterPanel({} as never, { mode: "managed" }), container);
    expect(container.textContent).toContain("隐私与记忆");
    expect(container.textContent).toContain("云端托管");
    expect(container.textContent).not.toContain("查看机器人记住了什么");
    expect(container.textContent).not.toContain("删除此记忆文件");
  });

  it("renders view/delete loop for local memory entries", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel(
        {
          robotEntries: [{ id: "main", name: "大白管家", emoji: "🐻", source: "owned" }],
          groupEntries: [],
          onMemoryCenterAgentIdChange: () => undefined,
          onMemoryCenterKeyChange: () => undefined,
          onMemoryCenterAtomIdChange: () => undefined,
          onMemoryCenterForget: () => undefined,
        } as never,
        {
          mode: "local",
          agentId: "main",
          selectedKey: "notes/idea.md",
          entries: [
            {
              key: "notes/idea.md",
              label: "idea.md",
              bytes: 2048,
              updatedAtMs: 1_700_000_000_000,
            },
          ],
        },
      ),
      container,
    );
    expect(container.textContent).toContain("大白管家");
    expect(container.textContent).toContain("idea.md");
    expect(container.textContent).toContain("删除此记忆文件");
    const forgetBtn = Array.from(container.querySelectorAll("button")).find((button) =>
      (button.textContent ?? "").includes("删除此记忆文件"),
    );
    expect(forgetBtn?.getAttribute("title")).toBe(
      "仅删除工作区已索引记忆语料中的所选文件（MEMORY.md / memory/**），不会清除会话或其他来源中的相同内容，也不保证立即停止相关召回",
    );
    expect(container.textContent).not.toMatch(/canonical|sqlite|embedding|FTS|journal/i);
  });

  it("renders atom summaries without store internals", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel(
        {
          robotEntries: [{ id: "main", name: "大白管家", source: "owned" }],
          groupEntries: [],
          onMemoryCenterAtomIdChange: () => undefined,
        } as never,
        {
          mode: "local",
          agentId: "main",
          selectedAtomId: "atom_1",
          viewMode: "atoms",
          atoms: [
            {
              id: "atom_1",
              summary: "Prefer async retries under latency",
              atomType: "strategy",
              whyHint: "high latency",
              scope: { kind: "agent", visibility: "private", agentId: "main" },
              botId: "main",
              syncEligible: false,
              shared: false,
              status: "active",
              updatedAtMs: 1_700_000_000_000,
            },
          ],
        },
      ),
      container,
    );
    expect(container.textContent).toContain("Prefer async retries under latency");
    expect(container.textContent).toContain("记忆要点");
    expect(container.textContent).not.toContain("删除此记忆文件");
    expect(container.textContent).not.toMatch(/provenance|evidenceRef|embedding|journal|sqlite/i);
  });

  it("prompts to pick a robot before listing", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel(
        {
          robotEntries: [{ id: "main", name: "大白管家", source: "owned" }],
          groupEntries: [],
        } as never,
        { mode: "local", agentId: "" },
      ),
      container,
    );
    expect(container.textContent).toContain("请先选择机器人");
    expect(container.textContent).not.toContain("不会展示底层存储");
  });
});

describe("O5 file-delete copy contract", () => {
  it("uses file-scoped delete wording on the file detail action only", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel(
        {
          robotEntries: [{ id: "main", name: "大白管家", emoji: "🐻", source: "owned" }],
          groupEntries: [],
          onMemoryCenterForget: () => undefined,
        } as never,
        {
          mode: "local",
          agentId: "main",
          selectedKey: "notes/idea.md",
          message: "已删除所选记忆文件",
          entries: [
            {
              key: "notes/idea.md",
              label: "idea.md",
              bytes: 128,
              updatedAtMs: 1_700_000_000_000,
            },
          ],
          atoms: [
            {
              id: "atom_1",
              summary: "atom only",
              atomType: "strategy",
              scope: { kind: "agent", visibility: "private", agentId: "main" },
              botId: "main",
              syncEligible: false,
              shared: false,
              status: "active",
              updatedAtMs: 1_700_000_000_000,
            },
          ],
          selectedAtomId: "atom_1",
        },
      ),
      container,
    );
    expect(container.textContent).toContain("删除此记忆文件");
    expect(container.textContent).toContain("已删除所选记忆文件");
    expect(container.textContent).not.toContain("忘记这条记忆");
    expect(container.textContent).not.toContain("已忘记这条记忆");
    // Atom detail is selected too, but delete remains a file action only (one button).
    const deleteButtons = Array.from(container.querySelectorAll("button")).filter((button) =>
      (button.textContent ?? "").includes("删除此记忆文件"),
    );
    expect(deleteButtons).toHaveLength(1);
  });
});

describe("O4 candidate status view (C1–C6 UI)", () => {
  const baseSettings = {
    robotEntries: [{ id: "main", name: "大白管家", source: "owned" }],
    groupEntries: [],
    onMemoryCenterStatusViewChange: () => undefined,
    onMemoryCenterAtomIdChange: () => undefined,
  } as never;

  it("C1: default active view with only tentative elsewhere shows candidate hint empty-state", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel(baseSettings, {
        mode: "local",
        agentId: "main",
        statusView: "active",
        atoms: [],
        entries: [],
        otherViewTotal: 2,
      }),
      container,
    );
    expect(container.textContent).toContain("已确认");
    expect(container.textContent).toContain("候选（待确认）");
    expect(container.textContent).toContain("可切换到「候选（待确认）」查看待确认项");
    expect(container.textContent).not.toContain("待确认的候选记忆");
  });

  it("C2: tentative view shows rows with 待确认 badge and detail status", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel(baseSettings, {
        mode: "local",
        agentId: "main",
        statusView: "tentative",
        selectedAtomId: "atom_t",
        atoms: [
          {
            id: "atom_t",
            summary: "maybe prefer dark mode",
            atomType: "preference",
            scope: { kind: "agent", visibility: "private", agentId: "main" },
            botId: "main",
            syncEligible: false,
            shared: false,
            status: "tentative",
            updatedAtMs: 1_700_000_000_000,
          },
        ],
      }),
      container,
    );
    expect(container.textContent).toContain("maybe prefer dark mode");
    expect(container.textContent).toContain("待确认");
    expect(container.textContent).toContain("候选 ·");
    // Filter tab selected
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const candidate = tabs.find((tab) => (tab.textContent ?? "").includes("候选"));
    expect(candidate?.getAttribute("aria-selected")).toBe("true");
  });

  it("C3: unbound atomListError is explicit (not fake empty copy)", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel(baseSettings, {
        mode: "local",
        agentId: "main",
        statusView: "tentative",
        atoms: [],
        entries: [],
        atomListError: {
          code: "MEMORY_SUBJECT_UNBOUND",
          message: "unbound",
        },
      }),
      container,
    );
    expect(container.textContent).toContain("尚未绑定记忆主体");
    expect(container.textContent).not.toContain("暂无待确认的候选记忆");
  });

  it("C4: active view lists only confirmed atoms without tentative badge", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel(baseSettings, {
        mode: "local",
        agentId: "main",
        statusView: "active",
        atoms: [
          {
            id: "atom_a",
            summary: "confirmed preference",
            atomType: "preference",
            scope: { kind: "agent", visibility: "private", agentId: "main" },
            botId: "main",
            syncEligible: false,
            shared: false,
            status: "active",
            updatedAtMs: 1_700_000_000_000,
          },
        ],
      }),
      container,
    );
    expect(container.textContent).toContain("confirmed preference");
    // Filter tab label includes「待确认」, but confirmed rows must not carry the badge.
    expect(container.querySelector(".employee-workbench__memory-badge")).toBeNull();
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const confirmed = tabs.find((tab) => (tab.textContent ?? "").trim() === "已确认");
    expect(confirmed?.getAttribute("aria-selected")).toBe("true");
  });

  it("C5: managed mode still hides local memory center actions", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel({} as never, { mode: "managed", statusView: "tentative" }),
      container,
    );
    expect(container.textContent).toContain("云端托管");
    expect(container.textContent).not.toContain("候选（待确认）");
    expect(container.textContent).not.toContain("删除此记忆文件");
  });

  it("C6: tentative empty-state copy does not imply confirmed memories", () => {
    const container = document.createElement("div");
    render(
      renderMemoryCenterPanel(baseSettings, {
        mode: "local",
        agentId: "main",
        statusView: "tentative",
        atoms: [],
        entries: [],
        otherViewTotal: 3,
      }),
      container,
    );
    expect(container.textContent).toContain("暂无待确认的候选记忆");
    expect(container.textContent).not.toContain("可切换到「候选（待确认）」查看待确认项");
  });
});
