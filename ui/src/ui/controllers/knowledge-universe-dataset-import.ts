import { parseAgentSessionKey } from "../../../../src/sessions/session-key-utils.ts";
import type { AppPortState } from "../app-port-state.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import { readPersonalDocumentUpload } from "../capability/knowledge-universe/personal-document-upload.ts";
import {
  buildDatasetImportPreview,
  datasetRecordsFromTable,
  datasetTitleFromFileName,
  downloadDatasetImportTemplateXlsx,
  parseDatasetImportTable,
  parseDatasetManualTable,
  validateDatasetImportFile,
  type DatasetImportPreview,
  type DatasetImportTab,
} from "../views/knowledge-universe-dataset-import.ts";
import {
  appendPersonalCompatWarnings,
  personalMessageCollectFailed,
  personalMessageDatasetEmpty,
  personalMessageSelectFileFirst,
  personalMessageUploadFailed,
  personalNoticeDatasetImported,
  personalNoticeUploaded,
  personalDatasetDefaultTitle,
} from "./knowledge-universe-personal-messages.ts";
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

function syncDatasetImportToAppState(
  state: AppPortState,
  runtime: KnowledgeUniverseControllerState,
) {
  state.knowledgeUniverseLibraryWorkspaceDatasetImportTab =
    runtime.libraryWorkspaceDatasetImportTab;
  state.knowledgeUniverseLibraryWorkspaceDatasetFileAttachment =
    runtime.libraryWorkspaceDatasetFileAttachment;
  state.knowledgeUniverseLibraryWorkspaceDatasetPreview = runtime.libraryWorkspaceDatasetPreview;
  state.knowledgeUniverseLibraryWorkspaceDatasetPreviewError =
    runtime.libraryWorkspaceDatasetPreviewError;
  state.knowledgeUniversePersonalDatasetText = runtime.personalDatasetText;
  state.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  state.knowledgeUniversePersonalActionError = runtime.personalActionError;
  state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
}

export function resetKnowledgeUniverseDatasetImportState(
  runtime: KnowledgeUniverseControllerState,
) {
  runtime.libraryWorkspaceDatasetImportTab = "file";
  runtime.libraryWorkspaceDatasetFileAttachment = null;
  runtime.libraryWorkspaceDatasetPreview = null;
  runtime.libraryWorkspaceDatasetPreviewError = null;
  runtime.personalDatasetText = "";
}

function setDatasetPreviewFromTable(
  runtime: KnowledgeUniverseControllerState,
  table: string[][],
  error: string | null = null,
) {
  runtime.libraryWorkspaceDatasetPreviewError = error;
  runtime.libraryWorkspaceDatasetPreview = error ? null : buildDatasetImportPreview(table);
}

export function setKnowledgeUniverseDatasetImportTab(state: AppPortState, tab: DatasetImportTab) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.libraryWorkspaceDatasetImportTab = tab;
  syncDatasetImportToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseDatasetManualText(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.personalDatasetText = value;
  runtime.libraryWorkspaceDatasetFileAttachment = null;
  const table = parseDatasetManualTable(value);
  setDatasetPreviewFromTable(runtime, table);
  syncDatasetImportToAppState(state, runtime);
  requestUpdate(state);
}

export async function pickKnowledgeUniverseDatasetImportFile(state: AppPortState, file: File) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.personalActionError = null;
  const validationError = validateDatasetImportFile(file);
  if (validationError) {
    runtime.libraryWorkspaceDatasetPreviewError = validationError;
    runtime.libraryWorkspaceDatasetPreview = null;
    runtime.libraryWorkspaceDatasetFileAttachment = null;
    syncDatasetImportToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  try {
    const table = await parseDatasetImportTable(file);
    runtime.libraryWorkspaceDatasetFileAttachment = await readPersonalDocumentUpload(file);
    runtime.personalDatasetText = "";
    runtime.libraryWorkspaceDatasetImportTab = "file";
    setDatasetPreviewFromTable(runtime, table);
  } catch (error) {
    runtime.libraryWorkspaceDatasetFileAttachment = null;
    runtime.libraryWorkspaceDatasetPreview = null;
    runtime.libraryWorkspaceDatasetPreviewError =
      error instanceof Error ? error.message : "Failed to parse dataset file.";
  }
  syncDatasetImportToAppState(state, runtime);
  requestUpdate(state);
}

