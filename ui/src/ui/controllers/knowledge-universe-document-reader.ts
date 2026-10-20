import { t } from "../../i18n/index.ts";
import type { AppPortState } from "../app-port-state.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import type {
  KnowledgeDocumentPreviewResponse,
  WorkspaceDeliverableDto,
} from "../capability/knowledge-universe/workspace-endpoints.ts";
import { GatewayRequestError } from "../gateway.ts";
import type { KnowledgeHomeCockpitTab } from "../ports/employee/views/home-page-contracts.ts";
import { classifyWorkspaceFilePreview } from "../wiring/workspace-file-preview.ts";
import { readGroupWorkspaceFile } from "./group-workspace-file.ts";
import { loadLibraryWorkspaceDocuments } from "./knowledge-universe-workspace.ts";
import {
  getKnowledgeUniverseRuntime,
  setKnowledgeUniverseHomeFocus,
  type KnowledgeUniverseControllerState,
} from "./knowledge-universe.ts";
import { readStewardWorkspaceFile } from "./steward-workspace-file.ts";

export function isKnowledgeDocumentTextEditable(
  preview: KnowledgeDocumentPreviewResponse | null,
): preview is KnowledgeDocumentPreviewResponse {
  return Boolean(preview && classifyWorkspaceFilePreview(preview).lane === "text");
}

function requestUpdate(state: AppPortState) {
  if (typeof state.requestUpdate === "function") {
    state.requestUpdate();
  }
}

function syncReaderToAppState(_state: AppPortState, _runtime: KnowledgeUniverseControllerState) {
  // Reader state lives on the knowledge-universe runtime; Lit re-renders via requestUpdate.
}

export function emptyKnowledgeDocumentReaderState(): Pick<
  KnowledgeUniverseControllerState,
  | "homeCockpitTab"
  | "documentReaderLoading"
  | "documentReaderSaving"
  | "documentReaderEditing"
  | "documentReaderDirty"
  | "documentReaderError"
  | "documentReaderDocKey"
  | "documentReaderPreview"
  | "documentReaderDraft"
> {
  return {
    homeCockpitTab: "relations",
    documentReaderLoading: false,
    documentReaderSaving: false,
    documentReaderEditing: false,
    documentReaderDirty: false,
    documentReaderError: null,
    documentReaderDocKey: null,
    documentReaderPreview: null,
    documentReaderDraft: "",
  };
}

