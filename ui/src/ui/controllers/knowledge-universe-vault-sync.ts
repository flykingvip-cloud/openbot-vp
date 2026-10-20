/**
 * Knowledge Vault Sync — UI controller (P1).
 * Sync password is held only in memory for the active form; never written to localStorage.
 */
import { t } from "../../i18n/index.ts";
import type { AppPortState } from "../app-port-state.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import type {
  VaultSyncInviteSummary,
  VaultSyncMemberSummary,
} from "../capability/knowledge-universe/gateway-client.ts";
import { restoreClientVaultRevision } from "../vault-sync/client-restore.ts";
import type { SelectiveSyncOptions } from "../vault-sync/client-sync-types.ts";
import type { VaultSyncClientGateway } from "../vault-sync/client-sync-types.ts";
import {
  ensureVaultDirectoryHandle,
  isFileSystemAccessSupported,
  pickVaultDirectoryHandle,
  rememberVaultDirectoryHandle,
  runClientVaultSync,
  vaultDirectoryKey,
} from "../vault-sync/client-sync.ts";
import {
  acceptInviteOnClient,
  createInviteOnClient,
  enableTeamOnClient,
} from "../vault-sync/client-team-ops.ts";
import {
  revokeMemberAndRotateOnClient,
  rotateMemberWrapsWithEpochBumpOnClient,
} from "../vault-sync/client-team-rotation.ts";
import {
  getKnowledgeUniverseRuntime,
  type KnowledgeUniverseControllerState,
} from "./knowledge-universe.ts";

type VaultSyncGateway = ReturnType<typeof createKnowledgeUniverseGateway>;

function asVaultSyncClientGateway(gateway: VaultSyncGateway): VaultSyncClientGateway {
  return gateway as unknown as VaultSyncClientGateway;
}

async function notifyVaultRuntimeReindexAfterSync(params: {
  gateway: VaultSyncGateway;
  vaultId: string;
  knowledgeBaseId: string | null | undefined;
  rootPath: string | null | undefined;
  pushUploaded: number;
  pullApplied: number;
  pullTouchedPaths: string[];
}): Promise<void> {
  const activity = params.pushUploaded + params.pullApplied > 0;
  const touched =
    params.pullTouchedPaths.length > 0 ? params.pullTouchedPaths : activity ? ["."] : [];
  if (touched.length === 0) {
    return;
  }
  try {
    await params.gateway.runtimeReindexVaultSync({
      vaultId: params.vaultId,
      knowledgeBaseId: params.knowledgeBaseId?.trim() || undefined,
      rootPath: params.rootPath?.trim() || undefined,
      touchedRelativePaths: touched,
      persistBinding: Boolean(params.knowledgeBaseId?.trim()),
    });
  } catch {
    // Best-effort: sync already succeeded; Runtime projection may be deferred.
  }
}

export type VaultSyncDeviceRow = {
  deviceId: string;
  status?: string;
  platform?: string;
  label?: string;
};

export type VaultSyncMemberRow = VaultSyncMemberSummary;
export type VaultSyncInviteRow = VaultSyncInviteSummary;

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

