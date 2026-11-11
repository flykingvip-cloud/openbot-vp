import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { isPptxWorkspaceFilename } from "../../../../src/gateway/office-slide-draft.ts";
import { t } from "../../i18n/index.ts";
import { sanitizeArtifactPreviewText } from "../chat/generated-preview-artifact.ts";
import { recordExternalizationSignal } from "../controllers/asset-incubation/externalization-tracker.ts";
import type { AssetIncubationLevel } from "../controllers/asset-incubation/types.ts";
import { icons } from "../icons.ts";
import { toSanitizedHtml, toSanitizedMarkdownHtml } from "../markdown.ts";
import { openExternalUrlSafe } from "../open-external-url.ts";
import type { ArtifactWorkspaceSidebar, SharedArtifact } from "../types.ts";
import {
  type DeliverableSaveState,
  type DeliverableSaveToast,
} from "../wiring/deliverable-save.ts";
import {
  isTextLikePreviewFilename,
  resolveBrowsableHtmlPreviewUrl,
  resolveInlinePdfPreviewUrl,
} from "../wiring/workspace-file-preview.ts";

type CollaborationTarget = {
  sessionKey: string;
  label: string;
  sublabel?: string | null;
  current?: boolean;
};

type SlidePreview = {
  slideNumber: number;
  title: string;
  imageUrl: string;
  alt: string;
};

const ACTION_FEEDBACK_MS = 1600;

export type ArtifactSidebarProps = {
  workspace: ArtifactWorkspaceSidebar;
  collaborationTargets?: CollaborationTarget[];
  onRequestEditAccess?: (artifactId: string, targetSessionKey?: string) => void | Promise<void>;
  onGrantTargetAccess?: (artifactId: string, targetSessionKey?: string) => void | Promise<void>;
  onCreateVersion?: (artifactId: string) => void | Promise<void>;
  onNotifyVersion?: (
    artifactId: string,
    versionId: string,
    targetSessionKey?: string,
  ) => void | Promise<void>;
  onApproveIntent?: (intentId: string, artifactId: string) => void | Promise<void>;
  onRejectIntent?: (intentId: string, artifactId: string) => void | Promise<void>;
  onGrantIntent?: (intentId: string, artifactId: string) => void | Promise<void>;
  onRevokeGrant?: (grantId: string, artifactId: string) => void | Promise<void>;
  deliverableSaveState?: DeliverableSaveState | null;
  onSaveDeliverable?: (mode?: "save_as") => void | Promise<void>;
  onConfirmDeliverableOverwrite?: () => void;
  onConfirmDeliverableSaveAs?: () => void;
  onCancelDeliverableSaveDecision?: () => void;
  onDeliverableSaveAsFilenameChange?: (filename: string) => void;
  onDeliverableInlineEditApplied?: (content: string) => void;
  assetIncubationLevel?: AssetIncubationLevel | null;
  assetIncubationReason?: string | null;
  showWeakAssetIncubationHint?: boolean;
  showSystemAssetIncubationHint?: boolean;
  showEnterpriseSubmitFromIncubation?: boolean;
  onOpenSkillSaveFromPreview?: (preferEnterprise?: boolean) => void | Promise<void>;
  onDismissAssetIncubationFromPreview?: () => void;
  deliverableSaveToast?: DeliverableSaveToast | null;
};

function stringField(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  // Agents / write-tool miss sometimes persist the literal tokens "undefined"/"null".
  if (!trimmed || /^(?:undefined|null)$/i.test(trimmed)) {
    return "";
  }
  return trimmed;
}

/** Workspace-relative path as a quiet meta line (basename only). */
function renderArtifactWorkspacePathChip(metadata: Record<string, unknown>) {
  const path = stringField(metadata.workspaceFilename);
  if (!path) {
    return nothing;
  }
  const basename = path.split(/[/\\]/).filter(Boolean).at(-1) || path;
  return html`
    <div class="artifact-preview-path" title=${path}>
      <span class="artifact-preview-path__label">${t("chat.artifactWorkspacePath")}</span>
      <code class="artifact-preview-path__value">${basename}</code>
    </div>
  `;
}

function resolveDownloadableHref(artifact: SharedArtifact): string {
  const metadata = artifact.providerMetadata ?? {};
  const filename = stringField(metadata.workspaceFilename) || artifact.title || "";
  const officeHtml =
    metadata.previewKind === "html" &&
    (/\.(?:pptx?|docx?|xlsx?)$/i.test(filename) ||
      /officedocument|msword|ms-powerpoint|ms-excel/i.test(artifact.mimeType || ""));
  // Office HTML is a derivative, never a valid original Office download.
  const candidates = [
    metadata.binaryDownloadUrl,
    artifact.downloadUrl,
    ...(officeHtml ? [] : [artifact.openUrl]),
  ];
  for (const raw of candidates) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      continue;
    }
    if (
      officeHtml &&
      (value === artifact.previewUrl ||
        value === artifact.openUrl ||
        value === stringField(metadata.htmlPreviewUrl) ||
        /^data:text\/html/i.test(value))
    ) {
      continue;
    }
    if (/^(?:blob:|data:)/i.test(value) || /^https?:\/\//i.test(value)) {
      return value;
    }
  }
  // Only original bytes read through the authorized workspace port may back a download.
  // Preview text may be an excerpt or a generated summary and must never substitute for a file.
  const original = metadata.workspaceFileLoaded === true ? metadata.fileBase64 : undefined;
  if (
    typeof original === "string" &&
    original.length > 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(original)
  ) {
    return `data:application/octet-stream;base64,${original}`;
  }
  return "";
}

