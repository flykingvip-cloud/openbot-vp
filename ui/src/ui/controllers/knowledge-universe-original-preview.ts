/**
 * Preview retained knowledge-document originals in the artifact sidebar.
 */
import { t } from "../../i18n/index.ts";
import type { AppPortState } from "../app-port-state.ts";
import { createKnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import { GatewayRequestError } from "../gateway.ts";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import { selectArtifactPreviewSurface } from "../views/account-computer-preview.ts";
import type { StewardArtifactSidebarHost } from "../wiring/steward-workspace-file.ts";
import {
  applyWorkspaceFilePreview,
  createBlobUrlFromBase64,
} from "../wiring/workspace-file-preview.ts";
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

function syncPreviewActionToAppState(
  state: AppPortState,
  runtime: KnowledgeUniverseControllerState,
) {
  state.knowledgeUniversePersonalActionBusy = runtime.personalActionBusy;
  state.knowledgeUniversePersonalActionError = runtime.personalActionError;
  state.knowledgeUniversePersonalActionNotice = runtime.personalActionNotice;
}

function asSidebarHost(state: AppPortState): StewardArtifactSidebarHost {
  return state as unknown as StewardArtifactSidebarHost;
}

function buildPreviewWorkspace(params: {
  documentId: string;
  knowledgeBaseId: string;
  filename: string;
  mimeType?: string;
}): ArtifactWorkspaceSidebar {
  const now = new Date().toISOString();
  return {
    artifact: {
      artifactId: `kb-original:${params.knowledgeBaseId}:${params.documentId}`,
      artifactType: "doc",
      storageClass: "inline-media",
      title: params.filename,
      mimeType: params.mimeType,
      provider: "knowledge-original",
      createdBy: { type: "bot", id: "knowledge" },
      createdAt: now,
      updatedAt: now,
      lifecycleState: "created",
      providerMetadata: {
        knowledgeBaseId: params.knowledgeBaseId,
        documentId: params.documentId,
        previewKind: "loading",
        previewLoading: true,
      },
    },
    versions: [],
    deliveries: [],
    grants: [],
    intents: [],
  };
}

function isOriginalNotRetainedError(error: unknown): boolean {
  if (error instanceof GatewayRequestError) {
    if (error.gatewayCode === "UNAVAILABLE") {
      return true;
    }
    const details = error.details;
    if (details && typeof details === "object" && !Array.isArray(details)) {
      const reason = (details as { reason?: unknown }).reason;
      if (reason === "original_not_retained") {
        return true;
      }
    }
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /original_not_retained|not retained|re-upload|原文未保留/i.test(message);
}

/** Open retained original bytes (or local_index file) in the artifact sidebar. */
export async function previewKnowledgeUniverseOriginalDocument(
  state: AppPortState,
  documentId: string,
) {
  const runtime = getKnowledgeUniverseRuntime(state);
  const kbId = requireSelectedKnowledgeBaseId(state);
  const trimmed = documentId.trim();
  if (!state.client || !kbId || !trimmed) {
    return;
  }

  runtime.personalActionError = null;
  runtime.personalActionNotice = null;
  runtime.personalActionBusy = true;
  syncPreviewActionToAppState(state, runtime);
  requestUpdate(state);

  const host = asSidebarHost(state);
  const shell = buildPreviewWorkspace({
    documentId: trimmed,
    knowledgeBaseId: kbId,
    filename: trimmed,
  });
  host.sidebarPreviewMode = "artifact";
  selectArtifactPreviewSurface(host);
  host.sidebarArtifactWorkspace = shell;
  host.sidebarContent = t(
    "frontstage.workbench.knowledgeUniverse.libraryWorkspace.previewOriginalLoading",
  );
  host.sidebarError = null;
  host.sidebarOpen = true;
  requestUpdate(state);

  try {
    const gateway = createKnowledgeUniverseGateway(state.client);
    const file = await gateway.previewKnowledgeDocument({
      knowledgeBaseId: kbId,
      documentId: trimmed,
      render: true,
    });
    const workspace = buildPreviewWorkspace({
      documentId: trimmed,
      knowledgeBaseId: kbId,
      filename: file.filename,
      mimeType: file.mimeType,
    });
    const lane = applyWorkspaceFilePreview({
      host,
      workspace,
      file,
      filename: file.filename,
      extraMetadata: {
        knowledgeBaseId: kbId,
        documentId: trimmed,
        knowledgeOriginalSource: file.source,
      },
    });
    if (lane === "html" || lane === "pdf" || lane === "text" || lane === "canvas") {
      runtime.personalActionNotice = t(
        "frontstage.workbench.knowledgeUniverse.libraryWorkspace.noticePreviewOriginal",
      );
      return;
    }
    if (lane === "binary" && typeof file.base64 === "string") {
      const mimeType = file.mimeType || "application/octet-stream";
      const binaryDownloadUrl = createBlobUrlFromBase64(file.base64, mimeType);
      const notice = t(
        "frontstage.workbench.knowledgeUniverse.libraryWorkspace.previewOriginalBinaryHint",
      );
      host.sidebarPreviewMode = "artifact";
      selectArtifactPreviewSurface(host);
      host.sidebarArtifactWorkspace = {
        ...workspace,
        artifact: {
          ...workspace.artifact,
          artifactType: "binary",
          mimeType,
          sourceMessage: notice,
          ...(binaryDownloadUrl
            ? { openUrl: binaryDownloadUrl, downloadUrl: binaryDownloadUrl }
            : {}),
          providerMetadata: {
            ...workspace.artifact.providerMetadata,
            previewText: notice,
            previewKind: "binary",
            workspaceFilename: file.relativePath || file.filename,
            workspaceFileLoaded: true,
            knowledgeBaseId: kbId,
            documentId: trimmed,
            ...(binaryDownloadUrl ? { binaryDownloadUrl } : {}),
          },
        },
      };
      host.sidebarContent = null;
      host.sidebarError = null;
      host.sidebarOpen = true;
      runtime.personalActionNotice = notice;
      return;
    }
    runtime.personalActionError = t(
      "frontstage.workbench.knowledgeUniverse.libraryWorkspace.previewOriginalUnavailable",
    );
    host.sidebarOpen = false;
    host.sidebarArtifactWorkspace = null;
    host.sidebarContent = null;
  } catch (error) {
    const unavailable = isOriginalNotRetainedError(error);
    runtime.personalActionError = unavailable
      ? t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.previewOriginalUnavailable")
      : error instanceof Error
        ? error.message
        : t("frontstage.workbench.knowledgeUniverse.libraryWorkspace.previewOriginalUnavailable");
    // Keep the page banner as the primary message; don't leave a blank preview shell open.
    host.sidebarPreviewMode = "markdown";
    host.sidebarArtifactWorkspace = null;
    host.sidebarContent = null;
    host.sidebarError = null;
    host.sidebarOpen = false;
  } finally {
    runtime.personalActionBusy = false;
    syncPreviewActionToAppState(state, runtime);
    requestUpdate(state);
  }
}