function syncVaultFormToApp(state: AppPortState, runtime: KnowledgeUniverseControllerState) {
  state.knowledgeUniverseVaultSyncRootPath = runtime.vaultSyncRootPath ?? "";
  state.knowledgeUniverseVaultSyncPassword = ""; // never mirror password onto durable app state
  state.knowledgeUniverseVaultSyncStatus = runtime.vaultSyncStatus ?? null;
  state.knowledgeUniverseVaultSyncVaultId = runtime.vaultSyncVaultId ?? null;
  state.knowledgeUniverseVaultSyncDeviceId = runtime.vaultSyncDeviceId ?? null;
  state.knowledgeUniverseVaultSyncRevisionId = runtime.vaultSyncRevisionId ?? "";
  state.knowledgeUniverseVaultSyncIncludeImages = runtime.vaultSyncIncludeImages ?? true;
  state.knowledgeUniverseVaultSyncExcludeGlobsText = runtime.vaultSyncExcludeGlobsText ?? "";
  state.knowledgeUniverseVaultSyncDevices = runtime.vaultSyncDevices ?? [];
  state.knowledgeUniverseVaultSyncTeamEnabled = runtime.vaultSyncTeamEnabled ?? false;
  state.knowledgeUniverseVaultSyncMembers = runtime.vaultSyncMembers ?? [];
  state.knowledgeUniverseVaultSyncInvites = runtime.vaultSyncInvites ?? [];
  state.knowledgeUniverseVaultSyncInviteeAccountId = runtime.vaultSyncInviteeAccountId ?? "";
  state.knowledgeUniverseVaultSyncAcceptInviteId = runtime.vaultSyncAcceptInviteId ?? "";
  state.knowledgeUniverseVaultSyncInviteSecret = ""; // never mirror invite secret onto durable app state
  state.knowledgeUniverseVaultSyncLastCreatedInviteSecret =
    runtime.vaultSyncLastCreatedInviteSecret ?? null;
  state.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  state.knowledgeUniversePersonalActionError = runtime.personalActionError;
  state.knowledgeUniversePersonalActionNotice =
    runtime.vaultSyncPendingRevisionNotice ?? runtime.personalActionNotice;
}

function parseExcludeGlobs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildSelectiveSync(runtime: KnowledgeUniverseControllerState): SelectiveSyncOptions {
  return {
    includeFolders: true,
    includeImages: runtime.vaultSyncIncludeImages ?? true,
    includeAudio: true,
    includeVideo: true,
    includePdf: true,
    includeOtherAttachments: true,
    excludeGlobs: parseExcludeGlobs(runtime.vaultSyncExcludeGlobsText ?? ""),
  };
}

function requireClientVaultSyncSupport(runtime: KnowledgeUniverseControllerState): boolean {
  if (!isFileSystemAccessSupported()) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.clientSyncFsaRequired",
    );
    return false;
  }
  return true;
}

function requireVaultSession(runtime: KnowledgeUniverseControllerState): {
  vaultId: string;
  deviceId: string;
} | null {
  const vaultId = runtime.vaultSyncVaultId?.trim() ?? "";
  const deviceId = runtime.vaultSyncDeviceId?.trim() ?? "";
  if (!vaultId || !deviceId) {
    return null;
  }
  return { vaultId, deviceId };
}

function resolveVaultActorAccountId(state: AppPortState): string {
  const sessionUser =
    state.platformAuthState?.session?.user?.trim() ||
    state.bootstrapAuthSession?.user?.trim() ||
    "";
  return sessionUser || "local-operator";
}

export function noteKnowledgeUniverseVaultRevisionsAvailable(
  state: AppPortState,
  payload: {
    vaultId?: string;
    revisionIds?: string[];
    cursor?: string;
  },
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const vaultId = payload.vaultId?.trim() ?? "";
  if (!vaultId || runtime.vaultSyncVaultId !== vaultId) {
    return;
  }
  const count = payload.revisionIds?.length ?? 0;
  runtime.vaultSyncPendingRevisionNotice = t(
    "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.revisionsAvailable",
    {
      count: String(Math.max(count, 1)),
      cursor: payload.cursor ?? "",
    },
  );
  runtime.vaultSyncStatus = "idle_synced";
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseVaultSyncRootPath(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.vaultSyncRootPath = value;
  syncVaultFormToApp(state, runtime);
}

export function setKnowledgeUniverseVaultSyncPassword(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  // Memory-only on runtime; intentionally not copied to localStorage / persisted slices.
  runtime.vaultSyncPassword = value;
  syncVaultFormToApp(state, runtime);
}

export function setKnowledgeUniverseVaultSyncRevisionId(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.vaultSyncRevisionId = value;
  syncVaultFormToApp(state, runtime);
}

export function setKnowledgeUniverseVaultSyncIncludeImages(state: AppPortState, value: boolean) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.vaultSyncIncludeImages = value;
  syncVaultFormToApp(state, runtime);
}

