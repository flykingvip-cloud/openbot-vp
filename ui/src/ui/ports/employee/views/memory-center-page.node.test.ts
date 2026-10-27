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
      "仅删除所选文件，不会清除其他来源中的相同内容，也不保证立即停止相关召回",
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
