// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderSaveSkillModal } from "./save-skill-modal.ts";

describe("renderSaveSkillModal", () => {
  it("renders the quick save flow with only name and summary inputs", () => {
    const container = document.createElement("div");
    render(
      renderSaveSkillModal({
        open: true,
        busy: false,
        error: null,
        formData: {
          name: "合同审查",
          summary: "检查合同中的风险条款",
          assetType: "capability",
        },
        extractedPreview: {
          suggestedName: "合同审查",
          suggestedSummary: "",
          confidence: 0.82,
          detectedAt: null,
        },
        availableGroups: [],
        showEnterpriseSubmitAction: false,
        onFormChange: vi.fn(),
        onSave: vi.fn(),
        onSaveAndSubmit: vi.fn(),
        onClose: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("整理为资产草稿");
    expect(container.textContent).not.toContain("检测到可资产化内容");
    expect(container.textContent).not.toContain("系统已给出初步建议");
    expect(container.querySelector(".employee-workbench__creator-panel-kicker")).toBeNull();
    expect(container.querySelector(".employee-workbench__creator-panel-sub")).toBeNull();
    expect(container.textContent).toContain("资产名称");
    expect(container.textContent).toContain("一句话说明");
    expect(container.querySelector(".quick-save-dialog__backdrop")).toBeFalsy();
    expect(container.querySelector(".quick-save-panel")).toBeTruthy();
    expect(container.textContent).toContain("返回我的资产");
    expect(container.textContent).not.toContain("适合沉淀被反复引用的知识内容");
    expect(container.textContent).not.toContain("绑定工具");
    expect(container.textContent).not.toContain("MCP 服务名");
    expect(container.querySelector(".quick-save-panel__options")).toBeNull();
    expect(container.textContent).not.toContain("Prompt");
    expect(container.textContent).not.toContain("工作流");
    expect(container.textContent).not.toContain("工具链");
    expect(container.textContent).not.toContain("模型偏好");
  });

  it("does not render when closed", () => {
    const container = document.createElement("div");
    render(
      renderSaveSkillModal({
        open: false,
        busy: false,
        error: null,
        formData: null,
        extractedPreview: null,
        availableGroups: [],
        showEnterpriseSubmitAction: false,
        onFormChange: vi.fn(),
        onSave: vi.fn(),
        onSaveAndSubmit: vi.fn(),
        onClose: vi.fn(),
      }),
      container,
    );

    expect(container.textContent?.trim()).toBe("");
  });

  it("matches the primary action label to draft enrollment", () => {
    const container = document.createElement("div");
    render(
      renderSaveSkillModal({
        open: true,
        busy: false,
        error: null,
        formData: {
          name: "合同审查",
          summary: "检查合同中的风险条款",
          assetType: "template",
        },
        extractedPreview: null,
        availableGroups: [],
        showEnterpriseSubmitAction: false,
        onFormChange: vi.fn(),
        onSave: vi.fn(),
        onSaveAndSubmit: vi.fn(),
        onClose: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("纳入资产草稿");
    expect(container.textContent).not.toContain("模版");
  });

  it("renders the enterprise submission shortcut when the draft looks like a reusable package", () => {
    const container = document.createElement("div");
    render(
      renderSaveSkillModal({
        open: true,
        busy: false,
        error: null,
        formData: {
          name: "公众号文章编辑与发布",
          summary: "通过脚本、凭证和审核流程把文章推进到公众号草稿箱",
          assetType: "workflow",
        },
        extractedPreview: {
          suggestedName: "公众号文章编辑与发布",
          suggestedSummary: "整理并提交企业资产包",
          confidence: 0.91,
          detectedAt: null,
        },
        availableGroups: [],
        showEnterpriseSubmitAction: true,
        onFormChange: vi.fn(),
        onSave: vi.fn(),
        onSaveAndSubmit: vi.fn(),
        onClose: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("整理完成并提交企业资产包");
    expect(container.textContent).not.toContain("系统判断这项内容");
  });

  it("does not ask the user to classify Tool or MCP", () => {
    const container = document.createElement("div");
    render(
      renderSaveSkillModal({
        open: true,
        busy: false,
        error: null,
        formData: {
          name: "网页检索",
          summary: "让机器人能搜索网页",
        },
        extractedPreview: null,
        availableGroups: [],
        showEnterpriseSubmitAction: false,
        onFormChange: vi.fn(),
        onSave: vi.fn(),
        onSaveAndSubmit: vi.fn(),
        onClose: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).not.toContain("绑定工具");
    expect(container.textContent).not.toContain("MCP 服务名");
    expect(container.textContent).not.toContain("启动命令");
    expect(container.querySelectorAll("input, textarea")).toHaveLength(2);
  });
});
