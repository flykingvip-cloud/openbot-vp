import fs from "node:fs";
import path from "node:path";
import { resolveSessionAgentId } from "../../../agents/agent-scope.js";
import { loadConfig } from "../../../config/config.js";
import { resolveCollaborationGroupIdFromSessionKey } from "../../collaboration-learning/shared.js";
import type { GovernanceOwnershipProof } from "../../data-governance/write-gate.js";
import { resolveSecurityProfile } from "../../security-profile.js";
import { normalizeGroupWorkspaceRelativePath } from "../../server-methods/group-workspace-file.js";
import { readUniquePreviewFile } from "../../server-methods/steward-preview-locator.js";
import type { GatewayClient } from "../../server-methods/types.js";
import { resolveTenantContext } from "../../tenant-context.js";
import { alignFormalRootForManagedAddressing } from "../../workspace-resolver/formal-deliverable-root.js";
import { resolvePlacedFilesystemWriteRoot } from "../../workspace-resolver/write-roots.js";
import { assertGroupMemberAccess } from "../../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../../workspace/group-locator.js";
import {
  authorizeAgentWorkspaceFileAccess,
  authorizeGroupWorkspaceFileAccess,
  PRIMARY_CAPABLE_WRITE_CHANNELS,
  resolveTrustedAgentLocator,
} from "../../workspace/handler-bridge.js";
import { resolveReservedDeliverableFolderKind } from "../deliverable-folders.js";
import { computeRawContentHash } from "../document-fingerprint.js";
import { getKnowledgeBase, KnowledgeBaseStoreError } from "../knowledge-base-store.js";
import {
  resolveKnowledgeDirectoryLayoutForBase,
  writeKnowledgeFolderFile,
} from "../knowledge-directory.js";
import {
  findDeliverableArchiveByLogicalId,
  getDeliverableArchiveRecord,
  listDeliverableArchiveFilenames,
  setDeliverableArchiveRecord,
  syncDeliverableArchiveRawHash,
} from "./archive-store.js";
import { attachWorkspaceDeliverableToKnowledgeBase } from "./attach.js";
import { captureAgentOutputDeliverable } from "./auto-capture-runtime.js";
import {
  resolveDeliverableRelativePath,
  resolveLogicalId,
  upsertGroupDeliverableCanonical,
} from "./group-manifest.js";
import {
  assertDeliverableSaveDecision,
  type ArchivedDeliverableRecord,
  type DeliverableSaveMode,
} from "./save-decision.js";

export type SaveAndArchiveDeliverableResult = {
  deliverableId: string;
  knowledgeBaseId: string;
  knowledgeBaseTitle: string;
  relativePath?: string;
  logicalId?: string;
  groupId?: string;
  documentId?: string;
  rawHash?: string;
  saveAction?: "create" | "noop" | "overwrite" | "save_as";
  derivedFromDocumentId?: string;
};

/**
 * One rule: conversation preview reads the birth workspace; save write-throughs
 * that same workspace and copies bytes into 个人成果 / 团队成果. Never move.
 * Preview artifact ids (assistant-doc:/tool-write:) are UI-only hashes.
 */
export function isPreviewArtifactDeliverableId(deliverableId: string): boolean {
  const trimmed = deliverableId.trim();
  return (
    trimmed.startsWith("assistant-doc:") ||
    trimmed.startsWith("tool-write:") ||
    trimmed.startsWith("preview:")
  );
}

export function resolveSaveArchiveDeliverableId(params: {
  clientDeliverableId?: string | null;
  captureDeliverableId?: string | null;
  captureSkillId?: string | null;
}): string {
  const fromCapture =
    params.captureDeliverableId?.trim() ||
    (params.captureSkillId?.trim() ? `skill:${params.captureSkillId.trim()}` : "");
  // Capture materializes the content that archive will ingest — prefer it over any client id
  // (sidebar preview hashes like assistant-doc:* must never win).
  if (fromCapture) {
    return fromCapture;
  }
  const fromClient = params.clientDeliverableId?.trim() || "";
  if (fromClient && !isPreviewArtifactDeliverableId(fromClient)) {
    return fromClient;
  }
  return "";
}

