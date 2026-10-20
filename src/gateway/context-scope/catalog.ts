import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import { listKnowledgeBaseDocumentsFromIndex } from "../knowledge/knowledge-base-library-content.js";
import { listKnowledgeBaseMembers } from "../knowledge/knowledge-base-members.js";
import {
  buildKnowledgeBasePermissionActor,
  canReadKnowledgeBase,
} from "../knowledge/knowledge-base-permissions.js";
import {
  listKnowledgeBases,
  type KnowledgeBase,
  type KnowledgeBaseVisibility,
} from "../knowledge/knowledge-base-store.js";
import { readKnowledgeOriginalFileName } from "../knowledge/knowledge-original-store.js";
import { listLocalFolderBindings } from "../knowledge/sources/local-folder-binding-store.js";
import { listKnowledgeSourceBindings } from "../knowledge/sources/source-binding-store.js";
import type { KnowledgeSourceKind } from "../knowledge/sources/source-descriptor.js";
import type { GatewayClient } from "../server-methods/types.js";

export type ContextScopeCatalogType = "knowledge" | "file" | "folder" | "api";

export type ContextScopeCatalogItem = {
  type: ContextScopeCatalogType;
  id: string;
  label: string;
  subtitle?: string;
  parentId?: string;
  visibility?: KnowledgeBaseVisibility;
  hasConflict?: boolean;
};

export const CONTEXT_SCOPE_CATALOG_LIMITS = {
  knowledge: 50,
  files: 80,
  folders: 40,
  apis: 40,
} as const;

const API_KINDS = new Set<KnowledgeSourceKind>(["api", "external", "capability"]);
const FOLDER_SOURCE_KINDS = new Set<KnowledgeSourceKind>([
  "localFolder",
  "gitRepo",
  "cloudDrive",
  "mailAttachment",
]);

function fileLabel(documentId: string): string {
  const trimmed = documentId.trim();
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** Storage keys / connector ids that must never be shown as the picker title. */
export function looksLikeInternalDocumentId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (/^(Ifdoc|obj|doc|dataset|skill_)/i.test(trimmed)) {
    return true;
  }
  return /^[0-9a-f]{16,}$/i.test(trimmed);
}

export function resolveContextScopeFileLabel(params: {
  documentId: string;
  displayTitle?: string | null;
  originalFileName?: string | null;
}): string {
  const displayTitle = params.displayTitle?.trim() ?? "";
  if (displayTitle && !looksLikeInternalDocumentId(displayTitle)) {
    return displayTitle;
  }
  const originalFileName = params.originalFileName?.trim() ?? "";
  if (originalFileName && !looksLikeInternalDocumentId(originalFileName)) {
    return fileLabel(originalFileName);
  }
  return fileLabel(params.documentId);
}

type CatalogKnowledgeBase = {
  id: string;
  title: string;
  visibility?: KnowledgeBaseVisibility;
  hasConflict?: boolean;
};

function visibilityForParent(
  parentId: string | undefined,
  visibilityByKb: Map<string, KnowledgeBaseVisibility>,
): KnowledgeBaseVisibility | undefined {
  return parentId ? visibilityByKb.get(parentId) : undefined;
}

export function buildContextScopeCatalog(input: {
  knowledgeBases: CatalogKnowledgeBase[];
  files: Array<{ id: string; title: string; knowledgeBaseId: string }>;
  folders: Array<{ id: string; label: string; knowledgeBaseId?: string }>;
  apis: Array<{ id: string; title: string; endpoint?: string; knowledgeBaseId?: string }>;
  limits?: Partial<Record<keyof typeof CONTEXT_SCOPE_CATALOG_LIMITS, number>>;
}): ContextScopeCatalogItem[] {
  const limits = { ...CONTEXT_SCOPE_CATALOG_LIMITS, ...input.limits };
  const visibilityByKb = new Map(
    input.knowledgeBases
      .filter((base) => base.visibility)
      .map((base) => [base.id, base.visibility as KnowledgeBaseVisibility]),
  );
  const items: ContextScopeCatalogItem[] = [];
  for (const base of input.knowledgeBases.slice(0, limits.knowledge)) {
    items.push({
      type: "knowledge",
      id: base.id,
      label: base.title,
      ...(base.visibility ? { visibility: base.visibility } : {}),
      ...(base.hasConflict ? { hasConflict: true } : {}),
    });
  }
  for (const file of input.files.slice(0, limits.files)) {
    const visibility = visibilityForParent(file.knowledgeBaseId, visibilityByKb);
    items.push({
      type: "file",
      id: file.id,
      label: file.title,
      parentId: file.knowledgeBaseId,
      ...(visibility ? { visibility } : {}),
    });
  }
  for (const folder of input.folders.slice(0, limits.folders)) {
    const visibility = visibilityForParent(folder.knowledgeBaseId, visibilityByKb);
    items.push({
      type: "folder",
      id: folder.id,
      label: folder.label,
      ...(folder.knowledgeBaseId ? { parentId: folder.knowledgeBaseId } : {}),
      ...(visibility ? { visibility } : {}),
    });
  }
  for (const api of input.apis.slice(0, limits.apis)) {
    const visibility = visibilityForParent(api.knowledgeBaseId, visibilityByKb);
    items.push({
      type: "api",
      id: api.id,
      label: api.title,
      ...(api.endpoint ? { subtitle: api.endpoint } : {}),
      ...(api.knowledgeBaseId ? { parentId: api.knowledgeBaseId } : {}),
      ...(visibility ? { visibility } : {}),
    });
  }
  return items;
}

