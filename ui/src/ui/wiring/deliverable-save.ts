import { t } from "../../i18n/index.ts";
import { sanitizeArtifactPreviewText } from "../chat/generated-preview-artifact.ts";
import type { GroupManifestLookup } from "../controllers/group-deliverable-manifest.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ArtifactWorkspaceSidebar } from "../types.ts";

export type DeliverableSaveStatus = "unsaved" | "captured" | "saved" | "kb_failed";

export type DeliverableSaveState = {
  artifactId: string;
  status: DeliverableSaveStatus;
  knowledgeBaseTitle?: string | null;
  dirty?: boolean;
  busy?: boolean;
  error?: string | null;
  pendingDecision?: DeliverableSaveDecisionPrompt | null;
  saveAsFilenameDraft?: string;
};

export const DELIVERABLE_SAVE_TOAST_MS = 5000;

export type DeliverableSaveToast = {
  message: string;
  kind: "success" | "error";
  shownAt: number;
};

export type DeliverableSaveArchiveResult = {
  deliverableId: string;
  knowledgeBaseId: string;
  knowledgeBaseTitle: string;
  relativePath?: string;
  groupId?: string;
  logicalId?: string;
  documentId?: string;
};

export function slugifyLogicalId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "deliverable";
}

export function resolveInferredGroupDraftPath(logicalId: string): string {
  return `drafts/${slugifyLogicalId(logicalId)}/content.md`;
}

export function resolveDeliverableSaveChipLabel(
  state: DeliverableSaveState | null | undefined,
): string {
  if (!state) {
    return t("chat.deliverableStatusUnsaved");
  }
  switch (state.status) {
    case "saved":
      return state.knowledgeBaseTitle
        ? t("chat.deliverableStatusSavedKb", { kb: state.knowledgeBaseTitle })
        : t("chat.deliverableStatusSaved");
    case "captured":
      return t("chat.deliverableStatusCaptured");
    case "kb_failed":
      return t("chat.deliverableStatusKbFailed");
    default:
      return t("chat.deliverableStatusUnsaved");
  }
}