function toArchivedRecord(
  deliverableId: string,
  record: {
    knowledgeBaseId: string;
    documentId?: string;
    logicalId?: string;
    rawHash?: string;
    filename?: string;
    title?: string;
    archivedByAgentId?: string;
    archivedByGroupId?: string;
    archivedByUserId?: string;
    derivedFromDocumentId?: string;
    derivedFromRawHash?: string;
  },
): ArchivedDeliverableRecord {
  return {
    knowledgeBaseId: record.knowledgeBaseId,
    documentId: record.documentId?.trim() || "",
    deliverableId,
    ...(record.logicalId ? { logicalId: record.logicalId } : {}),
    ...(record.rawHash ? { rawHash: record.rawHash } : {}),
    ...(record.filename ? { filename: record.filename } : {}),
    ...(record.title ? { title: record.title } : {}),
    ...(record.archivedByAgentId ? { archivedByAgentId: record.archivedByAgentId } : {}),
    ...(record.archivedByGroupId ? { archivedByGroupId: record.archivedByGroupId } : {}),
    ...(record.archivedByUserId ? { archivedByUserId: record.archivedByUserId } : {}),
    ...(record.derivedFromDocumentId
      ? { derivedFromDocumentId: record.derivedFromDocumentId }
      : {}),
    ...(record.derivedFromRawHash ? { derivedFromRawHash: record.derivedFromRawHash } : {}),
  };
}

function findExistingArchive(params: {
  knowledgeBaseId: string;
  deliverableId?: string | null;
  logicalId: string;
  archiveStorePath?: string;
}): ArchivedDeliverableRecord | null {
  const persistableId = resolveSaveArchiveDeliverableId({
    clientDeliverableId: params.deliverableId,
    captureDeliverableId: null,
    captureSkillId: null,
  });
  if (persistableId) {
    const record = getDeliverableArchiveRecord(persistableId, params.archiveStorePath);
    if (record && record.knowledgeBaseId === params.knowledgeBaseId) {
      return toArchivedRecord(persistableId, record);
    }
  }
  const byLogical = findDeliverableArchiveByLogicalId({
    knowledgeBaseId: params.knowledgeBaseId,
    logicalId: params.logicalId,
    storePath: params.archiveStorePath,
  });
  if (!byLogical) {
    return null;
  }
  return toArchivedRecord(byLogical.deliverableId, byLogical.record);
}

function bufferLooksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

