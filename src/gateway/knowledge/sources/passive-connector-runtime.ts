/**
 * P5 runtime: bind/unbind/status + reuse local-folder sync plan/commit for inventory.
 * Provider adapters can later list/fetch; scaffolds stay client-driven.
 */
import { createHash } from "node:crypto";
import type { OpenBotConfig } from "../../../config/config.js";
import type { EmbeddingProvider } from "../../../memory/embeddings.js";
import type { GovernanceOwnershipProof } from "../../data-governance/write-gate.js";
import type { GatewayClient } from "../../server-methods/types.js";
import type { KnowledgeBase } from "../knowledge-base-store.js";
import { purgeIndexedDocument } from "./local-folder-runtime.js";
import { commitLocalFolderSync, planLocalFolderSync } from "./local-folder-sync.js";
import type { LocalFolderBinding } from "./local-folder-types.js";
import {
  deletePassiveConnectorBinding,
  findPassiveConnectorBinding,
  listPassiveConnectorBindings,
  upsertPassiveConnectorBinding,
  updatePassiveConnectorBindingStatus,
} from "./passive-connector-binding-store.js";
import {
  getPassiveConnectorProvider,
  isPassiveConnectorProviderReady,
  passiveConnectorNotReadyError,
} from "./passive-connector-providers.js";
import type {
  PassiveConnectorBindRequest,
  PassiveConnectorBindResponse,
  PassiveConnectorBinding,
  PassiveConnectorKind,
  PassiveConnectorStatusItem,
  PassiveConnectorSyncCommitFile,
  PassiveConnectorSyncCommitResponse,
  PassiveConnectorSyncCandidate,
  PassiveConnectorSyncPlanResponse,
} from "./passive-connector-types.js";
import { isPassiveConnectorKind } from "./passive-connector-types.js";
import { bindKnowledgeSource, unbindKnowledgeSource } from "./source-binding-store.js";
import {
  countActiveSourceDocumentLinks,
  deleteSourceDocumentLinksForSource,
  listSourceDocumentLinks,
} from "./source-document-link-store.js";

/** Map generic binding into LocalFolderBinding shape for shared plan/commit helpers. */
function asSyncBinding(binding: PassiveConnectorBinding): LocalFolderBinding {
  return {
    bindingId: binding.bindingId,
    sourceDescriptorId: binding.sourceDescriptorId,
    knowledgeBaseId: binding.knowledgeBaseId,
    deviceId: binding.deviceId ?? "remote",
    mode: "managed_push",
    rootPath: "",
    rootLabel: binding.label,
    includeGlobs: (binding.config.includeGlobs ?? "**/*").split(",").map((s) => s.trim()),
    excludeGlobs: (binding.config.excludeGlobs ?? "").split(",").filter(Boolean),
    deletePolicy: binding.deletePolicy,
    watcherEnabled: false,
    status:
      binding.status === "scanning" ? "scanning" : binding.status === "error" ? "error" : "idle",
    lastScanAt: binding.lastSyncAt,
    lastEventAt: binding.lastEventAt,
    lastError: binding.lastError,
  };
}

export function buildPassiveConnectorDocId(
  sourceDescriptorId: string,
  relativePath: string,
): string {
  const key = `${sourceDescriptorId}::${relativePath.replace(/\\/g, "/")}`;
  return `pcdoc:${createHash("sha256").update(key).digest("hex").slice(0, 28)}`;
}

export function bindPassiveConnector(params: {
  request: PassiveConnectorBindRequest;
  ownerId: string;
  knowledgeBase: KnowledgeBase;
  storePath?: string;
  sourceBindingsPath?: string;
}): PassiveConnectorBindResponse {
  const kind = params.request.kind;
  if (!isPassiveConnectorKind(kind) || kind === "localFolder") {
    throw new Error("kind must be gitRepo | cloudDrive | mailAttachment");
  }
  const provider = getPassiveConnectorProvider(kind);
  const locatorError = provider.validateLocator(
    params.request.locator,
    params.request.config ?? {},
  );
  if (locatorError) {
    throw new Error(locatorError);
  }

  const label = params.request.label.trim() || params.request.locator.trim();
  const descriptor = bindKnowledgeSource(
    {
      kind,
      title: label,
      knowledgeBaseId: params.knowledgeBase.id,
      ownerId: params.ownerId,
      visibility: params.knowledgeBase.visibility,
      // Non-secret locator only — never tokens.
      endpoint: params.request.locator.trim(),
      metadata: {
        connectorKind: kind,
        locator: params.request.locator.trim(),
        deletePolicy: params.request.deletePolicy ?? "snapshot",
        providerReady: provider.ready ? "true" : "false",
      },
    },
    params.sourceBindingsPath,
  );

  const binding = upsertPassiveConnectorBinding(
    {
      sourceDescriptorId: descriptor.id,
      knowledgeBaseId: params.knowledgeBase.id,
      kind,
      label,
      locator: params.request.locator.trim(),
      deviceId: params.request.deviceId,
      deletePolicy: params.request.deletePolicy,
      config: params.request.config,
      status: provider.ready ? "idle" : "not_ready",
      lastError: provider.ready ? null : passiveConnectorNotReadyError(kind),
    },
    params.storePath,
  );

  return {
    sourceDescriptorId: descriptor.id,
    bindingId: binding.bindingId,
    kind,
    label: binding.label,
    knowledgeBaseId: params.knowledgeBase.id,
    providerReady: provider.ready,
  };
}

