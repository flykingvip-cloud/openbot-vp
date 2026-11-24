import type { AgentDeliverableInput } from "./agent-generated-knowledge-store.js";
import { listKnowledgeBaseAgentKnowledgeFromIndex } from "./agent-generated-knowledge-store.js";
import {
  firstHumanDocumentTitle,
  isKnowledgeCabinInternalLabel,
  isSkillCatalogSourceRef,
} from "./document-display-title.js";
import {
  listKnowledgeBaseDatasetsFromIndex,
  listKnowledgeBaseDocumentsFromIndex,
  listKnowledgeBaseWebPagesFromIndex,
  type KnowledgeBaseDocumentSummary,
} from "./knowledge-base-library-content.js";
import type { KnowledgeBase, KnowledgeBaseVisibility } from "./knowledge-base-store.js";
import {
  resolveKnowledgeDirectoryLayoutForBase,
  resolveKnowledgeIndexRootForBase,
} from "./knowledge-directory.js";
import {
  isKnowledgeOriginalDeleted,
  listKnowledgeOriginalDocumentIds,
} from "./knowledge-original-store.js";
import { listReservedDeliverableDocuments } from "./reserved-deliverable-original.js";
import { listOpenableLocalFolderDocumentIds } from "./sources/local-folder-open.js";
import { listKnowledgeSourceBindings } from "./sources/source-binding-store.js";
import { resolveSourcePlane, type KnowledgeSourceKind } from "./sources/source-descriptor.js";
import { listSourceDocumentLinks } from "./sources/source-document-link-store.js";

export type KnowledgeBaseSourcePlane = "passive" | "active";

export type KnowledgeBaseSourceListKind =
  | "document"
  | "upload"
  | "web"
  | "dataset"
  | "note"
  | "agent-knowledge"
  | "api"
  | "external"
  | "capability"
  | "localFolder"
  | "gitRepo"
  | "cloudDrive"
  | "mailAttachment";

export type KnowledgeBaseSourceListItem = {
  id: string;
  knowledgeBaseId: string;
  plane: KnowledgeBaseSourcePlane;
  kind: KnowledgeBaseSourceListKind;
  title: string;
  formatLabel?: string;
  status?: string;
  sourceDescriptorId?: string;
  documentId?: string;
  /** True when gateway can open the host-local original file (local_index binding). */
  canOpenOriginal?: boolean;
  /** True when sidebar preview can load original bytes (stored blob or local_index). */
  canPreviewOriginal?: boolean;
  updatedAtMs: number;
  visibility: KnowledgeBaseVisibility;
};

export type ListKnowledgeBaseSourcesParams = {
  knowledgeBase: KnowledgeBase;
  plane?: KnowledgeBaseSourcePlane;
  kind?: KnowledgeBaseSourceListKind;
  indexRoot?: string;
  deliverables?: readonly AgentDeliverableInput[];
  bindingsStorePath?: string;
  localFolderBindingStorePath?: string;
  sourceDocumentLinkStorePath?: string;
  originalsRoot?: string;
  archiveStorePath?: string;
  tenantsRoot?: string;
  configDir?: string;
};

function bindingKindToListKind(kind: KnowledgeSourceKind): KnowledgeBaseSourceListKind {
  switch (kind) {
    case "upload":
      return "upload";
    case "web":
      return "web";
    case "dataset":
      return "dataset";
    case "api":
      return "api";
    case "capability":
      return "capability";
    case "localFolder":
      return "localFolder";
    case "gitRepo":
      return "gitRepo";
    case "cloudDrive":
      return "cloudDrive";
    case "mailAttachment":
      return "mailAttachment";
    case "external":
    case "enterprise":
      return "external";
    default:
      return "external";
  }
}

function looksLikeUploadedFile(doc: KnowledgeBaseDocumentSummary): boolean {
  const contentType = doc.contentType?.toLowerCase() ?? "";
  if (contentType.startsWith("application/") || contentType.startsWith("image/")) {
    return true;
  }
  return /\.(pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|gif|csv|tsv)$/i.test(doc.title);
}

function resolvePassiveDocumentKind(
  doc: KnowledgeBaseDocumentSummary,
): KnowledgeBaseSourceListKind {
  const contentType = doc.contentType?.toLowerCase() ?? "";
  if (
    (contentType.includes("text/plain") || contentType.includes("text/markdown")) &&
    !looksLikeUploadedFile(doc)
  ) {
    return "note";
  }
  if (looksLikeUploadedFile(doc)) {
    return "upload";
  }
  return "document";
}

function documentStatus(doc: KnowledgeBaseDocumentSummary): string | undefined {
  return doc.indexed ? "indexed" : "published";
}

