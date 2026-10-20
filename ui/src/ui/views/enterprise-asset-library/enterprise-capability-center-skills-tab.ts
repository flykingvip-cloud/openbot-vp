/**
 * 企业能力中心 — 「全部技能」主 Tab
 *
 * 搜索 + 领域/场景 Chip + OpenClaw 风格技能卡片列表。
 */

import { html, nothing, type TemplateResult } from "lit";
import {
  CAPABILITY_DOMAINS,
  type AssetListFilters,
  type AssetSortConfig,
  type CapabilityDomain,
  type DomainDistribution,
  type EnterpriseAssetListItem,
  type PaginationState,
} from "../../capability/enterprise-capability/types.ts";
import { renderEnterpriseSkillList } from "./enterprise-skill-list.ts";

export type CapabilityCenterSkillsTabProps = {
  filters: AssetListFilters;
  domains: DomainDistribution[];
  availableScenarios: string[];
  onSearchChange: (query: string) => void;
  onDomainSelect: (domain: CapabilityDomain | null) => void;
  onScenarioSelect: (scenario: string | null) => void;
  sorting: AssetSortConfig;
  onSortChange: (sort: AssetSortConfig) => void;
  items: EnterpriseAssetListItem[];
  loading: boolean;
  error: string | null;
  pagination: PaginationState;
  onInstallToRobot: (capabilityId: string) => void;
  onViewDetail: (capabilityId: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: 10 | 20 | 50) => void;
  onRetry?: () => void;
  variant?: "skills" | "mcp";
};

const SORT_FIELDS: ReadonlyArray<{ field: AssetSortConfig["field"]; label: string }> = [
  { field: "maturity", label: "成熟度" },
  { field: "reuseValue", label: "复用价值" },
  { field: "createdAt", label: "最近创建" },
];

function domainCountFor(
  domains: readonly DomainDistribution[],
  domain: CapabilityDomain,
): number | null {
  const match = domains.find((item) => item.domain === domain);
  return match ? match.capabilityCount : 0;
}

function renderSearchBar(props: CapabilityCenterSkillsTabProps): TemplateResult {
  return html`
    <div class="enterprise-capability-center-page__skills-search-row">
      <input
        type="search"
        class="enterprise-capability-center-page__skills-search"
        placeholder=${
          props.variant === "mcp" ? "搜索 MCP 名称、服务名或来源" : "搜索能力名称、描述或来源"
        }
        .value=${props.filters.searchQuery}
        @input=${(event: Event) =>
          props.onSearchChange((event.currentTarget as HTMLInputElement).value)}
        aria-label=${
          props.variant === "mcp" ? "搜索 MCP 名称、服务名或来源" : "搜索能力名称、描述或来源"
        }
      />
      ${renderSortControl(props)}
    </div>
  `;
}

function renderSortControl(props: CapabilityCenterSkillsTabProps): TemplateResult {
  const { sorting, onSortChange } = props;
  return html`
    <div class="enterprise-capability-center-page__sort" role="group" aria-label="排序方式">
      <span class="enterprise-capability-center-page__sort-label">排序</span>
      ${SORT_FIELDS.map((entry) => {
        const isActive = sorting.field === entry.field;
        const arrow = isActive ? (sorting.direction === "asc" ? "↑" : "↓") : "";
        return html`
          <button
            type="button"
            class="enterprise-capability-center-page__sort-btn ${isActive ? "is-active" : ""}"
            aria-pressed=${isActive ? "true" : "false"}
            @click=${() =>
              onSortChange({
                field: entry.field,
                // 点击当前激活项切换升/降序；切换到新字段默认降序。
                direction: isActive && sorting.direction === "desc" ? "asc" : "desc",
              })}
          >
            ${entry.label}${arrow ? html`<span aria-hidden="true"> ${arrow}</span>` : nothing}
          </button>
        `;
      })}
    </div>
  `;
}

function renderDomainChips(props: CapabilityCenterSkillsTabProps): TemplateResult {
  const activeDomain = props.filters.domain;
  return html`
    <div class="enterprise-capability-center-page__tag-block">
      <div class="enterprise-capability-center-page__tag-label">能力领域</div>
      <div class="enterprise-capability-center-page__tag-row" role="list">
        <button
          type="button"
          class="enterprise-capability-center-page__tag-chip ${
            activeDomain === null ? "is-active" : ""
          }"
          @click=${() => props.onDomainSelect(null)}
        >
          全部
        </button>
        ${CAPABILITY_DOMAINS.map((domain) => {
          const count = domainCountFor(props.domains, domain);
          const suffix = count === null ? "" : ` ${count}`;
          return html`
            <button
              type="button"
              class="enterprise-capability-center-page__tag-chip ${
                activeDomain === domain ? "is-active" : ""
              }"
              @click=${() => props.onDomainSelect(domain)}
            >
              ${domain}${suffix}
            </button>
          `;
        })}
      </div>
    </div>
  `;
}

function renderScenarioTags(props: CapabilityCenterSkillsTabProps): TemplateResult {
  const activeScenario = props.filters.usageScenario;
  if (props.availableScenarios.length === 0) {
    return html``;
  }
  return html`
    <div class="enterprise-capability-center-page__tag-block">
      <div class="enterprise-capability-center-page__tag-label">使用场景</div>
      <div class="enterprise-capability-center-page__tag-row" role="list">
        <button
          type="button"
          class="enterprise-capability-center-page__tag-chip ${
            activeScenario === null ? "is-active" : ""
          }"
          @click=${() => props.onScenarioSelect(null)}
        >
          全部场景
        </button>
        ${props.availableScenarios.map(
          (scenario) => html`
            <button
              type="button"
              class="enterprise-capability-center-page__tag-chip ${
                activeScenario === scenario ? "is-active" : ""
              }"
              @click=${() => props.onScenarioSelect(scenario)}
            >
              ${scenario}
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

/**
 * 渲染「全部技能」Tab 主体。
 */
export function renderCapabilityCenterSkillsTab(
  props: CapabilityCenterSkillsTabProps,
): TemplateResult {
  const isMcp = props.variant === "mcp";
  return html`
    <div
      id=${isMcp ? "mcp" : "skills"}
      class="enterprise-capability-center-page__skills-tab"
      role="tabpanel"
      aria-label=${isMcp ? "MCP" : "全部技能"}
    >
      ${renderSearchBar(props)}
      ${isMcp ? nothing : renderDomainChips(props)}
      ${isMcp ? nothing : renderScenarioTags(props)}
      <div class="enterprise-capability-center-page__skills-list">
        ${renderEnterpriseSkillList({
          items: props.items,
          loading: props.loading,
          error: props.error,
          pagination: props.pagination,
          onInstallToRobot: props.onInstallToRobot,
          onViewDetail: props.onViewDetail,
          onPageChange: props.onPageChange,
          onPageSizeChange: props.onPageSizeChange,
          onRetry: props.onRetry,
          emptyMessage: isMcp
            ? "还没有企业 MCP。员工在我的资产中提交 MCP，审核通过后会出现在这里。"
            : undefined,
          installLabel: isMcp ? "推送挂载" : undefined,
        })}
      </div>
    </div>
  `;
}
