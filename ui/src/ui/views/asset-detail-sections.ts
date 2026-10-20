import { html, type TemplateResult } from "lit";
import { renderStandardAssetDetailEmptyState } from "./asset-detail-tabs.ts";
import type {
  AssetDetailFactVM,
  AssetDetailStatVM,
  AssetDetailTimelineItemVM,
} from "./asset-detail-vm.ts";

export function renderAssetDetailFactRows(params: {
  items: AssetDetailFactVM[];
  rowClass: string;
  labelClass: string;
  valueClass: string;
}): TemplateResult {
  return html`
    ${params.items.map(
      (item) => html`
        <div class=${params.rowClass}>
          <span class=${params.labelClass}>${item.label}</span>
          <span class=${params.valueClass}>${item.value}</span>
        </div>
      `,
    )}
  `;
}

export function renderAssetDetailFactPairs(params: {
  items: AssetDetailFactVM[];
  containerClass: string;
  itemClass: string;
  labelClass: string;
  valueClass: string;
}): TemplateResult {
  return html`
    <div class=${params.containerClass}>
      ${params.items.map(
        (item) => html`
          <div class=${params.itemClass}>
            <span class=${params.labelClass}>${item.label}</span>
            <strong class=${params.valueClass}>${item.value}</strong>
          </div>
        `,
      )}
    </div>
  `;
}

export function renderAssetDetailStatCards(params: {
  items: AssetDetailStatVM[];
  containerClass: string;
  itemClass: string;
  labelClass: string;
  valueClass: string;
}): TemplateResult {
  return html`
    <div class=${params.containerClass}>
      ${params.items.map(
        (item) => html`
          <article class=${params.itemClass}>
            <span class=${params.labelClass}>${item.label}</span>
            <strong class=${params.valueClass}>${item.value}</strong>
          </article>
        `,
      )}
    </div>
  `;
}

export function renderAssetDetailListItems(params: {
  items: AssetDetailFactVM[];
  containerClass: string;
  itemClass: string;
  titleTag?: "strong" | "span";
  valueTag?: "span" | "strong";
}): TemplateResult {
  const titleTag = params.titleTag ?? "strong";
  const valueTag = params.valueTag ?? "span";
  return html`
    <div class=${params.containerClass}>
      ${params.items.map((item) => {
        const titleNode =
          titleTag === "span"
            ? html`<span>${item.label}</span>`
            : html`<strong>${item.label}</strong>`;
        const valueNode =
          valueTag === "strong"
            ? html`<strong>${item.value}</strong>`
            : html`<span>${item.value}</span>`;
        return html`
          <div class=${params.itemClass}>
            ${titleNode}
            ${valueNode}
          </div>
        `;
      })}
    </div>
  `;
}

export function renderAssetDetailFactRowsOrEmpty(params: {
  items: AssetDetailFactVM[];
  rowClass: string;
  labelClass: string;
  valueClass: string;
  emptyTitle: string;
  emptyDescription: string;
}): TemplateResult {
  if (params.items.length === 0) {
    return renderStandardAssetDetailEmptyState({
      title: params.emptyTitle,
      description: params.emptyDescription,
    });
  }
  return renderAssetDetailFactRows(params);
}

export function renderAssetDetailFactPairsOrEmpty(params: {
  items: AssetDetailFactVM[];
  containerClass: string;
  itemClass: string;
  labelClass: string;
  valueClass: string;
  emptyTitle: string;
  emptyDescription: string;
}): TemplateResult {
  if (params.items.length === 0) {
    return renderStandardAssetDetailEmptyState({
      title: params.emptyTitle,
      description: params.emptyDescription,
    });
  }
  return renderAssetDetailFactPairs(params);
}

export function renderAssetDetailListItemsOrEmpty(params: {
  items: AssetDetailFactVM[];
  containerClass: string;
  itemClass: string;
  titleTag?: "strong" | "span";
  valueTag?: "span" | "strong";
  emptyTitle: string;
  emptyDescription: string;
}): TemplateResult {
  if (params.items.length === 0) {
    return renderStandardAssetDetailEmptyState({
      title: params.emptyTitle,
      description: params.emptyDescription,
    });
  }
  return renderAssetDetailListItems(params);
}

export function renderAssetDetailTimeline(params: {
  items: AssetDetailTimelineItemVM[];
  itemClass: string;
  timeClass: string;
  primaryClass: string;
  secondaryClass: string;
  tagClass?: string;
  statusClassBase?: string;
  statusTonePrefix?: string;
  emptyTitle: string;
  emptyDescription: string;
}): TemplateResult {
  if (params.items.length === 0) {
    return renderStandardAssetDetailEmptyState({
      title: params.emptyTitle,
      description: params.emptyDescription,
    });
  }
  return html`
    ${params.items.map((item) => {
      const statusClass = [params.statusClassBase ?? ""]
        .concat(
          item.badge?.variant === "status" && item.badge.tone
            ? [`${params.statusTonePrefix ?? ""}${item.badge.tone}`]
            : [],
        )
        .filter(Boolean)
        .join(" ");
      const badge = item.badge
        ? item.badge.variant === "status"
          ? html`
              <span class=${statusClass}>
                ${item.badge.label}
              </span>
            `
          : html`<span class=${params.tagClass ?? ""}>${item.badge.label}</span>`
        : null;
      return html`
        <div class=${params.itemClass}>
          <span class=${params.timeClass}>${item.timestampLabel}</span>
          <span class=${params.primaryClass}>${item.primary}</span>
          ${badge}
          <span class=${params.secondaryClass}>${item.secondary}</span>
        </div>
      `;
    })}
  `;
}
