import { declareWorkspaceRelativePath } from "../../../../src/shared/workspace-deliverable-path.ts";
/**
 * Conversation sidebar preview reads only the birth workspace (steward or group).
 * Knowledge originals are never a fallback. Chip restore may look up archive-store.
 */
import { t } from "../../i18n/index.ts";
import {
  isGroupScopedSessionKey,
  resolveGroupIdFromSessionContext,
} from "../collaboration/resolve-group-scope.ts";
import { readGroupDeliverableManifestEntry } from "../controllers/group-deliverable-manifest.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionsListResult } from "../types.ts";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import { selectArtifactPreviewSurface } from "../views/account-computer-preview.ts";
import {
  inferInitialDeliverableSaveState,
  mergeDeliverableSaveStateAfterPreviewLoad,
  resolveGroupWorkspaceReadTarget,
  resolvePersistableDeliverableId,
  type DeliverableSaveState,
} from "./deliverable-save.ts";
import { openGroupWorkspaceFileArtifact } from "./group-workspace-file.ts";
import {
  openStewardWorkspaceFileArtifact,
  resolveStewardWorkspaceFilename,
  type StewardArtifactSidebarHost,
} from "./steward-workspace-file.ts";
import {
  applyPublishedHtmlUrlPreview,
  applyUnavailableFilePreview,
  resolveBrowsableHtmlPreviewUrl,
} from "./workspace-file-preview.ts";

export type DeliverablePreviewHost = StewardArtifactSidebarHost & {
  sidebarDeliverableSaveState: DeliverableSaveState | null;
};

function resolvePreviewGroupId(params: {
  workspace: ArtifactWorkspaceSidebar;
  sessionKey: string;
  sessionsResult: SessionsListResult | null;
  workbenchTeamSelectedKey?: string | null;
}): string | null {
  const metaGroupId =
    typeof params.workspace.artifact.providerMetadata?.groupId === "string"
      ? params.workspace.artifact.providerMetadata.groupId.trim()
      : "";
  if (metaGroupId) {
    return metaGroupId;
  }
  // Only consult session/team context when the active chat is itself a group/space lane.
  if (!isGroupScopedSessionKey(params.sessionKey)) {
    return null;
  }
  return resolveGroupIdFromSessionContext({
    sessionKey: params.sessionKey,
    sessionsResult: params.sessionsResult,
    workbenchTeamSelectedKey: params.workbenchTeamSelectedKey,
  });
}

async function restoreArchiveChipFromStore(params: {
  host: DeliverablePreviewHost;
  client: GatewayBrowserClient | null;
  sessionKey: string;
  workspace: ArtifactWorkspaceSidebar;
  groupId: string | null;
}): Promise<void> {
  if (params.host.sidebarDeliverableSaveState?.status === "saved" || !params.client) {
    return;
  }
  const metadata = params.workspace.artifact.providerMetadata ?? {};
  const logicalId = typeof metadata.logicalId === "string" ? metadata.logicalId.trim() : "";
  const deliverableId = resolvePersistableDeliverableId(
    typeof metadata.deliverableId === "string"
      ? metadata.deliverableId
      : params.workspace.artifact.artifactId,
  );
  if (!logicalId && !deliverableId) {
    return;
  }
  try {
    const status = await params.client.request<{
      saved?: boolean;
      knowledgeBaseTitle?: string;
    }>("knowledge.deliverables.archiveLookup", {
      sessionKey: params.sessionKey,
      ...(params.groupId ? { groupId: params.groupId } : {}),
      ...(logicalId ? { logicalId } : {}),
      ...(deliverableId ? { deliverableId } : {}),
    });
    if (!status?.saved) {
      return;
    }
    params.host.sidebarDeliverableSaveState = {
      artifactId: params.workspace.artifact.artifactId,
      status: "saved",
      knowledgeBaseTitle: status.knowledgeBaseTitle ?? null,
    };
  } catch {
    // Chip stays inferred; the next save still consults archive-store.
  }
}

function previewLoadedWorkspaceFile(host: DeliverablePreviewHost): boolean {
  return Boolean(host.sidebarArtifactWorkspace?.artifact.providerMetadata?.workspaceFileLoaded);
}

function isPreviewLoading(host: DeliverablePreviewHost, artifactId: string): boolean {
  const current = host.sidebarArtifactWorkspace?.artifact;
  if (!current || current.artifactId !== artifactId) {
    return false;
  }
  const meta = current.providerMetadata ?? {};
  return meta.previewKind === "loading" || meta.previewLoading === true;
}

/** Bumps per-host open generation so a slower earlier fetch cannot overwrite a newer open. */
const previewOpenEpochByHost = new WeakMap<object, number>();

function beginPreviewOpen(host: DeliverablePreviewHost): number {
  const next = (previewOpenEpochByHost.get(host) ?? 0) + 1;
  previewOpenEpochByHost.set(host, next);
  return next;
}

function isCurrentPreviewOpen(host: DeliverablePreviewHost, epoch: number): boolean {
  return previewOpenEpochByHost.get(host) === epoch;
}

