/**
 * Resolve a projected local-folder document to a host absolute path and open it
 * with the OS default application (Word / Preview / Finder association, etc.).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileUtf8 } from "../../../daemon/exec-file.js";
import { findLocalFolderBinding, listLocalFolderBindings } from "./local-folder-binding-store.js";
import { validateLocalFolderRelativePath } from "./local-folder-sync.js";
import {
  findSourceDocumentLinkByDocId,
  listSourceDocumentLinks,
} from "./source-document-link-store.js";

export type OpenLocalFolderDocumentParams = {
  documentId: string;
  knowledgeBaseId?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
  /** When true, only resolve the absolute path without launching an app. */
  dryRun?: boolean;
};

export type OpenLocalFolderDocumentResult = {
  ok: true;
  documentId: string;
  bindingId: string;
  relativePath: string;
  /** Absolute path opened on the gateway host (local_index only). */
  absolutePath: string;
};

function assertPathInsideRoot(rootPath: string, absolutePath: string): string {
  const rootReal = fs.realpathSync(rootPath);
  let targetReal: string;
  try {
    targetReal = fs.realpathSync(absolutePath);
  } catch {
    throw new Error("original file not found on this device");
  }
  const relative = path.relative(rootReal, targetReal);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("resolved path escapes the bound folder");
  }
  return targetReal;
}

export async function openPathWithDefaultApp(absolutePath: string): Promise<void> {
  if (process.platform === "darwin") {
    const result = await execFileUtf8("open", [absolutePath]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "failed to open file with the default app");
    }
    return;
  }
  if (process.platform === "win32") {
    const result = await execFileUtf8("cmd", ["/c", "start", "", absolutePath]);
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || "failed to open file with the default app");
    }
    return;
  }
  const result = await execFileUtf8("xdg-open", [absolutePath]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "failed to open file with the default app");
  }
}

export function listOpenableLocalFolderDocumentIds(params: {
  knowledgeBaseId: string;
  bindingStorePath?: string;
  linkStorePath?: string;
}): Set<string> {
  const openable = new Set<string>();
  const bindings = listLocalFolderBindings(
    { knowledgeBaseId: params.knowledgeBaseId },
    params.bindingStorePath,
  );
  for (const binding of bindings) {
    if (binding.mode !== "local_index" || !binding.rootPath?.trim()) {
      continue;
    }
    const links = listSourceDocumentLinks(
      { sourceDescriptorId: binding.sourceDescriptorId, state: "active" },
      params.linkStorePath,
    );
    for (const link of links) {
      openable.add(link.docId);
    }
  }
  return openable;
}

export type ResolveLocalFolderDocumentResult = {
  documentId: string;
  bindingId: string;
  rootPath: string;
  relativePath: string;
  absolutePath: string;
};

/** Resolve a projected local-folder document without launching an OS app. */
export function resolveLocalFolderDocument(
  params: OpenLocalFolderDocumentParams,
): ResolveLocalFolderDocumentResult {
  const documentId = params.documentId.trim();
  if (!documentId) {
    throw new Error("documentId required");
  }

  const link = findSourceDocumentLinkByDocId(documentId, params.linkStorePath);
  if (!link || link.state !== "active") {
    throw new Error("no local original file is linked to this document");
  }

  const binding =
    findLocalFolderBinding({
      sourceDescriptorId: link.sourceDescriptorId,
      storePath: params.bindingStorePath,
    }) ?? null;
  if (!binding) {
    throw new Error("local folder binding not found for this document");
  }
  if (params.knowledgeBaseId?.trim() && binding.knowledgeBaseId !== params.knowledgeBaseId.trim()) {
    throw new Error("document does not belong to the selected knowledge space");
  }
  if (binding.mode !== "local_index") {
    throw new Error(
      "opening the original file requires a same-host local folder binding (local_index)",
    );
  }
  if (!binding.rootPath?.trim()) {
    throw new Error("local folder root path is unavailable on this device");
  }

  const relativePath = validateLocalFolderRelativePath(link.relativePath);
  const candidate = path.resolve(binding.rootPath, relativePath);
  const absolutePath = assertPathInsideRoot(binding.rootPath, candidate);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile()) {
    throw new Error("original path is not a file");
  }

  return {
    documentId,
    bindingId: binding.bindingId,
    rootPath: binding.rootPath,
    relativePath,
    absolutePath,
  };
}

export async function openLocalFolderDocument(
  params: OpenLocalFolderDocumentParams,
): Promise<OpenLocalFolderDocumentResult> {
  const resolved = resolveLocalFolderDocument(params);
  if (!params.dryRun) {
    await openPathWithDefaultApp(resolved.absolutePath);
  }

  return {
    ok: true,
    documentId: resolved.documentId,
    bindingId: resolved.bindingId,
    relativePath: resolved.relativePath,
    absolutePath: resolved.absolutePath,
  };
}
