import { t } from "../../i18n/index.ts";
import type { AppPortState } from "../app-port-state.ts";
import type {
  LocalFolderBindingMode,
  LocalFolderDeletePolicy,
  LocalFolderStatusItem,
} from "../capability/knowledge-universe/endpoints.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import { loadOrCreateDeviceIdentity } from "../device-identity.ts";
import {
  clearManagedPushDirectory,
  ensureManagedPushDirectoryReadable,
  getManagedPushDirectorySelection,
  isBrowserFileUnreadable,
  isLocalFolderVecUnavailableMessage,
  ManagedPushReadError,
  pickManagedPushDirectory,
  resolveManagedPushFolderDisplayPath,
  syncManagedPushDirectory,
  type ManagedPushProgress,
  type ManagedPushSkippedFile,
  type ManagedPushSyncSummary,
} from "./knowledge-universe-local-folder-upload.ts";
import { ensurePersonalKnowledgeBase } from "./knowledge-universe-personal-space.ts";
import {
  loadLibraryWorkspaceDocuments,
  syncWorkspaceToAppState,
} from "./knowledge-universe-workspace.ts";
import {
  getKnowledgeUniverseRuntime,
  requireSelectedKnowledgeBaseId,
  type KnowledgeUniverseControllerState,
} from "./knowledge-universe.ts";

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

export function formatLocalFolderImportProgressLabel(progress: ManagedPushProgress): string {
  const current = String(progress.current);
  const total = String(progress.total);
  if (progress.phase === "scan") {
    if (progress.scanStage === "hashing" || progress.total > 0) {
      return progress.fileName
        ? t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.scanningHashing",
            { current, total, fileName: progress.fileName },
          )
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.scanningHashingUnknown",
            { current, total },
          );
    }
    if (progress.current > 0) {
      return t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.scanningListing",
        { current },
      );
    }
    return t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.scanning");
  }
  if (progress.phase === "index") {
    return t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.indexing", {
      current,
      total,
    });
  }
  if (progress.phase === "finalize") {
    return t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.finalizing",
    );
  }
  return progress.fileName
    ? t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.uploading", {
        current,
        total,
        fileName: progress.fileName,
      })
    : t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.uploadingUnknown",
        { current, total },
      );
}

export function localizeLocalFolderError(error: unknown): string {
  if (error instanceof ManagedPushReadError) {
    if (error.code === "permission-denied") {
      return t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.permissionRequired",
      );
    }
    return t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.fileUnreadable",
      { path: error.relativePath?.trim() || "—" },
    );
  }
  if (isBrowserFileUnreadable(error)) {
    return t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.permissionRequired",
    );
  }
  const message = error instanceof Error ? error.message.trim() : "";
  if (message && isLocalFolderVecUnavailableMessage(message)) {
    return t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.indexDeferred",
    );
  }
  if (message) {
    return message;
  }
  return t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.bindFailed");
}

export function localizeLocalFolderBindingError(message: string | undefined): string | null {
  const text = message?.trim() ?? "";
  if (!text) {
    return null;
  }
  if (isLocalFolderVecUnavailableMessage(text)) {
    return t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.indexDeferred",
    );
  }
  return text;
}

const SKIP_DETAIL_LIMIT = 5;

function formatLocalFolderSkipReason(item: ManagedPushSkippedFile): string {
  const path = item.relativePath;
  switch (item.reason) {
    case "unreadable":
      return t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.skipReasons.unreadable",
        { path },
      );
    case "empty":
      return t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.skipReasons.empty",
        { path },
      );
    case "too_large":
      return t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.skipReasons.too_large",
        { path },
      );
    case "folder_too_large":
      return t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.skipReasons.folder_too_large",
        { path },
      );
    case "changed":
      return t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.skipReasons.changed",
        { path },
      );
    case "index_deferred":
      return t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.skipReasons.index_deferred",
        { path },
      );
    default:
      return t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.skipReasons.upload_failed",
        { path },
      );
  }
}