export function setKnowledgeUniverseVaultSyncExcludeGlobsText(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.vaultSyncExcludeGlobsText = value;
  syncVaultFormToApp(state, runtime);
}

export async function pickKnowledgeUniverseVaultFolder(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!requireClientVaultSyncSupport(runtime)) {
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.personalActionError = null;
  try {
    const directory = await pickVaultDirectoryHandle();
    runtime.vaultSyncRootPath = directory.name;
    const session = requireVaultSession(runtime);
    if (session) {
      rememberVaultDirectoryHandle(vaultDirectoryKey(session.vaultId, session.deviceId), directory);
    }
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.folderSelected",
      { name: directory.name },
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.folderPickFailed",
          );
  }
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);
}

export async function createAndSyncKnowledgeUniverseVault(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const password = (runtime.vaultSyncPassword ?? "").trim();
  if (!requireClientVaultSyncSupport(runtime)) {
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!password) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.passwordRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  runtime.vaultSyncStatus = "syncing";
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const actorAccountId = resolveVaultActorAccountId(state);
    const directory = await pickVaultDirectoryHandle();
    runtime.vaultSyncRootPath = directory.name;
    const created = (await gateway.createVaultSync({
      password,
      platform: "desktop",
      ownerAccountId: actorAccountId,
    })) as { vaultId: string; deviceId: string };
    runtime.vaultSyncVaultId = created.vaultId;
    runtime.vaultSyncDeviceId = created.deviceId;
    runtime.vaultSyncPendingRevisionNotice = null;
    rememberVaultDirectoryHandle(vaultDirectoryKey(created.vaultId, created.deviceId), directory);
    const { push, pull } = await runClientVaultSync({
      gateway: asVaultSyncClientGateway(gateway),
      vaultId: created.vaultId,
      deviceId: created.deviceId,
      password,
      directory,
      selectiveSync: buildSelectiveSync(runtime),
    });
    await notifyVaultRuntimeReindexAfterSync({
      gateway,
      vaultId: created.vaultId,
      knowledgeBaseId: runtime.selectedKnowledgeBaseId,
      rootPath: runtime.vaultSyncRootPath,
      pushUploaded: push.uploaded ?? 0,
      pullApplied: pull.applied ?? 0,
      pullTouchedPaths: pull.touchedPaths ?? [],
    });
    runtime.vaultSyncStatus = "idle_synced";
    runtime.vaultSyncPassword = "";
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.synced",
      {
        uploaded: String(push.uploaded ?? 0),
        applied: String(pull.applied ?? 0),
        conflicts: String((push.conflicts ?? 0) + (pull.conflicts ?? 0)),
      },
    );
    if (push.errors.length > 0) {
      runtime.personalActionError = push.errors.slice(0, 3).join("; ");
    }
    runtime.libraryWorkspaceImportOpen = false;
    runtime.libraryWorkspaceImportKind = null;
    state.knowledgeUniverseLibraryWorkspaceImportOpen = false;
    state.knowledgeUniverseLibraryWorkspaceImportKind = null;
  } catch (error) {
    runtime.vaultSyncStatus = "error";
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.syncFailed");
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function syncKnowledgeUniverseVaultNow(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  const password = (runtime.vaultSyncPassword ?? "").trim();
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!requireClientVaultSyncSupport(runtime)) {
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!password) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.passwordRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  runtime.vaultSyncPendingRevisionNotice = null;
  runtime.vaultSyncStatus = "syncing";
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const directory = await ensureVaultDirectoryHandle({
      vaultId: session.vaultId,
      deviceId: session.deviceId,
    });
    runtime.vaultSyncRootPath = directory.name;
    const { push, pull } = await runClientVaultSync({
      gateway: asVaultSyncClientGateway(gateway),
      vaultId: session.vaultId,
      deviceId: session.deviceId,
      password,
      directory,
      selectiveSync: buildSelectiveSync(runtime),
    });
    await notifyVaultRuntimeReindexAfterSync({
      gateway,
      vaultId: session.vaultId,
      knowledgeBaseId: runtime.selectedKnowledgeBaseId,
      rootPath: runtime.vaultSyncRootPath,
      pushUploaded: push.uploaded ?? 0,
      pullApplied: pull.applied ?? 0,
      pullTouchedPaths: pull.touchedPaths ?? [],
    });
    runtime.vaultSyncStatus = "idle_synced";
    runtime.vaultSyncPassword = "";
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.synced",
      {
        uploaded: String(push.uploaded ?? 0),
        applied: String(pull.applied ?? 0),
        conflicts: String((push.conflicts ?? 0) + (pull.conflicts ?? 0)),
      },
    );
    if (push.errors.length > 0) {
      runtime.personalActionError = push.errors.slice(0, 3).join("; ");
    }
  } catch (error) {
    runtime.vaultSyncStatus = "error";
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.syncFailed");
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

/**
 * Restore a historical / tombstoned revision onto the local vault root.
 * Requires an unlocked session vault id + device id from a prior create/sync,
 * plus a sync password (never persisted).
 */
export async function restoreKnowledgeUniverseVaultRevision(
  state: AppPortState,
  params?: { revisionId?: string; password?: string },
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  const revisionId = (params?.revisionId ?? runtime.vaultSyncRevisionId ?? "").trim();
  const password = (params?.password ?? runtime.vaultSyncPassword ?? "").trim();
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!revisionId || !password) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.restoreParamsRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!requireClientVaultSyncSupport(runtime)) {
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  runtime.vaultSyncStatus = "syncing";
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const directory = await ensureVaultDirectoryHandle({
      vaultId: session.vaultId,
      deviceId: session.deviceId,
    });
    runtime.vaultSyncRootPath = directory.name;
    const restored = await restoreClientVaultRevision({
      gateway: asVaultSyncClientGateway(gateway),
      vaultId: session.vaultId,
      deviceId: session.deviceId,
      password,
      directory,
      revisionId,
    });
    runtime.vaultSyncStatus = restored.status ?? "idle_synced";
    runtime.vaultSyncPassword = "";
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.restored",
      {
        path: restored.relativePath ?? "",
        revisionId: restored.restoredFromRevisionId ?? revisionId,
      },
    );
  } catch (error) {
    runtime.vaultSyncStatus = "error";
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.restoreFailed");
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function loadKnowledgeUniverseVaultSelectiveSync(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const rootPath = (runtime.vaultSyncRootPath ?? "").trim() || undefined;
    const result = (await gateway.getVaultSyncSelectiveSync({
      vaultId: session.vaultId,
      deviceId: session.deviceId,
      rootPath,
    })) as {
      selectiveSync?: {
        includeImages?: boolean;
        excludeGlobs?: string[];
      };
    };
    const selective = result.selectiveSync ?? {};
    if (typeof selective.includeImages === "boolean") {
      runtime.vaultSyncIncludeImages = selective.includeImages;
    }
    if (Array.isArray(selective.excludeGlobs)) {
      runtime.vaultSyncExcludeGlobsText = selective.excludeGlobs.join("\n");
    }
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.selectiveLoaded",
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.selectiveLoadFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function saveKnowledgeUniverseVaultSelectiveSync(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const rootPath = (runtime.vaultSyncRootPath ?? "").trim() || undefined;
    await gateway.setVaultSyncSelectiveSync({
      vaultId: session.vaultId,
      deviceId: session.deviceId,
      rootPath,
      selectiveSync: {
        includeImages: runtime.vaultSyncIncludeImages,
        excludeGlobs: parseExcludeGlobs(runtime.vaultSyncExcludeGlobsText),
      },
    });
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.selectiveSaved",
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.selectiveSaveFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function loadKnowledgeUniverseVaultDevices(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const result = (await gateway.listVaultSyncDevices({
      vaultId: session.vaultId,
    })) as {
      devices?: VaultSyncDeviceRow[];
    };
    runtime.vaultSyncDevices = Array.isArray(result.devices)
      ? result.devices.map((device) => ({
          deviceId: String(device.deviceId ?? ""),
          status: device.status,
          platform: device.platform,
          label: device.label,
        }))
      : [];
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.devicesLoaded",
      { count: String(runtime.vaultSyncDevices.length) },
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.devicesLoadFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function revokeKnowledgeUniverseVaultDevice(state: AppPortState, deviceId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  const targetDeviceId = deviceId.trim();
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!targetDeviceId) {
    return;
  }
  if (targetDeviceId === session.deviceId) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.cannotRevokeCurrentDevice",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.revokeVaultSyncDevice({
      vaultId: session.vaultId,
      deviceId: targetDeviceId,
    });
    runtime.vaultSyncDevices = runtime.vaultSyncDevices.map((device) =>
      device.deviceId === targetDeviceId ? { ...device, status: "revoked" } : device,
    );
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.deviceRevoked",
      { deviceId: targetDeviceId },
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.deviceRevokeFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export function setKnowledgeUniverseVaultSyncInviteeAccountId(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.vaultSyncInviteeAccountId = value;
  syncVaultFormToApp(state, runtime);
}

export function setKnowledgeUniverseVaultSyncAcceptInviteId(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.vaultSyncAcceptInviteId = value;
  syncVaultFormToApp(state, runtime);
}

export function setKnowledgeUniverseVaultSyncInviteSecret(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.vaultSyncInviteSecret = value;
  syncVaultFormToApp(state, runtime);
}

/**
 * Best-effort panel hydrate for a Vault Sync session (devices / selective / team).
 * Retained for a future product entry (current 录入知识页 does **not** surface Vault — entry TBD).
 * Must not be assumed reachable via 本地文件夹 · 同步方式 (方案 A superseded 2026-07-23).
 */
export async function hydrateKnowledgeUniverseVaultSyncPanel(state: AppPortState): Promise<void> {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    syncVaultFormToApp(state, runtime);
    return;
  }
  if (!isFileSystemAccessSupported()) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.clientSyncFsaRequired",
    );
    syncVaultFormToApp(state, runtime);
    return;
  }
  runtime.personalActionError = null;
  const session = requireVaultSession(runtime);
  if (!session) {
    runtime.vaultSyncStatus = runtime.vaultSyncStatus ?? "unconfigured";
    syncVaultFormToApp(state, runtime);
    return;
  }
  if (!runtime.vaultSyncStatus || runtime.vaultSyncStatus === "unconfigured") {
    runtime.vaultSyncStatus = "idle_synced";
  }
  syncVaultFormToApp(state, runtime);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const rootPath = (runtime.vaultSyncRootPath ?? "").trim() || undefined;
    const status = await gateway.vaultSyncStatus({ vaultId: session.vaultId });
    runtime.vaultSyncTeamEnabled = Boolean(status.teamEnabled);

    const [devicesResult, selectiveResult] = await Promise.all([
      gateway.listVaultSyncDevices({ vaultId: session.vaultId }),
      gateway.getVaultSyncSelectiveSync({
        vaultId: session.vaultId,
        deviceId: session.deviceId,
        rootPath,
      }),
    ]);

    runtime.vaultSyncDevices = Array.isArray(devicesResult.devices)
      ? devicesResult.devices.map((device) => ({
          deviceId: String(device.deviceId ?? ""),
          status: device.status,
          platform: device.platform,
          label: device.label,
        }))
      : [];

    const selective = selectiveResult.selectiveSync ?? {};
    if (typeof selective.includeImages === "boolean") {
      runtime.vaultSyncIncludeImages = selective.includeImages;
    }
    if (Array.isArray(selective.excludeGlobs)) {
      runtime.vaultSyncExcludeGlobsText = selective.excludeGlobs.join("\n");
    }

    if (runtime.vaultSyncTeamEnabled) {
      const [membersResult, invitesResult] = await Promise.all([
        gateway.listVaultSyncMembers({ vaultId: session.vaultId }),
        gateway.listVaultSyncInvites({ vaultId: session.vaultId }),
      ]);
      runtime.vaultSyncMembers = membersResult.members ?? [];
      runtime.vaultSyncInvites = invitesResult.invites ?? [];
    } else {
      runtime.vaultSyncMembers = [];
      runtime.vaultSyncInvites = [];
    }
  } catch {
    // Hydrate is best-effort; explicit refresh buttons remain on the manage panel.
  } finally {
    syncVaultFormToApp(state, runtime);
  }
}

