export type ChatContextPreset = "auto" | "conversation" | "group" | "knowledge" | "deep" | "custom";
export type ChatContextLifetime = "turn" | "session";
export type ChatContextSourceKind = "knowledge" | "file" | "folder" | "api";
export type ChatContextBrowserKind = "all" | ChatContextSourceKind;
export type ChatContextVisibility = "private" | "team" | "enterprise";
export type ChatContextCatalogGroupId = ChatContextVisibility | "ungrouped";
export type ChatContextCheckState = "checked" | "unchecked" | "indeterminate" | "covered";

export type ChatContextSourceSelection = {
  type: ChatContextSourceKind;
  id: string;
  label: string;
  parentId?: string;
};

export type ChatConsumeReceiptStatus = "consumed" | "partial" | "unavailable" | "denied";

export type ChatConsumeReceipt = {
  type: ChatContextSourceKind;
  id: string;
  parentId?: string;
  label?: string;
  status: ChatConsumeReceiptStatus;
  reasonCode?: string;
};

export type ChatContextSourceCatalogItem = ChatContextSourceSelection & {
  subtitle?: string;
  visibility?: ChatContextVisibility;
  hasConflict?: boolean;
};

export type ChatContextCatalogNode = {
  item: ChatContextSourceCatalogItem;
  children: ChatContextCatalogNode[];
};

export type ChatContextCatalogGroup = {
  visibility: ChatContextCatalogGroupId;
  nodes: ChatContextCatalogNode[];
};

export type ChatContextScopeState = {
  preset: ChatContextPreset;
  lifetime: ChatContextLifetime;
  pickerOpen: boolean;
  selectedSources: ChatContextSourceSelection[];
  browserQuery: string;
  browserKind: ChatContextBrowserKind;
  deepEnabled: boolean;
  expandedKeys: string[];
  consumeReceipts: ChatConsumeReceipt[];
};

export type ChatContextScopePayload = {
  mode: "minimal" | "auto" | "focused" | "deep";
  lifetime: ChatContextLifetime;
  sources?: Array<{
    type: "conversation" | "group" | "knowledge" | "folder" | "file" | "api";
    id: string;
    parentId?: string;
  }>;
};

export const DEFAULT_CHAT_CONTEXT_SCOPE: ChatContextScopeState = {
  preset: "auto",
  lifetime: "turn",
  pickerOpen: false,
  selectedSources: [],
  browserQuery: "",
  browserKind: "all",
  deepEnabled: false,
  expandedKeys: [],
  consumeReceipts: [],
};

export const CONTEXT_CATALOG_GROUP_ORDER: ChatContextCatalogGroupId[] = [
  "private",
  "team",
  "enterprise",
  "ungrouped",
];

const SOURCE_KINDS = new Set(["knowledge", "file", "folder", "api"]);
const VISIBILITIES = new Set(["private", "team", "enterprise"]);
const PARENT_TYPES = new Set(["knowledge", "folder"]);
const RECEIPT_STATUSES = new Set(["consumed", "partial", "unavailable", "denied"]);

export function normalizeChatContextScope(
  state: ChatContextScopeState | null | undefined,
): ChatContextScopeState {
  return {
    preset: state?.preset ?? DEFAULT_CHAT_CONTEXT_SCOPE.preset,
    lifetime: state?.lifetime ?? DEFAULT_CHAT_CONTEXT_SCOPE.lifetime,
    pickerOpen: Boolean(state?.pickerOpen),
    selectedSources: Array.isArray(state?.selectedSources) ? state.selectedSources : [],
    browserQuery: state?.browserQuery ?? "",
    browserKind: state?.browserKind ?? "all",
    deepEnabled: Boolean(state?.deepEnabled) || state?.preset === "deep",
    expandedKeys: Array.isArray(state?.expandedKeys) ? state.expandedKeys : [],
    consumeReceipts: Array.isArray(state?.consumeReceipts) ? state.consumeReceipts : [],
  };
}

export function resolveGroupIdFromSessionKey(sessionKey: string | null | undefined): string | null {
  const key = sessionKey?.trim() ?? "";
  if (!key) {
    return null;
  }
  if (key.startsWith("space:")) {
    return key.slice("space:".length).trim() || null;
  }
  const marker = ":space:";
  const index = key.indexOf(marker);
  if (index >= 0) {
    return key.slice(index + marker.length).trim() || null;
  }
  return null;
}

