// @vitest-environment jsdom

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderDeleteConfirmPanel, renderDraftEditorPanel } from "./plan-version-panels.ts";

describe("plan-version-panels", () => {
  it("renders delete confirm panel shell", () => {
    const container = document.createElement("div");
    render(
      renderDeleteConfirmPanel({
        versionNumber: 3,
        busy: false,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    expect(container.querySelector('[data-testid="delete-confirm"]')).toBeTruthy();
    expect(container.textContent).toContain("删除版本 · v3");
    expect(container.textContent).toContain("确认删除");
  });

  it("renders draft editor panel shell with injected subviews", () => {
    const container = document.createElement("div");
    render(
      renderDraftEditorPanel({
        rows: [{ type: "seat", key: "viewer", priceYuan: "10" }],
        busy: false,
        title: "编辑草稿",
        modelsLabel: "可用模型",
        aorLabel: "AOR 执行",
        saveLabel: "保存草稿",
        cancelLabel: "取消",
        onPriceInput: vi.fn(),
        modelLibraryContent: "models" as never,
        aorEnableContent: "enable" as never,
        aorFieldsContent: "fields" as never,
        entitlementContent: "entitlement" as never,
        onSave: vi.fn(),
        onCancel: vi.fn(),
      }),
      container,
    );

    expect(container.querySelector('[data-testid="draft-editor"]')).toBeTruthy();
    expect(container.textContent).toContain("编辑草稿");
    expect(container.textContent).toContain("viewer");
    expect(container.textContent).toContain("保存草稿");
  });
});