export async function refreshKnowledgeUniverseVaultTeamState(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const status = await gateway.vaultSyncStatus({ vaultId: session.vaultId });
    runtime.vaultSyncTeamEnabled = Boolean(status.teamEnabled);
    if (runtime.vaultSyncTeamEnabled) {
      const [membersResult, invitesResult] = await Promise.all([
        gateway.listVaultSyncMembers({ vaultId: session.vaultId }),
        gateway.listVaultSyncInvites({ vaultId: session.vaultId }),
      ]);
      runtime.vaultSyncMembers = membersResult.members ?? [];
      runtime.vaultSyncInvites = invitesResult.invites ?? [];
    }
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.teamStateLoaded",
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.teamLoadFailed");
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function enableKnowledgeUniverseVaultTeam(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  const password = (runtime.vaultSyncPassword ?? "").trim();
  const ownerAccountId = resolveVaultActorAccountId(state);
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!password) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.passwordRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await enableTeamOnClient({
      gateway: asVaultSyncClientGateway(gateway),
      vaultId: session.vaultId,
      ownerAccountId,
      password,
    });
    runtime.vaultSyncTeamEnabled = true;
    runtime.vaultSyncPassword = "";
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.teamEnabled",
    );
    await refreshKnowledgeUniverseVaultTeamState(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.teamEnableFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function bumpKnowledgeUniverseVaultEncryptionEpoch(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  const password = (runtime.vaultSyncPassword ?? "").trim();
  const actorAccountId = resolveVaultActorAccountId(state);
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!runtime.vaultSyncTeamEnabled) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.teamNotEnabled",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!password) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.passwordRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const rotated = await rotateMemberWrapsWithEpochBumpOnClient({
      gateway: asVaultSyncClientGateway(gateway),
      vaultId: session.vaultId,
      actorAccountId,
      password,
    });
    runtime.vaultSyncPassword = "";
    const membersResult = await gateway.listVaultSyncMembers({ vaultId: session.vaultId });
    runtime.vaultSyncMembers = membersResult.members ?? [];
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.epochBumpedRotated",
      { epoch: String(rotated.keyEpoch), count: String(rotated.rotatedCount) },
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.epochBumpFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function createKnowledgeUniverseVaultInvite(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  const password = (runtime.vaultSyncPassword ?? "").trim();
  const invitedByAccountId = resolveVaultActorAccountId(state);
  const inviteeAccountId = (runtime.vaultSyncInviteeAccountId ?? "").trim();
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!runtime.vaultSyncTeamEnabled) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.teamNotEnabled",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!password) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.passwordRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const created = await createInviteOnClient({
      gateway: asVaultSyncClientGateway(gateway),
      vaultId: session.vaultId,
      invitedByAccountId,
      password,
      inviteeAccountId: inviteeAccountId || null,
    });
    runtime.vaultSyncPassword = "";
    runtime.vaultSyncLastCreatedInviteSecret = created.inviteSecret;
    runtime.vaultSyncInvites = [
      {
        inviteId: created.inviteId,
        inviteeAccountId: inviteeAccountId || null,
        status: "pending",
      },
      ...runtime.vaultSyncInvites.filter((i) => i.inviteId !== created.inviteId),
    ];
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.inviteCreated",
      { inviteId: created.inviteId },
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.inviteCreateFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function revokeKnowledgeUniverseVaultMember(
  state: AppPortState,
  memberAccountId: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  const targetId = memberAccountId.trim();
  const actorAccountId = resolveVaultActorAccountId(state);
  if (!session || !targetId) {
    return;
  }
  if (targetId === actorAccountId) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.cannotRevokeSelfMember",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  const password = (runtime.vaultSyncPassword ?? "").trim();
  if (runtime.vaultSyncTeamEnabled && !password) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.passwordRequiredForMemberRevoke",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    if (runtime.vaultSyncTeamEnabled && password) {
      const rotated = await revokeMemberAndRotateOnClient({
        gateway: asVaultSyncClientGateway(gateway),
        vaultId: session.vaultId,
        actorAccountId,
        memberAccountId: targetId,
        password,
      });
      runtime.vaultSyncPassword = "";
      const membersResult = await gateway.listVaultSyncMembers({ vaultId: session.vaultId });
      runtime.vaultSyncMembers = membersResult.members ?? [];
      runtime.personalActionNotice = t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.memberRevokedRotated",
        { memberAccountId: targetId, count: String(rotated.rotatedCount) },
      );
    } else {
      await gateway.revokeVaultSyncMember({
        vaultId: session.vaultId,
        memberAccountId: targetId,
        actorAccountId,
      });
      runtime.vaultSyncMembers = runtime.vaultSyncMembers.map((member) =>
        member.memberAccountId === targetId ? { ...member, status: "revoked" } : member,
      );
      runtime.personalActionNotice = t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.memberRevoked",
        { memberAccountId: targetId },
      );
    }
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.memberRevokeFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function revokeKnowledgeUniverseVaultInvite(state: AppPortState, inviteId: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  const targetInviteId = inviteId.trim();
  const actorAccountId = resolveVaultActorAccountId(state);
  if (!session || !targetInviteId) {
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.revokeVaultSyncInvite({
      vaultId: session.vaultId,
      inviteId: targetInviteId,
      actorAccountId,
    });
    runtime.vaultSyncInvites = runtime.vaultSyncInvites.map((invite) =>
      invite.inviteId === targetInviteId ? { ...invite, status: "revoked" } : invite,
    );
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.inviteRevoked",
      { inviteId: targetInviteId },
    );
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.inviteRevokeFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}

