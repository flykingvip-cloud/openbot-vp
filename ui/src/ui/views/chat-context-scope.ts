import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import type { ChatContextExpansionSuggestion } from "../chat/context-expansion.ts";
import {
  DEFAULT_CHAT_CONTEXT_SCOPE,
  applyConversationOnlyScope,
  applyDeepSearchToggle,
  buildContextScopeCatalogTree,
  contextSourceKey,
  filterContextScopeCatalogTree,
  normalizeChatContextScope,
  resolveContextSourceCheckState,
  summarizeChatContextPreset,
  summarizeContextReadingSources,
  toggleChatContextSource,
  toggleContextScopeExpanded,
  type ChatConsumeReceipt,
  type ChatContextCatalogGroup,
  type ChatContextCatalogGroupId,
  type ChatContextCatalogNode,
  type ChatContextLifetime,
  type ChatContextPreset,
  type ChatContextSourceCatalogItem,
  type ChatContextScopeState,
} from "../chat/context-scope.ts";
import { icons } from "../icons.ts";

export type ChatContextScopePickerProps = {
  sessionKey: string;
  connected: boolean;
  contextScope?: ChatContextScopeState;
  contextSources?: ChatContextSourceCatalogItem[];
  contextSourcesLoading?: boolean;
  onContextScopeChange?: (next: ChatContextScopeState) => void;
  onLoadContextSources?: () => void;
  /**
   * Extra chips rendered inline inside the tabs row, right after the knowledge
   * capsule (e.g. horizontal attachment capsules in compact workbench mode).
   */
  trailingChips?: unknown;
};

function presetLabels(): Record<Exclude<ChatContextPreset, "custom">, string> {
  return {
    auto: t("chat.contextPresetAuto"),
    conversation: t("chat.contextPresetConversation"),
    group: t("chat.contextPresetGroup"),
    knowledge: t("chat.contextPresetKnowledge"),
    deep: t("chat.contextPresetDeep"),
  };
}

const CONTEXT_POP_CLEANUPS = new WeakMap<HTMLElement, () => void>();

function positionContextPop(pop: HTMLElement) {
  pop.style.position = "fixed";
  pop.style.zIndex = "80";
  pop.style.margin = "0";
  pop.dataset.anchored = "true";
  const previous = pop.previousElementSibling;
  const button =
    pop.parentElement?.querySelector<HTMLElement>(".chat-compose__context-tab") ??
    (previous instanceof HTMLElement && previous.classList.contains("chat-compose__context-tab")
      ? previous
      : null);
  if (!button) {
    return;
  }
  const rect = button.getBoundingClientRect();
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const width = Math.min(420, Math.max(280, viewportWidth - 24));
  const left = Math.min(Math.max(12, rect.left), Math.max(12, viewportWidth - width - 12));
  const maxHeight = Math.min(520, Math.round(viewportHeight * 0.58) || 320);
  const spaceAbove = Math.max(0, rect.top - 12);
  const spaceBelow = Math.max(0, viewportHeight - rect.bottom - 12);
  const openUp = spaceAbove >= 240 || spaceAbove >= spaceBelow;
  pop.style.position = "fixed";
  pop.style.left = `${left}px`;
  pop.style.right = "auto";
  pop.style.width = `${width}px`;
  pop.style.zIndex = "80";
  pop.style.margin = "0";
  pop.dataset.anchored = "true";
  if (openUp) {
    pop.style.top = "auto";
    pop.style.bottom = `${Math.max(12, viewportHeight - rect.top + 8)}px`;
    pop.style.maxHeight = `${Math.min(maxHeight, Math.max(160, spaceAbove))}px`;
    return;
  }
  pop.style.bottom = "auto";
  pop.style.top = `${rect.bottom + 8}px`;
  pop.style.maxHeight = `${Math.min(maxHeight, Math.max(160, spaceBelow))}px`;
}

let boundContextPop: HTMLElement | null = null;

function unbindContextPop(el: HTMLElement | null) {
  if (!el) {
    return;
  }
  CONTEXT_POP_CLEANUPS.get(el)?.();
  CONTEXT_POP_CLEANUPS.delete(el);
  if (boundContextPop === el) {
    boundContextPop = null;
  }
}

function bindContextPop(el?: Element) {
  if (boundContextPop && boundContextPop !== el) {
    unbindContextPop(boundContextPop);
  }
  if (!(el instanceof HTMLElement)) {
    return;
  }
  boundContextPop = el;
  const update = () => positionContextPop(el);
  update();
  requestAnimationFrame(update);
  if (CONTEXT_POP_CLEANUPS.has(el)) {
    return;
  }
  window.addEventListener("resize", update);
  window.addEventListener("scroll", update, true);
  CONTEXT_POP_CLEANUPS.set(el, () => {
    window.removeEventListener("resize", update);
    window.removeEventListener("scroll", update, true);
  });
}