function resolveDownloadFileMeta(artifact: SharedArtifact): {
  path: string;
  basename: string;
  extLabel: string;
} {
  const metadata = artifact.providerMetadata ?? {};
  const path =
    stringField(metadata.workspaceFilename) || artifact.title?.trim() || t("chat.openArtifact");
  const basename = path.split(/[/\\]/).filter(Boolean).at(-1) || path;
  const ext = basename.includes(".") ? (basename.split(".").pop() ?? "").trim().toLowerCase() : "";
  const mime = (artifact.mimeType ?? "").toLowerCase();
  const extLabel =
    ext.toUpperCase() ||
    (mime.includes("spreadsheet") || mime.includes("excel")
      ? "XLSX"
      : mime.includes("presentation") || mime.includes("powerpoint")
        ? "PPTX"
        : mime.includes("word")
          ? "DOCX"
          : mime.includes("pdf")
            ? "PDF"
            : "");
  return { path, basename, extLabel };
}

/** Unified download channel for formats that cannot be previewed inline. */
function renderArtifactDownloadLane(params: { artifact: SharedArtifact; downloadHref: string }) {
  const { artifact, downloadHref } = params;
  const metadata = artifact.providerMetadata ?? {};
  const { path, basename, extLabel } = resolveDownloadFileMeta(artifact);
  const canDownload = Boolean(downloadHref);
  const hint = canDownload
    ? t("chat.artifactPreviewNoInlineHint")
    : t("chat.stewardFileUnavailable");
  return html`
    <section
      class="artifact-preview-section artifact-preview-primary artifact-preview-primary--download"
    >
      <div class="artifact-preview-download" data-testid="artifact-download-lane">
        <div class="artifact-preview-download__icon" aria-hidden="true">${icons.fileText}</div>
        <div class="artifact-preview-download__body">
          <div class="artifact-preview-download__title-row">
            <div class="artifact-preview-download__title" title=${basename}>${basename}</div>
            ${
              extLabel
                ? html`<span class="artifact-preview-download__badge">${extLabel}</span>`
                : nothing
            }
          </div>
          <div class="artifact-preview-download__kicker">
            ${t("chat.artifactPreviewNoInlineTitle")}
          </div>
          <p
            class="artifact-preview-download__hint"
            data-testid=${canDownload ? nothing : "artifact-download-missing"}
          >
            ${hint}
          </p>
          ${
            stringField(metadata.workspaceFilename) || path
              ? html`
                  <div class="artifact-preview-path" title=${path}>
                    <span class="artifact-preview-path__label"
                      >${t("chat.artifactWorkspacePath")}</span
                    >
                    <code class="artifact-preview-path__value">${basename}</code>
                  </div>
                `
              : nothing
          }
        </div>
        ${
          canDownload
            ? html`
                <div class="artifact-preview-download__actions">
                  <a
                    class="btn btn--sm primary artifact-preview-download__primary"
                    href=${downloadHref}
                    download=${basename}
                    rel="noreferrer"
                    data-testid="artifact-download-primary"
                  >
                    ${icons.download}
                    <span>${t("chat.artifactPreviewDownloadFile")}</span>
                  </a>
                  <a
                    class="btn btn--sm artifact-preview-download__secondary"
                    href=${downloadHref}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="artifact-download-open-tab"
                  >
                    ${t("chat.artifactPreviewOpenInTab")}
                  </a>
                </div>
              `
            : nothing
        }
      </div>
    </section>
  `;
}

/** Text-like miss: do not pretend the format is unsupported. */
function renderArtifactTextMissingLane(params: { artifact: SharedArtifact }) {
  const { artifact } = params;
  const { basename, extLabel } = resolveDownloadFileMeta(artifact);
  return html`
    <section
      class="artifact-preview-section artifact-preview-primary artifact-preview-primary--miss"
      data-testid="artifact-text-missing-lane"
    >
      <div class="artifact-preview-download">
        <div class="artifact-preview-download__icon" aria-hidden="true">${icons.fileText}</div>
        <div class="artifact-preview-download__body">
          <div class="artifact-preview-download__title-row">
            <div class="artifact-preview-download__title" title=${basename}>${basename}</div>
            ${
              extLabel
                ? html`<span class="artifact-preview-download__badge">${extLabel}</span>`
                : nothing
            }
          </div>
          <div class="artifact-preview-download__kicker">
            ${t(
              artifact.providerMetadata?.workspaceUnwritten === true
                ? "chat.artifactPreviewNotWrittenTitle"
                : "chat.artifactPreviewFileMissingTitle",
            )}
          </div>
        </div>
      </div>
    </section>
  `;
}

function isMediaPreviewShellArtifact(artifact: SharedArtifact): boolean {
  const metadata = artifact.providerMetadata ?? {};
  const previewKind = stringField(metadata.previewKind);
  if (
    previewKind === "html" ||
    previewKind === "canvas" ||
    previewKind === "image" ||
    previewKind === "published"
  ) {
    return previewKind === "html" || previewKind === "canvas" || previewKind === "image";
  }
  if ((artifact.mimeType ?? "").toLowerCase().startsWith("image/")) {
    return true;
  }
  return Boolean(
    stringField(metadata.htmlPreviewUrl) ||
    stringField(metadata.htmlSrcdoc) ||
    stringField(metadata.imagePreviewUrl),
  );
}

function renderArtifactMediaShell(params: {
  kind: "html" | "image";
  metadata: Record<string, unknown>;
  stage: ReturnType<typeof html>;
}) {
  return html`
    <section
      class="artifact-preview-section artifact-preview-primary artifact-preview-primary--media artifact-preview-primary--${params.kind}"
    >
      ${renderArtifactWorkspacePathChip(params.metadata)}
      <div class="artifact-preview-media__stage">${params.stage}</div>
    </section>
  `;
}