function openPreviewLoadingShell(
  host: DeliverablePreviewHost,
  workspace: ArtifactWorkspaceSidebar,
) {
  host.sidebarDeliverableSaveState = inferInitialDeliverableSaveState(workspace);
  host.sidebarPreviewMode = "artifact";
  selectArtifactPreviewSurface(host);
  host.sidebarArtifactWorkspace = {
    ...workspace,
    artifact: {
      ...workspace.artifact,
      providerMetadata: {
        ...workspace.artifact.providerMetadata,
        previewKind: "loading",
        previewLoading: true,
      },
    },
  };
  host.sidebarContent = t("chat.stewardFileLoading");
  host.sidebarError = null;
  host.sidebarOpen = true;
}

export async function openArtifactDeliverablePreview(params: {
  host: DeliverablePreviewHost;
  workspace: ArtifactWorkspaceSidebar;
  client: GatewayBrowserClient | null;
  sessionKey: string;
  sessionsResult: SessionsListResult | null;
  workbenchTeamSelectedKey?: string | null;
}): Promise<"group-file" | "steward-file" | "inline"> {
  const { host, client, sessionKey, sessionsResult, workbenchTeamSelectedKey } = params;
  let workspace = params.workspace;
  const artifactId = workspace.artifact.artifactId;

  // Same artifact already loading: keep the open pane, ignore repeat clicks.
  if (host.sidebarOpen && isPreviewLoading(host, artifactId)) {
    return "inline";
  }

  if (workspace.artifact.providerMetadata?.workspaceUnwritten === true) {
    applyUnavailableFilePreview({
      host,
      workspace,
      message: t("chat.artifactPreviewNotWrittenTitle"),
    });
    return "inline";
  }

  const openEpoch = beginPreviewOpen(host);
  // Open the pane immediately so users see progress instead of silent RPC wait.
  openPreviewLoadingShell(host, workspace);

  const groupId = resolvePreviewGroupId({
    workspace,
    sessionKey,
    sessionsResult,
    workbenchTeamSelectedKey,
  });
  const logicalId =
    typeof workspace.artifact.providerMetadata?.logicalId === "string"
      ? workspace.artifact.providerMetadata.logicalId.trim()
      : "";

  let manifestEntry = null;
  if (groupId && logicalId && client) {
    manifestEntry = await readGroupDeliverableManifestEntry(client, groupId, logicalId);
    if (!isCurrentPreviewOpen(host, openEpoch)) {
      return "inline";
    }
    if (manifestEntry?.canonical) {
      host.sidebarDeliverableSaveState = {
        artifactId: workspace.artifact.artifactId,
        status: "saved",
        knowledgeBaseTitle:
          manifestEntry.canonical.knowledgeBaseTitle ?? manifestEntry.canonical.knowledgeBaseId,
      };
    } else if (manifestEntry?.draft?.deliverableId) {
      host.sidebarDeliverableSaveState = {
        artifactId: workspace.artifact.artifactId,
        status: "captured",
      };
    }
  }
  if (host.sidebarDeliverableSaveState?.status !== "saved") {
    await restoreArchiveChipFromStore({
      host,
      client,
      sessionKey,
      workspace,
      groupId,
    });
    if (!isCurrentPreviewOpen(host, openEpoch)) {
      return "inline";
    }
  }

  const priorDeliverableSaveState = host.sidebarDeliverableSaveState;
  const applyGate = { shouldApply: () => isCurrentPreviewOpen(host, openEpoch) };

  let workspaceFilename = resolveStewardWorkspaceFilename(workspace);
  // Canvas-hosted deliverables often only carry openUrl like /__openbot__/canvas/foo.html
  // (or nested /canvas/output/foo.html). Keep the relative path under the canvas root so
  // authenticated steward RPC can load the bytes without a 401 iframe.
  if (!workspaceFilename) {
    const openUrl =
      typeof workspace.artifact.openUrl === "string" ? workspace.artifact.openUrl.trim() : "";
    const canvasMatch = openUrl.match(/\/__openbot__\/canvas\/([^?#]+)/i);
    if (canvasMatch?.[1]) {
      let relative = "";
      try {
        relative = decodeURIComponent(canvasMatch[1]);
      } catch {
        relative = canvasMatch[1];
      }
      const located = declareWorkspaceRelativePath(relative);
      workspaceFilename = located.ok ? located.relativePath : null;
      if (workspaceFilename) {
        workspace = {
          ...workspace,
          artifact: {
            ...workspace.artifact,
            providerMetadata: {
              ...workspace.artifact.providerMetadata,
              workspaceFilename,
              previewKind: "file",
            },
          },
        };
      }
    }
  }
  const groupFile = resolveGroupWorkspaceReadTarget(workspace, groupId, manifestEntry);
  const scopedToGroup = isGroupScopedSessionKey(sessionKey);

  const tryGroup = async (): Promise<"ok" | "miss" | "stale" | "unparsed"> => {
    if (!groupFile) {
      return "miss";
    }
    await openGroupWorkspaceFileArtifact(
      host,
      workspace,
      groupFile.groupId,
      groupFile.filename,
      client,
      applyGate,
    );
    if (!isCurrentPreviewOpen(host, openEpoch)) {
      return "stale";
    }
    if (host.sidebarArtifactWorkspace?.artifact.providerMetadata?.pdfParseFailed === true) {
      return "unparsed";
    }
    return previewLoadedWorkspaceFile(host) ? "ok" : "miss";
  };

  const trySteward = async (): Promise<
    "ok" | "miss" | "stale" | "unmappable" | "rejected" | "unparsed"
  > => {
    if (!workspaceFilename) {
      return "miss";
    }
    const opened = await openStewardWorkspaceFileArtifact(
      host,
      workspace,
      workspaceFilename,
      sessionKey,
      client,
      applyGate,
    );
    if (!isCurrentPreviewOpen(host, openEpoch)) {
      return "stale";
    }
    if (opened === "unparsed") {
      return "unparsed";
    }
    if (opened === "loaded" && previewLoadedWorkspaceFile(host)) {
      return "ok";
    }
    if (opened === "unmappable" || opened === "rejected") {
      return opened;
    }
    return "miss";
  };

  const finishLoaded = (route: "group-file" | "steward-file") => {
    if (!isCurrentPreviewOpen(host, openEpoch) || !host.sidebarArtifactWorkspace) {
      return "inline" as const;
    }
    host.sidebarDeliverableSaveState = mergeDeliverableSaveStateAfterPreviewLoad(
      priorDeliverableSaveState,
      host.sidebarArtifactWorkspace,
    );
    return route;
  };

  // Session scope picks one RPC. Cross-scope retry is not a file locator.
  if (scopedToGroup) {
    const group = await tryGroup();
    if (group === "stale") {
      return "inline";
    }
    if (group === "ok") {
      return finishLoaded("group-file");
    }
    if (group === "unparsed") {
      return "group-file";
    }
  } else {
    const steward = await trySteward();
    if (steward === "stale") {
      return "inline";
    }
    if (steward === "ok") {
      return finishLoaded("steward-file");
    }
    if (steward === "unparsed") {
      return "steward-file";
    }
    if (steward === "unmappable" || steward === "rejected") {
      applyUnavailableFilePreview({
        host,
        workspace,
        message: t("chat.stewardFileUnresolvable"),
      });
      return "steward-file";
    }
  }

  if (!isCurrentPreviewOpen(host, openEpoch)) {
    return "inline";
  }

  // Workspace file miss, but the artifact still points at a published HTML page
  // (e.g. https://www.openbot.love/128-layout-preview.html). Prefer iframe preview over
  // "文件暂不可用" — the page is the deliverable.
  const publishedHtmlUrl = resolveBrowsableHtmlPreviewUrl({
    openUrl: workspace.artifact.openUrl,
    previewUrl: workspace.artifact.previewUrl,
    mimeType: workspace.artifact.mimeType,
    title: workspace.artifact.title,
    workspaceFilename,
  });
  if (publishedHtmlUrl) {
    applyPublishedHtmlUrlPreview({ host, workspace, htmlUrl: publishedHtmlUrl });
    const sidebarWorkspace = host.sidebarArtifactWorkspace;
    if (!isCurrentPreviewOpen(host, openEpoch) || !sidebarWorkspace) {
      return "inline";
    }
    host.sidebarDeliverableSaveState = mergeDeliverableSaveStateAfterPreviewLoad(
      priorDeliverableSaveState,
      sidebarWorkspace,
    );
    return "inline";
  }

  // File-targeted artifacts: stay in artifact chrome. Never switch to markdown "工具输出"
  // (tool-card sidebar) and never degrade into re-showing chat prose.
  const wantsFile =
    Boolean(workspaceFilename) ||
    Boolean(groupFile) ||
    workspace.artifact.providerMetadata?.previewKind === "file" ||
    workspace.artifact.providerMetadata?.previewKind === "loading";
  if (wantsFile) {
    applyUnavailableFilePreview({
      host,
      workspace,
      message: t(scopedToGroup ? "chat.groupFileUnavailable" : "chat.stewardFileUnavailable"),
    });
    return scopedToGroup ? "group-file" : "steward-file";
  }

  host.sidebarPreviewMode = "artifact";
  selectArtifactPreviewSurface(host);
  host.sidebarArtifactWorkspace = workspace;
  const inlineBody = sanitizeInlinePreviewBody(
    workspace.artifact.sourceMessage ?? workspace.artifact.title,
  );
  host.sidebarContent = inlineBody || workspace.artifact.title || t("chat.artifactPreviewEmpty");
  host.sidebarError = null;
  host.sidebarOpen = true;
  return "inline";
}

function sanitizeInlinePreviewBody(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed || /^(?:undefined|null)$/i.test(trimmed)) {
    return "";
  }
  return trimmed;
}