export function contextSourceKey(source: { type: string; id: string }): string {
  return `${source.type}:${source.id}`;
}

function catalogItemFor(
  item: ChatContextSourceSelection,
  catalog: ChatContextSourceCatalogItem[],
): ChatContextSourceCatalogItem {
  return catalog.find((entry) => contextSourceKey(entry) === contextSourceKey(item)) ?? item;
}

function resolveCatalogParent(
  item: ChatContextSourceCatalogItem,
  catalog: ChatContextSourceCatalogItem[],
): ChatContextSourceCatalogItem | undefined {
  const parentId = item.parentId?.trim();
  if (!parentId) {
    return undefined;
  }
  return (
    catalog.find((candidate) => candidate.id === parentId && PARENT_TYPES.has(candidate.type)) ??
    catalog.find((candidate) => candidate.id === parentId)
  );
}

function ancestorKeys(
  item: ChatContextSourceCatalogItem,
  catalog: ChatContextSourceCatalogItem[],
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  let current = resolveCatalogParent(item, catalog);
  while (current) {
    const key = contextSourceKey(current);
    if (seen.has(key)) {
      break;
    }
    seen.add(key);
    keys.push(key);
    current = resolveCatalogParent(current, catalog);
  }
  return keys;
}

export function isCoveredBySelectedAncestor(
  item: ChatContextSourceCatalogItem,
  selectedKeys: Set<string>,
  catalog: ChatContextSourceCatalogItem[],
): boolean {
  return ancestorKeys(item, catalog).some((key) => selectedKeys.has(key));
}

function descendantKeys(
  parent: ChatContextSourceCatalogItem,
  catalog: ChatContextSourceCatalogItem[],
): string[] {
  const parentKey = contextSourceKey(parent);
  return catalog
    .filter((item) => ancestorKeys(item, catalog).includes(parentKey))
    .map((item) => contextSourceKey(item));
}

export function resolveContextSourceCheckState(
  item: ChatContextSourceCatalogItem,
  selectedKeys: Set<string>,
  catalog: ChatContextSourceCatalogItem[],
): ChatContextCheckState {
  const resolved = catalogItemFor(item, catalog);
  if (isCoveredBySelectedAncestor(resolved, selectedKeys, catalog)) {
    return "covered";
  }
  if (selectedKeys.has(contextSourceKey(resolved))) {
    return "checked";
  }
  const selectedDescendants = descendantKeys(resolved, catalog).filter((key) =>
    selectedKeys.has(key),
  );
  return selectedDescendants.length > 0 ? "indeterminate" : "unchecked";
}

function toSelection(item: ChatContextSourceSelection): ChatContextSourceSelection {
  const parentId = item.parentId?.trim();
  return {
    type: item.type,
    id: item.id,
    label: item.label,
    ...(parentId ? { parentId } : {}),
  };
}

function toPayloadSource(
  source: ChatContextSourceSelection,
  catalog: ChatContextSourceCatalogItem[],
): { type: ChatContextSourceSelection["type"]; id: string; parentId?: string } {
  const resolved = catalogItemFor(source, catalog);
  const parentId = resolved.parentId?.trim() || source.parentId?.trim();
  if (source.type === "knowledge" || !parentId) {
    return { type: source.type, id: source.id };
  }
  return { type: source.type, id: source.id, parentId };
}

export function toggleChatContextSource(
  state: ChatContextScopeState | null | undefined,
  item: ChatContextSourceSelection,
  catalog: ChatContextSourceCatalogItem[] = [],
): ChatContextScopeState {
  const scope = normalizeChatContextScope(state);
  const resolved = catalogItemFor(item, catalog);
  const selectedKeys = new Set(scope.selectedSources.map((source) => contextSourceKey(source)));
  if (isCoveredBySelectedAncestor(resolved, selectedKeys, catalog)) {
    return scope;
  }
  const key = contextSourceKey(resolved);
  const exists = selectedKeys.has(key);
  const selectedSources = exists
    ? scope.selectedSources.filter((source) => contextSourceKey(source) !== key)
    : [
        ...scope.selectedSources.filter(
          (source) => !descendantKeys(resolved, catalog).includes(contextSourceKey(source)),
        ),
        toSelection(resolved),
      ];
  return {
    ...scope,
    selectedSources,
    preset:
      selectedSources.length > 0 ? "custom" : scope.preset === "custom" ? "auto" : scope.preset,
  };
}

