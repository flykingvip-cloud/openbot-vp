import { parseAgentSessionKey } from "../../../../src/sessions/session-key-utils.ts";
import { t } from "../../i18n/index.ts";
import type { AppPortState } from "../app-port-state.ts";
import type { KnowledgeCompatWarningDto } from "../capability/knowledge-universe/endpoints.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import {
  isSupportedPersonalDocument,
  readPersonalDocumentUpload,
} from "../capability/knowledge-universe/personal-document-upload.ts";
import { generateUUID } from "../uuid.ts";
import {
  createEmptyFileImportState,
  SPACE_FILE_IMPORT_MAX_BYTES,
  SPACE_FILE_IMPORT_MAX_FILES,
  type FileChunkingStrategy,
  type FileImportQueueItem,
} from "../views/knowledge-universe-file-import.ts";
import {
  appendPersonalCompatWarnings,
  personalMessageReadFileFailed,
  personalMessageUnsupportedFileType,
  personalMessageUploadFailed,
  personalNoticeUploaded,
} from "./knowledge-universe-personal-messages.ts";
import { syncWorkspaceToAppState } from "./knowledge-universe-workspace.ts";
import {
  getKnowledgeUniverseRuntime,
  loadKnowledgeUniverseGovernance,
  refreshKnowledgeUniverseHome,
  requireSelectedKnowledgeBaseId,
  syncKnowledgeBaseAfterPersonalMutation,
  type KnowledgeUniverseControllerState,
} from "./knowledge-universe.ts";

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

function resolveKnowledgeAgentId(state: AppPortState): string {
  const parsed = parseAgentSessionKey(state.sessionKey);
  return parsed?.agentId ?? "main";
}

function syncFileImportToAppState(state: AppPortState, runtime: KnowledgeUniverseControllerState) {
  state.knowledgeUniverseLibraryWorkspaceFileImportItems = runtime.libraryWorkspaceFileImportItems;
  state.knowledgeUniverseLibraryWorkspaceFileImportAdvancedOpen =
    runtime.libraryWorkspaceFileImportAdvancedOpen;
  state.knowledgeUniverseLibraryWorkspaceFileChunkingStrategy =
    runtime.libraryWorkspaceFileChunkingStrategy;
  state.knowledgeUniverseLibraryWorkspaceFileOcrEnabled = runtime.libraryWorkspaceFileOcrEnabled;
  state.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  state.knowledgeUniversePersonalActionError = runtime.personalActionError;
  state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
}

export function resetKnowledgeUniverseFileImportState(runtime: KnowledgeUniverseControllerState) {
  Object.assign(runtime, createEmptyFileImportState());
}

export function setKnowledgeUniverseLibraryWorkspaceFileImportAdvancedOpen(
  state: AppPortState,
  open: boolean,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceFileImportAdvancedOpen = open;
  syncFileImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceFileChunkingStrategy(
  state: AppPortState,
  strategy: FileChunkingStrategy,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceFileChunkingStrategy = strategy;
  syncFileImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseLibraryWorkspaceFileOcrEnabled(
  state: AppPortState,
  enabled: boolean,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceFileOcrEnabled = enabled;
  syncFileImportToAppState(state, runtime);
  requestUpdate(state);
}

export function removeKnowledgeUniverseFileImportItem(state: AppPortState, id: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceFileImportItems = runtime.libraryWorkspaceFileImportItems.filter(
    (item) => item.id !== id,
  );
  syncFileImportToAppState(state, runtime);
  requestUpdate(state);
}

export async function pickKnowledgeUniverseFileImportFiles(state: AppPortState, files: File[]) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (files.length === 0) {
    return;
  }
  runtime.personalActionError = null;
  const skipped: string[] = [];
  const added: FileImportQueueItem[] = [];

  for (const file of files) {
    if (
      runtime.libraryWorkspaceFileImportItems.length + added.length >=
      SPACE_FILE_IMPORT_MAX_FILES
    ) {
      skipped.push(file.name);
      continue;
    }
    if (
      runtime.libraryWorkspaceFileImportItems.some(
        (item) => item.attachment.fileName === file.name,
      ) ||
      added.some((item) => item.attachment.fileName === file.name)
    ) {
      skipped.push(file.name);
      continue;
    }
    if (!isSupportedPersonalDocument(file.name, file.type)) {
      skipped.push(file.name);
      continue;
    }
    if (file.size > SPACE_FILE_IMPORT_MAX_BYTES) {
      skipped.push(file.name);
      continue;
    }
    try {
      const attachment = await readPersonalDocumentUpload(file);
      added.push({
        id: generateUUID(),
        attachment,
        status: "ready",
      });
    } catch {
      skipped.push(file.name);
    }
  }

  if (added.length > 0) {
    runtime.libraryWorkspaceFileImportItems = [
      ...runtime.libraryWorkspaceFileImportItems,
      ...added,
    ];
  }

  if (runtime.libraryWorkspaceFileImportItems.length === 0 && files.length > 0) {
    runtime.personalActionError =
      skipped.length > 0
        ? t("frontstage.workbench.knowledgeUniverse.importToSpace.file.errors.pickFailed")
        : personalMessageUnsupportedFileType();
  } else if (skipped.length > 0) {
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.file.skippedCount",
      { count: skipped.length },
    );
  } else {
    runtime.personalActionNotice = null;
  }

  syncFileImportToAppState(state, runtime);
  requestUpdate(state);
}

