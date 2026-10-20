import {
  contextSourceKey,
  normalizeChatContextScope,
  type ChatContextScopeState,
  type ChatContextSourceKind,
  type ChatContextSourceSelection,
} from "./context-scope.ts";
import { extractText } from "./message-extract.ts";

export type ChatContextExpansionReason = "empty" | "degraded" | "narrow_focus";

export type ChatContextExpansionSuggestion = {
  runId: string;
  sessionKey?: string;
  reason: ChatContextExpansionReason;
  proposedSources: ChatContextSourceSelection[];
};

const REASONS = new Set(["empty", "degraded", "narrow_focus"]);
const SOURCE_KINDS = new Set(["knowledge", "file", "folder", "api"]);

function parseProposedSources(raw: unknown): ChatContextSourceSelection[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: ChatContextSourceSelection[] = [];
  const seen = new Set<string>();
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
    const parentId = typeof record.parentId === "string" ? record.parentId.trim() : "";
    const item: ChatContextSourceSelection = {
      type: type as ChatContextSourceKind,
      id,
      label,
      ...(parentId ? { parentId } : {}),
    };
    const key = contextSourceKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(item);
  }
  return items;
}

export function parseContextExpansionAgentEvent(payload: {
  runId?: unknown;
  sessionKey?: unknown;
  data?: unknown;
}): ChatContextExpansionSuggestion | null {
  const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  if (!runId || !data || data.event !== "chat.context_expansion_suggested") {
    return null;
  }
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  const proposedSources = parseProposedSources(data.proposedSources);
  if (!REASONS.has(reason) || proposedSources.length === 0) {
    return null;
  }
  const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey.trim() : "";
  return {
    runId,
    reason: reason as ChatContextExpansionReason,
    proposedSources,
    ...(sessionKey ? { sessionKey } : {}),
  };
}

export function applyContextExpansionToScope(
  state: ChatContextScopeState | null | undefined,
  proposedSources: ChatContextSourceSelection[],
): ChatContextScopeState {
  const scope = normalizeChatContextScope(state);
  const selectedSources: ChatContextSourceSelection[] = [];
  const seen = new Set<string>();
  for (const source of [...scope.selectedSources, ...proposedSources]) {
    const key = contextSourceKey(source);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    selectedSources.push({
      type: source.type,
      id: source.id,
      label: source.label,
      ...(source.parentId ? { parentId: source.parentId } : {}),
    });
  }
  return {
    ...scope,
    selectedSources,
    preset: selectedSources.length > 0 ? "custom" : scope.preset,
    pickerOpen: false,
  };
}

export function extractLatestUserText(messages: unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }
    const role = (message as { role?: unknown }).role;
    if (role !== "user") {
      continue;
    }
    const text = extractText(message)?.trim();
    if (text) {
      return text;
    }
  }
  return null;
}