function formatLocalFolderImportHint(skipped: ManagedPushSkippedFile[]): string {
  const reasons = new Set(skipped.map((item) => item.reason));
  if (reasons.has("too_large") || reasons.has("folder_too_large")) {
    return t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.hints.tooLarge");
  }
  if (reasons.has("unreadable")) {
    return t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.hints.unreadable");
  }
  if (reasons.has("index_deferred")) {
    return t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.hints.indexDeferred",
    );
  }
  if (reasons.has("upload_failed")) {
    return t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.hints.uploadFailed");
  }
  return "";
}

export function formatLocalFolderSkipDetails(skipped: ManagedPushSkippedFile[]): string {
  const shown = skipped.slice(0, SKIP_DETAIL_LIMIT);
  const parts = shown.map((item) => formatLocalFolderSkipReason(item));
  if (skipped.length > shown.length) {
    parts.push(
      t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.skipMore", {
        count: String(skipped.length - shown.length),
      }),
    );
  }
  return parts.join("；");
}

export function formatLocalFolderImportOutcome(
  summary: ManagedPushSyncSummary,
  label: string,
): { kind: "notice" | "error"; text: string } {
  const storedCount = summary.documents.filter(
    (item) => item.originalStored || item.chunkCount > 0,
  ).length;
  const failed = summary.skipped.filter((item) => item.reason !== "index_deferred");
  const deferred = summary.skipped.filter((item) => item.reason === "index_deferred");
  const savedCount = Math.max(summary.uploadedCount, storedCount);
  const withHint = (text: string, skipped: ManagedPushSkippedFile[]) => {
    const hint = formatLocalFolderImportHint(skipped);
    return hint ? `${text} ${hint}` : text;
  };

  if (failed.length > 0) {
    return {
      kind: "notice",
      text: withHint(
        t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.notices.boundPartial", {
          label,
          uploaded: String(savedCount),
          skipped: String(failed.length),
          details: formatLocalFolderSkipDetails(failed),
        }),
        failed,
      ),
    };
  }
  if (
    savedCount > 0 &&
    (deferred.length > 0 || (summary.documents.length > 0 && !summary.allReady))
  ) {
    return {
      kind: "notice",
      text: withHint(
        t(
          "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.notices.boundIndexedPending",
          {
            label,
            saved: String(savedCount),
            ready: String(summary.readyCount),
          },
        ),
        deferred.length > 0 ? deferred : summary.skipped,
      ),
    };
  }
  if (savedCount === 0) {
    return {
      kind: "notice",
      text: t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.notices.boundEmpty",
        { label },
      ),
    };
  }
  return {
    kind: "notice",
    text: t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.notices.boundReady", {
      label,
      ready: String(summary.readyCount || savedCount),
    }),
  };
}

function syncLocalFolderToAppState(state: AppPortState, runtime: KnowledgeUniverseControllerState) {
  // The import surface is cloud-backed only. Historical local_index state must not leak back in.
  runtime.libraryWorkspaceLocalFolderMode = "managed_push";
  runtime.libraryWorkspaceLocalFolderWatcherEnabled = false;
  state.knowledgeUniverseLibraryWorkspaceLocalFolderPath = runtime.libraryWorkspaceLocalFolderPath;
  state.knowledgeUniverseLibraryWorkspaceLocalFolderLabel =
    runtime.libraryWorkspaceLocalFolderLabel;
  state.knowledgeUniverseLibraryWorkspaceLocalFolderDeletePolicy =
    runtime.libraryWorkspaceLocalFolderDeletePolicy;
  state.knowledgeUniverseLibraryWorkspaceLocalFolderWatcherEnabled = false;
  state.knowledgeUniverseLibraryWorkspaceLocalFolderMode = "managed_push";
  state.knowledgeUniverseLibraryWorkspaceLocalFolderStatusItems =
    runtime.libraryWorkspaceLocalFolderStatusItems;
  state.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  state.knowledgeUniversePersonalActionError = runtime.personalActionError;
  state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
}