/** Center image-centric HTML inside the sidebar iframe. Idempotent via the viewport marker. */
function ensureHtmlPreviewViewportStyles(htmlSource: string): string {
  const source = htmlSource.trim();
  if (!source || /data-openbot-preview-viewport/i.test(source)) {
    return htmlSource;
  }
  const style =
    "<style data-openbot-preview-viewport>" +
    "html,body{margin:0;padding:0;width:100%;min-height:100%;background:transparent}" +
    "body{display:grid;place-items:center;box-sizing:border-box;padding:16px;min-height:100vh}" +
    "img,video,svg,canvas{max-width:100%;max-height:calc(100vh - 32px);height:auto;width:auto;object-fit:contain;border-radius:12px}" +
    "</style>";
  if (/<\/head>/i.test(source)) {
    return source.replace(/<\/head>/i, `${style}</head>`);
  }
  if (/<html\b[^>]*>/i.test(source)) {
    return source.replace(/<html\b[^>]*>/i, (open) => `${open}${style}`);
  }
  if (/<body\b[^>]*>/i.test(source)) {
    return source.replace(/<body\b[^>]*>/i, (open) => `${open}${style}`);
  }
  return `${style}${source}`;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isImageUrl(value: string): boolean {
  // Do not treat generic blob: URLs as images — PDF/HTML previews also use blob:.
  return /^(?:https?:\/\/|data:image\/|\/)/i.test(value);
}

function isPdfPreviewArtifact(artifact: SharedArtifact, previewKind: string | null): boolean {
  return (
    previewKind === "pdf" || (artifact.mimeType ?? "").toLowerCase().startsWith("application/pdf")
  );
}

function normalizeSlidePreview(entry: unknown, index: number): SlidePreview | null {
  if (typeof entry === "string") {
    const imageUrl = entry.trim();
    return imageUrl
      ? {
          slideNumber: index + 1,
          title: `Slide ${index + 1}`,
          imageUrl,
          alt: `Slide ${index + 1}`,
        }
      : null;
  }
  const record = toRecord(entry);
  if (!record) {
    return null;
  }
  const imageUrl =
    stringField(record.imageUrl) ||
    stringField(record.url) ||
    stringField(record.dataUrl) ||
    stringField(record.src);
  if (!imageUrl) {
    return null;
  }
  const slideNumber = numberField(record.slideNumber) ?? numberField(record.index) ?? index + 1;
  const title = stringField(record.title) || `Slide ${slideNumber}`;
  return {
    slideNumber,
    title,
    imageUrl,
    alt: stringField(record.alt) || title,
  };
}

function resolveSlidePreviews(artifact: SharedArtifact): SlidePreview[] {
  const metadata = artifact.providerMetadata ?? {};
  const raw =
    (Array.isArray(metadata.slidePreviews) && metadata.slidePreviews) ||
    (Array.isArray(metadata.slides) && metadata.slides) ||
    (Array.isArray(metadata.slideImages) && metadata.slideImages) ||
    (Array.isArray(metadata.pptPreviewImages) && metadata.pptPreviewImages) ||
    [];
  const previews = raw
    .map((entry, index) => normalizeSlidePreview(entry, index))
    .filter((entry): entry is SlidePreview => entry !== null);
  if (previews.length > 0) {
    return previews;
  }
  if (artifact.previewUrl && isImageUrl(artifact.previewUrl)) {
    return [
      {
        slideNumber: 1,
        title: "Slide 1",
        imageUrl: artifact.previewUrl,
        alt: artifact.title,
      },
    ];
  }
  return [];
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text.trim()) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function setActionFeedback(
  button: HTMLButtonElement,
  status: "copied" | "error",
  labels: { idle: string; success: string; error: string },
) {
  const label = button.querySelector<HTMLElement>(".artifact-preview-action__label");
  delete button.dataset.copied;
  delete button.dataset.error;
  button.setAttribute("aria-label", labels.idle);
  if (label) {
    label.textContent = labels.idle;
  }
  if (status === "copied") {
    button.dataset.copied = "1";
    button.setAttribute("aria-label", labels.success);
    if (label) {
      label.textContent = labels.success;
    }
  } else {
    button.dataset.error = "1";
    button.setAttribute("aria-label", labels.error);
    if (label) {
      label.textContent = labels.error;
    }
  }
  window.setTimeout(() => {
    if (!button.isConnected) {
      return;
    }
    delete button.dataset.copied;
    delete button.dataset.error;
    button.setAttribute("aria-label", labels.idle);
    if (label) {
      label.textContent = labels.idle;
    }
  }, ACTION_FEEDBACK_MS);
}

/** Show the floating Chinese label on the icon the user just pointed at. */
export function revealArtifactActionTip(event: Event) {
  const action = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!action) {
    return;
  }
  const root = action.closest(".sidebar-header__actions") ?? action.parentElement;
  root?.querySelectorAll(".is-tip-open").forEach((node) => {
    if (node !== action) {
      node.classList.remove("is-tip-open");
    }
  });
  action.classList.add("is-tip-open");
}

export function hideArtifactActionTip(event: Event) {
  const action = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  action?.classList.remove("is-tip-open");
}

function findSidebarPanel(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target.closest(".sidebar-panel") : null;
}

function findInlinePreviewRoot(target: EventTarget | null): HTMLElement | null {
  return findSidebarPanel(target)?.querySelector<HTMLElement>(".artifact-preview-text") ?? null;
}

function resolveInlinePreviewText(target: EventTarget | null, artifact: SharedArtifact): string {
  const previewRoot = findInlinePreviewRoot(target);
  const editor = previewRoot?.querySelector<HTMLTextAreaElement>(".artifact-preview-text__editor");
  const content = previewRoot?.querySelector<HTMLElement>(".artifact-preview-text__content");
  if (previewRoot?.dataset.editing === "1" && editor?.value.trim()) {
    return editor.value.trim();
  }
  if (content?.textContent?.trim()) {
    return content.textContent.trim();
  }
  return extractArtifactTextPreview(artifact).trim();
}