export function decodeKnowledgeDocumentPreviewText(
  preview: KnowledgeDocumentPreviewResponse | null,
): string {
  if (!preview?.base64) {
    return "";
  }
  try {
    const binary = atob(preview.base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function readerDocKey(kind: string, id: string): string {
  return `${kind}::${id}`;
}

function resolveLibraryDocumentTarget(runtime: KnowledgeUniverseControllerState): {
  kbId: string;
  documentId: string;
} | null {
  const focus = runtime.homeFocus;
  if (focus?.kind !== "document") {
    return null;
  }
  const kbId = focus.kbId?.trim() || runtime.selectedKnowledgeBaseId?.trim() || "";
  const documentId = focus.id.trim();
  if (!kbId || !documentId) {
    return null;
  }
  return { kbId, documentId };
}

function resolveReaderTarget(runtime: KnowledgeUniverseControllerState): {
  kbId: string;
  documentId: string;
} | null {
  return resolveLibraryDocumentTarget(runtime);
}

function mapFileToPreview(file: {
  filename: string;
  mimeType: string;
  byteLength: number;
  textLike: boolean;
  renderKind?: "html";
  html?: string;
  base64?: string;
}): KnowledgeDocumentPreviewResponse {
  return {
    filename: file.filename,
    mimeType: file.mimeType,
    byteLength: file.byteLength,
    textLike: file.textLike,
    ...(file.renderKind ? { renderKind: file.renderKind } : {}),
    ...(file.html ? { html: file.html } : {}),
    ...(file.base64 ? { base64: file.base64 } : {}),
  };
}

function encodeTextPreview(text: string, filename: string): KnowledgeDocumentPreviewResponse {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return {
    filename,
    mimeType: "text/markdown",
    byteLength: bytes.length,
    textLike: true,
    base64: btoa(binary),
    source: "index_text",
  };
}

function resolveDeliverableFilename(item: WorkspaceDeliverableDto): string {
  const named = item.artifactFilename?.trim();
  if (named) {
    return named;
  }
  const title = item.title.trim();
  return /\.[a-z0-9]{1,8}$/i.test(title) ? title : "";
}

async function loadDeliverablePreview(
  state: AppPortState,
  runtime: KnowledgeUniverseControllerState,
): Promise<KnowledgeDocumentPreviewResponse | null> {
  const focus = runtime.homeFocus;
  if (focus?.kind !== "deliverable" || !state.client) {
    return null;
  }
  const item = runtime.workspaceDeliverables.find((row) => row.deliverableId === focus.id);
  const kbId = item?.relatedKnowledgeBaseId?.trim() || focus.kbId?.trim() || "";
  const gateway = createKnowledgeUniverseGateway(state.client);
  if (kbId) {
    try {
      return await gateway.previewKnowledgeDocument({
        knowledgeBaseId: kbId,
        documentId: focus.id,
        render: true,
      });
    } catch {
      // Fall through to the produced workspace file / trace body.
    }
  }
  const filename = item ? resolveDeliverableFilename(item) : "";
  const groupId = item?.groupId?.trim() || "";
  if (groupId && filename) {
    const groupFile = await readGroupWorkspaceFile(state.client, groupId, filename, {
      render: true,
    });
    if (groupFile) {
      return mapFileToPreview(groupFile);
    }
  }
  if (filename) {
    const stewardFile = await readStewardWorkspaceFile(state.client, filename, {
      render: true,
      sessionKey: typeof state.sessionKey === "string" ? state.sessionKey : undefined,
    });
    if (stewardFile) {
      return mapFileToPreview(stewardFile);
    }
  }
  try {
    const traced = await gateway.getWorkspaceDeliverableTrace({ deliverableId: focus.id });
    const text = traced.trace.previewText?.trim();
    if (text) {
      return encodeTextPreview(text, `${item?.title.trim() || focus.id}.md`);
    }
  } catch {
    // Keep the shared unavailable message below.
  }
  return null;
}

export function setKnowledgeUniverseHomeCockpitTab(
  state: AppPortState,
  tab: KnowledgeHomeCockpitTab,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.homeCockpitTab = tab;
  syncReaderToAppState(state, runtime);
  requestUpdate(state);
  if (tab === "document") {
    void loadKnowledgeUniverseDocumentReader(state);
  }
}

export async function loadKnowledgeUniverseDocumentReader(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const focus = runtime.homeFocus;
  const libraryTarget = resolveLibraryDocumentTarget(runtime);
  const canLoad =
    Boolean(state.client) && (Boolean(libraryTarget) || focus?.kind === "deliverable");
  if (!canLoad) {
    runtime.documentReaderLoading = false;
    runtime.documentReaderPreview = null;
    runtime.documentReaderDraft = "";
    runtime.documentReaderEditing = false;
    runtime.documentReaderDirty = false;
    runtime.documentReaderError =
      focus?.kind === "document"
        ? t("frontstage.workbench.knowledgeUniverse.home.documentReader.errors.unavailable")
        : null;
    runtime.documentReaderDocKey = null;
    syncReaderToAppState(state, runtime);
    requestUpdate(state);
    return;
  }
  const key = libraryTarget
    ? readerDocKey(libraryTarget.kbId, libraryTarget.documentId)
    : readerDocKey("deliverable", focus?.id ?? "");
  if (
    runtime.documentReaderDocKey === key &&
    runtime.documentReaderPreview &&
    !runtime.documentReaderDirty
  ) {
    return;
  }
  runtime.documentReaderLoading = true;
  runtime.documentReaderError = null;
  runtime.documentReaderEditing = false;
  runtime.documentReaderDirty = false;
  syncReaderToAppState(state, runtime);
  requestUpdate(state);
  try {
    const preview = libraryTarget
      ? await createKnowledgeUniverseGateway(state.client).previewKnowledgeDocument({
          knowledgeBaseId: libraryTarget.kbId,
          documentId: libraryTarget.documentId,
          render: true,
        })
      : await loadDeliverablePreview(state, runtime);
    if (!preview) {
      throw new Error(
        t("frontstage.workbench.knowledgeUniverse.home.documentReader.errors.unavailable"),
      );
    }
    runtime.documentReaderPreview = preview;
    runtime.documentReaderDraft = isKnowledgeDocumentTextEditable(preview)
      ? decodeKnowledgeDocumentPreviewText(preview)
      : "";
    runtime.documentReaderDocKey = key;
  } catch (error) {
    runtime.documentReaderPreview = null;
    runtime.documentReaderDraft = "";
    runtime.documentReaderDocKey = key;
    runtime.documentReaderError =
      error instanceof GatewayRequestError && error.gatewayCode === "UNAVAILABLE"
        ? t("frontstage.workbench.knowledgeUniverse.home.documentReader.errors.notDigitized")
        : error instanceof Error
          ? error.message
          : t("frontstage.workbench.knowledgeUniverse.home.documentReader.errors.unavailable");
  } finally {
    runtime.documentReaderLoading = false;
    syncReaderToAppState(state, runtime);
    requestUpdate(state);
  }
}

export function setKnowledgeUniverseDocumentReaderEditing(state: AppPortState, editing: boolean) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const preview = runtime.documentReaderPreview;
  if (editing && !isKnowledgeDocumentTextEditable(preview)) {
    return;
  }
  runtime.documentReaderEditing = editing;
  if (!editing) {
    runtime.documentReaderDraft = decodeKnowledgeDocumentPreviewText(preview);
    runtime.documentReaderDirty = false;
  }
  syncReaderToAppState(state, runtime);
  requestUpdate(state);
}

export function setKnowledgeUniverseDocumentReaderDraft(state: AppPortState, value: string) {
  const runtime = getKnowledgeUniverseRuntime(state);
  runtime.documentReaderDraft = value;
  runtime.documentReaderDirty =
    value !== decodeKnowledgeDocumentPreviewText(runtime.documentReaderPreview);
  syncReaderToAppState(state, runtime);
  requestUpdate(state);
}

export async function saveKnowledgeUniverseDocumentReader(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const target = resolveReaderTarget(runtime);
  if (!target || !state.client || !isKnowledgeDocumentTextEditable(runtime.documentReaderPreview)) {
    return;
  }
  runtime.documentReaderSaving = true;
  runtime.documentReaderError = null;
  syncReaderToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.saveKnowledgeDocument({
      knowledgeBaseId: target.kbId,
      documentId: target.documentId,
      text: runtime.documentReaderDraft,
      title: runtime.documentReaderPreview.filename,
      fileName: runtime.documentReaderPreview.filename,
    });
    runtime.documentReaderDirty = false;
    runtime.documentReaderEditing = false;
    runtime.documentReaderDocKey = null;
    syncReaderToAppState(state, runtime);
    requestUpdate(state);
    await loadKnowledgeUniverseDocumentReader(state);
    await loadLibraryWorkspaceDocuments(state);
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.home.documentReader.notices.saved",
    );
    state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
  } catch (error) {
    runtime.documentReaderError =
      error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.home.documentReader.errors.saveFailed");
  } finally {
    runtime.documentReaderSaving = false;
    syncReaderToAppState(state, runtime);
    requestUpdate(state);
  }
}