export function listPassiveConnectorStatus(params: {
  knowledgeBaseId?: string;
  kind?: PassiveConnectorKind;
  bindingId?: string;
  sourceDescriptorId?: string;
  storePath?: string;
}): PassiveConnectorStatusItem[] {
  let bindings = listPassiveConnectorBindings(
    {
      knowledgeBaseId: params.knowledgeBaseId,
      kind: params.kind === "localFolder" ? undefined : params.kind,
      sourceDescriptorId: params.sourceDescriptorId,
    },
    params.storePath,
  );
  if (params.bindingId) {
    const one = findPassiveConnectorBinding({
      bindingId: params.bindingId,
      storePath: params.storePath,
    });
    bindings = one ? [one] : [];
  }
  return bindings.map((binding) => ({
    bindingId: binding.bindingId,
    sourceDescriptorId: binding.sourceDescriptorId,
    knowledgeBaseId: binding.knowledgeBaseId,
    kind: binding.kind,
    label: binding.label,
    locator: binding.locator,
    status: binding.status,
    deletePolicy: binding.deletePolicy,
    providerReady: isPassiveConnectorProviderReady(
      binding.kind as Exclude<PassiveConnectorKind, "localFolder">,
    ),
    lastSyncAt: binding.lastSyncAt,
    lastEventAt: binding.lastEventAt,
    lastError: binding.lastError,
    activeDocumentCount: countActiveSourceDocumentLinks(binding.sourceDescriptorId),
  }));
}

export function planPassiveConnectorSync(params: {
  binding: PassiveConnectorBinding;
  candidates: PassiveConnectorSyncCandidate[];
  linkStorePath?: string;
}): PassiveConnectorSyncPlanResponse {
  const plan = planLocalFolderSync({
    binding: asSyncBinding(params.binding),
    candidates: params.candidates,
    linkStorePath: params.linkStorePath,
  });
  return {
    bindingId: plan.bindingId,
    sourceDescriptorId: plan.sourceDescriptorId,
    kind: params.binding.kind,
    needUpload: plan.needUpload,
    unchanged: plan.unchanged,
    missingOnDevice: plan.missingOnDevice,
  };
}

export async function commitPassiveConnectorSync(params: {
  binding: PassiveConnectorBinding;
  knowledgeBase: KnowledgeBase;
  ownerId: string;
  files: PassiveConnectorSyncCommitFile[];
  deletedRelativePaths?: string[];
  applyDeletes?: boolean;
  indexRoot?: string;
  kbStorePath?: string;
  bindingStorePath?: string;
  linkStorePath?: string;
  cfg?: OpenBotConfig;
  client?: GatewayClient | null;
  embeddingProvider?: EmbeddingProvider | null;
  /** Trusted proof from authenticated call entry — required for tenant-scoped KBs. */
  governanceOwnershipProof?: GovernanceOwnershipProof;
}): Promise<PassiveConnectorSyncCommitResponse> {
  updatePassiveConnectorBindingStatus(
    params.binding.bindingId,
    { status: "scanning", lastError: null },
    params.bindingStorePath,
  );
  try {
    const result = await commitLocalFolderSync({
      binding: asSyncBinding(params.binding),
      knowledgeBase: params.knowledgeBase,
      ownerId: params.ownerId,
      files: params.files,
      deletedRelativePaths: params.deletedRelativePaths,
      applyDeletes: params.applyDeletes,
      indexRoot: params.indexRoot,
      kbStorePath: params.kbStorePath,
      linkStorePath: params.linkStorePath,
      cfg: params.cfg,
      client: params.client,
      embeddingProvider: params.embeddingProvider,
      governanceOwnershipProof: params.governanceOwnershipProof,
    });
    updatePassiveConnectorBindingStatus(
      params.binding.bindingId,
      {
        status: result.errors.length > 0 ? "error" : "idle",
        lastSyncAt: Date.now(),
        lastEventAt: Date.now(),
        lastError: result.errors[0] ?? null,
      },
      params.bindingStorePath,
    );
    return {
      bindingId: result.bindingId,
      sourceDescriptorId: result.sourceDescriptorId,
      kind: params.binding.kind,
      ingested: result.ingested,
      skipped: result.skipped,
      tombstoned: result.tombstoned,
      snapshotted: result.snapshotted,
      errors: result.errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "commit failed";
    updatePassiveConnectorBindingStatus(
      params.binding.bindingId,
      { status: "error", lastError: message, lastEventAt: Date.now() },
      params.bindingStorePath,
    );
    throw error;
  }
}

export async function unbindPassiveConnector(params: {
  binding: PassiveConnectorBinding;
  knowledgeBase?: KnowledgeBase | null;
  ownerId?: string | null;
  purgeProjected?: boolean;
  storePath?: string;
  sourceBindingsPath?: string;
  linkStorePath?: string;
  indexRoot?: string;
  kbStorePath?: string;
}): Promise<{ ok: boolean; purged: number }> {
  let purged = 0;
  if (params.purgeProjected && params.knowledgeBase && params.ownerId) {
    // Full purge: KB detach + index chunks/versions + explicit metadata + links.
    const links = listSourceDocumentLinks(
      { sourceDescriptorId: params.binding.sourceDescriptorId },
      params.linkStorePath,
    );
    for (const link of links) {
      if (link.state === "tombstoned") {
        continue;
      }
      await purgeIndexedDocument({
        knowledgeBase: params.knowledgeBase,
        docId: link.docId,
        ownerId: params.ownerId,
        indexRoot: params.indexRoot,
        kbStorePath: params.kbStorePath,
      });
      purged += 1;
    }
  }
  deleteSourceDocumentLinksForSource(params.binding.sourceDescriptorId, params.linkStorePath);
  deletePassiveConnectorBinding(params.binding.bindingId, params.storePath);
  unbindKnowledgeSource(params.binding.sourceDescriptorId, params.sourceBindingsPath);
  return { ok: true, purged };
}
