/**
 * Steward workspace file artifact sidebar — wiring extracted from app.ts shell.
 */

import { declareWorkspaceRelativePath } from "../../../../src/shared/workspace-deliverable-path.ts";
import { t } from "../../i18n/index.ts";
import { adaptDaibaiState } from "../app-host-adapters.ts";
import { workspaceFileReadCandidates } from "../controllers/group-workspace-file.ts";
import {
  readStewardWorkspaceFileDetailed,
  type StewardWorkspaceFilePayload,
} from "../controllers/steward-workspace-file.ts";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import { selectArtifactPreviewSurface } from "../views/account-computer-preview.ts";
import { applyWorkspaceFilePreview } from "./workspace-file-preview.ts";

export type StewardArtifactSidebarHost = {
  sidebarPreviewMode: "markdown" | "artifact";
  sidebarArtifactWorkspace: ArtifactWorkspaceSidebar | null;
  sidebarContent: string | null;
  sidebarError: string | null;
  sidebarOpen: boolean;
  /**
   * Artifact ids whose workspace file was confirmed missing (never written / stale-snapshot
   * stopped the account worker before a durable write). Chips for these ids must not stay
   * openable as if the file exists.
   */
  artifactPreviewMissIds?: string[];
};

export async function openStewardWorkspaceFileArtifact(
  host: StewardArtifactSidebarHost,
  workspace: ArtifactWorkspaceSidebar,
  filename: string,
  sessionKey: string | null | undefined,
  client: ReturnType<typeof adaptDaibaiState>["client"],
  options?: { shouldApply?: () => boolean },
): Promise<"loaded" | "miss" | "unmappable" | "rejected"> {
  const shouldApply = () => options?.shouldApply?.() ?? true;
  // Request a faithful render: a produced Word file comes back as HTML, text files as bytes.
  const readOptions = {
    render: true as const,
    ...(sessionKey?.trim() ? { sessionKey: sessionKey.trim() } : {}),
  };
  const candidates = workspaceFileReadCandidates(filename);
  if (candidates.length === 0) {
    const located = declareWorkspaceRelativePath(filename);
    if (!shouldApply()) {
      return "miss";
    }
    return located.ok ? "miss" : located.code === "unmappable" ? "unmappable" : "rejected";
  }
  let file: StewardWorkspaceFilePayload | null = null;
  let failure: "miss" | "unmappable" | "rejected" = "miss";
  for (const candidate of candidates) {
    const result = await readStewardWorkspaceFileDetailed(client, candidate, readOptions);
    if (result.ok) {
      file = result.file;
      break;
    }
    if (result.reason !== "missing") {
      failure = result.reason;
    }
  }
  if (!shouldApply()) {
    return "miss";
  }
  if (!file) {
    // Leave the artifact loading shell in place. The orchestrator applies a single
    // unavailable state in artifact chrome so we never flash markdown "工具输出".
    return failure;
  }

  const lane = applyWorkspaceFilePreview({
    host,
    workspace,
    file,
    filename,
  });
  if (
    lane === "html" ||
    lane === "pdf" ||
    lane === "image" ||
    lane === "text" ||
    lane === "canvas" ||
    lane === "binary"
  ) {
    return "loaded";
  }

  if (!shouldApply()) {
    return "miss";
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
        workspaceFilename: file.relativePath || filename,
        workspaceFileLoaded: true,
        downloadedBinary: true,
      },
    },
  };
  host.sidebarContent = null;
  host.sidebarError = null;
  host.sidebarOpen = true;
  return "loaded";
}

const PREVIEWABLE_DELIVERABLE_NAME =
  /\.(?:md|markdown|txt|docx?|pptx?|xlsx?|csv|pdf|html?|json|png|jpe?g|webp|gif)$/i;

/**
 * Workspace-relative form of a declared path.
 * Absolute paths map only when `trustedRoots` is provided. Otherwise they
 * return null — callers must not substitute the basename.
 */
export function declaredWorkspaceRelPath(
  raw: string | null | undefined,
  options?: { trustedRoots?: readonly string[] },
): string | null {
  const located = declareWorkspaceRelativePath(raw, options);
  return located.ok ? located.relativePath : null;
}

/** Returns the workspace-relative file the conversation sidebar should open. */
export function resolveStewardWorkspaceFilename(
  workspace: ArtifactWorkspaceSidebar,
): string | null {
  const metadata = workspace.artifact.providerMetadata;
  const target =
    metadata?.deliverableTarget &&
    typeof metadata.deliverableTarget === "object" &&
    !Array.isArray(metadata.deliverableTarget)
      ? (metadata.deliverableTarget as Record<string, unknown>)
      : null;
  const declared = [
    typeof target?.workspaceFilename === "string" ? target.workspaceFilename : "",
    typeof metadata?.workspaceFilename === "string" ? metadata.workspaceFilename : "",
    typeof metadata?.pptxPath === "string" ? metadata.pptxPath : "",
    typeof metadata?.filePath === "string" ? metadata.filePath : "",
  ];
  let basename: string | null = null;
  let absolute: string | null = null;
  let sawDeclared = false;
  for (const raw of declared) {
    if (!raw.trim()) {
      continue;
    }
    sawDeclared = true;
    const located = declareWorkspaceRelativePath(raw);
    if (!located.ok) {
      if (located.code === "rejected") {
        return null;
      }
      if (located.code === "unmappable") {
        absolute ??= raw.trim().replace(/\\/g, "/");
      }
      continue;
    }
    if (located.kind === "basename") {
      basename ??= located.relativePath;
      continue;
    }
    return located.relativePath;
  }
  // An absolute declaration has to be mapped by the gateway. Do not replace it
  // with a basename from another field or the card title.
  if (absolute) {
    return absolute;
  }
  if (basename) {
    return basename;
  }
  if (sawDeclared) {
    return null;
  }
  const title = workspace.artifact.title?.trim() ?? "";
  if (!PREVIEWABLE_DELIVERABLE_NAME.test(title)) {
    return null;
  }
  const titled = declareWorkspaceRelativePath(title);
  if (!titled.ok || titled.kind !== "basename") {
    return null;
  }
  return titled.relativePath;
}