export function toggleContextScopeExpanded(
  state: ChatContextScopeState | null | undefined,
  key: string,
): ChatContextScopeState {
  const scope = normalizeChatContextScope(state);
  const exists = scope.expandedKeys.includes(key);
  return {
    ...scope,
    expandedKeys: exists
      ? scope.expandedKeys.filter((item) => item !== key)
      : [...scope.expandedKeys, key],
    pickerOpen: true,
  };
}

export function applyConversationOnlyScope(
  state: ChatContextScopeState | null | undefined,
): ChatContextScopeState {
  const scope = normalizeChatContextScope(state);
  return {
    ...scope,
    preset: "conversation",
    selectedSources: [],
    deepEnabled: false,
    pickerOpen: true,
  };
}

export function applyDeepSearchToggle(
  state: ChatContextScopeState | null | undefined,
): ChatContextScopeState {
  const scope = normalizeChatContextScope(state);
  const deepEnabled = !scope.deepEnabled;
  return {
    ...scope,
    deepEnabled,
    preset:
      deepEnabled && scope.preset === "conversation"
        ? "auto"
        : !deepEnabled && scope.preset === "deep"
          ? "auto"
          : scope.preset,
    pickerOpen: true,
  };
}

export function parseContextScopeCatalog(raw: unknown): ChatContextSourceCatalogItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: ChatContextSourceCatalogItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.trim() : "";
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!SOURCE_KINDS.has(type) || !id || !label) {
      continue;
    }
    const visibility =
      typeof record.visibility === "string" && VISIBILITIES.has(record.visibility)
        ? (record.visibility as ChatContextVisibility)
        : undefined;
    items.push({
      type: type as ChatContextSourceKind,
      id,
      label,
      ...(typeof record.subtitle === "string" && record.subtitle.trim()
        ? { subtitle: record.subtitle.trim() }
        : {}),
      ...(typeof record.parentId === "string" && record.parentId.trim()
        ? { parentId: record.parentId.trim() }
        : {}),
      ...(visibility ? { visibility } : {}),
      ...(record.hasConflict === true ? { hasConflict: true } : {}),
    });
  }
  return items;
}

function itemMatchesQuery(item: ChatContextSourceCatalogItem, needle: string): boolean {
  if (!needle) {
    return true;
  }
  return (
    item.label.toLowerCase().includes(needle) ||
    item.id.toLowerCase().includes(needle) ||
    (item.subtitle?.toLowerCase().includes(needle) ?? false)
  );
}

export function filterContextScopeCatalog(
  items: ChatContextSourceCatalogItem[],
  query: string,
  kind: ChatContextBrowserKind,
): ChatContextSourceCatalogItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (kind !== "all" && item.type !== kind) {
      return false;
    }
    return itemMatchesQuery(item, needle);
  });
}

function toNode(
  item: ChatContextSourceCatalogItem,
  childrenByParentId: Map<string, ChatContextSourceCatalogItem[]>,
  visiting: Set<string>,
): ChatContextCatalogNode {
  const key = contextSourceKey(item);
  if (visiting.has(key)) {
    return { item, children: [] };
  }
  visiting.add(key);
  const children = (childrenByParentId.get(item.id) ?? [])
    .filter((child) => contextSourceKey(child) !== key)
    .map((child) => toNode(child, childrenByParentId, visiting));
  visiting.delete(key);
  return { item, children };
}

export function buildContextScopeCatalogTree(
  items: ChatContextSourceCatalogItem[],
): ChatContextCatalogGroup[] {
  const childIds = new Set<string>();
  const childrenByParentId = new Map<string, ChatContextSourceCatalogItem[]>();
  for (const item of items) {
    const parent = resolveCatalogParent(item, items);
    if (!parent) {
      continue;
    }
    childIds.add(contextSourceKey(item));
    const siblings = childrenByParentId.get(parent.id) ?? [];
    siblings.push(item);
    childrenByParentId.set(parent.id, siblings);
  }

  const roots = items.filter((item) => !childIds.has(contextSourceKey(item)));
  const grouped = new Map<ChatContextCatalogGroupId, ChatContextCatalogNode[]>();
  for (const root of roots) {
    const visibility: ChatContextCatalogGroupId =
      root.type === "knowledge" && root.visibility ? root.visibility : "ungrouped";
    const nodes = grouped.get(visibility) ?? [];
    nodes.push(toNode(root, childrenByParentId, new Set()));
    grouped.set(visibility, nodes);
  }

  return CONTEXT_CATALOG_GROUP_ORDER.flatMap((visibility) => {
    const nodes = grouped.get(visibility);
    return nodes && nodes.length > 0 ? [{ visibility, nodes }] : [];
  });
}