export async function importFilesToKnowledgeSpace(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const readyItems = runtime.libraryWorkspaceFileImportItems.filter(
    (item) => item.status === "ready",
  );
  if (readyItems.length === 0) {
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.importToSpace.file.errors.noFiles",
    );
    syncFileImportToAppState(state, runtime);
    requestUpdate(state);
    return;
  }

  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncFileImportToAppState(state, runtime);
  requestUpdate(state);

  const kbId = requireSelectedKnowledgeBaseId(state);
  if (!kbId || !state.client) {
    runtime.personalActionBusy = false;
    syncFileImportToAppState(state, runtime);
    requestUpdate(state);
    return;
  }

  const gateway = createKnowledgeUniverseGateway(state.client);
  let imported = 0;
  let failed = 0;
  const compatWarnings: KnowledgeCompatWarningDto[] = [];

  try {
    for (const item of readyItems) {
      const current = runtime.libraryWorkspaceFileImportItems.find((entry) => entry.id === item.id);
      if (!current || current.status !== "ready") {
        continue;
      }
      current.status = "uploading";
      runtime.importProgress = {
        current: imported + failed + 1,
        total: readyItems.length,
        label: t("frontstage.workbench.knowledgeUniverse.importToSpace.file.importing", {
          current: String(imported + failed + 1),
          total: String(readyItems.length),
          fileName: current.attachment.fileName,
        }),
      };
      syncFileImportToAppState(state, runtime);
      requestUpdate(state);
      try {
        const response = await gateway.uploadPersonal({
          attachment: current.attachment,
          sourceAgentId: resolveKnowledgeAgentId(state),
          knowledgeBaseId: kbId,
          ingestOptions: {
            chunkingStrategy: runtime.libraryWorkspaceFileChunkingStrategy,
            ocrEnabled: runtime.libraryWorkspaceFileOcrEnabled,
          },
        });
        current.status = "done";
        imported += 1;
        if (response.compatWarnings?.length) {
          compatWarnings.push(...response.compatWarnings);
        }
        await syncKnowledgeBaseAfterPersonalMutation(state, response);
      } catch (error) {
        current.status = "error";
        current.errorMessage =
          error instanceof Error ? error.message : personalMessageUploadFailed();
        failed += 1;
      }
      syncFileImportToAppState(state, runtime);
      requestUpdate(state);
    }

    if (imported > 0) {
      await refreshKnowledgeUniverseHome(state);
      await loadKnowledgeUniverseGovernance(state);
      syncWorkspaceToAppState(state);
    }

    if (failed === 0 && imported > 0) {
      runtime.personalActionNotice = appendPersonalCompatWarnings(
        imported === 1
          ? personalNoticeUploaded()
          : t("frontstage.workbench.knowledgeUniverse.importToSpace.file.batchImported", {
              count: imported,
            }),
        compatWarnings.length > 0 ? compatWarnings : undefined,
      );
      resetKnowledgeUniverseFileImportState(runtime);
    } else if (imported > 0) {
      runtime.personalActionNotice = t(
        "frontstage.workbench.knowledgeUniverse.importToSpace.file.batchImportedWithFailed",
        { imported, failed },
      );
      runtime.libraryWorkspaceFileImportItems = runtime.libraryWorkspaceFileImportItems.filter(
        (item) => item.status !== "done",
      );
    } else {
      runtime.personalActionError = personalMessageUploadFailed();
    }
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageReadFileFailed();
  } finally {
    runtime.personalActionBusy = false;
    runtime.importProgress = null;
    syncFileImportToAppState(state, runtime);
    requestUpdate(state);
  }
}