function inferFormatLabel(params: {
  kind: KnowledgeBaseSourceListKind;
  title: string;
  contentType?: string | null;
  sourceName?: string | null;
  datasetFormat?: string | null;
}): string | undefined {
  if (params.kind === "web") {
    return "html";
  }
  if (params.kind === "dataset") {
    const format = params.datasetFormat?.trim().toLowerCase();
    if (format === "spreadsheet") {
      return "excel";
    }
    return format || undefined;
  }
  const source = `${params.sourceName ?? ""} ${params.title}`.toLowerCase();
  if (/\.pdf\b/.test(source) || params.contentType === "application/pdf") {
    return "pdf";
  }
  if (
    /\.docx\b/.test(source) ||
    params.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    /\.xlsx\b/.test(source) ||
    params.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    return "excel";
  }
  if (
    /\.pptx\b/.test(source) ||
    params.contentType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  if (/\.csv\b/.test(source) || params.contentType === "text/csv") {
    return "csv";
  }
  if (/\.tsv\b/.test(source) || params.contentType === "text/tab-separated-values") {
    return "tsv";
  }
  if (/\.md\b|\.markdown\b/.test(source) || params.contentType === "text/markdown") {
    return "markdown";
  }
  if (/\.txt\b/.test(source) || params.contentType === "text/plain") {
    return "txt";
  }
  if (/\.(png|jpg|jpeg|gif|webp)\b/.test(source) || params.contentType?.startsWith("image/")) {
    return "image";
  }
  if (/\.json\b/.test(source) || params.contentType === "application/json") {
    return "json";
  }
  return undefined;
}

export async function listKnowledgeBaseSources(
  params: ListKnowledgeBaseSourcesParams,
): Promise<KnowledgeBaseSourceListItem[]> {
  const visibility = params.knowledgeBase.visibility;
  const kbId = params.knowledgeBase.id;
  const indexRoot = resolveKnowledgeIndexRootForBase(params.knowledgeBase, {
    indexRoot: params.indexRoot,
    tenantsRoot: params.tenantsRoot,
    configDir: params.configDir,
  });

  const [documents, webPages, datasets, agentKnowledge, bindings] = await Promise.all([
    listKnowledgeBaseDocumentsFromIndex({
      knowledgeBase: params.knowledgeBase,
      indexRoot,
    }),
    listKnowledgeBaseWebPagesFromIndex({
      knowledgeBase: params.knowledgeBase,
      indexRoot,
    }),
    listKnowledgeBaseDatasetsFromIndex({
      knowledgeBase: params.knowledgeBase,
      indexRoot,
    }),
    listKnowledgeBaseAgentKnowledgeFromIndex({
      knowledgeBase: params.knowledgeBase,
      deliverables: params.deliverables,
      indexRoot,
    }),
    Promise.resolve(
      listKnowledgeSourceBindings({ knowledgeBaseId: kbId }, params.bindingsStorePath),
    ),
  ]);

  const webDocIds = new Set(webPages.map((page) => page.docId));
  const datasetDocIds = new Set(datasets.map((dataset) => dataset.docId));
  const openableOriginalDocIds = listOpenableLocalFolderDocumentIds({
    knowledgeBaseId: kbId,
    bindingStorePath: params.localFolderBindingStorePath,
    linkStorePath: params.sourceDocumentLinkStorePath,
  });
  const originalsRoot =
    params.originalsRoot ??
    resolveKnowledgeDirectoryLayoutForBase(params.knowledgeBase, {
      tenantsRoot: params.tenantsRoot,
      configDir: params.configDir,
    }).originalsRoot;
  const previewableOriginalDocIds = listKnowledgeOriginalDocumentIds({ kbId, originalsRoot });
  if (params.originalsRoot === undefined) {
    for (const id of listKnowledgeOriginalDocumentIds({ kbId })) {
      previewableOriginalDocIds.add(id);
    }
  }
  const canPreviewDoc = (docId: string) =>
    previewableOriginalDocIds.has(docId) || openableOriginalDocIds.has(docId);
  const items: KnowledgeBaseSourceListItem[] = [];

  for (const page of webPages) {
    items.push({
      id: `web:${page.docId}`,
      knowledgeBaseId: kbId,
      plane: "passive",
      kind: "web",
      title: page.title,
      formatLabel: inferFormatLabel({ kind: "web", title: page.title }),
      status: page.indexed ? "indexed" : "published",
      documentId: page.docId,
      canOpenOriginal: openableOriginalDocIds.has(page.docId),
      canPreviewOriginal: canPreviewDoc(page.docId),
      updatedAtMs: page.updatedAtMs,
      visibility,
    });
  }

  for (const dataset of datasets) {
    items.push({
      id: `dataset:${dataset.docId}`,
      knowledgeBaseId: kbId,
      plane: "passive",
      kind: "dataset",
      title: dataset.title,
      formatLabel: inferFormatLabel({
        kind: "dataset",
        title: dataset.title,
        datasetFormat: dataset.format,
      }),
      status: dataset.indexed ? "indexed" : "published",
      documentId: dataset.docId,
      canOpenOriginal: openableOriginalDocIds.has(dataset.docId),
      canPreviewOriginal: canPreviewDoc(dataset.docId),
      updatedAtMs: dataset.updatedAtMs,
      visibility,
    });
  }

  for (const doc of documents) {
    if (webDocIds.has(doc.docId) || datasetDocIds.has(doc.docId)) {
      continue;
    }
    const kind = resolvePassiveDocumentKind(doc);
    items.push({
      id: `doc:${doc.docId}`,
      knowledgeBaseId: kbId,
      plane: "passive",
      kind,
      title: doc.title,
      formatLabel: inferFormatLabel({
        kind,
        title: doc.title,
        contentType: doc.contentType,
        sourceName: doc.sourceName,
      }),
      status: documentStatus(doc),
      documentId: doc.docId,
      canOpenOriginal: openableOriginalDocIds.has(doc.docId),
      canPreviewOriginal: canPreviewDoc(doc.docId),
      updatedAtMs: doc.updatedAtMs,
      visibility,
    });
  }

  const seenDocumentIds = new Set(
    items.map((item) => item.documentId).filter((id): id is string => Boolean(id)),
  );
  for (const reserved of listReservedDeliverableDocuments({
    knowledgeBase: params.knowledgeBase,
    archiveStorePath: params.archiveStorePath,
    tenantsRoot: params.tenantsRoot,
    configDir: params.configDir,
  })) {
    if (seenDocumentIds.has(reserved.documentId)) {
      for (const item of items) {
        if (item.documentId === reserved.documentId) {
          item.canPreviewOriginal = true;
          // Repair placeholder/stub titles only; keep user-edited human titles.
          const reservedTitle = reserved.title?.trim() ?? "";
          if (
            reservedTitle &&
            !isKnowledgeCabinInternalLabel(reservedTitle) &&
            isKnowledgeCabinInternalLabel(item.title)
          ) {
            item.title = reservedTitle;
          }
        }
      }
      continue;
    }
    seenDocumentIds.add(reserved.documentId);
    items.push({
      id: `doc:${reserved.documentId}`,
      knowledgeBaseId: kbId,
      plane: "passive",
      kind: "note",
      title: reserved.title,
      formatLabel: inferFormatLabel({
        kind: "note",
        title: reserved.filename,
        contentType: "text/markdown",
      }),
      status: "published",
      documentId: reserved.documentId,
      canPreviewOriginal: true,
      updatedAtMs: reserved.updatedAtMs,
      visibility,
    });
  }

  for (const item of agentKnowledge.items) {
    const title = item.title ?? item.knowledgeId;
    if (
      isSkillCatalogSourceRef(item.knowledgeId) ||
      isSkillCatalogSourceRef(item.sourceDeliverableId) ||
      isSkillCatalogSourceRef(title) ||
      firstHumanDocumentTitle(title) == null
    ) {
      continue;
    }
    items.push({
      id: `agent:${item.knowledgeId}`,
      knowledgeBaseId: kbId,
      plane: "passive",
      kind: "agent-knowledge",
      title,
      status: item.status,
      updatedAtMs: item.updatedAtMs,
      visibility,
    });
  }

  const documentLinksBySource = new Map<string, string>();
  for (const binding of bindings) {
    const metaDocId = binding.metadata?.documentId?.trim();
    if (metaDocId) {
      documentLinksBySource.set(binding.id, metaDocId);
      continue;
    }
    const activeLink = listSourceDocumentLinks(
      { sourceDescriptorId: binding.id, state: "active" },
      params.sourceDocumentLinkStorePath,
    )[0];
    if (activeLink?.docId) {
      documentLinksBySource.set(binding.id, activeLink.docId);
    }
  }

  for (const binding of bindings) {
    const kind = bindingKindToListKind(binding.kind);
    const documentId = documentLinksBySource.get(binding.id);
    const lastIngestedAt = binding.metadata?.lastIngestedAt
      ? Date.parse(binding.metadata.lastIngestedAt)
      : NaN;
    items.push({
      id: `binding:${binding.id}`,
      knowledgeBaseId: kbId,
      plane: resolveSourcePlane(binding.kind),
      kind,
      title: binding.title,
      status: binding.freshness,
      sourceDescriptorId: binding.id,
      ...(documentId ? { documentId } : {}),
      updatedAtMs: Number.isFinite(lastIngestedAt) ? lastIngestedAt : binding.createdAtMs,
      visibility,
    });
  }

  let filtered = items;
  if (params.plane) {
    filtered = filtered.filter((item) => item.plane === params.plane);
  }
  if (params.kind) {
    filtered = filtered.filter((item) => item.kind === params.kind);
  }

  filtered = filtered.filter(
    (item) =>
      !isSkillCatalogSourceRef(item.documentId) &&
      !isSkillCatalogSourceRef(item.id) &&
      !isSkillCatalogSourceRef(item.title) &&
      !isKnowledgeCabinInternalLabel(item.title),
  );

  // Apply last so legacy/local/reserved projections cannot override deletion intent.
  for (const item of filtered) {
    if (
      item.documentId &&
      isKnowledgeOriginalDeleted({ kbId, docId: item.documentId, originalsRoot })
    ) {
      item.canPreviewOriginal = false;
      item.canOpenOriginal = false;
    }
  }
  return filtered.toSorted((left, right) => right.updatedAtMs - left.updatedAtMs);
}
