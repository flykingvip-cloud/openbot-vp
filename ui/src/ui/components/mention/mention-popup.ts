import { html, nothing, type TemplateResult } from "lit";
import type {
  MatchResult,
  MentionCandidate,
} from "../../../../../src/organization/mention-types.js";
import { match } from "./fuzzy-matcher.js";

export const MENTION_ALL_AGENT_ID = "__all__";

const DEFAULT_POPUP_ID = "mention-popup";
const DEFAULT_ITEM_HEIGHT = 44;
const DEFAULT_MAX_VISIBLE_ITEMS = 8;
const DEFAULT_VIEWPORT_HEIGHT = 768;
const DEFAULT_VERTICAL_GAP = 8;
const DEFAULT_DEBOUNCE_MS = 50;

export type MentionPopupPlacement = "above" | "below";

export type MentionPopupItem =
  | {
      type: "all";
      agentId: typeof MENTION_ALL_AGENT_ID;
      displayName: string;
      roleName: string;
      online: true;
      isCoordinator: false;
      isBot: false;
      match: null;
    }
  | {
      type: "candidate";
      kind?: "agent" | "human" | "all" | "plugin";
      agentId: string;
      userId?: string;
      displayName: string;
      roleName?: string;
      online: boolean;
      isCoordinator: boolean;
      isBot: boolean;
      capabilityTags?: string[];
      currentTask?: string;
      match: MatchResult;
    };

export interface MentionPopupCaretPosition {
  top: number;
  left: number;
}

export interface MentionPopupProps {
  query: string;
  candidates: MentionCandidate[];
  currentAgentId?: string | null;
  caretPosition: MentionPopupCaretPosition;
  id?: string;
  open?: boolean;
  activeIndex?: number;
  viewportHeight?: number;
  itemHeight?: number;
  maxVisibleItems?: number;
  verticalGap?: number;
  onActiveIndexChange?: (activeIndex: number) => void;
  onSelect?: (item: MentionPopupItem) => void;
  onDismiss?: () => void;
}

export interface MentionPopupPlacementParams {
  caretPosition: MentionPopupCaretPosition;
  itemCount: number;
  viewportHeight?: number;
  itemHeight?: number;
  maxVisibleItems?: number;
  verticalGap?: number;
}

export interface MentionPopupPlacementResult {
  placement: MentionPopupPlacement;
  top: number;
  left: number;
  maxHeight: number;
}

export interface MentionPopupKeydownParams {
  event: Pick<KeyboardEvent, "key" | "preventDefault">;
  items: MentionPopupItem[];
  activeIndex: number;
  onActiveIndexChange?: (activeIndex: number) => void;
  onSelect?: (item: MentionPopupItem) => void;
  onDismiss?: () => void;
}

export interface MentionQueryDebouncer {
  update(query: string): void;
  flush(): void;
  cancel(): void;
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function toAllMembersItem(): MentionPopupItem {
  return {
    type: "all",
    agentId: MENTION_ALL_AGENT_ID,
    displayName: "所有人",
    roleName: "All Members",
    online: true,
    isCoordinator: false,
    isBot: false,
    match: null,
  };
}

export function shouldIncludeAllMembers(query: string): boolean {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) {
    return true;
  }
  return "all".startsWith(normalizedQuery) || "所有人".includes(normalizedQuery);
}

export function deriveMentionPopupItems(params: {
  candidates: MentionCandidate[];
  query: string;
  currentAgentId?: string | null;
  currentUserId?: string | null;
}): MentionPopupItem[] {
  const selfUserId = params.currentUserId?.trim().toLowerCase() ?? "";
  const filteredCandidates = params.candidates.filter((candidate) => {
    if (candidate.kind === "human" || candidate.userId) {
      if (!selfUserId) {
        return true;
      }
      return (candidate.userId ?? "").trim().toLowerCase() !== selfUserId;
    }
    if (!params.currentAgentId) {
      return true;
    }
    return candidate.agentId !== params.currentAgentId;
  });
  const matchedCandidates = match(filteredCandidates, params.query).map<MentionPopupItem>(
    (result) => ({
      type: "candidate",
      kind: result.candidate.kind,
      agentId: result.candidate.agentId,
      userId: result.candidate.userId,
      displayName: result.candidate.displayName,
      roleName: result.candidate.roleName,
      online: result.candidate.online,
      isCoordinator: result.candidate.isCoordinator,
      isBot: result.candidate.isBot,
      capabilityTags: result.candidate.capabilityTags,
      currentTask: result.candidate.currentTask,
      match: result,
    }),
  );

  return shouldIncludeAllMembers(params.query)
    ? [toAllMembersItem(), ...matchedCandidates]
    : matchedCandidates;
}

