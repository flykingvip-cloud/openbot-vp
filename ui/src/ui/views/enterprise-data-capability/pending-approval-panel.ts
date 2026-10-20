/**
 * 企业数据能力中心 — 待审批中心面板（PendingApprovalPanel）。
 *
 * 渲染 5 类治理审批（数据源接入 / 数据访问 / 能力开放 / 身份绑定 / 员工能力申请）。
 * 「身份绑定」类目已接入（Phase 4.2）；实际记录由数字身份中心创建。
 *
 * @module enterprise-data-capability/pending-approval-panel
 */

import { html, nothing, type TemplateResult } from "lit";
import type { PendingApprovalItem } from "../../capability/enterprise-data-capability/types.ts";
import { stripOrganizationSeatIdSuffix } from "../../ports/enterprise/views/enterprise-organization-display-label.ts";

export type PendingApprovalPanelProps = {
  items: PendingApprovalItem[] | null;
  loading: boolean;
  error: string | null;
  /** 「进入审批中心」入口 href（模块内深链优先，如 #approvals）。 */
  approvalCenterHref: string;
  /** 若提供，优先用按钮回调进入模块内待审批，避免跳出到系统设置。 */
  onOpenApprovalCenter?: () => void;
  onDecideApproval?: (
    approvalId: string,
    decision: "approved" | "rejected",
  ) => void | Promise<void>;
  onApprovalDecided?: () => void;
};

const CATEGORY_LABEL: Record<PendingApprovalItem["category"], string> = {
  source_onboarding: "数据源接入",
  data_access: "数据访问",
  capability_exposure: "能力开放",
  identity_binding: "身份绑定",
  seat_capability_access: "员工能力申请",
};

/** §8.8 Approval Center keeps these three kinds in separate lanes. */
const PRIMARY_APPROVAL_LANES: Array<[PendingApprovalItem["category"], string]> = [
  ["source_onboarding", "数据源接入"],
  ["data_access", "数据访问"],
  ["capability_exposure", "能力开放"],
];

function presentApprovalLabel(label: string): string {
  return stripOrganizationSeatIdSuffix(label) || "数据能力";
}

function renderApprovalActions(
  props: PendingApprovalPanelProps,
  item: PendingApprovalItem,
): TemplateResult {
  if (!props.onDecideApproval) {
    return html`
      <span class="enterprise-mesh-badge enterprise-mesh-badge--warn">待审批</span>
    `;
  }
  return html`
    <button
      type="button"
      class="btn btn--sm btn--danger"
      data-testid="pending-approval-reject-${item.approvalId}"
      @click=${async (event: Event) => {
        if (
          typeof window !== "undefined" &&
          typeof window.confirm === "function" &&
          !window.confirm(`确认拒绝「${item.displayName}」？拒绝后该申请不会生效。`)
        ) {
          return;
        }
        const btn = event.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
          await props.onDecideApproval!(item.approvalId, "rejected");
          props.onApprovalDecided?.();
        } finally {
          btn.disabled = false;
        }
      }}
    >
      拒绝
    </button>
    <button
      type="button"
      class="btn btn--sm btn--approve"
      data-testid="pending-approval-approve-${item.approvalId}"
      @click=${async (event: Event) => {
        if (
          typeof window !== "undefined" &&
          typeof window.confirm === "function" &&
          !window.confirm(`确认批准「${item.displayName}」？批准后按申请范围生效。`)
        ) {
          return;
        }
        const btn = event.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        try {
          await props.onDecideApproval!(item.approvalId, "approved");
          props.onApprovalDecided?.();
        } finally {
          btn.disabled = false;
        }
      }}
    >
      批准
    </button>
  `;
}

function renderApprovalLane(
  props: PendingApprovalPanelProps,
  category: PendingApprovalItem["category"],
  label: string,
  items: PendingApprovalItem[],
): TemplateResult {
  return html`
    <section data-testid="approval-lane-${category}" aria-label=${label}>
      <h3 class="enterprise-data-capability__panel-title">${label}</h3>
      ${
        items.length === 0
          ? html`
              <div class="enterprise-data-capability__hint">暂无</div>
            `
          : html`
              <table class="edc-console-table">
                <tbody>
                  ${items.map(
                    (item) => html`
                      <tr>
                        <td>
                          <div class="edc-approval-cell" title=${`${presentApprovalLabel(item.displayName)} · ${label}`}>
                            <strong>${presentApprovalLabel(item.displayName)}</strong>
                            <span class="edc-approval-row__cat">${label}</span>
                          </div>
                        </td>
                        <td class="edc-console-table__actions">${renderApprovalActions(props, item)}</td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `
      }
    </section>
  `;
}

export function renderPendingApprovalPanel(props: PendingApprovalPanelProps): TemplateResult {
  const items = props.items ?? [];
  let body: TemplateResult;
  if (props.error && !props.items) {
    body = html`<div class="enterprise-data-capability__hint" role="alert">${props.error}</div>`;
  } else if (props.loading && !props.items) {
    body = html`
      <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
    `;
  } else {
    const other = items.filter(
      (item) => !PRIMARY_APPROVAL_LANES.some(([category]) => category === item.category),
    );
    const otherCategories = [...new Set(other.map((item) => item.category))];
    body = html`
      ${
        items.length === 0
          ? html`
              <div class="enterprise-data-capability__empty">
                <div class="enterprise-data-capability__empty-title">暂无待审批事项</div>
              </div>
            `
          : nothing
      }
      ${PRIMARY_APPROVAL_LANES.map(([category, label]) =>
        renderApprovalLane(
          props,
          category,
          label,
          items.filter((item) => item.category === category),
        ),
      )}
      ${otherCategories.map((category) =>
        renderApprovalLane(
          props,
          category,
          CATEGORY_LABEL[category],
          other.filter((item) => item.category === category),
        ),
      )}
    `;
  }

  return html`
    <section
      class="enterprise-card enterprise-data-capability__panel enterprise-data-capability__approvals"
      aria-label="待审批中心"
    >
      <div class="edc-panel-head">
        <div class="enterprise-data-capability__panel-title">
          待审批中心${items.length > 0 ? html`<span class="enterprise-data-capability__count">${items.length}</span>` : nothing}
        </div>
        ${
          props.onOpenApprovalCenter
            ? html`<button class="btn btn--sm" type="button" @click=${props.onOpenApprovalCenter}>
                进入审批中心
              </button>`
            : props.approvalCenterHref
              ? html`<a class="btn btn--sm" href=${props.approvalCenterHref}>进入审批中心</a>`
              : nothing
        }
      </div>
      ${body}
    </section>
  `;
}