function beginInlinePreviewEdit(target: EventTarget | null, artifact: SharedArtifact) {
  const previewRoot = findInlinePreviewRoot(target);
  const editor = previewRoot?.querySelector<HTMLTextAreaElement>(".artifact-preview-text__editor");
  if (!previewRoot || !editor) {
    return false;
  }
  // Prefer source markdown over rendered article/doc text so headings stay editable.
  editor.value = extractArtifactTextPreview(artifact);
  previewRoot.dataset.editing = "1";
  requestAnimationFrame(() => {
    editor.focus();
    editor.selectionStart = editor.value.length;
    editor.selectionEnd = editor.value.length;
  });
  return true;
}

function cancelInlinePreviewEdit(target: EventTarget | null) {
  const previewRoot = findInlinePreviewRoot(target);
  if (!previewRoot) {
    return;
  }
  delete previewRoot.dataset.editing;
}

function applyInlinePreviewEdit(
  target: EventTarget | null,
  artifact: SharedArtifact,
  onApplied?: (content: string) => void,
) {
  const previewRoot = findInlinePreviewRoot(target);
  const editor = previewRoot?.querySelector<HTMLTextAreaElement>(".artifact-preview-text__editor");
  const content = previewRoot?.querySelector<HTMLElement>(".artifact-preview-text__content");
  if (!previewRoot || !editor) {
    return false;
  }
  const prior = extractArtifactTextPreview(artifact);
  const next = editor.value.trim() || prior;
  delete previewRoot.dataset.editing;
  if (next !== prior) {
    if (content) {
      content.textContent = next;
    }
    onApplied?.(next);
  }
  return true;
}

function renderInlineEditablePreview(params: {
  artifact: SharedArtifact;
  variant: "text" | "article" | "doc";
  rendered: TemplateResult;
  editorValue: string;
  onApplied?: (content: string) => void;
}): TemplateResult {
  return html`
    <section
      class="artifact-preview-section artifact-preview-primary artifact-preview-primary--${params.variant}"
    >
      <div class="artifact-preview-text">
        <div class="artifact-preview-text__rendered">${params.rendered}</div>
        <textarea class="artifact-preview-text__editor" .value=${params.editorValue}></textarea>
        <div class="artifact-preview-text__toolbar">
          <button
            class="btn btn--sm"
            type="button"
            @click=${(event: Event) => cancelInlinePreviewEdit(event.currentTarget)}
          >
            ${t("chat.cancelArtifactInlineEdit")}
          </button>
          <button
            class="btn btn--sm primary"
            type="button"
            @click=${(event: Event) =>
              applyInlinePreviewEdit(event.currentTarget, params.artifact, params.onApplied)}
          >
            ${t("chat.applyArtifactInlineEdit")}
          </button>
        </div>
      </div>
    </section>
  `;
}

function extractArtifactTextPreview(artifact: SharedArtifact): string {
  const metadata = artifact.providerMetadata ?? {};
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
  return "";
}

function resolveArtifactPreviewFilename(artifact: SharedArtifact): string {
  const metadata = artifact.providerMetadata ?? {};
  return (
    stringField(metadata.workspaceFilename) ||
    stringField(artifact.title) ||
    stringField(artifact.openUrl)
  );
}

function isTextLikeArtifactPreview(artifact: SharedArtifact): boolean {
  return isTextLikePreviewFilename(resolveArtifactPreviewFilename(artifact), artifact.mimeType);
}

/**
 * Formats that support online preview when bytes exist (HTML iframe / PDF iframe).
 * A miss must use FileMissing copy — never「暂不支持在线预览」.
 */
function isInlinePreviewableFileArtifact(artifact: SharedArtifact): boolean {
  const previewKind = stringField(artifact.providerMetadata?.previewKind);
  if (previewKind === "html" || previewKind === "pdf" || previewKind === "canvas") {
    return true;
  }
  const name = resolveArtifactPreviewFilename(artifact);
  const mime = (artifact.mimeType ?? "").toLowerCase();
  if (mime.includes("text/html") || mime.startsWith("application/pdf")) {
    return true;
  }
  return /\.(?:html?|pdf)$/i.test(name);
}

/** File-backed miss for formats that preview online when present: FileMissing, not unsupported. */
function shouldRenderFileMissingLane(artifact: SharedArtifact): boolean {
  return isTextLikeArtifactPreview(artifact) || isInlinePreviewableFileArtifact(artifact);
}

/** True when the artifact is a workspace/office/PDF/HTML file that must not show chat prose. */
function isFileBackedArtifactPreview(
  artifact: SharedArtifact,
  previewKind: string | null,
): boolean {
  // Intentional text/markdown lane (loaded .md/.txt) may set workspaceFileLoaded — allow it.
  if (previewKind === "text" || previewKind === "published") {
    return false;
  }
  if (isTextLikeArtifactPreview(artifact)) {
    return false;
  }
  // Published / browsable HTML pages are previewed via iframe — not an unavailable file.
  if (
    resolveBrowsableHtmlPreviewUrl({
      openUrl: artifact.openUrl,
      previewUrl: artifact.previewUrl,
      mimeType: artifact.mimeType,
      title: artifact.title,
      workspaceFilename:
        typeof artifact.providerMetadata?.workspaceFilename === "string"
          ? artifact.providerMetadata.workspaceFilename
          : null,
    })
  ) {
    return false;
  }
  if (
    previewKind === "file" ||
    previewKind === "pdf" ||
    previewKind === "html" ||
    previewKind === "canvas" ||
    previewKind === "binary"
  ) {
    return true;
  }
  const mime = (artifact.mimeType ?? "").toLowerCase();
  if (
    mime.includes("pdf") ||
    mime.includes("wordprocessingml") ||
    mime.includes("msword") ||
    mime.includes("presentationml") ||
    mime.includes("ms-powerpoint") ||
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel") ||
    mime.includes("text/html")
  ) {
    return true;
  }
  const nameCandidates = [
    artifact.providerMetadata?.workspaceFilename,
    artifact.title,
    artifact.openUrl,
  ];
  for (const candidate of nameCandidates) {
    if (
      typeof candidate === "string" &&
      /\.(?:docx?|pptx?|xlsx?|pdf|html?|canvas)$/i.test(candidate)
    ) {
      return true;
    }
  }
  return false;
}

