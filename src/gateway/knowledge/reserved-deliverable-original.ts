/**
 * Reserved 个人成果 / 团队成果 folder is the write-through SoT for robot archives.
 * Preview and cabin-tree must read those files; leftover skill_ archive ids remap to kbdoc-.
 */
import path from "node:path";
import {
  listCollaborationGroupDeliverableFiles,
  readCollaborationGroupDeliverableFile,
  type CollaborationGroupDeliverableFile,
} from "./collaboration-group-deliverables.js";
import {
  isReservedDeliverableFolder,
  resolveReservedDeliverableFolderKind,
} from "./deliverable-folders.js";
import {
  listDeliverableArchivesForKnowledgeBase,
  type DeliverableArchiveLookup,
} from "./deliverables/archive-store.js";
import {
  firstHumanDocumentTitle,
  knowledgeDocumentIdFromSkillRef,
  resolveSkillAssetIdForDocument,
} from "./document-display-title.js";
import { isImportableKnowledgeFilename } from "./importable-filename.js";
import { getKnowledgeBase, type KnowledgeBase } from "./knowledge-base-store.js";
import {
  deleteKnowledgeFolderFile,
  listKnowledgeFolderFiles,
  readKnowledgeFolderFile,
  resolveKnowledgeDirectoryLayoutForBase,
  writeKnowledgeFolderFile,
  type KnowledgeDirectoryLayout,
} from "./knowledge-directory.js";

export type ReservedDeliverableOriginal = {
  filename: string;
  buffer: Buffer;
  documentId: string;
  updatedAtMs?: number;
};

export type ReservedDeliverableListItem = {
  documentId: string;
  filename: string;
  title: string;
  updatedAtMs: number;
};

function folderDocumentId(knowledgeBaseId: string, filename: string): string {
  return knowledgeDocumentIdFromSkillRef(knowledgeBaseId, `folder:${filename}`);
}

function skillIdFromArchive(lookup: DeliverableArchiveLookup): string | null {
  const fromDeliverable = lookup.deliverableId.startsWith("skill:")
    ? lookup.deliverableId.slice("skill:".length).trim()
    : resolveSkillAssetIdForDocument(lookup.deliverableId);
  if (fromDeliverable) {
    return fromDeliverable;
  }
  return resolveSkillAssetIdForDocument(lookup.record.documentId);
}

export function reservedDeliverableDocumentId(params: {
  knowledgeBaseId: string;
  filename: string;
  archive?: DeliverableArchiveLookup | null;
}): string {
  const archive = params.archive;
  if (archive) {
    const skillId = skillIdFromArchive(archive);
    if (skillId) {
      return knowledgeDocumentIdFromSkillRef(params.knowledgeBaseId, skillId);
    }
    const stored = archive.record.documentId?.trim();
    if (stored && !resolveSkillAssetIdForDocument(stored) && !stored.startsWith("skill:")) {
      return stored;
    }
  }
  return folderDocumentId(params.knowledgeBaseId, params.filename);
}

function resolveLayout(
  knowledgeBase: KnowledgeBase,
  overrides?: { tenantsRoot?: string; configDir?: string },
): KnowledgeDirectoryLayout {
  return resolveKnowledgeDirectoryLayoutForBase(knowledgeBase, overrides);
}

function archivesByFilename(
  knowledgeBaseId: string,
  archiveStorePath?: string,
): Map<string, DeliverableArchiveLookup> {
  const map = new Map<string, DeliverableArchiveLookup>();
  for (const lookup of listDeliverableArchivesForKnowledgeBase(knowledgeBaseId, archiveStorePath)) {
    const filename = lookup.record.filename?.trim();
    if (filename) {
      map.set(path.basename(filename), lookup);
    }
  }
  return map;
}

function archiveLookupForGroupFile(
  knowledgeBaseId: string,
  file: CollaborationGroupDeliverableFile,
  archives: Map<string, DeliverableArchiveLookup>,
): DeliverableArchiveLookup | null {
  const fromStore = archives.get(file.filename);
  if (fromStore) {
    return fromStore;
  }
  const deliverableId = file.deliverableId?.trim();
  if (!deliverableId) {
    return null;
  }
  const documentId = deliverableId.startsWith("skill:")
    ? deliverableId.slice("skill:".length).trim()
    : deliverableId;
  return {
    deliverableId,
    record: {
      knowledgeBaseId,
      documentId,
      filename: file.filename,
      title: file.title,
      updatedAtMs: file.updatedAtMs,
    },
  };
}

function writeThroughReservedFolder(
  layout: KnowledgeDirectoryLayout,
  filename: string,
  buffer: Buffer,
): void {
  try {
    writeKnowledgeFolderFile({ layout, filename, buffer });
  } catch {
    // Preview still returns group bytes; reserved folder fill is best-effort.
  }
}

