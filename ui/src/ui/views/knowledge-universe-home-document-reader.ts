import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { KnowledgeDocumentPreviewResponse } from "../capability/knowledge-universe/workspace-endpoints.ts";
import { icons } from "../icons.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  classifyWorkspaceFilePreview,
  createBlobUrlFromBase64,
} from "../wiring/workspace-file-preview.ts";
import { hideArtifactActionTip, revealArtifactActionTip } from "./artifact-sidebar.ts";
import { resolveKnowledgeDocumentPreviewFrame } from "./knowledge-universe-document-preview-html.ts";

const DELETE_ICON = html`
  <svg viewBox="0 0 24 24">
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
`;

function previewDownloadHref(preview: KnowledgeDocumentPreviewResponse): string | null {
  if (!preview.base64) {
    return null;
  }
  return (
    createBlobUrlFromBase64(preview.base64, preview.mimeType || "application/octet-stream") ||
    `data:${preview.mimeType || "application/octet-stream"};base64,${preview.base64}`
  );
}

function renderActionButton(params: {
  testId: string;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  primary?: boolean;
  icon: ReturnType<typeof html>;
  onClick: () => void;
}) {
  return html`
    <button
      type="button"
      class="btn btn--sm artifact-preview-action artifact-preview-action--icon ${
        params.primary ? "is-primary" : ""
      } ${params.danger ? "ku-doc-reader__action--danger" : ""}"
      data-testid=${params.testId}
      aria-label=${params.label}
      ?disabled=${Boolean(params.disabled)}
      @pointerenter=${revealArtifactActionTip}
      @pointerleave=${hideArtifactActionTip}
      @click=${params.onClick}
    >
      ${params.icon}
      <span class="artifact-preview-action__label">${params.label}</span>
    </button>
  `;
}

export function renderKnowledgeUniverseHomeDocumentReader(surface: WorkbenchKnowledgeSurface) {
  const reader = surface.documentReader;
  const focus = surface.homeFocus;
  const canWrite = focus?.kind === "document" && surface.selectedKnowledgeBaseCanWrite;
  const preview = reader?.preview ?? null;
  const classified = preview ? classifyWorkspaceFilePreview(preview, preview.filename) : null;
  const canEditText = classified?.lane === "text" && canWrite;
  const indexedDoc =
    focus?.kind === "document"
      ? surface.libraryWorkspaceDocuments.find((item) => item.docId === focus.id)
      : undefined;
  const downloadHref = preview ? previewDownloadHref(preview) : null;

  if (focus?.kind !== "document" && focus?.kind !== "deliverable") {
    return html`
      <div class="ku-doc-reader" data-testid="ku-home-document-reader">
        <div class="ku-doc-reader__empty">
          ${t("frontstage.workbench.knowledgeUniverse.home.documentReader.emptyFocus")}
        </div>
      </div>
    `;
  }

  if (reader?.loading) {
    return html`
      <div class="ku-doc-reader" data-testid="ku-home-document-reader">
        <div class="ku-doc-reader__empty">
          ${t("frontstage.workbench.knowledgeUniverse.home.documentReader.loading")}
        </div>
      </div>
    `;
  }

  return html`
    <div class="ku-doc-reader" data-testid="ku-home-document-reader">
      <div class="ku-doc-reader__toolbar">
        <div class="ku-doc-reader__meta">
          ${
            indexedDoc?.indexed === false
              ? html`<span class="ku-doc-reader__badge" data-testid="ku-doc-reader-not-indexed">
                  ${t("frontstage.workbench.knowledgeUniverse.home.documentReader.notIndexed")}
                </span>`
              : nothing
          }
        </div>
        <div class="ku-doc-reader__actions artifact-preview-actions">
          ${
            canEditText && !reader?.editing
              ? renderActionButton({
                  testId: "ku-doc-reader-edit",
                  label: t("chat.editArtifact"),
                  disabled: Boolean(reader?.saving),
                  icon: icons.edit,
                  onClick: () => surface.onDocumentReaderEdit?.(),
                })
              : nothing
          }
          ${
            reader?.editing
              ? html`
                  ${renderActionButton({
                    testId: "ku-doc-reader-cancel",
                    label: t("frontstage.workbench.knowledgeUniverse.home.documentReader.cancel"),
                    disabled: Boolean(reader.saving),
                    icon: icons.x,
                    onClick: () => surface.onDocumentReaderCancel?.(),
                  })}
                  ${renderActionButton({
                    testId: "ku-doc-reader-save",
                    label: t("chat.saveDeliverable"),
                    disabled: Boolean(reader.saving) || !reader.dirty,
                    primary: true,
                    icon: icons.fileText,
                    onClick: () => void surface.onDocumentReaderSave?.(),
                  })}
                `
              : nothing
          }
          ${
            downloadHref
              ? html`<a
                  class="btn btn--sm artifact-preview-action artifact-preview-action--icon"
                  data-testid="ku-doc-reader-download"
                  href=${downloadHref}
                  download=${preview?.filename || "document"}
                  rel="noreferrer"
                  aria-label=${t("chat.artifactPreviewDownloadFile")}
                  @pointerenter=${revealArtifactActionTip}
                  @pointerleave=${hideArtifactActionTip}
                >
                  ${icons.download}
                  <span class="artifact-preview-action__label">${t("chat.downloadArtifact")}</span>
                </a>`
              : nothing
          }
          ${
            canWrite
              ? renderActionButton({
                  testId: "ku-doc-reader-delete",
                  label: t("frontstage.workbench.knowledgeUniverse.home.documentReader.delete"),
                  disabled: Boolean(reader?.saving),
                  danger: true,
                  icon: DELETE_ICON,
                  onClick: () => void surface.onDocumentReaderDelete?.(),
                })
              : nothing
          }
        </div>
      </div>
      ${
        reader?.error
          ? html`<p class="ku-doc-reader__error" data-testid="ku-doc-reader-error">${reader.error}</p>`
          : nothing
      }
      ${renderReaderBody(surface, preview, classified, reader?.editing === true, reader?.draftText ?? "")}
    </div>
  `;
}