function filterNode(
  node: ChatContextCatalogNode,
  needle: string,
): { node: ChatContextCatalogNode; expandedKeys: string[] } | null {
  const childHits = needle
    ? node.children.flatMap((child) => {
        const hit = filterNode(child, needle);
        return hit ? [hit] : [];
      })
    : node.children.map((child) => ({ node: child, expandedKeys: [] as string[] }));
  const selfMatch = itemMatchesQuery(node.item, needle);
  if (!selfMatch && childHits.length === 0) {
    return null;
  }
  const children = selfMatch && needle ? node.children : childHits.map((hit) => hit.node);
  const expandedKeys =
    needle && childHits.length > 0
      ? [contextSourceKey(node.item), ...childHits.flatMap((hit) => hit.expandedKeys)]
      : childHits.flatMap((hit) => hit.expandedKeys);
  return {
    node: { item: node.item, children },
    expandedKeys,
  };
}

export function filterContextScopeCatalogTree(
  groups: ChatContextCatalogGroup[],
  query: string,
): { groups: ChatContextCatalogGroup[]; expandedKeys: string[] } {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return { groups, expandedKeys: [] };
  }
  const expandedKeys: string[] = [];
  const nextGroups: ChatContextCatalogGroup[] = [];
  for (const group of groups) {
    const nodes: ChatContextCatalogNode[] = [];
    for (const node of group.nodes) {
      const hit = filterNode(node, needle);
      if (!hit) {
        continue;
      }
      nodes.push(hit.node);
      expandedKeys.push(...hit.expandedKeys);
    }
    if (nodes.length > 0) {
      nextGroups.push({ visibility: group.visibility, nodes });
    }
  }
  return { groups: nextGroups, expandedKeys: [...new Set(expandedKeys)] };
}

export type ContextReadingSummary = {
  kind: "file" | "folder";
  name: string;
  count: number;
};

/** File/folder selection shown beside the knowledge capsule — not knowledge-base receipts. */
export function summarizeContextReadingSources(
  sources: Array<{ type: string; id: string; label?: string }>,
): ContextReadingSummary | null {
  const files = sources.filter((source) => source.type === "file");
  const folders = sources.filter((source) => source.type === "folder");
  const useFolders = folders.length > 0 && folders.length >= files.length;
  const group = useFolders ? folders : files;
  const first = group[0];
  if (!first) {
    return null;
  }
  const name = first.label?.trim() || first.id.trim();
  if (!name) {
    return null;
  }
  return {
    kind: useFolders ? "folder" : "file",
    name,
    count: group.length,
  };
}

export function compactChatContextSources(
  selected: ChatContextSourceSelection[],
  catalog: ChatContextSourceCatalogItem[],
): ChatContextSourceSelection[] {
  const selectedKeys = new Set(selected.map((source) => contextSourceKey(source)));
  return selected.filter((source) => {
    const item =
      catalog.find((entry) => contextSourceKey(entry) === contextSourceKey(source)) ?? source;
    return !isCoveredBySelectedAncestor(item, selectedKeys, catalog);
  });
}

function isDeepScope(scope: ChatContextScopeState): boolean {
  return scope.deepEnabled || scope.preset === "deep";
}

export function toChatSendContextScope(
  state: ChatContextScopeState | null | undefined,
  sessionKey: string,
  catalog: ChatContextSourceCatalogItem[] = [],
): ChatContextScopePayload | undefined {
  const scope = normalizeChatContextScope(state);
  const lifetime = scope.lifetime;
  const selectedSources = compactChatContextSources(scope.selectedSources, catalog);
  if (selectedSources.length > 0) {
    return {
      mode: isDeepScope(scope) ? "deep" : "focused",
      lifetime,
      sources: selectedSources.map((source) => toPayloadSource(source, catalog)),
    };
  }
  if (scope.preset === "conversation") {
    return { mode: "minimal", lifetime };
  }
  if (isDeepScope(scope)) {
    return { mode: "deep", lifetime };
  }
  if (scope.preset === "auto" || scope.preset === "custom") {
    return lifetime === "turn" ? undefined : { mode: "auto", lifetime };
  }
  if (scope.preset === "group") {
    const groupId = resolveGroupIdFromSessionKey(sessionKey);
    if (!groupId) {
      return undefined;
    }
    return {
      mode: "focused",
      lifetime,
      sources: [{ type: "group", id: groupId }],
    };
  }
  return {
    mode: "focused",
    lifetime,
    sources: [{ type: "knowledge", id: "authorized" }],
  };
}