export function normalizeActiveIndex(activeIndex: number | undefined, itemCount: number): number {
  if (itemCount <= 0) {
    return -1;
  }
  if (!Number.isFinite(activeIndex)) {
    return 0;
  }
  return Math.max(0, Math.min(itemCount - 1, Math.trunc(activeIndex ?? 0)));
}

export function moveMentionPopupActiveIndex(
  activeIndex: number,
  direction: 1 | -1,
  itemCount: number,
): number {
  if (itemCount <= 0) {
    return -1;
  }
  const normalizedIndex = normalizeActiveIndex(activeIndex, itemCount);
  return (normalizedIndex + direction + itemCount) % itemCount;
}

export function resolveMentionPopupPlacement(
  params: MentionPopupPlacementParams,
): MentionPopupPlacementResult {
  const viewportHeight = Math.max(0, params.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT);
  const itemHeight = Math.max(1, params.itemHeight ?? DEFAULT_ITEM_HEIGHT);
  const maxVisibleItems = Math.max(1, params.maxVisibleItems ?? DEFAULT_MAX_VISIBLE_ITEMS);
  const verticalGap = Math.max(0, params.verticalGap ?? DEFAULT_VERTICAL_GAP);
  const visibleItemCount = Math.max(1, Math.min(params.itemCount || 1, maxVisibleItems));
  const maxHeight = visibleItemCount * itemHeight;
  const spaceBelow = viewportHeight - params.caretPosition.top - verticalGap;
  const spaceAbove = params.caretPosition.top - verticalGap;
  const placement: MentionPopupPlacement =
    spaceBelow >= maxHeight || spaceBelow >= spaceAbove ? "below" : "above";
  const top =
    placement === "below"
      ? params.caretPosition.top + verticalGap
      : Math.max(verticalGap, params.caretPosition.top - maxHeight - verticalGap);

  return {
    placement,
    top,
    left: Math.max(0, params.caretPosition.left),
    maxHeight,
  };
}

export function handleMentionPopupKeydown(params: MentionPopupKeydownParams): boolean {
  if (params.items.length === 0) {
    if (params.event.key === "Escape") {
      params.event.preventDefault();
      params.onDismiss?.();
      return true;
    }
    return false;
  }

  if (params.event.key === "ArrowDown") {
    params.event.preventDefault();
    params.onActiveIndexChange?.(
      moveMentionPopupActiveIndex(params.activeIndex, 1, params.items.length),
    );
    return true;
  }

  if (params.event.key === "ArrowUp") {
    params.event.preventDefault();
    params.onActiveIndexChange?.(
      moveMentionPopupActiveIndex(params.activeIndex, -1, params.items.length),
    );
    return true;
  }

  if (params.event.key === "Enter" || params.event.key === "Tab") {
    params.event.preventDefault();
    const activeIndex = normalizeActiveIndex(params.activeIndex, params.items.length);
    params.onSelect?.(params.items[activeIndex]);
    return true;
  }

  if (params.event.key === "Escape") {
    params.event.preventDefault();
    params.onDismiss?.();
    return true;
  }

  return false;
}

export function createMentionQueryDebouncer(
  onQueryChange: (query: string) => void,
  delayMs = DEFAULT_DEBOUNCE_MS,
): MentionQueryDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingQuery: string | null = null;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    if (pendingQuery === null) {
      return;
    }
    const query = pendingQuery;
    pendingQuery = null;
    cancel();
    onQueryChange(query);
  };

  return {
    update(query: string) {
      pendingQuery = query;
      cancel();
      timer = setTimeout(flush, Math.max(0, delayMs));
    },
    flush,
    cancel() {
      pendingQuery = null;
      cancel();
    },
  };
}

function getItemId(popupId: string, index: number): string {
  return `${popupId}-option-${index}`;
}

function renderStatus(item: MentionPopupItem): TemplateResult {
  return html`
    <span class=${`mention-popup__status ${item.online ? "is-online" : "is-offline"}`}>
      ${item.online ? "在线" : "离线"}
    </span>
  `;
}

