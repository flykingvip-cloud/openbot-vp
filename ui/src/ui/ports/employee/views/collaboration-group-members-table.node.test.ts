// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { renderCollaborationGroupMembersTable } from "./collaboration-group-members-table.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("renderCollaborationGroupMembersTable", () => {
  it("renders four columns for members", () => {
    const container = document.createElement("div");
    render(
      html`${renderCollaborationGroupMembersTable([
        {
          memberId: "u1",
          kind: "human",
          name: "Alice",
          identity: "群主",
          duty: "拍板",
          contribution: 40,
          lastActiveAt: Date.now() - 60_000,
        },
        {
          memberId: "bot-1",
          kind: "bot",
          name: "助手",
          identity: "主负责人",
          duty: "协调",
          contribution: 60,
          lastActiveAt: null,
        },
      ])}`,
      container,
    );
    expect(container.textContent).toContain("身份");
    expect(container.textContent).toContain("职责");
    expect(container.textContent).toContain("贡献度");
    expect(container.textContent).toContain("最近活跃");
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("40");
    expect(container.textContent).toContain("群主");
    expect(container.querySelector(".employee-workbench__group-members-table")).toBeTruthy();
    expect(container.querySelectorAll("thead th")).toHaveLength(5);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(
      container.querySelector(".employee-workbench__group-members-pill")?.textContent,
    ).toContain("群主");
  });
});