function decodeDeliverableContentBase64(value: string): Buffer {
  const cleaned = value.replace(/^data:[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (!cleaned) {
    return Buffer.alloc(0);
  }
  return Buffer.from(cleaned, "base64");
}

function resolveDeliverableIngestBytes(params: {
  content?: string | null;
  contentBase64?: string | null;
  filename?: string | null;
  title: string;
}): { buffer: Buffer; captureText: string; contentBase64?: string } {
  const encoded = params.contentBase64?.replace(/\s+/g, "") || "";
  if (encoded) {
    const buffer = decodeDeliverableContentBase64(encoded);
    const filename = params.filename?.trim() || "document.bin";
    const captureText =
      params.content?.trim() ||
      `Archived binary deliverable ${filename}. Original bytes stay in the reserved knowledge folder and must be read from knowledge originals.`;
    return { buffer, captureText, contentBase64: encoded.replace(/^data:[^;]+;base64,/i, "") };
  }
  const text = params.content?.trim() || "";
  return { buffer: Buffer.from(text, "utf8"), captureText: text };
}

export async function saveAndArchiveWorkspaceDeliverable(params: {
  userId: string;
  sessionKey: string;
  knowledgeBaseId: string;
  title: string;
  content: string;
  groupId?: string | null;
  logicalId?: string | null;
  filename?: string | null;
  deliverableId?: string | null;
  agentId?: string | null;
  knowledgeBaseTitle?: string | null;
  saveMode?: DeliverableSaveMode | null;
  expectedRawHash?: string | null;
  saveAsFilename?: string | null;
  contentBase64?: string | null;
  archiveStorePath?: string;
  indexRoot?: string;
  /** Gateway client for tenant-scoped group ACL + write authorization (C5/C17). */
  client?: GatewayClient | null;
  /** Trusted proof from authenticated call entry — required when the archive KB is tenant-scoped. */
  governanceOwnershipProof?: GovernanceOwnershipProof;
}): Promise<SaveAndArchiveDeliverableResult> {
  const sessionKey = params.sessionKey.trim();
  const title = params.title.trim();
  const knowledgeBaseId = params.knowledgeBaseId.trim();
  let filename = params.filename?.trim() || null;
  let ingest = resolveDeliverableIngestBytes({
    content: params.content,
    contentBase64: params.contentBase64,
    filename,
    title,
  });
  const content = ingest.captureText;
  if (!sessionKey || !title || !knowledgeBaseId || ingest.buffer.length === 0) {
    throw new KnowledgeBaseStoreError(
      "sessionKey, title, content, and knowledgeBaseId are required",
    );
  }

  const groupId =
    params.groupId?.trim() || resolveCollaborationGroupIdFromSessionKey(sessionKey) || undefined;
  const archiveKb = getKnowledgeBase(knowledgeBaseId);
  const expectedKind = groupId ? "team_deliverables" : "personal_deliverables";
  if (resolveReservedDeliverableFolderKind(archiveKb) !== expectedKind) {
    throw new KnowledgeBaseStoreError(`deliverable must be saved to the ${expectedKind} folder`);
  }
  const agentId =
    params.agentId?.trim() || resolveSessionAgentId({ sessionKey: sessionKey }) || "main";

  let groupAuth: {
    cfg: ReturnType<typeof loadConfig>;
    tenantId: string | null;
    locator: string;
  } | null = null;
  if (groupId) {
    const cfg = loadConfig();
    const profile = resolveSecurityProfile(cfg, process.env);
    const tenantCtx =
      profile.profile === "managed_enterprise"
        ? await resolveTenantContext(params.client ?? null)
        : null;
    const tenantId = tenantCtx?.tenantId ?? null;
    if (profile.profile === "managed_enterprise" && !tenantId) {
      throw new KnowledgeBaseStoreError("trusted tenant context required");
    }
    const aclDenied = await assertGroupMemberAccess({
      groupId,
      userId: params.userId,
      tenantId,
      profile: profile.profile,
      cfg,
      identityAliases: [params.client?.user ?? ""].map((entry) => entry.trim()).filter(Boolean),
    });
    if (aclDenied) {
      throw new KnowledgeBaseStoreError(aclDenied);
    }
    groupAuth = {
      cfg,
      tenantId,
      locator: resolveTrustedGroupLocator({
        groupId,
        tenantId,
        profile: profile.profile,
        cfg,
      }),
    };
  }

  if (filename && /\.pdf$/i.test(filename) && !bufferLooksLikePdf(ingest.buffer)) {
    let birthRoot: string | null = groupAuth?.locator?.trim() || null;
    if (birthRoot && birthRoot.includes("://")) {
      birthRoot = null;
    }
    if (!birthRoot) {
      try {
        const trusted = await resolveTrustedAgentLocator({
          client: params.client ?? null,
          agentId,
          cfg: loadConfig(),
        });
        const placedBirth = resolvePlacedFilesystemWriteRoot({
          locator: trusted,
          agentId,
          userId: params.userId,
          sessionKey,
          ensureDirectory: false,
        });
        birthRoot = placedBirth
          ? alignFormalRootForManagedAddressing(placedBirth, {
              config: groupAuth?.cfg ?? loadConfig(),
            })
          : null;
      } catch {
        birthRoot = null;
      }
    }
    const recovered = birthRoot ? readUniquePreviewFile(birthRoot, filename) : null;
    if (!recovered || !bufferLooksLikePdf(recovered.buffer)) {
      throw new KnowledgeBaseStoreError("工作区里没有找到这份 PDF，不能把对话正文当成 PDF 入库");
    }
    filename = recovered.relativePath;
    ingest = {
      buffer: recovered.buffer,
      captureText: content,
      contentBase64: recovered.buffer.toString("base64"),
    };
  }

  const proposedRawHash = computeRawContentHash(ingest.buffer);
  let logicalId = resolveLogicalId({
    explicit: params.logicalId,
    title,
    filename,
  });
  let relativePath = resolveDeliverableRelativePath({
    logicalId,
    title,
    filename,
  });
  const existing = findExistingArchive({
    knowledgeBaseId,
    deliverableId: params.deliverableId,
    logicalId,
    archiveStorePath: params.archiveStorePath,
  });
  const reservedFilenames = listDeliverableArchiveFilenames(
    knowledgeBaseId,
    params.archiveStorePath,
  );
  const decision = assertDeliverableSaveDecision({
    existing,
    proposedRawHash,
    proposedAgentId: agentId,
    proposedGroupId: groupId,
    saveMode: params.saveMode,
    expectedRawHash: params.expectedRawHash,
    saveAsFilename: params.saveAsFilename,
    reservedFilenames,
  });

  if (decision.action === "noop") {
    const knowledgeBaseTitle =
      params.knowledgeBaseTitle?.trim() || archiveKb?.title?.trim() || knowledgeBaseId;
    return {
      deliverableId: decision.existing.deliverableId?.trim() || params.deliverableId?.trim() || "",
      knowledgeBaseId,
      knowledgeBaseTitle,
      relativePath: decision.existing.filename || relativePath,
      logicalId: decision.existing.logicalId || logicalId,
      documentId: decision.existing.documentId,
      rawHash: decision.existing.rawHash || proposedRawHash,
      saveAction: "noop",
      ...(groupId ? { groupId } : {}),
    };
  }

  if (decision.action === "overwrite" && decision.existing.filename) {
    relativePath = decision.existing.filename;
    logicalId = decision.existing.logicalId?.trim() || logicalId;
  } else if (decision.action === "save_as") {
    relativePath = resolveDeliverableRelativePath({
      logicalId: resolveLogicalId({ filename: decision.filename, title }),
      title,
      filename: decision.filename,
    });
    logicalId = resolveLogicalId({ filename: relativePath, title });
  }

  const writeBirthWorkspace = async (): Promise<string | null> => {
    if (groupId && groupAuth) {
      const safeRelative = mkdirBirthParentDir(groupAuth.locator, relativePath);
      const authorized = await authorizeGroupWorkspaceFileAccess({
        client: params.client ?? null,
        cfg: groupAuth.cfg,
        userId: params.userId,
        groupId,
        relativePath: safeRelative,
        operation: "write",
        purpose: "knowledge.deliverables.saveAndArchive",
        locator: groupAuth.locator,
        groupAclVerified: true,
        authoritativeTenantId: groupAuth.tenantId,
        allowedWriteChannels: PRIMARY_CAPABLE_WRITE_CHANNELS,
      });
      if (!authorized.ok) {
        throw new KnowledgeBaseStoreError(authorized.message);
      }
      fs.mkdirSync(path.dirname(authorized.absoluteFilePath), { recursive: true });
      fs.writeFileSync(authorized.absoluteFilePath, ingest.buffer);
      return authorized.access.baseReal;
    }
    const cfg = loadConfig();
    const trustedLocator = await resolveTrustedAgentLocator({
      client: params.client ?? null,
      agentId,
      cfg,
    });
    // Unplaced catalog locators must not become birth-write roots; place onto robot-own.
    const placedLocator = resolvePlacedFilesystemWriteRoot({
      locator: trustedLocator,
      agentId,
      userId: params.userId,
      sessionKey,
      ensureDirectory: true,
    });
    const locator = placedLocator
      ? alignFormalRootForManagedAddressing(placedLocator, { config: cfg })
      : null;
    if (!locator) {
      throw new KnowledgeBaseStoreError("deliverable birth root unavailable");
    }
    const safeRelative = mkdirBirthParentDir(locator, relativePath);
    const authorized = await authorizeAgentWorkspaceFileAccess({
      client: params.client ?? null,
      cfg,
      userId: params.userId,
      agentId,
      relativePath: safeRelative,
      operation: "write",
      purpose: "knowledge.deliverables.saveAndArchive",
      locator,
      stewardException: true,
      allowedWriteChannels: PRIMARY_CAPABLE_WRITE_CHANNELS,
    });
    if (!authorized.ok) {
      throw new KnowledgeBaseStoreError(authorized.message);
    }
    fs.mkdirSync(path.dirname(authorized.absoluteFilePath), { recursive: true });
    fs.writeFileSync(authorized.absoluteFilePath, ingest.buffer);
    return null;
  };

  const capture = captureAgentOutputDeliverable({
    agentId,
    groupId: groupId ?? null,
    ownerId: params.userId,
    logicalId,
    title,
    content,
    sessionKey,
    contextId: sessionKey,
    force: true,
    tags: groupId ? ["collaboration", "saved"] : ["saved"],
    deliverableArtifact: { previewKind: "file", filename: relativePath },
  });
  const deliverableId = resolveSaveArchiveDeliverableId({
    clientDeliverableId: params.deliverableId,
    captureDeliverableId: capture.deliverableId,
    captureSkillId: capture.skillId,
  });
  if (!deliverableId) {
    throw new KnowledgeBaseStoreError("failed to capture deliverable before archive");
  }

  const overwriteDocumentId =
    decision.action === "overwrite" ? decision.existing.documentId.trim() : "";
  const derivedFromDocumentId =
    decision.action === "save_as" ? decision.existing.documentId.trim() : "";
  const derivedFromRawHash =
    decision.action === "save_as" ? decision.existing.rawHash?.trim() || "" : "";
  const attach = await attachWorkspaceDeliverableToKnowledgeBase({
    userId: params.userId,
    deliverableId,
    knowledgeBaseId,
    groupIds: groupId ? [groupId] : undefined,
    archiveStorePath: params.archiveStorePath,
    indexRoot: params.indexRoot,
    ingestTitle: title,
    ingestFileName: relativePath,
    deferEmbedding: true,
    ...(ingest.contentBase64 ? { ingestBase64: ingest.contentBase64 } : { ingestContent: content }),
    ...(overwriteDocumentId ? { documentId: overwriteDocumentId } : {}),
    ...(derivedFromDocumentId ? { derivedFromDocumentId } : {}),
    ...(derivedFromRawHash ? { derivedFromRawHash } : {}),
    ...(params.governanceOwnershipProof
      ? { governanceOwnershipProof: params.governanceOwnershipProof }
      : {}),
  });
  if (archiveKb) {
    writeKnowledgeFolderFile({
      layout: resolveKnowledgeDirectoryLayoutForBase(archiveKb),
      filename: relativePath,
      buffer: ingest.buffer,
    });
  }

  if (decision.action === "overwrite" && attach.documentId) {
    // Updating the current document must not destroy versions referenced by
    // reviews or delivery receipts. Retention is a separate governed operation.
    syncDeliverableArchiveRawHash({
      documentId: attach.documentId,
      rawHash: proposedRawHash,
      filename: relativePath,
      storePath: params.archiveStorePath,
    });
  }

  setDeliverableArchiveRecord({
    deliverableId,
    knowledgeBaseId: attach.relatedKnowledgeBaseId,
    documentId: attach.documentId,
    logicalId,
    rawHash: proposedRawHash,
    filename: relativePath,
    title,
    archivedByAgentId: agentId,
    archivedByGroupId: groupId,
    archivedByUserId: params.userId,
    derivedFromDocumentId: derivedFromDocumentId || undefined,
    derivedFromRawHash: derivedFromRawHash || undefined,
    storePath: params.archiveStorePath,
  });

  // Birth workspace is write-through after the reserved KB commit so an ingest
  // failure cannot leave the conversation file ahead of the callable original.
  const groupWorkspacePath = await writeBirthWorkspace();
  if (groupId && groupWorkspacePath) {
    upsertGroupDeliverableCanonical({
      workspacePath: groupWorkspacePath,
      logicalId,
      relativePath,
      deliverableId,
      knowledgeBaseId: attach.relatedKnowledgeBaseId,
      knowledgeBaseTitle:
        params.knowledgeBaseTitle?.trim() || attach.knowledgeBase.title?.trim() || knowledgeBaseId,
    });
  }

  return {
    deliverableId,
    knowledgeBaseId: attach.relatedKnowledgeBaseId,
    knowledgeBaseTitle:
      params.knowledgeBaseTitle?.trim() || attach.knowledgeBase.title?.trim() || knowledgeBaseId,
    relativePath,
    logicalId,
    documentId: attach.documentId,
    rawHash: proposedRawHash,
    saveAction: decision.action,
    ...(derivedFromDocumentId ? { derivedFromDocumentId } : {}),
    ...(groupId ? { groupId } : {}),
  };
}

/**
 * Create the birth-path parent before write authorize. Parent `realpathSync`
 * fails closed when the directory is missing; do not mkdir a guessed
 * `deliverables/` folder instead of the declared path.
 */
function mkdirBirthParentDir(locator: string, relativePath: string): string {
  const safeRelative =
    normalizeGroupWorkspaceRelativePath(relativePath) ??
    (() => {
      throw new KnowledgeBaseStoreError("invalid deliverable relative path");
    })();
  if (!locator.trim() || locator.includes("://") || /^unplaced:/i.test(locator.trim())) {
    throw new KnowledgeBaseStoreError("deliverable birth root must be a filesystem workspace");
  }
  const absoluteFilePath = path.resolve(locator, ...safeRelative.split("/"));
  const rootResolved = path.resolve(locator);
  const rel = path.relative(rootResolved, absoluteFilePath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new KnowledgeBaseStoreError("invalid deliverable relative path");
  }
  fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
  return safeRelative;
}

/** Normalize a user-provided filename for group workspace writes (used by RPC callers). */
export function normalizeDeliverableSaveFilename(
  filename: string | null | undefined,
): string | null {
  if (!filename?.trim()) {
    return null;
  }
  const relative = normalizeGroupWorkspaceRelativePath(filename);
  return relative;
}
