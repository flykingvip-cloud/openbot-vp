/**
 * 员工端只读「可用模型 + 各模型消费量」视图（props 驱动）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§8.2，R5.2）。
 *
 * 员工端**不**暴露平台模型管理复杂度，只读展示：当前 seat / 可用模型 / 被拒原因，
 * 以及近 30 天各模型的实际消费量（tokens / 调用次数）条形可视化。
 * 员工端不展示成本金额。
 * 两态区分：未配置（missing）≠ 已解析为空（被拒）。
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  EmployeeModelUsageView,
  EmployeeModelView,
} from "../capability/model-authorization/view-model.ts";

export type EmployeeModelAccessProps = {
  view: EmployeeModelView;
  /** 近 30 天各模型消费量视图（可选）。 */
  usage?: EmployeeModelUsageView | null;
  loading?: boolean;
  /** 嵌入个人设置面板时使用，去除外层 card 与重复标题。 */
  embedded?: boolean;
};

const tokenFormatter = new Intl.NumberFormat("en-US");

function formatTokens(value: number): string {
  return tokenFormatter.format(Math.max(0, Math.round(value)));
}

function modelAccessTone(view: EmployeeModelView): "ok" | "muted" | "danger" {
  if (view.hasModels) {
    return "ok";
  }
  if (view.statusLabel === "未配置授权" || view.statusLabel === "No entitlements") {
    return "muted";
  }
  return "danger";
}

/** 拆分 provider/model，避免员工设置页堆砌技术路径。 */
function splitModelId(modelId: string): { provider: string | null; name: string } {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) {
    return { provider: null, name: trimmed || modelId };
  }
  return {
    provider: trimmed.slice(0, slash),
    name: trimmed.slice(slash + 1),
  };
}

/** 内部解析文案（ceiling ∩ grant 等）不面向员工展示。 */
function isTechnicalDetail(detail: string | undefined): boolean {
  const text = detail?.trim() ?? "";
  if (!text) {
    return true;
  }
  return (
    /resolved from|enterprise ceiling|seat grant|active model set|∩|已隐藏\s*\d+/i.test(text) ||
    text === "可用"
  );
}

function shouldShowDetail(view: EmployeeModelView): boolean {
  if (!view.detail?.trim()) {
    return false;
  }
  if (view.hasModels) {
    return false;
  }
  if (view.statusLabel === "未配置授权" || view.statusLabel === "No entitlements") {
    return !isTechnicalDetail(view.detail);
  }
  return !isTechnicalDetail(view.detail);
}

function renderModelCard(modelId: string): TemplateResult {
  const { provider, name } = splitModelId(modelId);
  return html`
    <div class="employee-model-access__model" title=${modelId}>
      <span class="employee-model-access__model-name">${name}</span>
      ${
        provider
          ? html`<span class="employee-model-access__model-provider">${provider}</span>`
          : nothing
      }
    </div>
  `;
}

function renderModelList(view: EmployeeModelView, loading: boolean) {
  if (loading) {
    return html`
      <div class="employee-model-access__detail">加载中…</div>
    `;
  }
  if (view.hasModels) {
    return html`
      <div class="employee-model-access__models" role="list">
        ${view.modelIds.map(
          (modelId) => html`<div role="listitem">${renderModelCard(modelId)}</div>`,
        )}
      </div>
    `;
  }
  return html`
    <div class="employee-model-access__empty">暂无可用模型</div>
  `;
}

function renderAccessMeta(view: EmployeeModelView): TemplateResult {
  const count = view.modelIds.length;
  const countLabel = view.hasModels ? `${String(count)} 个可用模型` : view.statusLabel;
  return html`
    <div class="employee-model-access__meta">
      <span
        class="employee-workbench__settings-personal-badge employee-workbench__settings-personal-badge--${modelAccessTone(
          view,
        )}"
      >
        ${view.statusLabel}
      </span>
      <span class="employee-model-access__meta-copy">${countLabel}</span>
    </div>
  `;
}