function truncateDeliverableSaveError(message: string, maxLen = 160): string {
  const trimmed = message.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLen - 1)}…`;
}

export function resolveDeliverableSaveToastMessage(
  state: DeliverableSaveState | null | undefined,
): string {
  const chip = resolveDeliverableSaveChipLabel(state);
  if (state?.status === "kb_failed") {
    const detail = state.error?.trim();
    if (detail) {
      return `${chip}: ${truncateDeliverableSaveError(detail)}`;
    }
  }
  return chip;
}

export function markDeliverableSaveDirty(
  state: DeliverableSaveState | null | undefined,
): DeliverableSaveState | null {
  if (!state || state.status !== "saved") {
    return state ?? null;
  }
  return { ...state, dirty: true };
}

/** Keep manifest-derived chip when reloading preview content from group/steward files. */
export function mergeDeliverableSaveStateAfterPreviewLoad(
  prior: DeliverableSaveState | null | undefined,
  workspace: ArtifactWorkspaceSidebar,
): DeliverableSaveState {
  if (
    prior &&
    prior.artifactId === workspace.artifact.artifactId &&
    (prior.status === "saved" || prior.status === "kb_failed")
  ) {
    return prior.dirty ? { ...prior, dirty: true } : prior;
  }
  if (prior && prior.artifactId === workspace.artifact.artifactId && prior.status === "captured") {
    const inferred = inferInitialDeliverableSaveState(workspace);
    return inferred.status === "saved" ? inferred : prior;
  }
  return inferInitialDeliverableSaveState(workspace);
}

export function resolveGroupWorkspaceReadTarget(
  workspace: ArtifactWorkspaceSidebar,
  groupId: string | null,
  manifest?: GroupManifestLookup | null,
): { groupId: string; filename: string } | null {
  if (!groupId?.trim()) {
    return null;
  }
  const trimmedGroupId = groupId.trim();
  const canonicalPath = manifest?.canonical?.relativePath?.trim();
  if (canonicalPath) {
    return { groupId: trimmedGroupId, filename: canonicalPath };
  }
  const draftPath = manifest?.draft?.relativePath?.trim();
  if (draftPath) {
    return { groupId: trimmedGroupId, filename: draftPath };
  }
  const metadata = workspace.artifact.providerMetadata ?? {};
  const raw = metadata.workspaceFilename;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed) {
    return { groupId: trimmedGroupId, filename: trimmed };
  }
  const logicalIdRaw = typeof metadata.logicalId === "string" ? metadata.logicalId.trim() : "";
  if (logicalIdRaw) {
    return { groupId: trimmedGroupId, filename: resolveInferredGroupDraftPath(logicalIdRaw) };
  }
  return null;
}

function extractHtmlPreviewSource(metadata: Record<string, unknown>): string {
  const htmlCandidates = [metadata.htmlSrcdoc, metadata.renderedHtml, metadata.htmlPreview];
  for (const candidate of htmlCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

export type ArtifactSavePayload = {
  content: string;
  contentBase64?: string;
};

function extractFileBase64(metadata: Record<string, unknown>): string {
  const explicit = metadata.fileBase64;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.replace(/\s+/g, "");
  }
  const dataUrl = typeof metadata.dataUrl === "string" ? metadata.dataUrl.trim() : "";
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/i);
  return match?.[1]?.replace(/\s+/g, "") || "";
}

/** Prefer retained original bytes (Office/PDF/image/binary) over preview HTML/text. */
export function extractArtifactSavePayload(
  workspace: ArtifactWorkspaceSidebar,
): ArtifactSavePayload {
  const metadata = workspace.artifact.providerMetadata ?? {};
  const contentBase64 = extractFileBase64(metadata);
  if (contentBase64) {
    return { content: "", contentBase64 };
  }
  const previewKind = typeof metadata.previewKind === "string" ? metadata.previewKind : "";
  const binaryKinds = new Set(["pdf", "image", "binary"]);
  if (binaryKinds.has(previewKind)) {
    // Do not archive the "cannot preview" hint as the document body.
    return { content: "" };
  }
  return { content: extractArtifactPreviewContent(workspace) };
}

export function extractArtifactPreviewContent(workspace: ArtifactWorkspaceSidebar): string {
  const artifact = workspace.artifact;
  const metadata = artifact.providerMetadata ?? {};
  const previewKind = typeof metadata.previewKind === "string" ? metadata.previewKind : "";
  // HTML iframe lane stores the document in htmlSrcdoc; envelope sourceMessage is often a chat summary.
  if (previewKind === "html") {
    const htmlSource = extractHtmlPreviewSource(metadata);
    if (htmlSource) {
      return htmlSource;
    }
  }
  const candidates = [
    metadata.previewText,
    metadata.textPreview,
    metadata.plainTextPreview,
    metadata.markdownPreview,
    metadata.excerpt,
    metadata.summary,
    artifact.sourceMessage,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return sanitizeArtifactPreviewText(candidate);
    }
  }
  const htmlSource = extractHtmlPreviewSource(metadata);
  if (htmlSource) {
    return htmlSource;
  }
  return "";
}

export function inferInitialDeliverableSaveState(
  workspace: ArtifactWorkspaceSidebar,
): DeliverableSaveState {
  const metadata = workspace.artifact.providerMetadata ?? {};
  const savedKbTitle =
    typeof metadata.savedKnowledgeBaseTitle === "string"
      ? metadata.savedKnowledgeBaseTitle.trim()
      : "";
  if (metadata.saved === true || savedKbTitle) {
    return {
      artifactId: workspace.artifact.artifactId,
      status: "saved",
      knowledgeBaseTitle: savedKbTitle || null,
    };
  }
  if (
    metadata.captured === true ||
    metadata.deliverableCaptured === true ||
    metadata.deliverableEnvelope === true ||
    typeof metadata.logicalId === "string"
  ) {
    return {
      artifactId: workspace.artifact.artifactId,
      status: "captured",
    };
  }
  return {
    artifactId: workspace.artifact.artifactId,
    status: "unsaved",
  };
}

/** Sentinel accepted by gateway saveAndArchive — resolves 个人成果 / 团队成果. */
export const SAVE_ARCHIVE_KB_AUTO = "auto";

export function resolveSaveKnowledgeBaseId(_params?: {
  selectedKnowledgeBaseId: string | null;
  knowledgeBaseIds: string[];
  relatedKnowledgeBaseId?: string | null;
}): string {
  // Chat preview save always lands in the reserved deliverable folders.
  // Gateway picks 个人成果 or 团队成果 from session/group context.
  return SAVE_ARCHIVE_KB_AUTO;
}

/** Preview-only artifact ids must not be sent as archive deliverableId. */
export function resolvePersistableDeliverableId(
  deliverableId: string | null | undefined,
): string | null {
  const trimmed = deliverableId?.trim() || "";
  if (!trimmed) {
    return null;
  }
  if (
    trimmed.startsWith("assistant-doc:") ||
    trimmed.startsWith("tool-write:") ||
    trimmed.startsWith("preview:")
  ) {
    return null;
  }
  return trimmed;
}

export const SAVE_DECISION_REQUIRED = "SAVE_DECISION_REQUIRED";
export const SAVE_CONFLICT_STALE = "SAVE_CONFLICT_STALE";

export type DeliverableSaveMode = "overwrite" | "save_as";

export type DeliverableSaveDecisionPrompt = {
  kind: "require_decision" | "stale";
  existingRawHash?: string;
  suggestedSaveAsFilename: string;
  reason?: string;
  filename?: string;
};

export type DeliverableSaveDecisionChoice = {
  saveMode: DeliverableSaveMode;
  saveAsFilename?: string;
};

export class DeliverableSaveCancelledError extends Error {
  readonly code = "SAVE_DECISION_CANCELLED";

  constructor() {
    super("save cancelled");
    this.name = "DeliverableSaveCancelledError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseDeliverableSaveDecisionError(
  error: unknown,
): DeliverableSaveDecisionPrompt | null {
  const details = asRecord(
    error && typeof error === "object" && "details" in error
      ? (error as { details?: unknown }).details
      : error,
  );
  const nested = asRecord(details?.existing);
  const code = typeof details?.code === "string" ? details.code.trim() : "";
  if (code !== SAVE_DECISION_REQUIRED && code !== SAVE_CONFLICT_STALE) {
    return null;
  }
  const suggested =
    (typeof details?.suggestedSaveAsFilename === "string" &&
      details.suggestedSaveAsFilename.trim()) ||
    (typeof nested?.filename === "string" && nested.filename.trim()) ||
    "deliverable.md";
  const existingRawHash =
    (typeof nested?.rawHash === "string" && nested.rawHash.trim()) ||
    (typeof details?.existingRawHash === "string" && details.existingRawHash.trim()) ||
    undefined;
  return {
    kind: code === SAVE_CONFLICT_STALE ? "stale" : "require_decision",
    existingRawHash,
    suggestedSaveAsFilename: suggested,
    reason: typeof details?.reason === "string" ? details.reason : undefined,
    filename: typeof nested?.filename === "string" ? nested.filename : undefined,
  };
}

export async function saveAndArchiveSidebarDeliverable(params: {
  client: GatewayBrowserClient | null;
  workspace: ArtifactWorkspaceSidebar;
  sessionKey: string;
  groupId?: string | null;
  knowledgeBaseId?: string | null;
  content: string;
  contentBase64?: string | null;
  logicalId?: string | null;
  filename?: string | null;
  deliverableId?: string | null;
  saveMode?: DeliverableSaveMode | null;
  expectedRawHash?: string | null;
  saveAsFilename?: string | null;
  askSaveDecision?: (
    prompt: DeliverableSaveDecisionPrompt,
  ) => Promise<DeliverableSaveDecisionChoice | null>;
}): Promise<DeliverableSaveArchiveResult> {
  if (!params.client) {
    throw new Error("gateway client unavailable");
  }
  const title = params.workspace.artifact.title.trim() || "未命名成果";
  const content = params.content.trim();
  const contentBase64 = params.contentBase64?.replace(/\s+/g, "") || "";
  if (!content && !contentBase64) {
    throw new Error("preview content is empty");
  }
  const metadata = params.workspace.artifact.providerMetadata ?? {};
  const filename =
    params.filename?.trim() ||
    (typeof metadata.workspaceFilename === "string" ? metadata.workspaceFilename.trim() : "") ||
    undefined;
  const logicalId =
    params.logicalId?.trim() ||
    (typeof metadata.logicalId === "string" ? metadata.logicalId.trim() : "") ||
    undefined;
  const deliverableId = resolvePersistableDeliverableId(params.deliverableId);
  // Ignore caller/picker KB ids. Gateway saveAndArchive is the only archive
  // write; it resolves 个人成果 vs 团队成果 from session/group context.
  const knowledgeBaseId = SAVE_ARCHIVE_KB_AUTO;
  const requestSave = (decision?: {
    saveMode?: DeliverableSaveMode | null;
    expectedRawHash?: string | null;
    saveAsFilename?: string | null;
  }) =>
    params.client!.request<DeliverableSaveArchiveResult>("knowledge.deliverables.saveAndArchive", {
      sessionKey: params.sessionKey,
      knowledgeBaseId,
      title,
      content,
      ...(contentBase64 ? { contentBase64 } : {}),
      ...(params.groupId?.trim() ? { groupId: params.groupId.trim() } : {}),
      ...(logicalId ? { logicalId } : {}),
      ...(filename ? { filename } : {}),
      ...(deliverableId ? { deliverableId } : {}),
      ...(decision?.saveMode ? { saveMode: decision.saveMode } : {}),
      ...(decision?.expectedRawHash ? { expectedRawHash: decision.expectedRawHash } : {}),
      ...(decision?.saveAsFilename ? { saveAsFilename: decision.saveAsFilename } : {}),
    });
  let decision = {
    saveMode: params.saveMode,
    expectedRawHash: params.expectedRawHash,
    saveAsFilename: params.saveAsFilename,
  };
  for (;;) {
    try {
      return await requestSave(decision);
    } catch (error) {
      const prompt = parseDeliverableSaveDecisionError(error);
      if (!prompt || !params.askSaveDecision) {
        throw error;
      }
      const choice = await params.askSaveDecision(prompt);
      if (!choice) {
        throw new DeliverableSaveCancelledError();
      }
      // Concurrent writers change rawHash after the user confirmed — ask again
      // with the hash they just saw instead of failing the click.
      decision = {
        saveMode: choice.saveMode,
        expectedRawHash: prompt.existingRawHash,
        saveAsFilename: choice.saveAsFilename?.trim() || prompt.suggestedSaveAsFilename,
      };
    }
  }
}
