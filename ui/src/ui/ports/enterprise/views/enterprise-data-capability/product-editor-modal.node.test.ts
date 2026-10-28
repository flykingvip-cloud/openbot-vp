// @vitest-environment jsdom
import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ManagedConnectorActionRecord,
  ManagedDataSourceRecord,
} from "../../../../capability/enterprise-data-capability/types.ts";
import type { EnterprisePortReadModel } from "../../semantic/enterprise-read-model.ts";
import { renderCapabilityEditorModal, type CapabilityEditorState } from "./product-editor-modal.ts";
import { actionRefToken, PRODUCT_WIZARD_SOURCE_ACTION_PRUNED_MESSAGE } from "./product-wizard.ts";

const crmAction: ManagedConnectorActionRecord = {
  connectorId: "crm-salesforce",
  actionKey: "crm.customer.export",
  version: "v1",
  displayName: "客户导出",
  category: "crm",
  lifecycle: "active",
  riskLevel: "HIGH",
  readOnly: true,
};

const yonyouAction: ManagedConnectorActionRecord = {
  connectorId: "erp-yonyou-tplus",
  actionKey: "erp.voucher.list",
  version: "v1",
  displayName: "凭证列表",
  category: "erp",
  lifecycle: "active",
  riskLevel: "LOW",
  readOnly: true,
};

const sources: ManagedDataSourceRecord[] = [
  {
    sourceId: "sf",
    sourceKey: "crm-salesforce",
    displayName: "Salesforce CRM",
    category: "crm",
    status: "connected",
    connectorId: "crm-salesforce",
    updatedAt: "2026-10-28T00:00:00.000Z",
  },
  {
    sourceId: "yy",
    sourceKey: "erp-yonyou-tplus",
    displayName: "用友 T+",
    category: "erp",
    status: "connected",
    connectorId: "erp-yonyou-tplus",
    updatedAt: "2026-10-28T00:00:00.000Z",
  },
];

afterEach(() => {
  document.body.replaceChildren();
});

function editorState(patch: Partial<CapabilityEditorState> = {}): CapabilityEditorState {
  return {
    open: true,
    wizardStep: 2,
    outputMode: "direct",
    projectionTemplateKey: "",
    capabilityId: null,
    capabilityKey: "customer_export",
    displayName: "客户导出产品",
    description: "",
    sourceIds: new Set(["yy"]),
    actionRefTokens: new Set(),
    enabled: true,
    busy: false,
    error: null,
    ...patch,
  };
}

function mount(
  state: CapabilityEditorState,
  onUpdate: (patch: Partial<CapabilityEditorState>) => void,
) {
  const container = document.createElement("div");
  document.body.append(container);
  render(
    html`${renderCapabilityEditorModal(
      state,
      sources,
      [crmAction, yonyouAction],
      {
        seatCount: 0,
        readModel: {} as EnterprisePortReadModel,
        seatIds: new Set(["seat-ceo"]),
        departmentPaths: new Set(),
        seatQuery: "",
        onToggleSeat: () => undefined,
        onToggleDepartment: () => undefined,
        onRemoveSeat: () => undefined,
        onRemoveDepartment: () => undefined,
        onClearAll: () => undefined,
        onSeatQueryChange: () => undefined,
      },
      () => undefined,
      () => undefined,
      onUpdate,
      () => undefined,
      () => undefined,
    )}`,
    container,
  );
  return container;
}

describe("product editor source/action alignment", () => {
  it("offers only actions whose connector matches the selected sources", () => {
    const container = mount(editorState(), vi.fn());
    const text = container.textContent ?? "";
    expect(text).toContain("凭证列表");
    expect(text).not.toContain("客户导出");
    expect(text).toContain("同一连接器");
  });

  it("hides actions until a data source is selected", () => {
    const container = mount(editorState({ sourceIds: new Set() }), vi.fn());
    const text = container.textContent ?? "";
    expect(text).toContain("请先勾选数据源，再选择同一连接器下的动作。");
    expect(text).not.toContain("客户导出");
    expect(text).not.toContain("凭证列表");
  });

  it("shows Chinese guidance when a selected action is outside the linked connectors", () => {
    const container = mount(
      editorState({
        wizardStep: 4,
        actionRefTokens: new Set([actionRefToken(crmAction)]),
      }),
      vi.fn(),
    );
    const notice = container.querySelector(".enterprise-org-modal__notice--danger");
    expect(notice?.textContent).toContain("客户导出");
    expect(notice?.textContent).toContain("连接器不一致");
    expect(notice?.textContent).not.toContain("must align with a linked DataSource");
  });

  it("clears incompatible actions when the matching source is unchecked", () => {
    const onUpdate = vi.fn();
    const container = mount(
      editorState({
        sourceIds: new Set(["sf"]),
        actionRefTokens: new Set([actionRefToken(crmAction)]),
      }),
      onUpdate,
    );
    const salesforceRow = [...container.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("Salesforce CRM"),
    );
    const checkbox = salesforceRow?.querySelector("input");
    expect(checkbox).toBeTruthy();
    checkbox?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceIds: new Set(),
        actionRefTokens: new Set(),
        error: PRODUCT_WIZARD_SOURCE_ACTION_PRUNED_MESSAGE,
      }),
    );
  });
});
