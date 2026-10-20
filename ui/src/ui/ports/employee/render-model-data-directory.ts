import type { AppPortState } from "../../app-port-state.ts";
import { resolveWorkbenchDataSpaceSettings } from "./data-space.ts";
import type {
  DataDirectoryPanelState,
  DataDirectoryAccessGrantRow,
} from "./views/data-directory-page.ts";

type DataRootGetResponse =
  | { mode: "managed" }
  | {
      mode: "local";
      rootPath?: string;
      displayRoot?: string;
      volumeName?: string;
      usedBytesLabel?: string;
      previousRoot?: string;
    };

type MigrationStartResponse = {
  job?: {
    phase?: string;
    targetRoot?: string;
    message?: string;
    error?: string;
  };
};

type MigrationPreflightResponse = {
  ok?: boolean;
  error?: string;
  estimatedBytesLabel?: string;
  targetRoot?: string;
};

type DataExportCreateResponse = {
  exportPath?: string;
};

type AccessGrantsListResponse = {
  grants?: Array<{
    id: string;
    agentId: string;
    resourceType: string;
    resourcePath: string;
    grantedAt: string;
    revokedAt?: string | null;
  }>;
};

export function buildWorkbenchDataDirectoryPanelState(
  state: AppPortState,
): DataDirectoryPanelState {
  const dataSpace = resolveWorkbenchDataSpaceSettings({
    config: state.configSnapshot?.config,
    bootstrapMode: state.bootstrapDataSpace?.mode ?? null,
    bootstrapDisplayRoot: state.bootstrapDataSpace?.displayRoot ?? null,
  });
  const mode = state.workbenchDataDirectoryMode ?? dataSpace.mode;
  return {
    loading: state.workbenchDataDirectoryLoading,
    error: state.workbenchDataDirectoryError,
    mode,
    displayRoot: state.workbenchDataDirectoryDisplayRoot ?? dataSpace.displayRoot,
    volumeName: state.workbenchDataDirectoryVolumeName ?? undefined,
    usedBytesLabel: state.workbenchDataDirectoryUsedLabel ?? undefined,
    migrationOpen: state.workbenchDataMigrationOpen,
    migrationBusy: state.workbenchDataMigrationBusy,
    migrationMessage: state.workbenchDataMigrationMessage,
    migrationTargetDraft: state.workbenchDataMigrationTargetDraft,
    exportBusy: state.workbenchDataExportBusy,
    exportPath: state.workbenchDataExportPath,
    showFinderReveal: mode === "local" && state.workspaceHost?.platform === "darwin",
    accessGrants: state.workbenchDataAccessGrants,
    accessGrantsLoading: state.workbenchDataAccessGrantsLoading,
    forgetMemoryAgentId: state.workbenchForgetMemoryAgentId,
    forgetMemoryKey: state.workbenchForgetMemoryKey,
    forgetMemoryBusy: state.workbenchForgetMemoryBusy,
    forgetMemoryMessage: state.workbenchForgetMemoryMessage,
  };
}

export async function loadWorkbenchDataAccessGrants(
  state: AppPortState,
  requestRender: () => void,
): Promise<void> {
  if (!state.client || !state.connected || state.workbenchDataDirectoryMode === "managed") {
    state.workbenchDataAccessGrants = [];
    state.workbenchDataAccessGrantsLoading = false;
    requestRender();
    return;
  }
  state.workbenchDataAccessGrantsLoading = true;
  requestRender();
  try {
    const result: AccessGrantsListResponse = await state.client.request(
      "data.accessGrants.list",
      {},
    );
    state.workbenchDataAccessGrants = (result.grants ?? [])
      .filter((grant) => !grant.revokedAt)
      .map(
        (grant): DataDirectoryAccessGrantRow => ({
          id: grant.id,
          agentId: grant.agentId,
          resourceType: grant.resourceType,
          resourcePath: grant.resourcePath,
          grantedAt: grant.grantedAt,
        }),
      );
  } catch {
    state.workbenchDataAccessGrants = [];
  } finally {
    state.workbenchDataAccessGrantsLoading = false;
    requestRender();
  }
}

export async function loadWorkbenchDataDirectoryPanel(
  state: AppPortState,
  requestRender: () => void,
): Promise<void> {
  const dataSpace = resolveWorkbenchDataSpaceSettings({
    config: state.configSnapshot?.config,
    bootstrapMode: state.bootstrapDataSpace?.mode ?? null,
    bootstrapDisplayRoot: state.bootstrapDataSpace?.displayRoot ?? null,
  });
  if (dataSpace.mode === "managed") {
    state.workbenchDataDirectoryMode = "managed";
    state.workbenchDataDirectoryLoading = false;
    state.workbenchDataDirectoryError = null;
    requestRender();
    return;
  }
  if (!state.client || !state.connected) {
    state.workbenchDataDirectoryError = "当前未连接到网关，无法加载数据目录。";
    state.workbenchDataDirectoryLoading = false;
    requestRender();
    return;
  }
  state.workbenchDataDirectoryLoading = true;
  state.workbenchDataDirectoryError = null;
  requestRender();
  try {
    const result: DataRootGetResponse = await state.client.request("data.root.get", {});
    if (result.mode === "managed") {
      state.workbenchDataDirectoryMode = "managed";
      return;
    }
    state.workbenchDataDirectoryMode = "local";
    state.workbenchDataDirectoryDisplayRoot = result.displayRoot ?? result.rootPath ?? null;
    state.workbenchDataDirectoryVolumeName = result.volumeName ?? null;
    state.workbenchDataDirectoryUsedLabel = result.usedBytesLabel ?? null;
    await loadWorkbenchDataAccessGrants(state, requestRender);
  } catch (error) {
    state.workbenchDataDirectoryError = String(error);
  } finally {
    state.workbenchDataDirectoryLoading = false;
    requestRender();
  }
}