function renderBadges(item: MentionPopupItem): TemplateResult | typeof nothing {
  if (item.type === "all") {
    return nothing;
  }
  return html`
    ${
      item.isCoordinator
        ? html`
            <span class="mention-popup__badge mention-popup__badge--coordinator" title="Coordinator">🧠</span>
          `
        : nothing
    }
    ${
      item.isBot
        ? html`
            <span class="mention-popup__badge mention-popup__badge--bot" title="Bot">Bot</span>
          `
        : nothing
    }
  `;
}

function renderOrganizationSignals(item: MentionPopupItem): TemplateResult | typeof nothing {
  if (item.type === "all") {
    return nothing;
  }
  const tags = item.capabilityTags?.slice(0, 3) ?? [];
  if (tags.length === 0 && !item.currentTask) {
    return nothing;
  }

  return html`
    <span class="mention-popup__signals">
      ${
        tags.length > 0
          ? html`
              <span class="mention-popup__tags">${tags.join(" / ")}</span>
            `
          : nothing
      }
      ${
        item.currentTask
          ? html`
              <span class="mention-popup__task">${item.currentTask}</span>
            `
          : nothing
      }
    </span>
  `;
}

function renderMentionPopupItem(params: {
  item: MentionPopupItem;
  index: number;
  popupId: string;
  selected: boolean;
  onSelect?: (item: MentionPopupItem) => void;
}): TemplateResult {
  const item = params.item;
  return html`
    <div
      id=${getItemId(params.popupId, params.index)}
      class=${`mention-popup__option ${params.selected ? "is-active" : ""}`}
      role="option"
      aria-selected=${params.selected ? "true" : "false"}
      data-agent-id=${item.agentId}
      @mousedown=${(event: MouseEvent) => event.preventDefault()}
      @click=${() => params.onSelect?.(item)}
    >
      <span class="mention-popup__avatar" aria-hidden="true">
        ${item.type === "all" ? "@" : item.displayName.slice(0, 1).toLocaleUpperCase()}
      </span>
      <span class="mention-popup__main">
        <span class="mention-popup__name">${item.displayName}</span>
        <span class="mention-popup__meta">
          ${item.roleName ? html`<span>${item.roleName}</span>` : nothing} ${renderStatus(item)}
        </span>
        ${renderOrganizationSignals(item)}
      </span>
      <span class="mention-popup__badges">${renderBadges(item)}</span>
    </div>
  `;
}

export function renderMentionPopup(props: MentionPopupProps): TemplateResult | typeof nothing {
  if (props.open === false) {
    return nothing;
  }

  const popupId = props.id ?? DEFAULT_POPUP_ID;
  const items = deriveMentionPopupItems({
    candidates: props.candidates,
    query: props.query,
    currentAgentId: props.currentAgentId,
  });
  const activeIndex = normalizeActiveIndex(props.activeIndex, items.length);
  const placement = resolveMentionPopupPlacement({
    caretPosition: props.caretPosition,
    itemCount: items.length,
    viewportHeight: props.viewportHeight,
    itemHeight: props.itemHeight,
    maxVisibleItems: props.maxVisibleItems,
    verticalGap: props.verticalGap,
  });
  const activeDescendant = activeIndex >= 0 ? getItemId(popupId, activeIndex) : "";
  const style = [
    `top:${placement.top}px`,
    `left:${placement.left}px`,
    `max-height:${placement.maxHeight}px`,
  ].join(";");

  return html`
    <div
      id=${popupId}
      class=${`mention-popup mention-popup--${placement.placement}`}
      role="listbox"
      aria-expanded="true"
      aria-activedescendant=${activeDescendant}
      style=${style}
      @keydown=${(event: KeyboardEvent) =>
        handleMentionPopupKeydown({
          event,
          items,
          activeIndex,
          onActiveIndexChange: props.onActiveIndexChange,
          onSelect: props.onSelect,
          onDismiss: props.onDismiss,
        })}
    >
      ${
        items.length === 0
          ? html`
              <div class="mention-popup__empty" role="status">无匹配成员</div>
            `
          : items.map((item, index) =>
              renderMentionPopupItem({
                item,
                index,
                popupId,
                selected: index === activeIndex,
                onSelect: props.onSelect,
              }),
            )
      }
    </div>
  `;
}