async function shareArtifact(artifact: SharedArtifact, textPreview?: string) {
  const shareUrl = artifact.openUrl || artifact.downloadUrl || artifact.editUrl || "";
  const previewText = textPreview?.trim() || "";
  const shareText = previewText
    ? `${artifact.title}\n\n${previewText}`
    : shareUrl
      ? `${artifact.title}\n${shareUrl}`
      : `${artifact.title}\nArtifact ID: ${artifact.artifactId}`;
  if (typeof navigator !== "undefined" && "share" in navigator && shareUrl) {
    try {
      await navigator.share({
        title: artifact.title,
        text: artifact.title,
        url: shareUrl,
      });
      return true;
    } catch {
      // Fall through to clipboard copy when native share is unavailable or cancelled.
    }
  }
  return await copyTextToClipboard(shareText);
}

function resolveShareTargets(props: ArtifactSidebarProps): CollaborationTarget[] {
  const targets = props.collaborationTargets ?? [];
  const currentTargets = targets.filter((target) => target.current);
  const otherTargets = targets.filter((target) => !target.current);
  return [...currentTargets, ...otherTargets];
}

function renderArtifactShareAction(props: ArtifactSidebarProps) {
  const artifact = props.workspace.artifact;
  const targets = resolveShareTargets(props);
  const canShareToCollaboration = Boolean(props.onGrantTargetAccess);
  if (canShareToCollaboration) {
    return html`
      <details class="artifact-share-menu">
        <summary
          class="btn btn--sm artifact-preview-action artifact-preview-action--icon"
          aria-label=${t("chat.shareArtifact")}
          @pointerenter=${revealArtifactActionTip}
          @pointerleave=${hideArtifactActionTip}
        >
          ${icons.share2}
          <span class="artifact-preview-action__label">${t("chat.shareArtifact")}</span>
        </summary>
        <div class="artifact-share-menu__panel" role="menu">
          <div class="artifact-share-menu__title">${t("chat.shareArtifactTargetTitle")}</div>
          ${
            targets.length > 0
              ? targets.map(
                  (target) => html`
                    <button
                      class="artifact-share-menu__item"
                      type="button"
                      role="menuitem"
                      @click=${async (event: Event) => {
                        const button = event.currentTarget as HTMLButtonElement | null;
                        const details = button?.closest("details");
                        if (!button) {
                          return;
                        }
                        try {
                          await props.onGrantTargetAccess?.(
                            artifact.artifactId,
                            target.sessionKey || undefined,
                          );
                          if (details instanceof HTMLDetailsElement) {
                            details.open = false;
                          }
                          setActionFeedback(button, "copied", {
                            idle: target.label,
                            success: t("chat.shareArtifactSent"),
                            error: t("chat.shareArtifactFailed"),
                          });
                        } catch {
                          setActionFeedback(button, "error", {
                            idle: target.label,
                            success: t("chat.shareArtifactSent"),
                            error: t("chat.shareArtifactFailed"),
                          });
                        }
                      }}
                    >
                      <span class="artifact-share-menu__item-label">${target.label}</span>
                      ${
                        target.sublabel
                          ? html`<span class="artifact-share-menu__item-meta"
                              >${target.sublabel}</span
                            >`
                          : nothing
                      }
                    </button>
                  `,
                )
              : html`<div class="artifact-share-menu__empty">
                  ${t("chat.shareArtifactNoTargets")}
                </div>`
          }
        </div>
      </details>
    `;
  }
  return html`
    <button
      class="btn btn--sm artifact-preview-action artifact-preview-action--icon"
      type="button"
      aria-label=${t("chat.shareArtifact")}
      @pointerenter=${revealArtifactActionTip}
      @pointerleave=${hideArtifactActionTip}
      @click=${async (event: Event) => {
        const button = event.currentTarget as HTMLButtonElement | null;
        if (!button) {
          return;
        }
        const ok = await shareArtifact(
          artifact,
          resolveInlinePreviewText(event.currentTarget, artifact),
        );
        if (ok) {
          recordExternalizationSignal({
            kind: "share",
            contextId: artifact.artifactId,
          });
        }
        if (!button.isConnected) {
          return;
        }
        setActionFeedback(button, ok ? "copied" : "error", {
          idle: t("chat.shareArtifact"),
          success: t("chat.shareArtifactCopied"),
          error: t("chat.shareArtifactFailed"),
        });
      }}
    >
      ${icons.share2}
      <span class="artifact-preview-action__label">${t("chat.shareArtifact")}</span>
    </button>
  `;
}

export function renderDeliverableSaveDecision(props: ArtifactSidebarProps) {
  const prompt = props.deliverableSaveState?.pendingDecision;
  if (!prompt) {
    return nothing;
  }
  const draft =
    props.deliverableSaveState?.saveAsFilenameDraft?.trim() || prompt.suggestedSaveAsFilename;
  const stale = prompt.kind === "stale";
  return html`
    <section
      class="artifact-preview-save-decision"
      data-testid="deliverable-save-decision"
      role="dialog"
      aria-label=${t("chat.deliverableSaveDecisionTitle")}
    >
      <p class="artifact-preview-save-decision__copy">
        ${stale ? t("chat.deliverableSaveStale") : t("chat.deliverableSaveDecisionBody")}
      </p>
      <label class="artifact-preview-save-decision__filename">
        <span>${t("chat.deliverableSaveAsFilenameLabel")}</span>
        <input
          type="text"
          .value=${draft}
          ?disabled=${!props.onDeliverableSaveAsFilenameChange}
          @input=${(event: Event) => {
            const value = (event.target as HTMLInputElement).value;
            props.onDeliverableSaveAsFilenameChange?.(value);
          }}
        />
      </label>
      <div class="artifact-preview-save-decision__actions">
        <button
          class="btn btn--sm btn--primary"
          type="button"
          @click=${() => props.onConfirmDeliverableOverwrite?.()}
        >
          ${t("chat.deliverableSaveOverwrite")}
        </button>
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => props.onConfirmDeliverableSaveAs?.()}
        >
          ${icons.copy}
          <span class="artifact-preview-action__label">${t("chat.deliverableSaveAs")}</span>
        </button>
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => props.onCancelDeliverableSaveDecision?.()}
        >
          ${t("chat.deliverableSaveCancel")}
        </button>
      </div>
    </section>
  `;
}

