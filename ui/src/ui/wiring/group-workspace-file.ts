/**
 * Group workspace file artifact sidebar — mirrors steward workspace file wiring.
 */

import { t } from "../../i18n/index.ts";
import { adaptDaibaiState } from "../app-host-adapters.ts";
import {
  readGroupWorkspaceFile,
  resolveGroupWorkspaceReadPath,
} from "../controllers/group-workspace-file.ts";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import { selectArtifactPreviewSurface } from "../views/account-computer-preview.ts";
import type { StewardArtifactSidebarHost } from "./steward-workspace-file.ts";
import { applyWorkspaceFilePreview } from "./workspace-file-preview.ts";

export async function openGroupWorkspaceFileArtifact(
  host: StewardArtifactSidebarHost,
  workspace: ArtifactWorkspaceSidebar,
  groupId: string,
  filename: string,
  client: ReturnType<typeof adaptDaibaiState>["client"],
  options?: { shouldApply?: () => boolean },
) {
  const shouldApply = () => options?.shouldApply?.() ?? true;
  const file = await readGroupWorkspaceFile(client, groupId, filename, { render: true });
  if (!shouldApply()) {
    return;
  }
  if (!file) {
    // Miss must not switch to markdown "工具输出". The orchestrator keeps artifact chrome.
    return;
  }

  const relativePath =
    file.relativePath || resolveGroupWorkspaceReadPath(filename) || filename.trim();
  const lane = applyWorkspaceFilePreview({
    host,
    workspace,
    file: { ...file, relativePath },
    filename: relativePath,
    extraMetadata: { groupId },
  });
  if (
    lane === "html" ||
    lane === "pdf" ||
    lane === "image" ||
    lane === "text" ||
    lane === "canvas" ||
    lane === "binary"
  ) {
    return;
  }
  if (host.sidebarArtifactWorkspace?.artifact.providerMetadata?.pdfParseFailed === true) {
    return;
  }

  if (!shouldApply()) {
    return;
  }
  // Keep the download-lane shell even when bytes cannot be materialized.
  const mimeType = file.mimeType || workspace.artifact.mimeType || "application/octet-stream";
  const notice = t("chat.artifactPreviewNoInlineHint");
  host.sidebarPreviewMode = "artifact";
  selectArtifactPreviewSurface(host);
  host.sidebarArtifactWorkspace = {
    ...workspace,
    artifact: {
      ...workspace.artifact,
      artifactType: "binary",
      mimeType,
      sourceMessage: notice,
      providerMetadata: {
        ...workspace.artifact.providerMetadata,
        previewText: notice,
        previewKind: "binary",
        workspaceFilename: relativePath,
        workspaceFileLoaded: true,
        groupId,
        downloadedBinary: true,
      },
    },
  };
  host.sidebarContent = null;
  host.sidebarError = null;
  host.sidebarOpen = true;
}