export function downloadKnowledgeUniverseDatasetImportTemplate() {
  void downloadDatasetImportTemplateXlsx();
}

export async function importKnowledgeUniverseDatasetToSpace(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  if (runtime.libraryWorkspaceDatasetImportTab === "file") {
    await uploadKnowledgeUniverseDatasetFile(state);
    return;
  }
  await importDatasetKnowledgeUniverseFromManual(state);
}

async function importDatasetKnowledgeUniverseFromManual(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const table = parseDatasetManualTable(runtime.personalDatasetText);
  const records = datasetRecordsFromTable(table);
  if (records.length === 0) {
    runtime.personalActionError = personalMessageDatasetEmpty();
    syncDatasetImportToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncDatasetImportToAppState(state, runtime);
  requestUpdate(state);
  try {
    const kbId = requireSelectedKnowledgeBaseId(state);
    const afterEnsure = getKnowledgeUniverseRuntime(state);
    if (!kbId) {
      return;
    }
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.importDatasetPersonal({
      datasetTitle: afterEnsure.personalCollectTitle.trim() || personalDatasetDefaultTitle(),
      records,
      knowledgeBaseId: kbId,
    });
    resetKnowledgeUniverseDatasetImportState(afterEnsure);
    afterEnsure.personalActionNotice = appendPersonalCompatWarnings(
      personalNoticeDatasetImported(response.imported),
      response.compatWarnings,
    );
    if (response.errors?.length) {
      afterEnsure.personalActionError = response.errors
        .map((item) => item.message ?? item.reason)
        .join("; ");
      if (response.imported === 0) {
        afterEnsure.personalActionNotice = null;
      }
    }
    await syncKnowledgeBaseAfterPersonalMutation(state, response);
    await refreshKnowledgeUniverseHome(state);
    await loadKnowledgeUniverseGovernance(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageCollectFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncDatasetImportToAppState(state, runtime);
    requestUpdate(state);
  }
}

async function uploadKnowledgeUniverseDatasetFile(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const attachment = runtime.libraryWorkspaceDatasetFileAttachment;
  if (!attachment) {
    runtime.personalActionError = personalMessageSelectFileFirst();
    syncDatasetImportToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  if (!runtime.libraryWorkspaceDatasetPreview) {
    runtime.personalActionError = personalMessageDatasetEmpty();
    syncDatasetImportToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  runtime.personalActionBusy = true;
  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  syncDatasetImportToAppState(state, runtime);
  requestUpdate(state);
  try {
    const kbId = requireSelectedKnowledgeBaseId(state);
    const afterEnsure = getKnowledgeUniverseRuntime(state);
    if (!kbId) {
      return;
    }
    const gateway = createKnowledgeUniverseGateway(state.client);
    const response = await gateway.uploadPersonal({
      title: datasetTitleFromFileName(attachment.fileName),
      summary: "",
      tags: [],
      attachment,
      sourceAgentId: resolveKnowledgeAgentId(state),
      knowledgeBaseId: kbId,
    });
    resetKnowledgeUniverseDatasetImportState(afterEnsure);
    afterEnsure.personalActionNotice = appendPersonalCompatWarnings(
      personalNoticeUploaded(),
      response.compatWarnings,
    );
    await syncKnowledgeBaseAfterPersonalMutation(state, response);
    await refreshKnowledgeUniverseHome(state);
    await loadKnowledgeUniverseGovernance(state);
  } catch (error) {
    runtime.personalActionError =
      error instanceof Error ? error.message : personalMessageUploadFailed();
  } finally {
    runtime.personalActionBusy = false;
    syncDatasetImportToAppState(state, runtime);
    requestUpdate(state);
  }
}

export type { DatasetImportPreview, DatasetImportTab };
