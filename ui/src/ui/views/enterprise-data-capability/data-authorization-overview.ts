/**
 * 企业数据能力中心 — 数据授权关系总览（DataAuthorizationOverview，v1 / 决策 b）。
 *
 * 每数据源一卡，列出授权目标：
 * - seat：权威席位标题（precise）。
 * - role：按 roleCode 分组的席位数（标注「非精确」）。
 * department 不在 v1 展开成员计数；若存在 department 策略，仅披露其数量（待决策 a 落地后展开）。
 * 只展示「数据源 → 目标 → 数量」，不展示用户。
 *
 * @module enterprise-data-capability/data-authorization-overview
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  AuthorizationSourceCard,
  AuthorizationTarget,
} from "../../capability/enterprise-data-capability/types.ts";

export type DataAuthorizationOverviewProps = {
  cards: AuthorizationSourceCard[] | null;
  loading: boolean;
  error: string | null;
};

function renderTargetLine(target: AuthorizationTarget): TemplateResult {
  const kindLabel = target.kind === "seat" ? "岗位" : target.kind === "role" ? "角色" : "部门";
  return html`
    <div class="edc-authz-line">
      <span class="edc-authz-line__label">${target.label}</span>
      <span class="edc-authz-line__count"
        >${kindLabel} ${target.count}${
          target.precise
            ? nothing
            : html`
                <em> · 非精确</em>
              `
        }</span
      >
    </div>
  `;
}

function renderRow(card: AuthorizationSourceCard): TemplateResult {
  return html`
    <tr>
      <td><strong>${card.displayName}</strong></td>
      <td>
        ${
          card.targets.length === 0
            ? html`
                <span class="enterprise-data-capability__hint">暂无 部门/岗位/角色 授权</span>
              `
            : html`
                <div class="edc-authz-cell">
                  ${card.targets.map((target) => renderTargetLine(target))}
                </div>
              `
        }
      </td>
    </tr>
  `;
}

export function renderDataAuthorizationOverview(
  props: DataAuthorizationOverviewProps,
): TemplateResult {
  const cards = props.cards ?? [];
  let body: TemplateResult;
  if (props.error && !props.cards) {
    body = html`<div class="enterprise-data-capability__hint" role="alert">${props.error}</div>`;
  } else if (props.loading && !props.cards) {
    body = html`
      <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
    `;
  } else if (cards.length === 0) {
    body = html`
      <div class="enterprise-data-capability__empty">
        <div class="enterprise-data-capability__empty-title">暂无授权数据源</div>
        <div class="enterprise-data-capability__hint">
          在「默认权限矩阵」中为部门/岗位/角色配置数据源访问策略后，这里将展示授权关系。
        </div>
      </div>
    `;
  } else {
    body = html`
      <table class="edc-console-table">
        <thead>
          <tr>
            <th>数据源</th>
            <th>授权目标</th>
          </tr>
        </thead>
        <tbody>
          ${cards.map((card) => renderRow(card))}
        </tbody>
      </table>
    `;
  }

  return html`
    <section
      class="enterprise-card enterprise-data-capability__panel enterprise-data-capability__authz"
      aria-label="数据授权关系总览"
    >
      <div class="enterprise-data-capability__panel-title">
        数据授权关系总览${cards.length > 0 ? html`<span class="enterprise-data-capability__count">${cards.length}</span>` : nothing}
      </div>
      ${body}
    </section>
  `;
}
