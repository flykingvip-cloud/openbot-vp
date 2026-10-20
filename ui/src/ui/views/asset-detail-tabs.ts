import { html, type TemplateResult } from "lit";

export type StandardAssetDetailTabId =
  | "overview"
  | "definition"
  | "files"
  | "versions"
  | "runtime"
  | "install";

export type StandardAssetDetailTab = {
  id: StandardAssetDetailTabId;
  label: string;
  badge?: string | null;
  disabled?: boolean;
};

export const STANDARD_ASSET_DETAIL_TABS: readonly StandardAssetDetailTab[] = [
  {
    id: "overview",
    label: "概览",
  },
  {
    id: "definition",
    label: "定义",
  },
  {
    id: "files",
    label: "文件",
  },
  {
    id: "versions",
    label: "版本",
  },
  {
    id: "runtime",
    label: "运行时",
  },
  {
    id: "install",
    label: "安装与分发",
  },
];

export function getStandardAssetDetailTab(
  tabId: StandardAssetDetailTabId,
  tabs: readonly StandardAssetDetailTab[] = STANDARD_ASSET_DETAIL_TABS,
): StandardAssetDetailTab {
  return tabs.find((tab) => tab.id === tabId) ?? tabs[0];
}

export function renderStandardAssetDetailTabs(props: {
  activeTab: StandardAssetDetailTabId;
  onChange: (tabId: StandardAssetDetailTabId) => void;
  tabs?: readonly StandardAssetDetailTab[];
}): TemplateResult {
  const tabs = props.tabs ?? STANDARD_ASSET_DETAIL_TABS;
  return html`
    <nav class="asset-detail-tabs__nav" aria-label="标准资产详情标签" role="tablist">
      ${tabs.map(
        (tab) => html`
          <button
            type="button"
            role="tab"
            class="asset-detail-tabs__tab ${props.activeTab === tab.id ? "is-active" : ""}"
            aria-selected=${String(props.activeTab === tab.id)}
            ?disabled=${tab.disabled === true}
            @click=${() => props.onChange(tab.id)}
          >
            <span class="asset-detail-tabs__tab-label">${tab.label}</span>
            ${tab.badge ? html`<span class="asset-detail-tabs__tab-badge">${tab.badge}</span>` : ""}
          </button>
        `,
      )}
    </nav>
  `;
}

export function renderStandardAssetDetailEmptyState(params: {
  title: string;
  description: string;
}): TemplateResult {
  return html`
    <div class="asset-detail-tabs__empty">
      <strong>${params.title}</strong>
      <span>${params.description}</span>
    </div>
  `;
}