export type ContextScopeCatalogStores = {
  knowledgeBaseStorePath?: string;
  membersStorePath?: string;
  localFolderStorePath?: string;
  sourceBindingStorePath?: string;
  indexRoot?: string;
  originalsRoot?: string;
};

function visibleKnowledgeBases(
  actor: ReturnType<typeof buildKnowledgeBasePermissionActor>,
  stores: ContextScopeCatalogStores,
): KnowledgeBase[] {
  return listKnowledgeBases({}, stores.knowledgeBaseStorePath).filter((base) =>
    canReadKnowledgeBase({
      knowledgeBase: base,
      actor,
      members:
        base.visibility === "private"
          ? undefined
          : listKnowledgeBaseMembers(base.id, stores.membersStorePath),
    }),
  );
}

async function resolveCatalogFileTitles(
  bases: KnowledgeBase[],
  stores: ContextScopeCatalogStores,
): Promise<Array<{ id: string; title: string; knowledgeBaseId: string }>> {
  const resolved = await Promise.all(
    bases.map(async (base) => {
      const docs = await listKnowledgeBaseDocumentsFromIndex({
        knowledgeBase: base,
        indexRoot: stores.indexRoot,
      });
      const titleById = new Map(docs.map((doc) => [doc.docId, doc.title]));
      return base.documentIds.map((documentId) => ({
        id: documentId,
        title: resolveContextScopeFileLabel({
          documentId,
          displayTitle: titleById.get(documentId),
          originalFileName: readKnowledgeOriginalFileName({
            kbId: base.id,
            docId: documentId,
            originalsRoot: stores.originalsRoot,
          }),
        }),
        knowledgeBaseId: base.id,
      }));
    }),
  );
  return resolved.flat();
}

export async function loadContextScopeCatalogForActor(params: {
  actor: ReturnType<typeof buildKnowledgeBasePermissionActor>;
  stores?: ContextScopeCatalogStores;
}): Promise<ContextScopeCatalogItem[]> {
  const stores = params.stores ?? {};
  const visible = visibleKnowledgeBases(params.actor, stores);
  const visibleIds = new Set(visible.map((base) => base.id));
  const titleByKb = new Map(visible.map((base) => [base.id, base.title]));

  const files = await resolveCatalogFileTitles(visible, stores);

  const folderBindings = listLocalFolderBindings({}, stores.localFolderStorePath).filter(
    (binding) => visibleIds.has(binding.knowledgeBaseId),
  );
  const sourceBindings = listKnowledgeSourceBindings({}, stores.sourceBindingStorePath).filter(
    (binding) =>
      !binding.knowledgeBaseId ||
      visibleIds.has(binding.knowledgeBaseId) ||
      binding.ownerId === params.actor.userId,
  );

  const foldersFromBindings = folderBindings.map((binding) => ({
    id: binding.bindingId,
    label: binding.rootLabel,
    knowledgeBaseId: binding.knowledgeBaseId,
  }));
  const foldersFromSources = sourceBindings
    .filter((binding) => FOLDER_SOURCE_KINDS.has(binding.kind))
    .filter((binding) => !folderBindings.some((item) => item.sourceDescriptorId === binding.id))
    .map((binding) => ({
      id: binding.id,
      label: binding.title,
      knowledgeBaseId: binding.knowledgeBaseId,
    }));

  const apis = sourceBindings
    .filter((binding) => API_KINDS.has(binding.kind))
    .map((binding) => ({
      id: binding.id,
      title: binding.title,
      endpoint: binding.endpoint,
      knowledgeBaseId: binding.knowledgeBaseId,
    }));

  const catalog = buildContextScopeCatalog({
    knowledgeBases: visible.map((base) => ({
      id: base.id,
      title: base.title,
      visibility: base.visibility,
    })),
    files,
    folders: [...foldersFromBindings, ...foldersFromSources],
    apis,
  });

  return catalog.map((item) => {
    if (!item.parentId || item.subtitle) {
      return item;
    }
    const parentTitle = titleByKb.get(item.parentId);
    return parentTitle ? { ...item, subtitle: parentTitle } : item;
  });
}

export async function loadContextScopeCatalog(params: {
  client: GatewayClient | null;
  stores?: ContextScopeCatalogStores;
}): Promise<ContextScopeCatalogItem[]> {
  const context = await resolveKnowledgeSourceContext(params.client);
  if (!context.userId) {
    return [];
  }
  return await loadContextScopeCatalogForActor({
    actor: buildKnowledgeBasePermissionActor({
      context,
      email: typeof params.client?.user === "string" ? params.client.user : null,
    }),
    stores: params.stores,
  });
}
