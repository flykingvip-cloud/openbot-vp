import type { KnowledgeObject } from "../capability/knowledge-universe/types.ts";
import type { KnowledgeHomeFocus } from "../ports/employee/views/home-page-contracts.ts";
import {
  DEFAULT_CHAT_CONTEXT_SCOPE,
  normalizeChatContextScope,
  type ChatContextSourceCatalogItem,
  type ChatContextSourceSelection,
  type ChatContextScopeState,
} from "./context-scope.ts";

export type KnowledgeUniverseChatSelection = {
  selectedObject?: KnowledgeObject | null;
  selectedKnowledgeBaseId?: string | null;
  selectedKnowledgeBaseTitle?: string | null;
  homeFocus?: KnowledgeHomeFocus | null;
  catalog?: ChatContextSourceCatalogItem[];
};

function fileIdFromKnowledgeObjectId(objectId: string): string | null {
  const trimmed = objectId.trim();
  if (!trimmed) {
    return null;
  }
  for (const prefix of ["obj:doc:", "obj:personal:", "obj:enterprise:"]) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim() || null;
    }
  }
  if (trimmed.startsWith("obj:kb:") || trimmed.startsWith("obj:deliverable:")) {
    return null;
  }
  return trimmed;
}

function knowledgeBaseIdFromObject(
  object: KnowledgeObject,
  selectedKnowledgeBaseId?: string | null,
): string | null {
  const selected = selectedKnowledgeBaseId?.trim();
  if (selected) {
    return selected;
  }
  if (object.id.startsWith("obj:kb:")) {
    return object.id.slice("obj:kb:".length).trim() || null;
  }
  for (const related of object.relatedObjectIds ?? []) {
    if (related.startsWith("obj:kb:")) {
      const id = related.slice("obj:kb:".length).trim();
      if (id) {
        return id;
      }
    }
  }
  return null;
}

function matchCatalog(
  catalog: ChatContextSourceCatalogItem[],
  type: ChatContextSourceSelection["type"],
  id: string,
  parentId?: string | null,
): ChatContextSourceCatalogItem | undefined {
  const parent = parentId?.trim();
  return (
    catalog.find(
      (item) =>
        item.type === type &&
        item.id === id &&
        (!parent || !item.parentId || item.parentId === parent),
    ) ?? catalog.find((item) => item.type === type && item.label === id)
  );
}

export function knowledgeUniverseSelectionKey(sources: ChatContextSourceSelection[]): string {
  return sources
    .map((source) => `${source.type}:${source.id}:${source.parentId ?? ""}`)
    .toSorted()
    .join("|");
}

export function knowledgeUniverseSelectionToChatSources(
  selection: KnowledgeUniverseChatSelection,
): ChatContextSourceSelection[] {
  const catalog = selection.catalog ?? [];
  const object = selection.selectedObject;
  if (object?.id.trim()) {
    if (object.id.startsWith("obj:kb:")) {
      const kbId = knowledgeBaseIdFromObject(object, selection.selectedKnowledgeBaseId);
      if (!kbId) {
        return [];
      }
      const catalogKb = matchCatalog(catalog, "knowledge", kbId);
      return [
        {
          type: "knowledge",
          id: kbId,
          label: catalogKb?.label || object.title || kbId,
        },
      ];
    }
    const fileId = fileIdFromKnowledgeObjectId(object.id);
    if (!fileId) {
      return [];
    }
    const parentId = knowledgeBaseIdFromObject(object, selection.selectedKnowledgeBaseId);
    const catalogFile = matchCatalog(catalog, "file", fileId, parentId);
    const catalogFolder = matchCatalog(catalog, "folder", fileId, parentId);
    if (catalogFolder && !catalogFile) {
      return [
        {
          type: "folder",
          id: catalogFolder.id,
          label: catalogFolder.label || object.title || fileId,
          ...(catalogFolder.parentId || parentId
            ? { parentId: catalogFolder.parentId || parentId || undefined }
            : {}),
        },
      ];
    }
    const resolvedParent = catalogFile?.parentId || parentId || undefined;
    return [
      {
        type: "file",
        id: catalogFile?.id || fileId,
        label: catalogFile?.label || object.title || fileId,
        ...(resolvedParent ? { parentId: resolvedParent } : {}),
      },
    ];
  }

  const focus = selection.homeFocus;
  const kbId =
    (focus?.kind === "knowledge-base" ? focus.id : null)?.trim() ||
    (focus?.kind === "knowledge-base" ? focus.kbId : null)?.trim() ||
    null;
  if (kbId) {
    const catalogKb = matchCatalog(catalog, "knowledge", kbId);
    return [
      {
        type: "knowledge",
        id: kbId,
        label: catalogKb?.label || selection.selectedKnowledgeBaseTitle?.trim() || kbId,
      },
    ];
  }
  return [];
}

export function applyKnowledgeUniverseSelectionToChatScope(
  current: ChatContextScopeState | null | undefined,
  sources: ChatContextSourceSelection[],
): ChatContextScopeState {
  if (sources.length === 0) {
    return { ...DEFAULT_CHAT_CONTEXT_SCOPE };
  }
  const scope = normalizeChatContextScope(current);
  return {
    ...scope,
    preset: "custom",
    lifetime: "session",
    selectedSources: sources,
    pickerOpen: false,
  };
}

export type KnowledgeUniverseChatScopeHost = {
  chatContextScope?: ChatContextScopeState;
  chatContextSourceCatalog?: ChatContextSourceCatalogItem[] | null;
};

export type KnowledgeUniverseChatScopeRuntime = {
  selectedObject?: KnowledgeObject | null;
  selectedKnowledgeBaseId?: string | null;
  knowledgeBases?: Array<{ id: string; title: string }>;
  homeFocus?: KnowledgeHomeFocus | null;
  chatScopeSyncKey: string;
};

export function syncKnowledgeUniverseSelectionToChatHost(
  host: KnowledgeUniverseChatScopeHost,
  runtime: KnowledgeUniverseChatScopeRuntime,
): string {
  const selectedKb = runtime.knowledgeBases?.find(
    (item) => item.id === runtime.selectedKnowledgeBaseId,
  );
  const sources = knowledgeUniverseSelectionToChatSources({
    selectedObject: runtime.selectedObject,
    selectedKnowledgeBaseId: runtime.selectedKnowledgeBaseId,
    selectedKnowledgeBaseTitle: selectedKb?.title ?? null,
    homeFocus: runtime.homeFocus,
    catalog: host.chatContextSourceCatalog ?? [],
  });
  const nextKey = knowledgeUniverseSelectionKey(sources);
  if (nextKey === runtime.chatScopeSyncKey) {
    return nextKey;
  }
  host.chatContextScope = applyKnowledgeUniverseSelectionToChatScope(
    host.chatContextScope,
    sources,
  );
  return nextKey;
}