function renderHtmlFrame(title: string, htmlSource: string, testId: string) {
  const frame = resolveKnowledgeDocumentPreviewFrame(htmlSource);
  if (frame.src) {
    return html`<iframe
      class="ku-doc-reader__frame"
      data-testid=${testId}
      title=${title}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
      src=${frame.src}
    ></iframe>`;
  }
  if (frame.srcdoc) {
    return html`<iframe
      class="ku-doc-reader__frame"
      data-testid=${testId}
      title=${title}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
      srcdoc=${frame.srcdoc}
    ></iframe>`;
  }
  return nothing;
}

function renderReaderBody(
  surface: WorkbenchKnowledgeSurface,
  preview: KnowledgeDocumentPreviewResponse | null,
  classified: ReturnType<typeof classifyWorkspaceFilePreview> | null,
  editing: boolean,
  draftText: string,
) {
  if (editing) {
    return html`
      <textarea
        class="ku-doc-reader__editor"
        data-testid="ku-doc-reader-editor"
        .value=${draftText}
        @input=${(event: Event) => {
          const target = event.target as HTMLTextAreaElement;
          surface.onDocumentReaderDraftChange?.(target.value);
        }}
      ></textarea>
    `;
  }
  if (!preview || !classified || classified.lane === "empty") {
    return html`
      <div class="ku-doc-reader__empty" data-testid="ku-doc-reader-empty">
        ${t("frontstage.workbench.knowledgeUniverse.home.documentReader.emptyBody")}
      </div>
    `;
  }
  if (classified.lane === "html" || classified.lane === "canvas") {
    return renderHtmlFrame(preview.filename, classified.html, "ku-doc-reader-html");
  }
  if (classified.lane === "text") {
    return html`<pre class="ku-doc-reader__text" data-testid="ku-doc-reader-text">${classified.text}</pre>`;
  }
  if (classified.lane === "image") {
    const src =
      createBlobUrlFromBase64(classified.base64, classified.mimeType) ||
      `data:${classified.mimeType};base64,${classified.base64}`;
    return html`<img
      class="ku-doc-reader__image"
      data-testid="ku-doc-reader-image"
      alt=${preview.filename}
      src=${src}
    />`;
  }
  if (classified.lane === "pdf") {
    const src =
      createBlobUrlFromBase64(classified.base64, "application/pdf") ||
      `data:application/pdf;base64,${classified.base64}`;
    return html`<iframe
      class="ku-doc-reader__pdf"
      data-testid="ku-doc-reader-pdf"
      title=${preview.filename}
      src=${src}
    ></iframe>`;
  }
  return html`
    <div class="ku-doc-reader__empty" data-testid="ku-doc-reader-binary">
      <strong>${t("chat.artifactPreviewNoInlineTitle")}</strong>
      <p>${t("chat.artifactPreviewNoInlineHint")}</p>
    </div>
  `;
}
