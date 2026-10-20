import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { hideArtifactActionTip, revealArtifactActionTip } from "./artifact-sidebar.ts";

export type MarkdownSidebarProps = {
  content: string | null;
  error: string | null;
  bodyContent?: TemplateResult | null;
  headerActions?: TemplateResult | null;
  leading?: TemplateResult | null;
  activeSurface?: "artifact" | "computer";
  computerBody?: TemplateResult | null;
  computerHeaderActions?: TemplateResult | null;
  /** Text title. `null` omits the default title so a slot can replace it. */
  title?: string | null;
  /** Replaces the text title. Used for the computer operator mark. */
  titleContent?: TemplateResult | null;
  /** Accessible name for the close control. Defaults to the sidebar close label. */
  closeLabel?: string;
  /**
   * Drop the chrome row. Fullscreen cloud computer exits from the stage
   * header so the desktop can use the height this row used to reserve.
   */
  omitHeader?: boolean;
  onClose: () => void;
  onViewRawText: () => void;
};

export function renderMarkdownSidebar(props: MarkdownSidebarProps) {
  const resolvedTitle =
    props.title === null
      ? null
      : (props.title ??
        (props.bodyContent ? t("chat.artifactPreviewTitle") : t("markdownSidebar.title")));
  const titleNode = props.titleContent
    ? props.titleContent
    : resolvedTitle
      ? html`<div class="sidebar-title">${resolvedTitle}</div>`
      : nothing;
  const computerSurface = props.activeSurface === "computer";
  const closeLabel = props.closeLabel ?? t("markdownSidebar.close");
  const artifactInner = props.error
    ? html`
      <div class="callout danger">${props.error}</div>
      <button @click=${props.onViewRawText} class="btn" style="margin-top: 12px;">
        ${t("markdownSidebar.viewRawText")}
      </button>
    `
    : props.bodyContent
      ? props.bodyContent
      : props.content
        ? html`<div class="sidebar-markdown">${unsafeHTML(toSanitizedMarkdownHtml(props.content))}</div>`
        : html`<div class="muted">${t("markdownSidebar.empty")}</div>`;
  const header = props.omitHeader
    ? nothing
    : html`
      <div class=${resolvedTitle || props.titleContent || props.leading ? "sidebar-header" : "sidebar-header sidebar-header--actions-only"}>
        ${props.leading ?? nothing}
        ${titleNode}
        <div class="sidebar-header__actions">
          ${
            computerSurface
              ? props.computerHeaderActions
                ? html`<div class="computer-chrome-actions">${props.computerHeaderActions}</div>`
                : nothing
              : (props.headerActions ?? null)
          }
          <button
            @pointerenter=${revealArtifactActionTip}
            @pointerleave=${hideArtifactActionTip}
            @click=${props.onClose}
            class="btn artifact-preview-action artifact-preview-action--icon sidebar-header__close"
            aria-label=${closeLabel}
          >
            ${icons.x}
            <span class="artifact-preview-action__label">${closeLabel}</span>
          </button>
        </div>
      </div>
    `;
  return html`
    <div class="sidebar-panel">
      ${header}
      <div class="sidebar-content">
        ${
          props.computerBody
            ? html`
              <div class="sidebar-body sidebar-body--artifact" ?hidden=${computerSurface}>
                ${artifactInner}
              </div>
              <div class="sidebar-body sidebar-body--computer" ?hidden=${!computerSurface}>
                ${props.computerBody}
              </div>
            `
            : artifactInner
        }
      </div>
    </div>
  `;
}