export function buildWorkbenchDataDirectoryActionHandlers(params: {
  state: AppPortState;
  requestRender: () => void;
}) {
  const { state, requestRender } = params;
  return {
    onRevealDataDirectoryInFinder: async () => {
      if (!state.client || !state.connected) {
        state.workbenchDataDirectoryError = "当前未连接到网关。";
        requestRender();
        return;
      }
      try {
        await state.client.request("data.root.reveal", {});
      } catch (error) {
        state.workbenchDataDirectoryError = String(error);
        requestRender();
      }
    },
    onOpenDataMigrationWizard: () => {
      state.workbenchDataMigrationOpen = true;
      state.workbenchDataMigrationMessage = null;
      requestRender();
    },
    onCloseDataMigrationWizard: () => {
      state.workbenchDataMigrationOpen = false;
      state.workbenchDataMigrationMessage = null;
      requestRender();
    },
    onDataMigrationTargetDraftChange: (value: string) => {
      state.workbenchDataMigrationTargetDraft = value;
      state.workbenchDataMigrationMessage = null;
      requestRender();
    },
    onChooseDataMigrationTarget: async () => {
      state.workbenchDataMigrationMessage = null;
      requestRender();
    },
    onStartDataMigration: async () => {
      const targetPath = (state.workbenchDataMigrationTargetDraft ?? "").trim();
      if (!targetPath) {
        state.workbenchDataMigrationMessage = "请先填写目标父目录。";
        requestRender();
        return;
      }
      if (!state.client || !state.connected) {
        state.workbenchDataMigrationMessage = "当前未连接到网关。";
        requestRender();
        return;
      }
      state.workbenchDataMigrationBusy = true;
      state.workbenchDataMigrationMessage = "正在预检…";
      requestRender();
      try {
        const preflight: MigrationPreflightResponse = await state.client.request(
          "data.migration.preflight",
          {
            targetPath,
          },
        );
        if (!preflight.ok) {
          state.workbenchDataMigrationMessage = preflight.error ?? "预检失败。";
          return;
        }
        state.workbenchDataMigrationMessage = `预计迁移 ${preflight.estimatedBytesLabel ?? "—"} 至 ${preflight.targetRoot ?? targetPath}…`;
        requestRender();
        const started: MigrationStartResponse = await state.client.request("data.migration.start", {
          targetPath,
        });
        const job = started.job;
        if (job?.phase === "done") {
          state.workbenchDataMigrationMessage = `迁移完成：${job.targetRoot ?? targetPath}。请重启 Gateway 使配置生效。`;
          state.workbenchDataMigrationOpen = false;
          await loadWorkbenchDataDirectoryPanel(state, requestRender);
          return;
        }
        state.workbenchDataMigrationMessage = job?.error ?? job?.message ?? "迁移失败。";
      } catch (error) {
        state.workbenchDataMigrationMessage = String(error);
      } finally {
        state.workbenchDataMigrationBusy = false;
        requestRender();
      }
    },
    onExportOpenBotData: async () => {
      if (!state.client || !state.connected) {
        state.workbenchDataDirectoryError = "当前未连接到网关。";
        requestRender();
        return;
      }
      state.workbenchDataExportBusy = true;
      state.workbenchDataExportPath = null;
      requestRender();
      try {
        const result: DataExportCreateResponse = await state.client.request(
          "data.export.create",
          {},
        );
        state.workbenchDataExportPath = result.exportPath ?? null;
        if (!result.exportPath) {
          state.workbenchDataDirectoryError = "导出失败：未返回文件路径。";
        }
      } catch (error) {
        state.workbenchDataDirectoryError = String(error);
      } finally {
        state.workbenchDataExportBusy = false;
        requestRender();
      }
    },
    onForgetMemoryAgentIdChange: (value: string) => {
      state.workbenchForgetMemoryAgentId = value;
      state.workbenchForgetMemoryMessage = null;
      requestRender();
    },
    onForgetMemoryKeyChange: (value: string) => {
      state.workbenchForgetMemoryKey = value;
      state.workbenchForgetMemoryMessage = null;
      requestRender();
    },
    onForgetMemoryEntry: async () => {
      const agentId = (state.workbenchForgetMemoryAgentId ?? "").trim();
      const memoryKey = (state.workbenchForgetMemoryKey ?? "").trim();
      if (!agentId || !memoryKey) {
        state.workbenchForgetMemoryMessage = "请填写 Agent ID 与记忆路径。";
        requestRender();
        return;
      }
      if (!state.client || !state.connected) {
        state.workbenchForgetMemoryMessage = "当前未连接到网关。";
        requestRender();
        return;
      }
      state.workbenchForgetMemoryBusy = true;
      state.workbenchForgetMemoryMessage = null;
      requestRender();
      try {
        await state.client.request("data.memory.forget", { agentId, memoryKey });
        state.workbenchForgetMemoryMessage = "已删除指定记忆条目。";
        state.workbenchForgetMemoryKey = "";
      } catch (error) {
        state.workbenchForgetMemoryMessage = String(error);
      } finally {
        state.workbenchForgetMemoryBusy = false;
        requestRender();
      }
    },
    onRevokeAccessGrant: async (grantId: string) => {
      if (!state.client || !state.connected) {
        state.workbenchDataDirectoryError = "当前未连接到网关。";
        requestRender();
        return;
      }
      try {
        await state.client.request("data.accessGrants.revoke", { grantId });
        await loadWorkbenchDataAccessGrants(state, requestRender);
      } catch (error) {
        state.workbenchDataDirectoryError = String(error);
        requestRender();
      }
    },
  };
}
