/**
 * 企业能力中心 — 技能卡片（OpenClaw 风格纵向列表项）
 *
 * 名称 + 描述 + 底栏企业指标 + 操作，不在卡片内重复领域/场景列。
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  CapabilityDomain,
  EnterpriseAssetListItem,
} from "../../capability/enterprise-capability/types.ts";
import { truncateText } from "./asset-table.ts";
import { renderEnterpriseHealthBadge } from "./health-badge.ts";
import { renderMaturityIndicator } from "./maturity-indicator.ts";
import { formatMonthlyExecutions, formatReuseGrowthRate } from "./value-summary-card.ts";

const DOMAIN_ACCENT: Record<CapabilityDomain, string> = {
  销售: "#3B82F6",
  HR: "#8B5CF6",
  客服: "#10B981",
  财务: "#F59E0B",
  法务: "#6366F1",
  数据分析: "#EC4899",
};

const DESCRIPTION_MAX = 140;

export type EnterpriseSkillListCardProps = {
  item: EnterpriseAssetListItem;
  onInstallToRobot: (capabilityId: string) => void;
  onViewDetail: (capabilityId: string) => void;
  installLabel?: string;
};

function formatRobotCoverage(count: number): string {
  if (count <= 0) {
    return "暂未安装到机器人";
  }
  return `${count} 个机器人`;
}

export function formatSkillCardMeta(item: EnterpriseAssetListItem): string {
  const parts = [
    item.assetType === "mcp" && item.mcpServerName ? `服务 ${item.mcpServerName}` : null,
    formatMonthlyExecutions(item.valueSummary.monthlyExecutions),
    formatRobotCoverage(item.reuseData.robotCount),
    formatReuseGrowthRate(item.valueSummary.reuseGrowthRate30d),
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

function isInstallable(item: EnterpriseAssetListItem): boolean {
  return item.lifecycle === "published" && item.healthStatus !== "已不适合继续推广";
}

function isDisabled(item: EnterpriseAssetListItem): boolean {
  return (
    item.lifecycle === "deprecated" ||
    item.lifecycle === "retired" ||
    item.healthStatus === "已不适合继续推广"
  );
}

export function renderEnterpriseSkillListCard(props: EnterpriseSkillListCardProps): TemplateResult {
  const { item, onInstallToRobot, onViewDetail } = props;
  const accent = DOMAIN_ACCENT[item.domain];
  const description = truncateText(item.description, DESCRIPTION_MAX);
  const installLabel = props.installLabel ?? "推送到岗位";

  return html`
    <article
      class="enterprise-skill-card"
      aria-label="能力：${item.name}"
      style="--enterprise-skill-card-accent:${accent}"
    >
      <div class="enterprise-skill-card__main">
        ${
          item.avatar
            ? html`<img class="enterprise-skill-card__icon" src=${item.avatar} alt="" />`
            : html`
                <span
                  class="enterprise-skill-card__icon enterprise-skill-card__icon--placeholder"
                  aria-hidden="true"
                  >◆</span
                >
              `
        }
        <div class="enterprise-skill-card__body">
          <div class="enterprise-skill-card__title">
            <span class="enterprise-skill-card__source">来源：${item.sourceEmployeeName}</span>
            <span class="enterprise-skill-card__sep" aria-hidden="true">/</span>
            <span class="enterprise-skill-card__name">${item.name}</span>
            ${
              item.assetType === "mcp"
                ? html`
                    <span class="enterprise-skill-card__type-badge">MCP</span>
                  `
                : nothing
            }
          </div>
          <div class="enterprise-skill-card__badges">
            ${renderMaturityIndicator({ maturity: item.maturity, variant: "with-label" })}
            ${renderEnterpriseHealthBadge({ status: item.healthStatus, variant: "inline" })}
          </div>
          <p class="enterprise-skill-card__desc" title=${item.description}>${description}</p>
          <p class="enterprise-skill-card__meta">${formatSkillCardMeta(item)}</p>
        </div>
      </div>
      <div class="enterprise-skill-card__actions">
        ${
          isInstallable(item)
            ? html`<button
                type="button"
                class="enterprise-skill-card__install-btn"
                @click=${() => onInstallToRobot(item.id)}
              >
                ${installLabel}
              </button>`
            : nothing
        }
        ${
          isDisabled(item)
            ? html`
                <span class="enterprise-skill-card__disabled-label" aria-label="已停用">已停用</span>
              `
            : nothing
        }
        <button
          type="button"
          class="enterprise-skill-card__detail-link"
          @click=${() => onViewDetail(item.id)}
        >
          查看详情
        </button>
      </div>
    </article>
  `;
}