export function setKnowledgeUniverseLocalFolderPath(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceLocalFolderPath = value;
  if (!runtime.libraryWorkspaceLocalFolderLabel.trim() && value.trim()) {
    const base = value.trim().split(/[/\\]/).filter(Boolean).at(-1);
    if (base) {
      runtime.libraryWorkspaceLocalFolderLabel = base;
    }
  }
  syncLocalFolderToAppState(state, runtime);
}

export function setKnowledgeUniverseLocalFolderLabel(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceLocalFolderLabel = value;
  syncLocalFolderToAppState(state, runtime);
}

export function setKnowledgeUniverseLocalFolderDeletePolicy(
  state: AppPortState,
  value: LocalFolderDeletePolicy,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceLocalFolderDeletePolicy = value;
  syncLocalFolderToAppState(state, runtime);
}

export function setKnowledgeUniverseLocalFolderWatcherEnabled(
  state: AppPortState,
  _enabled: boolean,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceLocalFolderWatcherEnabled = false;
  syncLocalFolderToAppState(state, runtime);
}

export function setKnowledgeUniverseLocalFolderMode(
  state: AppPortState,
  _mode: LocalFolderBindingMode,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceLocalFolderMode = "managed_push";
  runtime.libraryWorkspaceLocalFolderWatcherEnabled = false;
  syncLocalFolderToAppState(state, runtime);
}

export async function loadKnowledgeUniverseLocalFolderStatus(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = requireSelectedKnowledgeBaseId(state);
  if (!kbId || !state.client) {
    runtime.libraryWorkspaceLocalFolderStatusItems = [];
    syncLocalFolderToAppState(state, runtime);
    return;
  }
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const result = (await gateway.localFolderStatus({
      knowledgeBaseId: kbId,
    })) as { items?: LocalFolderStatusItem[] };
    runtime.libraryWorkspaceLocalFolderStatusItems = Array.isArray(result.items)
      ? result.items
      : [];
  } catch {
    runtime.libraryWorkspaceLocalFolderStatusItems = [];
  }
  syncLocalFolderToAppState(state, runtime);
}

