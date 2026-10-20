// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { scanNode } from "../capability/employee-capability/terminology-filter.ts";
import { renderQuickCapabilitySaveModal } from "./quick-capability-save-modal.ts";

describe("renderQuickCapabilitySaveModal", () => {
  it("renders the reusable capability hint and the two-field form", () => {
    const container = document.createElement("div");
    render(
      renderQuickCapabilitySaveModal({
        open: true,
        busy: false,
        error: null,
        formData: { name: "合同审查", summary: "识别合同中的风险条款" },
        patternHint: {
          sampleTaskDescription: "客户给我发了一份合同，需要帮我看看风险",
          firstFormedScenario: "首次在供应商合同处理时形成",
        },
        onFormChange: vi.fn(),
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("检测到可复用的能力");
    expect(text).toContain("名称");
    expect(text).toContain("一句话描述");
    expect(text).toContain("保存");
    expect(text).not.toContain("分享到协作小组");
    expect(text).not.toContain("提交到企业资产库");
  });

  it("preserves and emits field changes", () => {
    const container = document.createElement("div");
    const onFormChange = vi.fn();
    render(
      renderQuickCapabilitySaveModal({
        open: true,
        busy: false,
        error: "保存失败，请稍后再试",
        formData: { name: "合同审查", summary: "识别合同中的风险条款" },
        patternHint: null,
        onFormChange,
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      }),
      container,
    );

    const input = container.querySelector("input");
    expect(input?.value).toBe("合同审查");
    input!.value = "合同风险识别";
    input!.dispatchEvent(new InputEvent("input", { bubbles: true }));

    expect(container.textContent).toContain("保存失败，请稍后再试");
    expect(onFormChange).toHaveBeenCalledWith({ name: "合同风险识别" });
  });

  it("passes the employee capability terminology scan", () => {
    const container = document.createElement("div");
    render(
      renderQuickCapabilitySaveModal({
        open: true,
        busy: false,
        error: null,
        formData: { name: "合同审查", summary: "识别合同中的风险条款" },
        patternHint: null,
        onFormChange: vi.fn(),
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      }),
      container,
    );

    expect(() => scanNode(container)).not.toThrow();
  });

  it("renders nothing when closed", () => {
    const container = document.createElement("div");
    render(
      renderQuickCapabilitySaveModal({
        open: false,
        busy: false,
        error: null,
        formData: { name: "", summary: "" },
        patternHint: null,
        onFormChange: vi.fn(),
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toBe("");
  });
});
