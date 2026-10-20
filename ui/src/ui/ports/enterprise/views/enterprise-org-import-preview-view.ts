import { html, nothing, render } from "lit";
import type { OrganizationImportPreview } from "./enterprise-org-import-preview.ts";
import { renderEnterpriseOrgTree } from "./enterprise-org-tree-view.ts";

export type OrganizationImportPreviewTab = "tree" | "errors";

export function renderOrganizationImportPreviewPanel(params: {
  preview: OrganizationImportPreview;
  activeTab: OrganizationImportPreviewTab;
  onTabChange: (tab: OrganizationImportPreviewTab) => void;
}) {
  const { preview, activeTab } = params;
  return html`
    <section class="enterprise-org-import-preview">
      <div class="enterprise-org-import-preview__summary">
        <span>共 ${preview.rows.length} 行</span>
        <span>有效 ${preview.validRows.length} 行</span>
        <span class=${preview.errorCount > 0 ? "is-error" : "is-ok"}>
          异常 ${preview.errorCount} 行
        </span>
      </div>
      ${
        preview.structureSyncPlan.paths.length > 0
          ? html`
              <div class="enterprise-org-import-preview__sync-plan">
                <strong>结构对齐</strong>
                <span>${preview.structureSyncPlan.paths.length} 条部门路径</span>
              </div>
            `
          : nothing
      }
      <div class="enterprise-org-import-preview__tabs" role="tablist" aria-label="导入预览">
        <button
          class="enterprise-org-import-preview__tab ${activeTab === "tree" ? "is-active" : ""}"
          type="button"
          role="tab"
          aria-selected=${String(activeTab === "tree")}
          @click=${() => params.onTabChange("tree")}
        >
          结构预览
        </button>
        <button
          class="enterprise-org-import-preview__tab ${activeTab === "errors" ? "is-active" : ""}"
          type="button"
          role="tab"
          aria-selected=${String(activeTab === "errors")}
          @click=${() => params.onTabChange("errors")}
        >
          行级校验
        </button>
      </div>
      ${
        activeTab === "tree"
          ? html`
              <div class="enterprise-org-import-preview__tree" role="tabpanel">
                ${renderEnterpriseOrgTree({
                  departments: preview.tree,
                  mode: "navigate",
                  title: "导入后组织结构",
                  hint: "部门 → 岗位 → 成员",
                  autoExpandAll: preview.tree.length <= 6,
                  emptyLabel: "没有可预览的有效组织记录。",
                })}
              </div>
            `
          : html`
              <div class="enterprise-org-import-preview__table" role="tabpanel">
                <div class="enterprise-org-import-preview__table-head">
                  <span>行号</span>
                  <span>部门</span>
                  <span>岗位</span>
                  <span>成员</span>
                  <span>状态</span>
                </div>
                ${
                  preview.rows.length
                    ? preview.rows.map(
                        (row) => html`
                          <div
                            class="enterprise-org-import-preview__table-row enterprise-org-import-preview__table-row--${row.status}"
                          >
                            <span>${row.rowNumber}</span>
                            <span>${row.teamLabel || "—"}</span>
                            <span>${row.seatTitle || "—"}</span>
                            <span>${row.employeeName || row.employeeEmail || "—"}</span>
                            <span>
                              ${row.status === "valid" ? "有效" : (row.errorMessage ?? "异常")}
                            </span>
                          </div>
                        `,
                      )
                    : html`
                        <div class="enterprise-empty enterprise-empty--compact">暂无预览数据。</div>
                      `
                }
              </div>
            `
      }
      ${
        preview.errorCount > 0
          ? html`
              <div class="enterprise-org-modal__notice enterprise-org-modal__notice--warn">
                仍有 ${preview.errorCount} 行未通过校验。
              </div>
            `
          : nothing
      }
    </section>
  `;
}

export function mountOrganizationImportPreviewPanel(
  mount: HTMLElement,
  preview: OrganizationImportPreview,
  activeTab: OrganizationImportPreviewTab,
  onTabChange: (tab: OrganizationImportPreviewTab) => void,
) {
  render(
    renderOrganizationImportPreviewPanel({
      preview,
      activeTab,
      onTabChange: (tab) => {
        onTabChange(tab);
        render(
          renderOrganizationImportPreviewPanel({
            preview,
            activeTab: tab,
            onTabChange,
          }),
          mount,
        );
      },
    }),
    mount,
  );
}

export function clearOrganizationImportPreviewMount(mount: HTMLElement) {
  render(nothing, mount);
}
