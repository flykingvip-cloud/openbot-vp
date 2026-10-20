// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { EnterpriseAuthorizationView } from "../capability/model-authorization/view-model.ts";
import {
  renderModelAuthorizationPanel,
  type ModelAuthorizationPanelProps,
} from "./model-authorization-panel.ts";

function mount(props: ModelAuthorizationPanelProps): HTMLDivElement {
  const container = document.createElement("div");
  render(renderModelAuthorizationPanel(props), container);
  return container;
}

const baseView: EnterpriseAuthorizationView = {
  hasEntitlement: true,
  entitlementModelIds: ["p/a", "p/b"],
  notice: null,
  subjects: [
    {
      subjectType: "seat",
      subjectId: "seat-1",
      seatId: "seat-1",
      status: "active",
      rows: [
        { modelId: "p/a", withinEntitlement: true, granted: true },
        { modelId: "p/b", withinEntitlement: true, granted: false },
      ],
    },
  ],
};

describe("renderModelAuthorizationPanel (browser)", () => {
  it("无 entitlement 时展示引导文案", async () => {
    const container = mount({
      view: { hasEntitlement: false, entitlementModelIds: [], notice: "请联系平台", subjects: [] },
      onToggleModel: () => undefined,
      onRevokeSubject: () => undefined,
    });
    await Promise.resolve();
    expect(container.textContent ?? "").toContain("请联系平台");
  });

  it("勾选未授权模型触发 onToggleModel(granted=true)", async () => {
    const onToggleModel = vi.fn();
    const container = mount({
      view: baseView,
      onToggleModel,
      onRevokeSubject: () => undefined,
    });
    await Promise.resolve();
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    // 第二行 p/b 未授权
    const pb = checkboxes[1];
    expect(pb.checked).toBe(false);
    pb.checked = true;
    pb.dispatchEvent(new Event("change"));
    expect(onToggleModel).toHaveBeenCalledTimes(1);
    const call = onToggleModel.mock.calls[0];
    expect(call[1]).toBe("p/b");
    expect(call[2]).toBe(true);
  });

  it("撤销按钮触发 onRevokeSubject", async () => {
    const onRevokeSubject = vi.fn();
    const container = mount({
      view: baseView,
      onToggleModel: () => undefined,
      onRevokeSubject,
    });
    await Promise.resolve();
    const revokeBtn = container.querySelector<HTMLButtonElement>("button.danger")!;
    revokeBtn.click();
    expect(onRevokeSubject).toHaveBeenCalledTimes(1);
  });

  it("预览标题优先使用目录人名，缺省时回退到主体 id", async () => {
    const named = mount({
      view: baseView,
      previewTitle: "Owner",
      previewMeta: "Sales Lead",
      onToggleModel: () => undefined,
      onRevokeSubject: () => undefined,
    });
    await Promise.resolve();
    expect(named.querySelector(".model-auth-preview__title")?.textContent?.trim()).toBe(
      "Owner · Sales Lead",
    );
    expect(named.querySelector(".model-auth-preview__title")?.getAttribute("title")).toContain(
      "seat-1",
    );
    expect(named.querySelector(".model-auth-preview__sub")).toBeNull();

    const fallback = mount({
      view: baseView,
      onToggleModel: () => undefined,
      onRevokeSubject: () => undefined,
    });
    await Promise.resolve();
    expect(fallback.querySelector(".model-auth-preview__title")?.textContent?.trim()).toBe(
      "席位 · seat-1",
    );
  });

  it("busy 时禁用复选框", async () => {
    const container = mount({
      view: baseView,
      busy: true,
      onToggleModel: () => undefined,
      onRevokeSubject: () => undefined,
    });
    await Promise.resolve();
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect([...checkboxes].every((c) => c.disabled)).toBe(true);
  });
});
