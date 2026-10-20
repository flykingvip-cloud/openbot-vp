/**
 * 企业能力中心 — 技能卡片列表（含加载/空/错态与分页）
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  EnterpriseAssetListItem,
  PaginationState,
} from "../../capability/enterprise-capability/types.ts";
import { renderEnterpriseSkillListCard } from "./enterprise-skill-list-card.ts";
import { renderPagination } from "./pagination.ts";

export type EnterpriseSkillListProps = {
  items: EnterpriseAssetListItem[];
  loading: boolean;
  error: string | null;
  pagination: PaginationState;
  onInstallToRobot: (capabilityId: string) => void;
  onViewDetail: (capabilityId: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: 10 | 20 | 50) => void;
  onRetry?: () => void;
  emptyMessage?: string;
  installLabel?: string;
};

const SKELETON_COUNT = 5;

function renderSkeletonCards(): TemplateResult {
  return html`${Array.from({ length: SKELETON_COUNT }, () => {
    return html`
      <div class="enterprise-skill-card enterprise-skill-card--skeleton" aria-hidden="true">
        <div class="enterprise-skill-card__main">
          <span class="enterprise-skill-card__icon enterprise-skill-card__icon--placeholder"></span>
          <div class="enterprise-skill-card__body">
            <div
              class="enterprise-skill-card__skeleton-bar enterprise-skill-card__skeleton-bar--title"
            ></div>
            <div
              class="enterprise-skill-card__skeleton-bar enterprise-skill-card__skeleton-bar--desc"
            ></div>
            <div
              class="enterprise-skill-card__skeleton-bar enterprise-skill-card__skeleton-bar--meta"
            ></div>
          </div>
        </div>
      </div>
    `;
  })}`;
}

function renderErrorState(error: string, onRetry?: () => void): TemplateResult {
  return html`
    <div class="enterprise-skill-list__message enterprise-skill-list__message--error" role="alert">
      <strong>加载失败</strong>
      <span>${error}</span>
      ${
        onRetry
          ? html`<button type="button" class="btn btn--sm" @click=${onRetry}>重试</button>`
          : nothing
      }
    </div>
  `;
}

function renderEmptyState(message?: string): TemplateResult {
  return html`
    <div class="enterprise-skill-list__message" role="status">${message ?? "暂无匹配的能力资产，请调整筛选条件"}</div>
  `;
}

export function renderEnterpriseSkillList(props: EnterpriseSkillListProps): TemplateResult {
  const { items, loading, error, pagination, onInstallToRobot, onViewDetail } = props;

  let listBody: TemplateResult;
  if (loading) {
    listBody = renderSkeletonCards();
  } else if (error !== null) {
    listBody = renderErrorState(error, props.onRetry);
  } else if (items.length === 0) {
    listBody = renderEmptyState(props.emptyMessage);
  } else {
    listBody = html`${items.map((item) =>
      renderEnterpriseSkillListCard({
        item,
        onInstallToRobot,
        onViewDetail,
        installLabel: props.installLabel,
      }),
    )}`;
  }

  return html`
    <div class="enterprise-skill-list">
      <div class="enterprise-skill-list__cards" aria-busy=${loading ? "true" : "false"}>
        ${listBody}
      </div>
      ${
        !loading
          ? renderPagination({
              currentPage: pagination.currentPage,
              pageSize: pagination.pageSize,
              totalItems: pagination.totalItems,
              totalLabel: `共 ${pagination.totalItems} 项能力资产`,
              onPageChange: props.onPageChange,
              onPageSizeChange: props.onPageSizeChange,
            })
          : nothing
      }
    </div>
  `;
}
