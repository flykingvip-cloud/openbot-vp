/**
 * 权限与治理页 — 授权矩阵 / 审批 / 审计血缘 / 记忆范围的页面编排入口。
 */

import { html, type TemplateResult } from "lit";
import { renderAuditLineagePanel, type AuditLineagePanelProps } from "./audit-lineage-panel.ts";
import { renderMemoryScopePanel, type MemoryScopePanelProps } from "./memory-scope-panel.ts";

export type GovernancePageSection = "authorization" | "approvals" | "audit" | "memory";

export {
  renderAuditLineagePanel,
  renderMemoryScopePanel,
  type AuditLineagePanelProps,
  type MemoryScopePanelProps,
};

/** 治理子区外壳。 */
export function renderGovernanceSection(
  section: GovernancePageSection,
  body: TemplateResult,
): TemplateResult {
  return html`
    <div class="edc-governance-section edc-governance-section--${section}">${body}</div>
  `;
}

/** 页面外壳。 */
export function renderGovernancePage(sections: TemplateResult[]): TemplateResult {
  return html`<div class="edc-page edc-page--governance">${sections}</div>`;
}