export async function acceptKnowledgeUniverseVaultInvite(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (!state.client) {
    return;
  }
  const session = requireVaultSession(runtime);
  const inviteId = (runtime.vaultSyncAcceptInviteId ?? "").trim();
  const inviteSecret = (runtime.vaultSyncInviteSecret ?? "").trim();
  const memberAccountId = resolveVaultActorAccountId(state);
  if (!session) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.vaultSessionRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!inviteId || !inviteSecret) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.acceptInviteParamsRequired",
    );
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  syncVaultFormToApp(state, runtime);
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const invitesResult = await gateway.listVaultSyncInvites({ vaultId: session.vaultId });
    const invite = (invitesResult.invites ?? []).find((row) => row.inviteId === inviteId);
    if (!invite?.inviteSaltB64 || !invite?.wrappedBaseKeyB64) {
      throw new Error("invite wrap metadata unavailable");
    }
    await acceptInviteOnClient({
      gateway: asVaultSyncClientGateway(gateway),
      vaultId: session.vaultId,
      inviteId,
      memberAccountId,
      inviteSecret,
      inviteSaltB64: invite.inviteSaltB64,
      wrappedBaseKeyB64: invite.wrappedBaseKeyB64,
      keyEpoch: invite.keyEpoch ?? 1,
    });
    runtime.vaultSyncInviteSecret = "";
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.notices.inviteAccepted",
      { inviteId },
    );
    await refreshKnowledgeUniverseVaultTeamState(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error
        ? error.message
        : t(
            "frontstage.workbench.knowledgeUniverse.importToSpace.vaultSync.errors.inviteAcceptFailed",
          );
  } finally {
    runtime.personalActionBusy = false;
    syncVaultFormToApp(state, runtime);
    requestUpdate(state);
  }
}