export function summarizeChatContextPreset(
  scope: ChatContextScopeState,
  labels: Record<Exclude<ChatContextPreset, "custom">, string>,
  customLabel: string,
  deepSuffix?: string,
): string {
  const normalized = normalizeChatContextScope(scope);
  if (normalized.selectedSources.length > 0) {
    const names = normalized.selectedSources.map((source) => source.label).filter(Boolean);
    const base =
      names.length === 1
        ? (names[0] ?? customLabel)
        : names.length > 1
          ? `${names[0]} · ${names.length}`
          : customLabel;
    return normalized.deepEnabled && deepSuffix ? `${base} · ${deepSuffix}` : base;
  }
  if (normalized.preset === "custom") {
    return customLabel;
  }
  if (normalized.preset === "conversation") {
    return labels.conversation;
  }
  const base = labels[normalized.preset === "deep" ? "auto" : normalized.preset];
  return normalized.deepEnabled && deepSuffix ? `${base} · ${deepSuffix}` : base;
}

function uiKindFromConsumeRefType(type: string): ChatContextSourceKind | null {
  if (type === "knowledge-base") {
    return "knowledge";
  }
  if (type === "knowledge-file" || type === "deliverable") {
    return "file";
  }
  if (type === "folder" || type === "api") {
    return type;
  }
  return SOURCE_KINDS.has(type) ? (type as ChatContextSourceKind) : null;
}

function parseConsumeReceipt(raw: unknown): ChatConsumeReceipt | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const ref =
    record.ref && typeof record.ref === "object" ? (record.ref as Record<string, unknown>) : record;
  const type = uiKindFromConsumeRefType(typeof ref.type === "string" ? ref.type.trim() : "");
  const id = typeof ref.id === "string" ? ref.id.trim() : "";
  const status = typeof record.status === "string" ? record.status.trim() : "";
  if (!type || !id || !RECEIPT_STATUSES.has(status)) {
    return null;
  }
  const parentId = typeof ref.parentId === "string" ? ref.parentId.trim() : "";
  const label = typeof record.label === "string" ? record.label.trim() : "";
  const reasonCode = typeof record.reasonCode === "string" ? record.reasonCode.trim() : "";
  return {
    type,
    id,
    status: status as ChatConsumeReceiptStatus,
    ...(parentId ? { parentId } : {}),
    ...(label ? { label } : {}),
    ...(reasonCode ? { reasonCode } : {}),
  };
}

export function parseConsumeReceiptsFromAgentEvent(
  payload:
    | {
        sessionKey?: unknown;
        data?: unknown;
      }
    | null
    | undefined,
): ChatConsumeReceipt[] | null {
  const data =
    payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  if (!data) {
    return null;
  }
  const event = typeof data.event === "string" ? data.event.trim() : "";
  if (event !== "chat.knowledge_finished" && event !== "chat.knowledge_degraded") {
    return null;
  }
  if (!Array.isArray(data.consumeReceipts)) {
    return [];
  }
  return data.consumeReceipts
    .map(parseConsumeReceipt)
    .filter((item): item is ChatConsumeReceipt => Boolean(item));
}

export function applyConsumeReceipts(
  state: ChatContextScopeState | null | undefined,
  receipts: ChatConsumeReceipt[],
  catalog: ChatContextSourceCatalogItem[] = [],
): ChatContextScopeState {
  const scope = normalizeChatContextScope(state);
  return {
    ...scope,
    consumeReceipts: receipts.map((receipt) => {
      if (receipt.label) {
        return receipt;
      }
      const match =
        catalog.find((item) => contextSourceKey(item) === contextSourceKey(receipt)) ??
        scope.selectedSources.find((item) => contextSourceKey(item) === contextSourceKey(receipt));
      return match?.label ? { ...receipt, label: match.label } : receipt;
    }),
  };
}
