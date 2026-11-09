/**
 * Shared helpers for opening workspace files (steward / group) into the artifact sidebar.
 */

import {
  formatOfficeSlideDraft,
  parseOfficeSlidesInput,
  type OfficeSlideText,
} from "../../../../src/gateway/office-slide-draft.ts";
import { t } from "../../i18n/index.ts";
import {
  decodeGroupFileText,
  isGroupHtmlPreviewFilename,
  isGroupImagePreviewFilename,
  isGroupPdfPreviewFilename,
} from "../controllers/group-workspace-file.ts";
import type { ArtifactWorkspaceSidebar } from "../types.ts";
import { selectArtifactPreviewSurface } from "../views/account-computer-preview.ts";
import type { StewardArtifactSidebarHost } from "./steward-workspace-file.ts";

function showArtifactPreviewMode(host: StewardArtifactSidebarHost) {
  host.sidebarPreviewMode = "artifact";
  selectArtifactPreviewSurface(host);
}

export type WorkspaceFilePreviewPayload = {
  contentHash?: string;
  filename: string;
  relativePath?: string;
  mimeType: string;
  textLike: boolean;
  renderKind?: "html";
  html?: string;
  base64?: string;
  officeSlides?: OfficeSlideText[];
};

export type ApplyWorkspaceFilePreviewResult =
  | "html"
  | "pdf"
  | "image"
  | "text"
  | "canvas"
  | "binary"
  | "empty";

/**
 * Server-side `readable` only proves bytes were returned. A PDF preview is
 * accepted here only when those bytes parse as a PDF header.
 */
export function pdfBase64LooksParseable(base64: string): boolean {
  const cleaned = base64.replace(/\s+/g, "");
  if (cleaned.length < 8) {
    return false;
  }
  try {
    const header = atob(cleaned.slice(0, 8));
    return header.startsWith("%PDF-");
  } catch {
    return false;
  }
}

const TEXT_LIKE_PREVIEW_EXT_RE = /\.(?:md|markdown|txt|text|log|csv|tsv|json|ya?ml|xml)$/i;

/** Markdown / plain-text deliverables that should preview inline, not as an office download. */
export function isTextLikePreviewFilename(
  filename?: string | null,
  mimeType?: string | null,
): boolean {
  const name = (filename ?? "").trim();
  const mime = (mimeType ?? "").trim().toLowerCase();
  if (mime === "text/html" || mime === "text/css" || mime === "application/pdf") {
    return false;
  }
  if (TEXT_LIKE_PREVIEW_EXT_RE.test(name)) {
    return true;
  }
  return (
    mime === "text/plain" ||
    mime === "text/markdown" ||
    mime === "text/csv" ||
    mime === "application/json" ||
    mime.includes("markdown")
  );
}

/** Cursor / OpenBot canvas graph JSON (nodes + edges), not React .canvas.tsx source. */
export function isCanvasGraphFilename(filename: string, mimeType?: string): boolean {
  const lower = filename.trim().toLowerCase();
  const mime = (mimeType ?? "").trim().toLowerCase();
  if (lower.endsWith(".canvas.tsx") || lower.endsWith(".canvas.ts")) {
    return false;
  }
  return (
    lower.endsWith(".canvas") ||
    mime === "application/x-openbot-canvas" ||
    mime === "application/vnd.openbot.canvas+json"
  );
}