function renderUsageRow(row: EmployeeModelUsageView["rows"][number]): TemplateResult {
  const widthPct = Math.max(row.used ? 2 : 0, Math.round(row.share * 100));
  return html`
    <div class="employee-model-usage__row ${row.used ? "" : "is-unused"}">
      <div class="employee-model-usage__row-head">
        <span class="employee-model-usage__model" title=${row.label}>${row.label}</span>
        <span class="employee-model-usage__badges">
          ${
            row.entitled
              ? html`
                  <span class="employee-model-usage__tag employee-model-usage__tag--ok">可用</span>
                `
              : html`
                  <span class="employee-model-usage__tag">未在授权内</span>
                `
          }
          ${
            row.used
              ? nothing
              : html`
                  <span class="employee-model-usage__tag employee-model-usage__tag--muted">未使用</span>
                `
          }
        </span>
      </div>
      <div class="employee-model-usage__bar-track" role="presentation">
        <div
          class="employee-model-usage__bar ${row.used ? "" : "is-empty"}"
          style="width: ${widthPct}%"
        ></div>
      </div>
      <div class="employee-model-usage__metrics">
        <span><b>${formatTokens(row.totalTokens)}</b> tokens</span>
        <span>${formatTokens(row.requests)} 次调用</span>
      </div>
    </div>
  `;
}

function renderModelUsage(usage: EmployeeModelUsageView, loading: boolean): TemplateResult {
  return html`
    <div class="card employee-model-usage">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div class="card-title">模型消费量</div>
        <span class="card-sub">近 ${String(usage.windowDays)} 天</span>
      </div>
      ${
        usage.status === "unavailable"
          ? html`
              <div class="employee-model-usage__unavailable" role="status">
                <strong>用量暂不可用</strong>
                <div class="card-sub">
                  ${usage.unavailableReason ?? "暂时无法获取完整用量，请稍后重试。"}
                </div>
              </div>
            `
          : html`
              <div class="employee-model-usage__totals">
                <div class="employee-model-usage__total">
                  <span class="employee-model-usage__total-value"
                    >${formatTokens(usage.totalTokens)}</span
                  >
                  <span class="employee-model-usage__total-label">总 tokens</span>
                </div>
                <div class="employee-model-usage__total">
                  <span class="employee-model-usage__total-value"
                    >${formatTokens(usage.totalRequests)}</span
                  >
                  <span class="employee-model-usage__total-label">调用次数</span>
                </div>
                <div class="employee-model-usage__total">
                  <span class="employee-model-usage__total-value"
                    >${String(usage.usedModelCount)}</span
                  >
                  <span class="employee-model-usage__total-label">已用模型</span>
                </div>
              </div>
              ${
                loading
                  ? html`
                      <div class="card-sub" style="margin-top: 12px">加载中…</div>
                    `
                  : usage.hasUsage
                    ? html`
                        <div class="employee-model-usage__list">
                          ${usage.rows.map((row) => renderUsageRow(row))}
                        </div>
                      `
                    : html`
                        <div class="card-sub" style="margin-top: 12px;">
                          近 ${String(usage.windowDays)} 天暂无模型调用记录。
                        </div>
                      `
              }
            `
      }
    </div>
  `;
}

export function renderEmployeeModelAccess(props: EmployeeModelAccessProps) {
  const { view } = props;
  const tone = modelAccessTone(view);
  const showDetail = shouldShowDetail(view);

  if (props.embedded) {
    return html`
      <section class="employee-model-access employee-model-access--embedded">
        ${renderAccessMeta(view)}
        ${showDetail ? html`<div class="employee-model-access__detail">${view.detail}</div>` : nothing}
        ${renderModelList(view, Boolean(props.loading))}
        ${props.usage ? renderModelUsage(props.usage, Boolean(props.loading)) : nothing}
      </section>
    `;
  }

  return html`
    <section class="employee-model-access">
      <div class="card">
        <div class="row" style="justify-content: space-between; align-items: center;">
          <div class="card-title">我的可用模型</div>
          <span class="badge ${tone}" data-status=${view.statusLabel}>${view.statusLabel}</span>
        </div>
        ${
          view.hasModels
            ? html`
                <div class="employee-model-access__meta-copy employee-model-access__meta-copy--card">
                  ${String(view.modelIds.length)} 个可用模型
                </div>
              `
            : nothing
        }
        ${showDetail ? html`<div class="card-sub" style="margin-top: 4px;">${view.detail}</div>` : nothing}
        ${renderModelList(view, Boolean(props.loading))}
      </div>
      ${props.usage ? renderModelUsage(props.usage, Boolean(props.loading)) : nothing}
    </section>
  `;
}
