// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderEnterpriseMemoryGovernancePanel } from "./enterprise-memory-governance-surface.ts";

describe("renderEnterpriseMemoryGovernancePanel", () => {
  it("shows privacy note and org scopes without private content", () => {
    const container = document.createElement("div");
    render(
      renderEnterpriseMemoryGovernancePanel({
        privacyNote: "仅展示岗位/组织记忆范围元数据；员工私人记忆对管理员不可见。",
        seats: [
          {
            seatId: "seat_ops",
            title: "运营岗",
            scopes: [
              { scopeId: "seat:seat_ops", transferClass: "inheritable" },
              { scopeId: "project-crm-notes", transferClass: "review_required" },
            ],
          },
        ],
      }),
      container,
    );
    expect(container.textContent).toContain("记忆范围治理");
    expect(container.textContent).toContain("员工私人记忆对管理员不可见");
    expect(container.textContent).toContain("运营岗");
    expect(container.textContent).toContain("可继承");
    expect(container.textContent).toContain("需复核");
    expect(container.textContent).not.toMatch(
      /atom|transcript|embedding|salary|private memory body/i,
    );
  });

  it("shows empty state when no seats", () => {
    const container = document.createElement("div");
    render(renderEnterpriseMemoryGovernancePanel({ seats: [] }), container);
    expect(container.textContent).toContain("暂无岗位记忆范围配置");
  });
});