/** Build a simple HTML preview from canvas graph JSON (node labels). */
export function buildCanvasGraphPreviewHtml(raw: string, title: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { nodes?: unknown };
    if (!parsed || !Array.isArray(parsed.nodes)) {
      return null;
    }
    const labels = parsed.nodes
      .map((node) => {
        if (!node || typeof node !== "object") {
          return "";
        }
        const record = node as Record<string, unknown>;
        const label = typeof record.label === "string" ? record.label.trim() : "";
        const id = typeof record.id === "string" ? record.id.trim() : "";
        return label || id;
      })
      .filter(Boolean)
      .slice(0, 40);
    if (labels.length === 0) {
      return null;
    }
    const items = labels
      .map((label) => `<li>${escapeHtml(label.replace(/\n+/g, " · "))}</li>`)
      .join("");
    const safeTitle = escapeHtml(title.trim() || "Canvas");
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${safeTitle}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#14212b;background:#f7fafc}
h1{font-size:18px;margin:0 0 12px}
ul{margin:0;padding-left:1.2em}li{margin:6px 0}
.muted{color:#5b6b76;font-size:12px;margin-top:16px}
</style></head><body>
<h1>${safeTitle}</h1>
<ul>${items}</ul>
<p class="muted">Canvas 节点预览（共 ${labels.length} 项）</p>
</body></html>`;
  } catch {
    return null;
  }
}

function resolveImagePreviewMimeType(filename: string, mimeType?: string): string {
  const mime = (mimeType ?? "").trim().toLowerCase();
  if (mime.startsWith("image/")) {
    return mime;
  }
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".bmp")) {
    return "image/bmp";
  }
  return "image/png";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** True for full HTML documents that should render in a sandboxed iframe (not as source text). */
export function isFullHtmlDocument(html: string): boolean {
  const head = html.slice(0, 2000).toLowerCase();
  return (
    head.includes("<!doctype") ||
    head.includes("<html") ||
    head.includes("<head") ||
    head.includes("<body") ||
    /<style[\s>]/i.test(head)
  );
}

/**
 * Resolves a browsable HTML page URL for sidebar iframe preview.
 * Accepts same-origin paths (`/foo.html`) and http(s) URLs that look like HTML pages
 * (including published Control UI hosts such as openbot.love).
 */
export function resolveBrowsableHtmlPreviewUrl(params: {
  openUrl?: string | null;
  previewUrl?: string | null;
  mimeType?: string | null;
  title?: string | null;
  workspaceFilename?: string | null;
}): string | null {
  const candidates = [params.openUrl, params.previewUrl];
  for (const raw of candidates) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      continue;
    }
    // Only data:text/html is an HTML document URL. Generic blob: is also used
    // for PDF/image bytes and must not be inferred as a browsable HTML page.
    if (/^data:text\/html/i.test(value)) {
      return value;
    }
    // blob: is also used for PDF/image previews. Only treat it as HTML when the
    // deliverable is actually an HTML page — otherwise the sidebar sandboxes a
    // PDF blob and Chrome shows「此页面已被 Chrome 屏蔽」.
    if (/^blob:/i.test(value)) {
      const looksHtml =
        (params.mimeType ?? "").toLowerCase().includes("text/html") ||
        /\.html?$/i.test(params.title ?? "") ||
        /\.html?$/i.test(params.workspaceFilename ?? "");
      if (looksHtml) {
        return value;
      }
      continue;
    }
    const isHttp = /^https?:\/\//i.test(value);
    const isRootRelative = value.startsWith("/") && !value.startsWith("//");
    if (!isHttp && !isRootRelative) {
      continue;
    }
    const pathPart = value.split(/[?#]/, 1)[0] ?? value;
    const looksHtml =
      /\.html?$/i.test(pathPart) ||
      (params.mimeType ?? "").toLowerCase().includes("text/html") ||
      /\.html?$/i.test(params.title ?? "") ||
      /\.html?$/i.test(params.workspaceFilename ?? "");
    if (looksHtml) {
      return value;
    }
  }
  return null;
}

/** Record a confirmed workspace-file miss so chat chips stop pretending the file is openable. */
export function noteArtifactPreviewMiss(
  host: StewardArtifactSidebarHost,
  artifactId: string | null | undefined,
): void {
  const id = typeof artifactId === "string" ? artifactId.trim() : "";
  if (!id) {
    return;
  }
  const prev = Array.isArray(host.artifactPreviewMissIds) ? host.artifactPreviewMissIds : [];
  if (prev.includes(id)) {
    return;
  }
  host.artifactPreviewMissIds = [...prev, id];
}

/**
 * Drop a miss once bytes load (or a published HTML URL preview succeeds).
 * Miss chips stay honest after a failure, but a later write + retry must clear the sticky id.
 */
export function clearArtifactPreviewMiss(
  host: StewardArtifactSidebarHost,
  artifactId: string | null | undefined,
): void {
  const id = typeof artifactId === "string" ? artifactId.trim() : "";
  if (!id) {
    return;
  }
  const prev = Array.isArray(host.artifactPreviewMissIds) ? host.artifactPreviewMissIds : [];
  if (!prev.includes(id)) {
    return;
  }
  host.artifactPreviewMissIds = prev.filter((entry) => entry !== id);
}

export function isArtifactPreviewMiss(
  missIds: readonly string[] | null | undefined,
  artifactId: string,
): boolean {
  const id = artifactId.trim();
  if (!id || !missIds?.length) {
    return false;
  }
  return missIds.includes(id);
}

/**
 * Keep the artifact preview chrome when a workspace file cannot be loaded.
 * Never switch to markdown "工具输出" — that is a different sidebar mode for tool cards.
 */
export function applyUnavailableFilePreview(params: {
  host: StewardArtifactSidebarHost;
  workspace: ArtifactWorkspaceSidebar;
  message: string;
}): void {
  const { host, workspace, message } = params;
  const notice = message.trim();
  // Honest chip state: a miss (including after stale-snapshot stopped billing before a durable
  // write) must not leave 「打开成果」 looking openable for a file that was never written.
  noteArtifactPreviewMiss(host, workspace.artifact.artifactId);
  showArtifactPreviewMode(host);
  host.sidebarArtifactWorkspace = {
    ...workspace,
    artifact: {
      ...workspace.artifact,
      sourceMessage: notice,
      providerMetadata: {
        ...workspace.artifact.providerMetadata,
        previewKind: "file",
        previewLoading: false,
        previewUnavailable: true,
        workspaceFileLoaded: false,
        previewText: notice,
      },
    },
  };
  host.sidebarContent = null;
  host.sidebarError = null;
  host.sidebarOpen = true;
}

/** Apply a published / browsable HTML URL into the artifact sidebar (iframe lane). */
export function applyPublishedHtmlUrlPreview(params: {
  host: StewardArtifactSidebarHost;
  workspace: ArtifactWorkspaceSidebar;
  htmlUrl: string;
}): "html" {
  const { host, workspace, htmlUrl } = params;
  const trimmed = htmlUrl.trim();
  clearArtifactPreviewMiss(host, workspace.artifact.artifactId);
  showArtifactPreviewMode(host);
  host.sidebarArtifactWorkspace = {
    ...workspace,
    artifact: {
      ...workspace.artifact,
      mimeType: workspace.artifact.mimeType || "text/html",
      openUrl: trimmed,
      previewUrl: trimmed,
      providerMetadata: {
        ...workspace.artifact.providerMetadata,
        previewKind: "html",
        htmlPreviewUrl: trimmed,
        publishedUrlPreview: true,
        // Mark loaded so openers treat this as a successful preview (not a miss).
        workspaceFileLoaded: true,
      },
    },
  };
  host.sidebarContent = null;
  host.sidebarError = null;
  host.sidebarOpen = true;
  return "html";
}

function createHtmlPreviewBlobUrl(html: string): string | null {
  if (typeof URL === "undefined" || typeof Blob === "undefined") {
    return null;
  }
  try {
    return URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  } catch {
    return null;
  }
}

/** Chrome blocks `data:application/pdf` inside iframes. Only blob:/http(s) can inline-preview. */
const INLINE_PDF_PREVIEW_RE = /^(?:blob:|https?:\/\/)/i;

export function resolveInlinePdfPreviewUrl(input: {
  pdfPreviewUrl?: string | null;
  previewUrl?: string | null;
  openUrl?: string | null;
}): string {
  for (const raw of [input.pdfPreviewUrl, input.previewUrl, input.openUrl]) {
    const url = typeof raw === "string" ? raw.trim() : "";
    if (url && INLINE_PDF_PREVIEW_RE.test(url)) {
      return url;
    }
  }
  return "";
}

/** Decode base64 file bytes into a blob: URL (preferred over giant data: URLs for PDF/PPT). */
export function createBlobUrlFromBase64(base64: string, mimeType: string): string | null {
  if (
    typeof URL === "undefined" ||
    typeof Blob === "undefined" ||
    typeof atob === "undefined" ||
    !base64
  ) {
    return null;
  }
  try {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return URL.createObjectURL(new Blob([bytes], { type: mimeType || "application/octet-stream" }));
  } catch {
    return null;
  }
}

function applyHtmlPreviewLane(params: {
  host: StewardArtifactSidebarHost;
  workspace: ArtifactWorkspaceSidebar;
  html: string;
  mimeType?: string;
  baseMeta: Record<string, unknown>;
}): "html" {
  const { host, workspace, html, mimeType, baseMeta } = params;
  // Full pages (agent-authored .html reports) keep their CSS/layout in a sandboxed iframe.
  // Prefer blob: URLs (allowed by Control UI CSP frame-src) over srcdoc — Chrome blocks
  // about:srcdoc when frame-src falls back to default-src 'self'.
  // Mammoth/docx fragments stay on the inline sanitized-HTML path.
  const useIframe = isFullHtmlDocument(html);
  const htmlPreviewUrl = useIframe ? createHtmlPreviewBlobUrl(html) : null;
  // The renderer produces a view; download must retain the original Office package bytes.
  const originalBytes = typeof baseMeta.fileBase64 === "string" ? baseMeta.fileBase64 : "";
  const originalDownloadUrl = originalBytes
    ? createBlobUrlFromBase64(
        originalBytes,
        mimeType || workspace.artifact.mimeType || "application/octet-stream",
      )
    : null;

  // Preserve specialized kinds (e.g. canvas graph) when the HTML lane is used as a renderer.
  const inheritedKind = typeof baseMeta.previewKind === "string" ? baseMeta.previewKind.trim() : "";
  const previewKind = inheritedKind === "canvas" ? "canvas" : "html";
  showArtifactPreviewMode(host);
  host.sidebarArtifactWorkspace = {
    ...workspace,
    artifact: {
      ...workspace.artifact,
      mimeType: mimeType || "text/html",
      ...(htmlPreviewUrl ? { previewUrl: htmlPreviewUrl, openUrl: htmlPreviewUrl } : {}),
      downloadUrl: originalDownloadUrl || undefined,
      providerMetadata: {
        ...baseMeta,
        previewKind,
        downloadedBinary: false,
        binaryDownloadUrl: originalDownloadUrl || undefined,
        ...(useIframe
          ? {
              ...(htmlPreviewUrl ? { htmlPreviewUrl } : {}),
              // Keep source for reopen / non-browser test environments.
              htmlSrcdoc: html,
            }
          : { renderedHtml: html }),
      },
    },
  };
  host.sidebarContent = null;
  host.sidebarError = null;
  host.sidebarOpen = true;
  return "html";
}

/**
 * Shared preview lanes for chat deliverables and knowledge-universe document preview.
 *
 * Previewable: .docx/.pptx/.xlsx (server HTML), .html/.htm, .pdf, images
 * (png/jpg/jpeg/webp/gif/svg/bmp), text (md/txt/csv/json/yaml/xml/log), .canvas graphs.
 * Not inline-previewable: legacy .doc/.ppt/.xls and other binaries — download only.
 */
export type ClassifiedWorkspaceFilePreview =
  | { lane: "html"; html: string; mimeType: string; base64?: string }
  | { lane: "canvas"; html: string; mimeType: string; source: string }
  | { lane: "pdf"; base64: string; mimeType: "application/pdf" }
  | { lane: "pdf-rejected" }
  | { lane: "image"; base64: string; mimeType: string }
  | { lane: "text"; text: string; mimeType: string }
  | { lane: "binary"; base64: string; mimeType: string }
  | { lane: "empty" };

export function classifyWorkspaceFilePreview(
  file: WorkspaceFilePreviewPayload,
  filename = file.filename,
): ClassifiedWorkspaceFilePreview {
  const displayName = (file.filename || filename || "").trim() || "document.bin";
  if (file.renderKind === "html" && file.html) {
    return {
      lane: "html",
      html: file.html,
      mimeType: file.mimeType || "text/html",
      ...(typeof file.base64 === "string" && file.base64.trim()
        ? { base64: file.base64.replace(/\s+/g, "") }
        : {}),
    };
  }
  if (typeof file.base64 === "string" && isGroupHtmlPreviewFilename(displayName, file.mimeType)) {
    return {
      lane: "html",
      html: decodeGroupFileText(file.base64),
      mimeType: file.mimeType || "text/html",
      base64: file.base64.replace(/\s+/g, ""),
    };
  }
  if (typeof file.base64 === "string" && isCanvasGraphFilename(displayName, file.mimeType)) {
    const raw = decodeGroupFileText(file.base64);
    const canvasHtml = buildCanvasGraphPreviewHtml(raw, displayName);
    if (canvasHtml) {
      return { lane: "canvas", html: canvasHtml, mimeType: "text/html", source: raw };
    }
  }
  if (typeof file.base64 === "string" && isGroupPdfPreviewFilename(displayName, file.mimeType)) {
    if (!pdfBase64LooksParseable(file.base64)) {
      return { lane: "pdf-rejected" };
    }
    return { lane: "pdf", base64: file.base64, mimeType: "application/pdf" };
  }
  if (typeof file.base64 === "string" && isGroupImagePreviewFilename(displayName, file.mimeType)) {
    return {
      lane: "image",
      base64: file.base64,
      mimeType: resolveImagePreviewMimeType(displayName, file.mimeType),
    };
  }
  if (
    (file.textLike || isTextLikePreviewFilename(displayName, file.mimeType)) &&
    typeof file.base64 === "string"
  ) {
    return {
      lane: "text",
      text: decodeGroupFileText(file.base64),
      mimeType: file.mimeType || "text/plain",
    };
  }
  if (typeof file.base64 === "string") {
    return {
      lane: "binary",
      base64: file.base64,
      mimeType: file.mimeType || "application/octet-stream",
    };
  }
  return { lane: "empty" };
}

/** Apply a fetched workspace file into the sidebar host. Returns which preview lane was used. */
export function applyWorkspaceFilePreview(params: {
  host: StewardArtifactSidebarHost;
  workspace: ArtifactWorkspaceSidebar;
  file: WorkspaceFilePreviewPayload;
  filename: string;
  extraMetadata?: Record<string, unknown>;
}): ApplyWorkspaceFilePreviewResult {
  const { host, workspace, file, filename, extraMetadata } = params;
  clearArtifactPreviewMiss(host, workspace.artifact.artifactId);
  const relativePath = file.relativePath || filename.trim();
  const displayName =
    file.filename || relativePath.split("/").filter(Boolean).at(-1) || relativePath;
  const classified = classifyWorkspaceFilePreview(file, displayName);
  const retainedBytes =
    typeof file.base64 === "string" && file.base64.trim()
      ? { fileBase64: file.base64.replace(/\s+/g, "") }
      : classified.lane === "html" && classified.base64
        ? { fileBase64: classified.base64 }
        : { fileBase64: undefined };
  const officeSlides = parseOfficeSlidesInput(file.officeSlides);
  const slideDraft = officeSlides ? formatOfficeSlideDraft(officeSlides) : "";
  const baseMeta = {
    ...workspace.artifact.providerMetadata,
    workspaceFilename: relativePath,
    workspaceFileLoaded: true,
    contentHash: file.contentHash,
    dataUrl: undefined,
    binaryDownloadUrl: undefined,
    htmlPreviewUrl: undefined,
    htmlSrcdoc: undefined,
    renderedHtml: undefined,
    ...retainedBytes,
    ...(officeSlides ? { officeSlides, previewText: slideDraft } : {}),
    ...extraMetadata,
  };

  if (classified.lane === "html") {
    return applyHtmlPreviewLane({
      host,
      workspace,
      html: classified.html,
      mimeType: classified.mimeType || workspace.artifact.mimeType,
      baseMeta,
    });
  }

  if (classified.lane === "canvas") {
    applyHtmlPreviewLane({
      host,
      workspace,
      html: classified.html,
      mimeType: "text/html",
      baseMeta: {
        ...baseMeta,
        previewKind: "canvas",
        canvasGraphSource: classified.source,
      },
    });
    return "canvas";
  }

  if (classified.lane === "pdf-rejected") {
    applyUnavailableFilePreview({
      host,
      workspace,
      message: t("chat.deliverablePdfUnparsed"),
    });
    if (host.sidebarArtifactWorkspace) {
      host.sidebarArtifactWorkspace = {
        ...host.sidebarArtifactWorkspace,
        artifact: {
          ...host.sidebarArtifactWorkspace.artifact,
          providerMetadata: {
            ...host.sidebarArtifactWorkspace.artifact.providerMetadata,
            previewKind: "pdf-unparsed",
            pdfParseFailed: true,
            previewUnavailable: true,
          },
        },
      };
    }
    return "empty";
  }

  if (classified.lane === "pdf") {
    // Prefer blob: — multi‑MB data: URLs often fail to render in Chrome iframes even when CSP
    // allows data:. Keep a data: fallback for environments without Blob/URL.
    const blobUrl = createBlobUrlFromBase64(classified.base64, "application/pdf");
    const dataUrl = `data:application/pdf;base64,${classified.base64}`;
    const previewUrl = blobUrl || dataUrl;
    showArtifactPreviewMode(host);
    host.sidebarArtifactWorkspace = {
      ...workspace,
      artifact: {
        ...workspace.artifact,
        mimeType: "application/pdf",
        previewUrl,
        openUrl: previewUrl,
        downloadUrl: previewUrl,
        providerMetadata: {
          ...baseMeta,
          previewKind: "pdf",
          fileBase64: classified.base64,
          ...(blobUrl ? { pdfPreviewUrl: blobUrl } : {}),
          dataUrl,
        },
      },
    };
    host.sidebarContent = null;
    host.sidebarError = null;
    host.sidebarOpen = true;
    return "pdf";
  }

  if (classified.lane === "image") {
    const mimeType = classified.mimeType;
    const blobUrl = createBlobUrlFromBase64(classified.base64, mimeType);
    const dataUrl = `data:${mimeType};base64,${classified.base64}`;
    const previewUrl = blobUrl || dataUrl;
    showArtifactPreviewMode(host);
    host.sidebarArtifactWorkspace = {
      ...workspace,
      artifact: {
        ...workspace.artifact,
        artifactType: "image",
        mimeType,
        previewUrl,
        openUrl: previewUrl,
        downloadUrl: previewUrl,
        providerMetadata: {
          ...baseMeta,
          previewKind: "image",
          fileBase64: classified.base64,
          ...(blobUrl ? { imagePreviewUrl: blobUrl } : {}),
          dataUrl,
        },
      },
    };
    host.sidebarContent = null;
    host.sidebarError = null;
    host.sidebarOpen = true;
    return "image";
  }

  if (classified.lane === "text") {
    showArtifactPreviewMode(host);
    host.sidebarArtifactWorkspace = {
      ...workspace,
      artifact: {
        ...workspace.artifact,
        mimeType: classified.mimeType || workspace.artifact.mimeType,
        sourceMessage: classified.text,
        providerMetadata: {
          ...baseMeta,
          previewText: classified.text,
          previewKind: "text",
        },
      },
    };
    host.sidebarContent = classified.text;
    host.sidebarError = null;
    host.sidebarOpen = true;
    return "text";
  }

  if (classified.lane === "binary") {
    const mimeType =
      classified.mimeType || workspace.artifact.mimeType || "application/octet-stream";
    const binaryDownloadUrl = createBlobUrlFromBase64(classified.base64, mimeType);
    const notice = t("chat.artifactPreviewNoInlineHint");
    showArtifactPreviewMode(host);
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
          ...baseMeta,
          previewKind: "binary",
          fileBase64: classified.base64,
          previewText: notice,
          downloadedBinary: true,
          ...(binaryDownloadUrl ? { binaryDownloadUrl } : {}),
        },
      },
    };
    host.sidebarContent = null;
    host.sidebarError = null;
    host.sidebarOpen = true;
    return "binary";
  }
  return "empty";
}