export function renderDeliverableSaveToast(toast: DeliverableSaveToast | null | undefined) {
  if (!toast) {
    return nothing;
  }
  return html`
    <div
      class="artifact-preview-deliverable-toast artifact-preview-deliverable-toast--${toast.kind}"
      role="status"
      aria-live="polite"
      data-testid="deliverable-save-toast"
    >
      ${toast.message}
    </div>
  `;
}

export function renderArtifactSidebarHeaderActions(props: ArtifactSidebarProps) {
  const artifact = props.workspace.artifact;
  const hasInlineTextPreview = Boolean(extractArtifactTextPreview(artifact));
  const saveState = props.deliverableSaveState;
  const saveDisabled =
    !props.onSaveDeliverable ||
    Boolean(saveState?.busy) ||
    Boolean(saveState?.pendingDecision) ||
    (saveState?.status === "saved" && !saveState?.dirty);
  return html`
    ${
      props.onSaveDeliverable
        ? html`
            <button
              class="btn btn--sm btn--primary artifact-preview-action artifact-preview-action--icon"
              type="button"
              aria-label=${t("chat.saveDeliverable")}
              ?disabled=${saveDisabled}
              @pointerenter=${revealArtifactActionTip}
              @pointerleave=${hideArtifactActionTip}
              @click=${() => void props.onSaveDeliverable?.()}
            >
              ${icons.save}
              <span class="artifact-preview-action__label">${t("chat.saveDeliverable")}</span>
            </button>
          `
        : nothing
    }
    ${
      props.onSaveDeliverable
        ? html`
      <button class="btn btn--sm artifact-preview-action artifact-preview-action--icon" type="button"
        aria-label=${t("chat.deliverableSaveAs")}
        ?disabled=${Boolean(saveState?.busy) || Boolean(saveState?.pendingDecision)}
        @pointerenter=${revealArtifactActionTip}
        @pointerleave=${hideArtifactActionTip}
        @click=${() => void props.onSaveDeliverable?.("save_as")}>
        ${icons.copy}
        <span class="artifact-preview-action__label">${t("chat.deliverableSaveAs")}</span>
      </button>`
        : nothing
    }
    ${
      hasInlineTextPreview || artifact.editUrl
        ? html`
            <button
              class="btn btn--sm artifact-preview-action artifact-preview-action--icon"
              type="button"
              aria-label=${t("chat.editArtifact")}
              @pointerenter=${revealArtifactActionTip}
              @pointerleave=${hideArtifactActionTip}
              @click=${(event: Event) => {
                if (hasInlineTextPreview && beginInlinePreviewEdit(event.currentTarget, artifact)) {
                  return;
                }
                if (artifact.editUrl) {
                  openExternalUrlSafe(artifact.editUrl);
                }
              }}
            >
              ${icons.edit}
              <span class="artifact-preview-action__label">${t("chat.editArtifact")}</span>
            </button>
          `
        : nothing
    }
    ${(() => {
      const downloadHref = resolveDownloadableHref(artifact);
      if (!downloadHref) {
        return nothing;
      }
      const { basename } = resolveDownloadFileMeta(artifact);
      return html`
        <a
          class="btn btn--sm artifact-preview-action artifact-preview-action--icon"
          href=${downloadHref}
          download=${basename}
          rel="noreferrer"
          aria-label=${t("chat.artifactPreviewDownloadFile")}
          @pointerenter=${revealArtifactActionTip}
          @pointerleave=${hideArtifactActionTip}
        >
          ${icons.download}
          <span class="artifact-preview-action__label">${t("chat.downloadArtifact")}</span>
        </a>
      `;
    })()}
    ${renderArtifactShareAction(props)}
  `;
}