export async function deleteKnowledgeUniverseDocumentReader(state: AppPortState) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const target = resolveReaderTarget(runtime);
  if (!target || !state.client) {
    return;
  }
  runtime.documentReaderSaving = true;
  runtime.documentReaderError = null;
  syncReaderToAppState(state, runtime);
  requestUpdate(state);
  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    await gateway.deleteKnowledgeBaseDocument({
      knowledgeBaseId: target.kbId,
      documentId: target.documentId,
    });
    runtime.documentReaderPreview = null;
    runtime.documentReaderDraft = "";
    runtime.documentReaderDocKey = null;
    runtime.documentReaderEditing = false;
    runtime.documentReaderDirty = false;
    runtime.personalActionNotice = t(
      "frontstage.workbench.knowledgeUniverse.home.documentReader.notices.deleted",
    );
    state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
    setKnowledgeUniverseHomeFocus(state, {
      kind: "knowledge-base",
      id: target.kbId,
      kbId: target.kbId,
    });
    await loadLibraryWorkspaceDocuments(state);
  } catch (error) {
    runtime.documentReaderError =
      error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.home.documentReader.errors.deleteFailed");
  } finally {
    runtime.documentReaderSaving = false;
    syncReaderToAppState(state, runtime);
    requestUpdate(state);
  }
}
