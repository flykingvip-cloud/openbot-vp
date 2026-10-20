import { html, type TemplateResult } from "lit";
import type {
  AssetListFilters,
  CapabilityDomain,
  CapabilityMaturity,
  EnterpriseHealthStatus,
} from "../../capability/enterprise-capability/types.ts";
import {
  CAPABILITY_DOMAINS,
  CAPABILITY_MATURITY_LEVELS,
  ENTERPRISE_HEALTH_STATUSES,
} from "../../capability/enterprise-capability/types.ts";

/**
 * AssetFilterBar 组件属性。
 *
 * 验证需求：3.1, 3.2, 3.3, 3.4, 3.5
 */
export type AssetFilterBarProps = {
  filters: AssetListFilters;
  availableScenarios: string[];
  availableTargets: string[];
  onFilterChange: <K extends keyof AssetListFilters>(key: K, value: AssetListFilters[K]) => void;
  onReset: () => void;
};

/**
 * 渲染能力资产筛选栏。
 *
 * 布局（水平 flex 行，窄屏自动换行）：
 * 1. 搜索输入框（按名称或描述搜索）
 * 2. 使用场景下拉
 * 3. 适用对象下拉
 * 4. 能力领域下拉
 * 5. 能力成熟度下拉
 * 6. 健康状态下拉
 * 7. "只看我可安装"开关
 * 8. 重置按钮
 *
 * 样式：使用 enterprise-components.css 的 .asset-filter-bar 类体系，响应主题。
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 */
export function renderAssetFilterBar(props: AssetFilterBarProps): TemplateResult {
  const { filters, availableScenarios, availableTargets, onFilterChange, onReset } = props;

  return html`
    <div class="asset-filter-bar" role="toolbar" aria-label="能力资产筛选栏">
      ${renderSearchInput(filters.searchQuery, onFilterChange)}
      ${renderScenarioSelect(filters.usageScenario, availableScenarios, onFilterChange)}
      ${renderTargetSelect(filters.applicableTarget, availableTargets, onFilterChange)}
      ${renderDomainSelect(filters.domain, onFilterChange)}
      ${renderMaturitySelect(filters.maturity, onFilterChange)}
      ${renderHealthStatusSelect(filters.healthStatus, onFilterChange)}
      ${renderInstallableToggle(filters.onlyInstallable, onFilterChange)}
      ${renderResetButton(onReset)}
    </div>
  `;
}

/**
 * 搜索输入框：按能力名称或描述搜索，最少 1 字符触发。
 */
function renderSearchInput(
  value: string,
  onFilterChange: AssetFilterBarProps["onFilterChange"],
): TemplateResult {
  return html`
    <input
      type="text"
      class="asset-filter-bar__input asset-filter-bar__input--search"
      placeholder="搜索能力名称或描述"
      .value="${value}"
      @input="${(e: InputEvent) => {
        const target = e.target as HTMLInputElement;
        onFilterChange("searchQuery", target.value);
      }}"
      aria-label="搜索能力名称或描述"
    />
  `;
}

/** 使用场景下拉 */
function renderScenarioSelect(
  current: string | null,
  scenarios: string[],
  onFilterChange: AssetFilterBarProps["onFilterChange"],
): TemplateResult {
  return html`
    <select
      class="asset-filter-bar__select"
      .value="${current ?? ""}"
      @change="${(e: Event) => {
        const target = e.target as HTMLSelectElement;
        onFilterChange("usageScenario", target.value || null);
      }}"
      aria-label="使用场景筛选"
    >
      <option value="">全部场景</option>
      ${scenarios.map((s) => html`<option value="${s}" ?selected="${current === s}">${s}</option>`)}
    </select>
  `;
}

/** 适用对象下拉 */
function renderTargetSelect(
  current: string | null,
  targets: string[],
  onFilterChange: AssetFilterBarProps["onFilterChange"],
): TemplateResult {
  return html`
    <select
      class="asset-filter-bar__select"
      .value="${current ?? ""}"
      @change="${(e: Event) => {
        const target = e.target as HTMLSelectElement;
        onFilterChange("applicableTarget", target.value || null);
      }}"
      aria-label="适用对象筛选"
    >
      <option value="">全部对象</option>
      ${targets.map((t) => html`<option value="${t}" ?selected="${current === t}">${t}</option>`)}
    </select>
  `;
}

/** 能力领域下拉 */
function renderDomainSelect(
  current: CapabilityDomain | null,
  onFilterChange: AssetFilterBarProps["onFilterChange"],
): TemplateResult {
  return html`
    <select
      class="asset-filter-bar__select"
      .value="${current ?? ""}"
      @change="${(e: Event) => {
        const target = e.target as HTMLSelectElement;
        onFilterChange("domain", (target.value || null) as CapabilityDomain | null);
      }}"
      aria-label="能力领域筛选"
    >
      <option value="">全部领域</option>
      ${CAPABILITY_DOMAINS.map(
        (d) => html`<option value="${d}" ?selected="${current === d}">${d}</option>`,
      )}
    </select>
  `;
}

/** 能力成熟度下拉 */
function renderMaturitySelect(
  current: CapabilityMaturity | null,
  onFilterChange: AssetFilterBarProps["onFilterChange"],
): TemplateResult {
  return html`
    <select
      class="asset-filter-bar__select"
      .value="${current ?? ""}"
      @change="${(e: Event) => {
        const target = e.target as HTMLSelectElement;
        onFilterChange("maturity", (target.value || null) as CapabilityMaturity | null);
      }}"
      aria-label="能力成熟度筛选"
    >
      <option value="">全部</option>
      ${CAPABILITY_MATURITY_LEVELS.map(
        (m) => html`<option value="${m}" ?selected="${current === m}">${m}</option>`,
      )}
    </select>
  `;
}

/** 健康状态下拉 */
function renderHealthStatusSelect(
  current: EnterpriseHealthStatus | null,
  onFilterChange: AssetFilterBarProps["onFilterChange"],
): TemplateResult {
  return html`
    <select
      class="asset-filter-bar__select"
      .value="${current ?? ""}"
      @change="${(e: Event) => {
        const target = e.target as HTMLSelectElement;
        onFilterChange("healthStatus", (target.value || null) as EnterpriseHealthStatus | null);
      }}"
      aria-label="健康状态筛选"
    >
      <option value="">全部状态</option>
      ${ENTERPRISE_HEALTH_STATUSES.map(
        (h) => html`<option value="${h}" ?selected="${current === h}">${h}</option>`,
      )}
    </select>
  `;
}

/** "只看我可安装"开关 */
function renderInstallableToggle(
  active: boolean,
  onFilterChange: AssetFilterBarProps["onFilterChange"],
): TemplateResult {
  return html`
    <label class="asset-filter-bar__toggle">
      <span
        class="asset-filter-bar__toggle-track ${
          active ? "asset-filter-bar__toggle-track--active" : ""
        }"
        role="switch"
        aria-checked="${active}"
        tabindex="0"
        @click="${() => onFilterChange("onlyInstallable", !active)}"
        @keydown="${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onFilterChange("onlyInstallable", !active);
          }
        }}"
      >
        <span class="asset-filter-bar__toggle-thumb"></span>
      </span>
      <span>只看我可安装</span>
    </label>
  `;
}

/** 重置按钮 */
function renderResetButton(onReset: () => void): TemplateResult {
  return html`
    <button
      type="button"
      class="asset-filter-bar__reset"
      @click="${onReset}"
      aria-label="重置所有筛选条件"
    >
      重置
    </button>
  `;
}