export function listReservedDeliverableDocuments(params: {
  knowledgeBase: KnowledgeBase;
  archiveStorePath?: string;
  tenantsRoot?: string;
  configDir?: string;
}): ReservedDeliverableListItem[] {
  if (!isReservedDeliverableFolder(params.knowledgeBase)) {
    return [];
  }
  const layout = resolveLayout(params.knowledgeBase, {
    tenantsRoot: params.tenantsRoot,
    configDir: params.configDir,
  });
  const archives = archivesByFilename(params.knowledgeBase.id, params.archiveStorePath);
  // Listing is strictly read-only: non-importable entries (e.g. extensionless
  // 图书室 / UPBEYOND shells) are hidden from the cabin tree, never deleted.
  const items = listKnowledgeFolderFiles({ layout })
    .filter((file) => isImportableKnowledgeFilename(file.filename))
    .filter((file) => firstHumanDocumentTitle(file.filename) != null)
    .map((file) => {
      const archive = archives.get(file.filename) ?? null;
      const documentId = reservedDeliverableDocumentId({
        knowledgeBaseId: params.knowledgeBase.id,
        filename: file.filename,
        archive,
      });
      return {
        documentId,
        filename: file.filename,
        title: archive?.record.title?.trim() || file.filename,
        updatedAtMs: archive?.record.updatedAtMs ?? file.updatedAtMs,
      };
    });
  if (resolveReservedDeliverableFolderKind(params.knowledgeBase) !== "team_deliverables") {
    return items;
  }
  const seen = new Set(items.map((item) => item.filename));
  for (const file of listCollaborationGroupDeliverableFiles({
    tenantId: params.knowledgeBase.tenantId,
    tenantsRoot: params.tenantsRoot,
  })) {
    if (seen.has(file.filename) || !isImportableKnowledgeFilename(file.filename)) {
      continue;
    }
    seen.add(file.filename);
    const archive = archiveLookupForGroupFile(params.knowledgeBase.id, file, archives);
    items.push({
      documentId: reservedDeliverableDocumentId({
        knowledgeBaseId: params.knowledgeBase.id,
        filename: file.filename,
        archive,
      }),
      filename: file.filename,
      title: archive?.record.title?.trim() || file.title,
      updatedAtMs: archive?.record.updatedAtMs ?? file.updatedAtMs,
    });
  }
  return items;
}

export function readReservedDeliverableOriginal(params: {
  knowledgeBaseId: string;
  documentId: string;
  linkedName?: string;
  kbStorePath?: string;
  archiveStorePath?: string;
  tenantsRoot?: string;
  configDir?: string;
}): ReservedDeliverableOriginal | null {
  const kb = getKnowledgeBase(params.knowledgeBaseId, params.kbStorePath);
  if (!kb || !isReservedDeliverableFolder(kb)) {
    return null;
  }
  const layout = resolveLayout(kb, {
    tenantsRoot: params.tenantsRoot,
    configDir: params.configDir,
  });
  const archives = listDeliverableArchivesForKnowledgeBase(kb.id, params.archiveStorePath);
  const names: string[] = [];
  const linked = params.linkedName?.trim();
  if (linked) {
    names.push(path.basename(linked));
  }
  for (const lookup of archives) {
    const remapped = reservedDeliverableDocumentId({
      knowledgeBaseId: kb.id,
      filename: lookup.record.filename?.trim() || "",
      archive: lookup,
    });
    if (
      remapped === params.documentId ||
      lookup.record.documentId === params.documentId ||
      lookup.deliverableId === params.documentId
    ) {
      const filename = lookup.record.filename?.trim();
      if (filename) {
        names.push(path.basename(filename));
      }
    }
  }
  for (const file of listKnowledgeFolderFiles({ layout })) {
    const archive = archives.find(
      (item) => path.basename(item.record.filename ?? "") === file.filename,
    );
    const documentId = reservedDeliverableDocumentId({
      knowledgeBaseId: kb.id,
      filename: file.filename,
      archive: archive ?? null,
    });
    if (documentId === params.documentId) {
      names.push(file.filename);
    }
  }

  const seen = new Set<string>();
  for (const name of names) {
    const key = name.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const found = readKnowledgeFolderFile({ layout, filename: key });
    if (found) {
      return {
        filename: found.filename,
        buffer: found.buffer,
        documentId: params.documentId,
      };
    }
  }

  if (resolveReservedDeliverableFolderKind(kb) !== "team_deliverables") {
    return null;
  }
  const groupFiles = listCollaborationGroupDeliverableFiles({
    tenantId: kb.tenantId,
    tenantsRoot: params.tenantsRoot,
  });
  for (const file of groupFiles) {
    const archive = archiveLookupForGroupFile(
      kb.id,
      file,
      archivesByFilename(kb.id, params.archiveStorePath),
    );
    const documentId = reservedDeliverableDocumentId({
      knowledgeBaseId: kb.id,
      filename: file.filename,
      archive,
    });
    if (documentId === params.documentId) {
      names.push(file.filename);
    }
  }
  for (const name of names) {
    const key = name.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const found = readCollaborationGroupDeliverableFile({
      tenantId: kb.tenantId,
      tenantsRoot: params.tenantsRoot,
      filename: key,
    });
    if (found) {
      writeThroughReservedFolder(layout, found.filename, found.buffer);
      return {
        filename: found.filename,
        buffer: found.buffer,
        documentId: params.documentId,
      };
    }
  }
  return null;
}

/** Remove a reserved-folder file listed in the cabin tree even when it was never attached. */
export function deleteReservedDeliverableOriginal(params: {
  knowledgeBase: KnowledgeBase;
  documentId: string;
  archiveStorePath?: string;
  tenantsRoot?: string;
  configDir?: string;
}): boolean {
  if (!isReservedDeliverableFolder(params.knowledgeBase)) {
    return false;
  }
  const layout = resolveLayout(params.knowledgeBase, {
    tenantsRoot: params.tenantsRoot,
    configDir: params.configDir,
  });
  const archives = archivesByFilename(params.knowledgeBase.id, params.archiveStorePath);
  let removed = false;
  for (const file of listKnowledgeFolderFiles({ layout })) {
    const archive = archives.get(file.filename) ?? null;
    const documentId = reservedDeliverableDocumentId({
      knowledgeBaseId: params.knowledgeBase.id,
      filename: file.filename,
      archive,
    });
    if (documentId !== params.documentId) {
      continue;
    }
    if (deleteKnowledgeFolderFile({ layout, filename: file.filename })) {
      removed = true;
    }
  }
  return removed;
}
