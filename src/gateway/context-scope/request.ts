import type { ContextScopeRequest, ContextSource } from "./types.js";

const MODES = new Set(["minimal", "auto", "focused", "deep"]);
const LIFETIMES = new Set(["turn", "session"]);
const SOURCE_TYPES = new Set(["conversation", "group", "knowledge", "folder", "file", "api"]);

export type ChatContextScopePayload = {
  mode?: string;
  lifetime?: string;
  sources?: Array<{ type?: string; id?: string; parentId?: string }>;
};

function asTrimmedId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const id = value.trim();
  return id ? id : null;
}

function parseSource(raw: { type?: string; id?: string; parentId?: string }): ContextSource | null {
  const type = raw.type?.trim();
  const id = asTrimmedId(raw.id);
  const parentId = asTrimmedId(raw.parentId);
  if (!type || !SOURCE_TYPES.has(type) || !id) {
    return null;
  }
  switch (type) {
    case "conversation":
      return { type: "conversation", id };
    case "group":
      return { type: "group", groupId: id };
    case "knowledge":
      return { type: "knowledge", knowledgeBaseId: id };
    case "folder":
      return { type: "folder", path: id, ...(parentId ? { parentId } : {}) };
    case "file":
      return { type: "file", fileId: id, ...(parentId ? { parentId } : {}) };
    case "api":
      return { type: "api", connectorId: id, ...(parentId ? { parentId } : {}) };
    default:
      return null;
  }
}

export function parseChatContextScopeRequest(
  raw: ChatContextScopePayload | null | undefined,
): ContextScopeRequest | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const mode = raw.mode?.trim();
  const lifetime = raw.lifetime?.trim();
  const sources = (raw.sources ?? [])
    .map((entry) => parseSource(entry ?? {}))
    .filter((entry): entry is ContextSource => Boolean(entry));
  if (
    (!mode || !MODES.has(mode)) &&
    sources.length === 0 &&
    (!lifetime || !LIFETIMES.has(lifetime))
  ) {
    return undefined;
  }
  return {
    ...(mode && MODES.has(mode) ? { mode: mode as ContextScopeRequest["mode"] } : {}),
    ...(lifetime && LIFETIMES.has(lifetime)
      ? { lifetime: lifetime as ContextScopeRequest["lifetime"] }
      : {}),
    ...(sources.length > 0 ? { sources } : {}),
  };
}