export async function scanKnowledgeUniverseLocalFolderNow(state: AppPortState, bindingId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client || !bindingId.trim()) {
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncLocalFolderToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const result = (await gateway.scanLocalFolderNow({ bindingId })) as {
      summary?: { scanned?: number; ingested?: number; errors?: string[] };
    };
    const scanned = result.summary?.scanned ?? 0;
    const ingested = result.summary?.ingested ?? 0;
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.notices.scanned",
      { scanned: String(scanned), ingested: String(ingested) },
    );
    if (result.summary?.errors?.length) {
      runtime.personalActionError = result.summary.errors.join("; ");
      if (ingested === 0) {
        runtime.personalActionNotice = null;
      }
    }
    await loadKnowledgeUniverseLocalFolderStatus(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.scanFailed");
  } finally {
    runtime.personalActionBusy = false;
    syncLocalFolderToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function pickKnowledgeUniverseLocalFolderPath(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.personalActionError = null;
  try {
    const directory = await pickManagedPushDirectory(state);
    setKnowledgeUniverseLocalFolderPath(state, resolveManagedPushFolderDisplayPath(directory));
    requestUpdate(state);
  } catch (error) {
    // User cancellation is intentionally silent; browser implementations use AbortError.
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.pickFailed");
    syncLocalFolderToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function bindKnowledgeUniverseLocalFolder(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const selection = getManagedPushDirectorySelection(state);
  if (!selection) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.pathRequired",
    );
    syncLocalFolderToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  const { directory, directoryId } = selection;
  const rootLabel = runtime.libraryWorkspaceLocalFolderLabel.trim() || directory.name || "folder";
  if (!(await ensureManagedPushDirectoryReadable(directory))) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.permissionRequired",
    );
    syncLocalFolderToAppState(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  runtime.importProgress = {
    current: 0,
    total: 0,
    label: t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.progress.binding"),
  };
  syncLocalFolderToAppState(state, runtime);
  requestUpdate(state);

  try {
    if (!state.client) {
      throw new Error(
        t("frontstage.workbench.knowledgeUniverse.importToSpace.localFolder.errors.gatewayOffline"),
      );
    }
    const selectedKbId = runtime.selectedKnowledgeBaseId?.trim();
    const kbId =
      selectedKbId &&
      runtime.knowledgeBases.some((knowledgeBase) => knowledgeBase.id === selectedKbId)
        ? selectedKbId
        : await ensurePersonalKnowledgeBase(state);
    const gateway = createKnowledgeUniverseGateway(state.client);
    if (!gateway.localFolderSyncPlan || !gateway.localFolderSyncCommit) {
      throw new Error("This gateway does not support managed folder uploads.");
    }
    const identity = await loadOrCreateDeviceIdentity();
    const deviceId = identity.deviceId?.trim() || `browser-${Date.now().toString(36)}`;
    const result = await gateway.bindLocalFolder({
      knowledgeBaseId: kbId,
      rootLabel,
      directoryId,
      mode: "managed_push",
      deletePolicy: runtime.libraryWorkspaceLocalFolderDeletePolicy,
      watcherEnabled: false,
      deviceId,
    });
    if (!result.bindingId?.trim()) {
      throw new Error("Managed folder binding did not return a binding id.");
    }
    const summary = await syncManagedPushDirectory({
      gateway,
      bindingId: result.bindingId,
      deviceId,
      directory,
      onProgress: (progress) => {
        runtime.importProgress = {
          current: progress.current,
          total: progress.total,
          label: formatLocalFolderImportProgressLabel(progress),
        };
        requestUpdate(state);
      },
    });
    const connectedLabel = result.rootLabel ?? rootLabel;
    const outcome = formatLocalFolderImportOutcome(summary, connectedLabel);
    if (outcome.kind === "error") {
      runtime.personalActionError = outcome.text;
    } else {
      runtime.personalActionNotice = outcome.text;
    }
    if (summary.skipped.length === 0) {
      clearManagedPushDirectory(state);
      runtime.libraryWorkspaceLocalFolderPath = "";
      runtime.libraryWorkspaceLocalFolderLabel = "";
      runtime.libraryWorkspaceLocalFolderDeletePolicy = "snapshot";
      runtime.libraryWorkspaceLocalFolderWatcherEnabled = false;
      runtime.libraryWorkspaceLocalFolderMode = "managed_push";
      runtime.libraryWorkspaceImportOpen = false;
      runtime.libraryWorkspaceImportKind = null;
      runtime.libraryWorkspaceContentTab = "documents";
      state.knowledgeUniverseLibraryWorkspaceImportOpen = false;
      state.knowledgeUniverseLibraryWorkspaceImportKind = null;
    }
    await loadLibraryWorkspaceDocuments(state);
    await loadKnowledgeUniverseLocalFolderStatus(state);
    syncWorkspaceToAppState(state);
  } catch (error) {
    runtime.personalActionError = localizeLocalFolderError(error);
  } finally {
    runtime.personalActionBusy = false;
    runtime.importProgress = null;
    syncLocalFolderToAppState(state, runtime);
    requestUpdate(state);
  }
}

/** Open the host-local original file for a projected local-folder document. */
export async function openKnowledgeUniverseOriginalDocument(
  state: AppPortState,
  documentId: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = requireSelectedKnowledgeBaseId(state);
  if (!state.client || !kbId || !documentId.trim()) {
    return;
  }
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncLocalFolderToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.openLocalFolderDocument({
      documentId: documentId.trim(),
      knowledgeBaseId: kbId,
    });
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.libraryWorkspace.noticeOpenedOriginal",
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.openOriginalFailed");
  } finally {
    syncLocalFolderToAppState(state, runtime);
    requestUpdate(state);
  }
}
