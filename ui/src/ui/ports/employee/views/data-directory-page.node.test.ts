// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderDataDirectoryPanel } from "./data-directory-page.ts";

describe("renderDataDirectoryPanel", () => {
  it("shows managed hosting copy without local actions", () => {
    const container = document.createElement("div");
    render(renderDataDirectoryPanel({} as never, { mode: "managed" }), container);
    expect(container.textContent).toContain("云端");
    expect(container.textContent).not.toContain("在 Finder 中显示");
    expect(container.textContent).not.toContain("迁移数据位置");
  });

  it("shows local data directory with migration and export actions", () => {
    const container = document.createElement("div");
    render(
      renderDataDirectoryPanel({} as never, {
        mode: "local",
        displayRoot: "~/OpenBot",
        volumeName: "Macintosh HD",
        usedBytesLabel: "28 GB",
        showFinderReveal: true,
      }),
      container,
    );
    expect(container.textContent).toContain("~/OpenBot");
    expect(container.textContent).toContain("Macintosh HD");
    expect(container.textContent).toContain("28 GB");
    expect(container.textContent).toContain("在 Finder 中显示");
    expect(container.textContent).toContain("迁移数据位置");
    expect(container.textContent).toContain("导出备份");
  });

  it("hides Finder reveal when showFinderReveal is false", () => {
    const container = document.createElement("div");
    render(
      renderDataDirectoryPanel({} as never, {
        mode: "local",
        displayRoot: "~/OpenBot",
        showFinderReveal: false,
      }),
      container,
    );
    expect(container.textContent).not.toContain("在 Finder 中显示");
    expect(container.textContent).toContain("迁移数据位置");
  });

  it("shows privacy controls for forget memory and access grants", () => {
    const container = document.createElement("div");
    render(
      renderDataDirectoryPanel(
        {
          onForgetMemoryEntry: () => undefined,
          onRevokeAccessGrant: () => undefined,
        } as never,
        {
          mode: "local",
          forgetMemoryAgentId: "main",
          forgetMemoryKey: "note.md",
          accessGrants: [
            {
              id: "grant-1",
              agentId: "main",
              resourceType: "knowledge",
              resourcePath: "shared/knowledge/a",
              grantedAt: "2026-07-10T10:00:00Z",
            },
          ],
        },
      ),
      container,
    );
    expect(container.textContent).toContain("忘记此条记忆");
    expect(container.textContent).toContain("撤销授权");
    expect(container.textContent).toContain("shared/knowledge/a");
  });
});