function renderArtifactOverview(props: ArtifactSidebarProps) {
  const artifact = props.workspace.artifact;
  const metadata = artifact.providerMetadata ?? {};
  const renderedHtml = stringField(metadata.renderedHtml);
  const previewKind = stringField(metadata.previewKind);
  const declaredType = stringField(metadata.declaredType);
  const textPreview = extractArtifactTextPreview(artifact);
  const previewUnavailable = metadata.previewUnavailable === true;
  const isPdfPreview = isPdfPreviewArtifact(artifact, previewKind);
  const imagePreviewCandidate =
    artifact.previewUrl?.trim() || stringField(metadata.imagePreviewUrl) || "";
  const imagePreview =
    imagePreviewCandidate &&
    !isPdfPreview &&
    (previewKind === "image" ||
      (artifact.mimeType ?? "").toLowerCase().startsWith("image/") ||
      isImageUrl(imagePreviewCandidate))
      ? imagePreviewCandidate
      : null;

  // Immediate shell after 「打开成果」— keep the pane open while the file RPC runs.
  if (previewKind === "loading" || metadata.previewLoading === true) {
    return html`
      <section class="artifact-preview-section artifact-preview-primary">
        <div class="artifact-preview-loading" role="status" aria-live="polite">
          <div class="artifact-preview-loading__spinner" aria-hidden="true"></div>
          <div class="artifact-preview-loading__copy">${t("chat.stewardFileLoading")}</div>
        </div>
      </section>
    `;
  }

  if (
    previewUnavailable &&
    (metadata.workspaceUnwritten === true ||
      isTextLikeArtifactPreview(artifact) ||
      isInlinePreviewableFileArtifact(artifact))
  ) {
    return renderArtifactTextMissingLane({ artifact });
  }

  // Slide artifacts with real slide images are rendered by renderSlidePreview below.
  // PPTX without generated previews must fall through to the binary download card —
  // otherwise the pane only shows "还没有可用的幻灯片预览图" and looks unopenable.
  if (artifact.artifactType === "slide" && resolveSlidePreviews(artifact).length > 0) {
    return nothing;
  }

  // Prefer explicit image lane before HTML/blob URL heuristics — image blob: previewUrls
  // also match resolveBrowsableHtmlPreviewUrl's blob: acceptance and would otherwise
  // incorrectly render as a blank/left-aligned iframe page.
  if (
    imagePreviewCandidate &&
    (previewKind === "image" || (artifact.mimeType ?? "").toLowerCase().startsWith("image/"))
  ) {
    return renderArtifactMediaShell({
      kind: "image",
      metadata,
      stage: html`
        <figure class="artifact-preview-image">
          <img src=${imagePreviewCandidate} alt=${artifact.title} loading="lazy" />
        </figure>
      `,
    });
  }

  // Office / unknown binaries must win before blob: HTML heuristics — their downloadUrl is
  // often a blob: URL that resolveBrowsableHtmlPreviewUrl would otherwise treat as a page.
  const earlyDownloadHref = resolveDownloadableHref(artifact);
  if (previewKind === "binary" || Boolean(metadata.downloadedBinary)) {
    return renderArtifactDownloadLane({
      artifact,
      downloadHref: earlyDownloadHref,
    });
  }

  // Full HTML deliverables (e.g. report_design.html): sandboxed iframe so CSS/layout render
  // as a page — never dump source into the text/<pre> lane. Prefer blob:/data: URL (CSP
  // frame-src); fall back to srcdoc only when no URL is available. Also accept published
  // http(s)/same-origin HTML pages (e.g. https://www.openbot.love/128-layout-preview.html).
  const publishedHtmlUrl = resolveBrowsableHtmlPreviewUrl({
    openUrl: artifact.openUrl,
    previewUrl: artifact.previewUrl,
    mimeType: artifact.mimeType,
    title: artifact.title,
    workspaceFilename: stringField(metadata.workspaceFilename),
  });
  const htmlPreviewUrl =
    stringField(metadata.htmlPreviewUrl) ||
    publishedHtmlUrl ||
    (artifact.previewUrl?.trim() && /^(?:blob:|data:text\/html)/i.test(artifact.previewUrl.trim())
      ? artifact.previewUrl.trim()
      : "");
  const htmlSrcdocRaw = stringField(metadata.htmlSrcdoc);
  const htmlSrcdoc = htmlSrcdocRaw ? ensureHtmlPreviewViewportStyles(htmlSrcdocRaw) : "";
  if (
    (previewKind === "html" ||
      previewKind === "canvas" ||
      previewKind === "published" ||
      Boolean(publishedHtmlUrl)) &&
    (htmlPreviewUrl || htmlSrcdoc)
  ) {
    // Never bind `.srcdoc=${undefined}`. Browsers coerce that to the literal string
    // "undefined", and a present srcdoc attribute overrides `src`.
    const stage = htmlPreviewUrl
      ? html`
          <iframe
            class="artifact-preview-html"
            src=${htmlPreviewUrl}
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
            title=${artifact.title}
          ></iframe>
        `
      : html`
          <iframe
            class="artifact-preview-html"
            srcdoc=${htmlSrcdoc}
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
            title=${artifact.title}
          ></iframe>
        `;
    if (
      isPptxWorkspaceFilename(resolveArtifactPreviewFilename(artifact)) &&
      (textPreview || Array.isArray(metadata.officeSlides))
    ) {
      return renderInlineEditablePreview({
        artifact,
        variant: "doc",
        rendered: stage,
        editorValue: textPreview,
        onApplied: props.onDeliverableInlineEditApplied,
      });
    }
    return renderArtifactMediaShell({
      kind: "html",
      metadata,
      stage,
    });
  }

  // Faithful document render (e.g. a produced .docx converted to HTML server-side): show the
  // document itself, sanitized, instead of the chat text.
  if (renderedHtml) {
    const safeDocHtml = toSanitizedHtml(renderedHtml);
    if (safeDocHtml) {
      return renderInlineEditablePreview({
        artifact,
        variant: "doc",
        rendered: html`<article class="artifact-preview-doc">${unsafeHTML(safeDocHtml)}</article>`,
        editorValue: textPreview,
        onApplied: props.onDeliverableInlineEditApplied,
      });
    }
  }

  // Declared article (published link or type=article): render the markdown body as a formatted
  // article, not a raw <pre> of chat text. Inferred/plain artifacts keep the editable text path.
  const isDeclaredArticle = previewKind === "published" || declaredType === "article";
  const isMarkdownPreview =
    /\.(?:md|markdown)$/i.test(resolveArtifactPreviewFilename(artifact)) ||
    (artifact.mimeType ?? "").toLowerCase().includes("markdown");
  if ((isDeclaredArticle || isMarkdownPreview) && textPreview) {
    const safeArticleHtml = toSanitizedMarkdownHtml(textPreview);
    if (safeArticleHtml) {
      return renderInlineEditablePreview({
        artifact,
        variant: "article",
        rendered: html`
          <article class="artifact-preview-article">${unsafeHTML(safeArticleHtml)}</article>
        `,
        editorValue: textPreview,
        onApplied: props.onDeliverableInlineEditApplied,
      });
    }
  }

  if (imagePreview) {
    return renderArtifactMediaShell({
      kind: "image",
      metadata,
      stage: html`
        <figure class="artifact-preview-image">
          <img src=${imagePreview} alt=${artifact.title} loading="lazy" />
        </figure>
      `,
    });
  }

  // Never iframe data:application/pdf — Chrome shows「此页面已被 Chrome 屏蔽」.
  const pdfPreviewUrl = isPdfPreview
    ? resolveInlinePdfPreviewUrl({
        pdfPreviewUrl: stringField(metadata.pdfPreviewUrl),
        previewUrl: artifact.previewUrl,
        openUrl: artifact.openUrl,
      })
    : "";
  if (pdfPreviewUrl) {
    return html`
      <section
        class="artifact-preview-section artifact-preview-primary artifact-preview-primary--pdf"
      >
        <iframe
          class="artifact-preview-pdf"
          src=${pdfPreviewUrl}
          title=${artifact.title}
        ></iframe>
      </section>
    `;
  }

  // Office binaries (pptx/xlsx/…): show an explicit download/open card — never chat prose.
  // PDF data: URLs also land here (Chrome blocks them in iframes).
  const pdfDataFallback =
    isPdfPreview && !pdfPreviewUrl
      ? [stringField(metadata.dataUrl), artifact.downloadUrl, artifact.previewUrl, artifact.openUrl]
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .find((value) => /^data:application\/pdf/i.test(value)) || ""
      : "";
  const binaryDownloadUrl =
    stringField(metadata.binaryDownloadUrl) ||
    pdfDataFallback ||
    (previewKind === "binary" || Boolean(metadata.downloadedBinary)
      ? (artifact.downloadUrl?.trim() && /^(?:blob:|data:)/i.test(artifact.downloadUrl.trim())
          ? artifact.downloadUrl.trim()
          : "") ||
        (artifact.openUrl?.trim() && /^(?:blob:|data:)/i.test(artifact.openUrl.trim())
          ? artifact.openUrl.trim()
          : "")
      : "");
  if (binaryDownloadUrl) {
    return renderArtifactDownloadLane({
      artifact,
      downloadHref: binaryDownloadUrl,
    });
  }

  // File-backed deliverables must never degrade into chat/envelope prose in the preview pane.
  const downloadHref = resolveDownloadableHref(artifact);
  if (isFileBackedArtifactPreview(artifact, previewKind)) {
    // HTML/PDF (and text-like) with no bytes: FileMissing — not「暂不支持在线预览」.
    if (!downloadHref && shouldRenderFileMissingLane(artifact)) {
      return renderArtifactTextMissingLane({ artifact });
    }
    return renderArtifactDownloadLane({
      artifact,
      downloadHref,
    });
  }

  if (textPreview) {
    return renderInlineEditablePreview({
      artifact,
      variant: "text",
      rendered: html`<pre class="artifact-preview-text__content">${textPreview}</pre>`,
      editorValue: textPreview,
      onApplied: props.onDeliverableInlineEditApplied,
    });
  }

  return html`
    <section class="artifact-preview-section artifact-preview-primary">
      <div class="artifact-preview-fallback">
        <div class="artifact-preview-fallback__copy">
          ${t("chat.artifactPreviewUnavailable")}
        </div>
        ${
          artifact.openUrl
            ? html`
                <a class="btn btn--sm" href=${artifact.openUrl} target="_blank" rel="noreferrer">
                  ${t("chat.openArtifact")}
                </a>
              `
            : nothing
        }
      </div>
    </section>
  `;
}