function groupLabel(visibility: ChatContextCatalogGroupId): string {
  if (visibility === "private") {
    return t("chat.contextGroupPrivate");
  }
  if (visibility === "team") {
    return t("chat.contextGroupTeam");
  }
  if (visibility === "enterprise") {
    return t("chat.contextGroupEnterprise");
  }
  return t("chat.contextGroupOther");
}

function renderCatalogNode(params: {
  node: ChatContextCatalogNode;
  catalog: ChatContextSourceCatalogItem[];
  selectedKeys: Set<string>;
  expandedKeys: Set<string>;
  scope: ChatContextScopeState;
  onContextScopeChange?: (next: ChatContextScopeState) => void;
}): TemplateResult {
  const { node, catalog, selectedKeys, expandedKeys, scope } = params;
  const item = node.item;
  const key = contextSourceKey(item);
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && expandedKeys.has(key);
  const check = resolveContextSourceCheckState(item, selectedKeys, catalog);
  return html`
    <div class="chat-compose__context-node" data-testid="chat-context-node" data-key=${key}>
      <div
        class="chat-compose__context-row ${check === "covered" ? "is-covered" : ""}"
        data-testid="chat-context-row"
      >
        <button
          class="chat-compose__context-row-main"
          type="button"
          ?disabled=${!hasChildren}
          aria-expanded=${hasChildren ? expanded : nothing}
          @click=${(event: Event) => {
            event.stopPropagation();
            if (!hasChildren) {
              return;
            }
            params.onContextScopeChange?.(toggleContextScopeExpanded(scope, key));
          }}
        >
          <span
            class="chat-compose__context-caret ${expanded ? "is-open" : ""} ${
              hasChildren ? "" : "is-empty"
            }"
            aria-hidden="true"
          >
            ${hasChildren ? icons.chevronRight : nothing}
          </span>
          <span class="chat-compose__context-row-text">
            <span class="chat-compose__context-source-label">
              ${item.label}
              ${
                item.hasConflict
                  ? html`<span
                      class="chat-compose__context-conflict"
                      title=${t("chat.contextConflictHint")}
                      aria-label=${t("chat.contextConflictHint")}
                    ></span>`
                  : nothing
              }
            </span>
            ${
              item.subtitle && item.type === "api"
                ? html`<span class="chat-compose__context-source-meta">${item.subtitle}</span>`
                : nothing
            }
          </span>
        </button>
        <input
          class="chat-compose__context-check"
          type="checkbox"
          .checked=${check === "checked" || check === "covered"}
          .indeterminate=${check === "indeterminate"}
          ?disabled=${check === "covered"}
          aria-label=${item.label}
          @click=${(event: Event) => event.stopPropagation()}
          @change=${() =>
            params.onContextScopeChange?.(toggleChatContextSource(scope, item, catalog))}
        />
      </div>
      ${
        expanded
          ? html`
            <div class="chat-compose__context-children" role="group">
              ${node.children.map((child) =>
                renderCatalogNode({
                  ...params,
                  node: child,
                }),
              )}
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderCatalogGroups(params: {
  groups: ChatContextCatalogGroup[];
  catalog: ChatContextSourceCatalogItem[];
  selectedKeys: Set<string>;
  expandedKeys: Set<string>;
  scope: ChatContextScopeState;
  loading: boolean;
  onContextScopeChange?: (next: ChatContextScopeState) => void;
}): TemplateResult {
  if (params.loading && params.catalog.length === 0) {
    return html`<div class="chat-compose__context-empty">${t("chat.contextBrowseLoading")}</div>`;
  }
  if (params.groups.length === 0) {
    return html`<div class="chat-compose__context-empty">${t("chat.contextBrowseEmpty")}</div>`;
  }
  const hideGroupLabel = params.groups.length === 1 && params.groups[0]?.visibility === "ungrouped";
  return html`
    ${params.groups.map(
      (group) => html`
        <div
          class="chat-compose__context-group"
          data-testid="chat-context-group"
          data-visibility=${group.visibility}
        >
          ${
            hideGroupLabel
              ? nothing
              : html`<div class="chat-compose__context-group-label">${groupLabel(group.visibility)}</div>`
          }
          ${group.nodes.map((node) =>
            renderCatalogNode({
              node,
              catalog: params.catalog,
              selectedKeys: params.selectedKeys,
              expandedKeys: params.expandedKeys,
              scope: params.scope,
              onContextScopeChange: params.onContextScopeChange,
            }),
          )}
        </div>
      `,
    )}
  `;
}

function receiptStatusLabel(status: ChatConsumeReceipt["status"]): string {
  if (status === "consumed") {
    return t("chat.contextReceiptConsumed");
  }
  if (status === "partial") {
    return t("chat.contextReceiptPartial");
  }
  if (status === "denied") {
    return t("chat.contextReceiptDenied");
  }
  return t("chat.contextReceiptUnavailable");
}

function formatContextReadingLabel(scope: ChatContextScopeState): string | null {
  const summary = summarizeContextReadingSources(scope.selectedSources);
  if (!summary) {
    return null;
  }
  if (summary.kind === "file") {
    return summary.count === 1
      ? t("chat.contextReadingFile", { name: summary.name })
      : t("chat.contextReadingFiles", { name: summary.name, count: summary.count });
  }
  return summary.count === 1
    ? t("chat.contextReadingFolder", { name: summary.name })
    : t("chat.contextReadingFolders", { name: summary.name, count: summary.count });
}

function contextTabValue(params: {
  scope: ChatContextScopeState;
  summarySource: string;
  readingLabel: string | null;
}): string {
  const knowledgeNames = params.scope.selectedSources
    .filter((source) => source.type === "knowledge" || source.type === "api")
    .map((source) => source.label)
    .filter((label): label is string => Boolean(label?.trim()));
  if (knowledgeNames.length === 1) {
    return knowledgeNames[0] ?? "";
  }
  if (knowledgeNames.length > 1) {
    return `${knowledgeNames[0]} · ${knowledgeNames.length}`;
  }
  if (params.readingLabel) {
    return "";
  }
  return params.summarySource;
}

function renderContextReadingStatus(params: {
  readingLabel: string | null;
  receipts: ChatConsumeReceipt[];
}) {
  if (params.readingLabel) {
    return html`
      <span
        class="chat-compose__context-reading"
        data-testid="chat-context-reading"
        role="status"
        title=${params.readingLabel}
        >${params.readingLabel}</span
      >
    `;
  }
  const failed = params.receipts.filter(
    (receipt) => receipt.status === "denied" || receipt.status === "unavailable",
  );
  if (failed.length === 0) {
    return nothing;
  }
  const receipt = failed[0];
  const label = `${receipt?.label ?? receipt?.id ?? ""} · ${receiptStatusLabel(receipt?.status ?? "unavailable")}`;
  return html`
    <span
      class="chat-compose__context-reading is-${receipt?.status ?? "unavailable"}"
      data-testid="chat-context-reading"
      role="status"
      title=${label}
      >${label}</span
    >
  `;
}

export function renderChatContextScopePicker(props: ChatContextScopePickerProps) {
  if (!props.onContextScopeChange) {
    return nothing;
  }
  const scope = normalizeChatContextScope(props.contextScope ?? DEFAULT_CHAT_CONTEXT_SCOPE);
  const catalog = props.contextSources ?? [];
  const summarySource = summarizeChatContextPreset(
    scope,
    presetLabels(),
    t("chat.contextPresetCustom"),
    t("chat.contextDeepSuffix"),
  );
  const summary = t("chat.contextUsing", { source: summarySource });
  const selectedKeys = new Set(scope.selectedSources.map((source) => contextSourceKey(source)));
  const filtered = filterContextScopeCatalogTree(
    buildContextScopeCatalogTree(catalog),
    scope.browserQuery,
  );
  const expandedKeys = new Set([...scope.expandedKeys, ...filtered.expandedKeys]);
  const constrained =
    scope.preset !== "auto" || scope.selectedSources.length > 0 || scope.deepEnabled;
  const readingLabel = formatContextReadingLabel(scope);
  const tabLabel = t("chat.composeContextKnowledge");
  const tabValue = constrained ? contextTabValue({ scope, summarySource, readingLabel }) : "";

  const setScope = (patch: Partial<ChatContextScopeState>) => {
    props.onContextScopeChange?.({
      ...scope,
      ...patch,
    });
  };

  return html`
    <div class="chat-compose__context ${scope.pickerOpen ? "is-open" : ""}">
      <div class="chat-compose__context-tabs">
        <button
          class="chat-compose__context-tab ${constrained || scope.pickerOpen ? "is-active" : ""}"
          type="button"
          aria-expanded=${scope.pickerOpen}
          aria-label=${tabValue ? `${tabLabel} ${tabValue}` : tabLabel}
          title=${tabValue ? `${tabLabel} ${tabValue}` : tabLabel}
          @click=${(event: Event) => {
            event.preventDefault();
            event.stopPropagation();
            const nextOpen = !scope.pickerOpen;
            setScope({ pickerOpen: nextOpen });
            if (nextOpen && props.connected) {
              props.onLoadContextSources?.();
            }
          }}
        >
          ${icons.sparkles}
          <span class="chat-compose__context-tab-label">${tabLabel}</span>
          ${
            tabValue
              ? html`<span class="chat-compose__context-tab-value">${tabValue}</span>`
              : nothing
          }
        </button>
        ${props.trailingChips ?? nothing}
        ${renderContextReadingStatus({
          readingLabel,
          receipts: scope.consumeReceipts,
        })}
      </div>
      ${
        scope.pickerOpen
          ? html`
            <div
              class="chat-compose__context-pop"
              data-testid="chat-context-pop"
              data-anchored="true"
              style="position:fixed;z-index:80"
              role="dialog"
              aria-label=${t("chat.contextPickerTitle")}
              ${ref(bindContextPop)}
              @click=${(event: Event) => event.stopPropagation()}
            >
              ${
                scope.selectedSources.length > 0
                  ? html`
                    <div class="chat-compose__context-selected" data-testid="chat-context-selected">
                      ${scope.selectedSources.map(
                        (source) => html`
                          <button
                            class="chat-compose__context-selected-chip"
                            type="button"
                            aria-label=${`${t("chat.contextSelectedRemove")} ${source.label}`}
                            @click=${() =>
                              props.onContextScopeChange?.(
                                toggleChatContextSource(scope, source, catalog),
                              )}
                          >
                            <span>${source.label}</span>
                            <span aria-hidden="true">×</span>
                          </button>
                        `,
                      )}
                    </div>
                  `
                  : nothing
              }
              <input
                class="chat-compose__context-search"
                type="search"
                .value=${scope.browserQuery}
                placeholder=${t("chat.contextBrowseSearch")}
                aria-label=${t("chat.contextBrowseSearch")}
                @input=${(event: Event) => {
                  const target = event.target as HTMLInputElement;
                  setScope({ browserQuery: target.value, pickerOpen: true });
                }}
              />
              <div class="chat-compose__context-tree" role="tree" aria-multiselectable="true">
                ${renderCatalogGroups({
                  groups: filtered.groups,
                  catalog,
                  selectedKeys,
                  expandedKeys,
                  scope,
                  loading: Boolean(props.contextSourcesLoading),
                  onContextScopeChange: props.onContextScopeChange,
                })}
              </div>
              <div class="chat-compose__context-config">
                ${(["turn", "session"] as ChatContextLifetime[]).map(
                  (lifetime) => html`
                    <button
                      class="chat-compose__context-chip ${
                        scope.lifetime === lifetime ? "is-active" : ""
                      }"
                      type="button"
                      @click=${() => setScope({ lifetime })}
                    >
                      ${
                        lifetime === "turn"
                          ? t("chat.contextLifetimeTurn")
                          : t("chat.contextLifetimeSession")
                      }
                    </button>
                  `,
                )}
                <button
                  class="chat-compose__context-chip ${scope.deepEnabled ? "is-active" : ""}"
                  type="button"
                  @click=${() => props.onContextScopeChange?.(applyDeepSearchToggle(scope))}
                >
                  ${t("chat.contextDeepSearch")}
                </button>
                <button
                  class="chat-compose__context-chip ${
                    scope.preset === "conversation" && scope.selectedSources.length === 0
                      ? "is-active"
                      : ""
                  }"
                  type="button"
                  @click=${() => props.onContextScopeChange?.(applyConversationOnlyScope(scope))}
                >
                  ${t("chat.contextConversationOnly")}
                </button>
              </div>
              <div class="chat-compose__context-summary">${summary}</div>
            </div>
          `
          : nothing
      }
    </div>
  `;
}

export function renderChatContextExpansionBanner(props: {
  expansion?: ChatContextExpansionSuggestion | null;
  onAccept?: () => void;
  onDismiss?: () => void;
}) {
  const sources = props.expansion?.proposedSources ?? [];
  if (!props.expansion || sources.length === 0 || !props.onAccept || !props.onDismiss) {
    return nothing;
  }
  const names = sources.map((source) => source.label).filter(Boolean);
  const sourceLabel =
    names.length <= 2 ? names.join("、") : `${names.slice(0, 2).join("、")} · ${names.length}`;
  return html`
    <div class="chat-compose__context-expand" role="status">
      <p class="chat-compose__context-expand-copy">
        ${t("chat.contextExpandHint", { sources: sourceLabel })}
      </p>
      <div class="chat-compose__context-expand-actions">
        <button class="btn btn--sm" type="button" @click=${props.onAccept}>
          ${t("chat.contextExpandAccept")}
        </button>
        <button class="btn btn--sm btn--ghost" type="button" @click=${props.onDismiss}>
          ${t("chat.contextExpandDismiss")}
        </button>
      </div>
    </div>
  `;
}