export function renderArtifactSidebarEmpty(props: { message?: string | null }) {
  const emptyCopy = props.message?.trim() || t("chat.artifactPreviewEmpty");
  return html`
    <div class="artifact-sidebar artifact-preview-shell">
      <section class="artifact-preview-body">
        <section
          class="artifact-preview-section artifact-preview-primary artifact-preview-primary--empty"
        >
          <div class="artifact-preview-empty-state">${emptyCopy}</div>
        </section>
      </section>
    </div>
  `;
}

function renderSlidePreview(props: ArtifactSidebarProps, previews: SlidePreview[]) {
  return html`
    <section class="ppt-preview">
      ${
        previews.length
          ? html`
              <div class="ppt-preview__slides">
                ${previews.map(
                  (slide) => html`
                    <figure class="ppt-preview__slide">
                      <img src=${slide.imageUrl} alt=${slide.alt} loading="lazy" />
                      <figcaption>
                        <strong>${slide.slideNumber}. ${slide.title}</strong>
                      </figcaption>
                    </figure>
                  `,
                )}
              </div>
            `
          : html`<div class="muted">${t("chat.pptPreviewMissing")}</div>`
      }
    </section>
  `;
}

function renderArtifactIncubationHint(_props: ArtifactSidebarProps) {
  // Preview bottom "系统建议整理为能力 / 整理为草稿" strip removed — low user value.
  return nothing;
}

export function renderArtifactSidebar(props: ArtifactSidebarProps) {
  const { workspace } = props;
  const artifact = workspace.artifact;
  const slidePreviews = artifact.artifactType === "slide" ? resolveSlidePreviews(artifact) : [];
  const mediaShellOwnsLayout = slidePreviews.length === 0 && isMediaPreviewShellArtifact(artifact);
  return html`
    <div
      class="artifact-sidebar artifact-preview-shell ${mediaShellOwnsLayout ? "artifact-preview-shell--media" : ""}"
    >
      <section class="artifact-preview-body">
        ${renderDeliverableSaveDecision(props)}
        ${renderArtifactOverview(props)}
        ${slidePreviews.length > 0 ? renderSlidePreview(props, slidePreviews) : nothing}
      </section>
      ${renderArtifactIncubationHint(props)}
    </div>
  `;
}
