import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { PERSONAL_DOCUMENT_ACCEPT } from "../capability/knowledge-universe/personal-document-upload.ts";
import type {
  KnowledgeObject,
  PersonalKnowledgeVersionDiff,
  PersonalKnowledgeVersionSummary,
} from "../capability/knowledge-universe/types.ts";
import type { KnowledgeUniversePersonalDrawerMode } from "../ports/employee/views/home-page-contracts.ts";
import {
  renderNoteImportForm,
  type NoteImportFormProps,
} from "./knowledge-universe-space-import-note.ts";

export type PersonalKnowledgePanelProps = {
  objects: KnowledgeObject[];
  collectTitle: string;
  collectSummary: string;
  collectTags: string;
  collectUrl: string;
  datasetText: string;
  uploadFileName: string | null;
  busy: boolean;
  notice: string | null;
  error: string | null;
  manageObjectId: string | null;
  manageObjectTitle: string | null;
  manageTags: string;
  manageBusy: boolean;
  manageNotice: string | null;
  versions: PersonalKnowledgeVersionSummary[];
  versionCompareFrom: string;
  versionCompareTo: string;
  versionDiff: PersonalKnowledgeVersionDiff | null;
  onCollectDraftChange: (
    field: "title" | "summary" | "tags" | "url" | "dataset",
    value: string,
  ) => void;
  onCollect: () => void | Promise<void>;
  onPickUploadFile: (file: File) => void | Promise<void>;
  onUpload: () => void | Promise<void>;
  onUploadFolder?: (files: File[]) => void | Promise<void>;
  onCollectWeb?: () => void | Promise<void>;
  onImportDataset?: () => void | Promise<void>;
  onOpenMyAccumulation: () => void;
  onSelectObject: (objectId: string) => void | Promise<void>;
  onManageObject: (objectId: string, title: string, tags: string[]) => void | Promise<void>;
  onManageTagsChange: (value: string) => void;
  onSaveTags: () => void | Promise<void>;
  onVersionCompareFromChange: (value: string) => void;
  onVersionCompareToChange: (value: string) => void;
  onCompareVersions: () => void | Promise<void>;
  libraryWorkspaceNoteTags: string[];
  libraryWorkspaceNoteTagDraft: string;
  libraryWorkspaceNoteTagSuggestionsOpen: boolean;
  libraryWorkspaceNoteTagHistory: string[];
  libraryWorkspaceNoteAiBusy: boolean;
  onGenerateNoteMetadataFromContent?: () => Promise<void>;
  onLibraryWorkspaceNoteTagDraftChange?: (value: string) => void;
  onLibraryWorkspaceNoteTagSuggestionsOpenChange?: (open: boolean) => void;
  onAddLibraryWorkspaceNoteTag?: (tag: string) => void;
  onRemoveLibraryWorkspaceNoteTag?: (tag: string) => void;
  onCommitLibraryWorkspaceNoteTagDraft?: () => void;
  onImportNoteToSpace?: () => Promise<void>;
};

function formatDiffValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (value == null) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value as string | number | boolean | bigint | symbol);
}

function renderFolderUploadPicker(props: PersonalKnowledgePanelProps) {
  const onUploadFolder = props.onUploadFolder;
  if (!onUploadFolder) {
    return nothing;
  }
  return html`
    <label class="knowledge-universe__field">
      <span>${t("frontstage.workbench.knowledgeUniverse.personal.uploadFolderLabel")}</span>
      <input
        id="ku-personal-upload-folder"
        type="file"
        webkitdirectory
        multiple
        accept=${PERSONAL_DOCUMENT_ACCEPT}
        ?disabled=${props.busy}
        @change=${(event: Event) => {
          const input = event.target as HTMLInputElement;
          const files = input.files ? Array.from(input.files) : [];
          if (files.length > 0) {
            void onUploadFolder(files);
          }
          input.value = "";
        }}
      />
    </label>
    <p class="knowledge-universe__empty-copy">
      ${t("frontstage.workbench.knowledgeUniverse.personal.uploadFolderHint")}
    </p>
  `;
}

function renderPersonalUploadForm(props: PersonalKnowledgePanelProps) {
  return html`
    <div class="knowledge-universe__personal-form knowledge-universe__personal-form--upload">
      <p class="knowledge-universe__empty-copy">
        ${t("frontstage.workbench.knowledgeUniverse.personal.uploadDrawerHint")}
      </p>
      <div class="knowledge-universe__personal-upload">
        <label class="knowledge-universe__field">
          <span>${t("frontstage.workbench.knowledgeUniverse.personal.uploadFileLabel")}</span>
          <input
            id="ku-personal-upload-file"
            type="file"
            accept=${PERSONAL_DOCUMENT_ACCEPT}
            ?disabled=${props.busy}
            @change=${(event: Event) => {
              const input = event.target as HTMLInputElement;
              const file = input.files?.[0];
              if (file) {
                void props.onPickUploadFile(file);
              }
              input.value = "";
            }}
          />
        </label>
        ${
          props.uploadFileName
            ? html`
                <div class="knowledge-universe__personal-upload-selected">
                  ${t("frontstage.workbench.knowledgeUniverse.personal.uploadSelected", {
                    fileName: props.uploadFileName,
                  })}
                </div>
              `
            : html`
                <p class="knowledge-universe__empty-copy">
                  ${t("frontstage.workbench.knowledgeUniverse.personal.uploadHint")}
                </p>
              `
        }
        ${renderFolderUploadPicker(props)}
      </div>
      <div class="knowledge-universe__personal-actions">
        <button
          type="button"
          class="btn btn--sm btn--primary"
          ?disabled=${props.busy || !props.uploadFileName}
          @click=${() => void props.onUpload()}
        >
          ${
            props.busy
              ? t("frontstage.workbench.knowledgeUniverse.personal.uploading")
              : t("frontstage.workbench.knowledgeUniverse.personal.uploadAction")
          }
        </button>
      </div>
    </div>
  `;
}

function buildPersonalNoteImportProps(props: PersonalKnowledgePanelProps): NoteImportFormProps {
  return {
    personalCollectTitle: props.collectTitle,
    personalCollectSummary: props.collectSummary,
    personalActionBusy: props.busy,
    libraryWorkspaceNoteTags: props.libraryWorkspaceNoteTags,
    libraryWorkspaceNoteTagDraft: props.libraryWorkspaceNoteTagDraft,
    libraryWorkspaceNoteTagSuggestionsOpen: props.libraryWorkspaceNoteTagSuggestionsOpen,
    libraryWorkspaceNoteTagHistory: props.libraryWorkspaceNoteTagHistory,
    libraryWorkspaceNoteAiBusy: props.libraryWorkspaceNoteAiBusy,
    onPersonalCollectDraftChange: (field, value) => props.onCollectDraftChange(field, value),
    onGenerateNoteMetadataFromContent: props.onGenerateNoteMetadataFromContent,
    onLibraryWorkspaceNoteTagDraftChange: props.onLibraryWorkspaceNoteTagDraftChange,
    onLibraryWorkspaceNoteTagSuggestionsOpenChange:
      props.onLibraryWorkspaceNoteTagSuggestionsOpenChange,
    onAddLibraryWorkspaceNoteTag: props.onAddLibraryWorkspaceNoteTag,
    onRemoveLibraryWorkspaceNoteTag: props.onRemoveLibraryWorkspaceNoteTag,
    onCommitLibraryWorkspaceNoteTagDraft: props.onCommitLibraryWorkspaceNoteTagDraft,
    onImportNoteToSpace: props.onImportNoteToSpace,
    submitActionKey: "personalSubmitAction",
    submitBusyKey: "personalSubmitBusy",
  };
}

function renderPersonalCollectForm(props: PersonalKnowledgePanelProps) {
  return html`
    <div class="knowledge-universe__personal-form">
      ${renderNoteImportForm(buildPersonalNoteImportProps(props))}
      ${
        props.onCollectWeb
          ? html`
              <label class="knowledge-universe__field">
                <span>${t("frontstage.workbench.knowledgeUniverse.personal.webUrlLabel")}</span>
                <input
                  type="url"
                  inputmode="url"
                  .value=${props.collectUrl}
                  placeholder=${t(
                    "frontstage.workbench.knowledgeUniverse.personal.webUrlPlaceholder",
                  )}
                  ?disabled=${props.busy}
                  @input=${(event: Event) =>
                    props.onCollectDraftChange("url", (event.target as HTMLInputElement).value)}
                />
              </label>
              <div class="knowledge-universe__personal-actions">
                <button
                  type="button"
                  class="btn btn--sm btn--ghost"
                  ?disabled=${props.busy || !props.collectUrl.trim()}
                  @click=${() => void props.onCollectWeb?.()}
                >
                  ${
                    props.busy
                      ? t("frontstage.workbench.knowledgeUniverse.personal.webCollecting")
                      : t("frontstage.workbench.knowledgeUniverse.personal.webCollectAction")
                  }
                </button>
              </div>
            `
          : nothing
      }
      ${
        props.onImportDataset
          ? html`
              <label class="knowledge-universe__field">
                <span>${t("frontstage.workbench.knowledgeUniverse.personal.datasetLabel")}</span>
                <textarea
                  rows="3"
                  .value=${props.datasetText}
                  placeholder=${t(
                    "frontstage.workbench.knowledgeUniverse.personal.datasetPlaceholder",
                  )}
                  ?disabled=${props.busy}
                  @input=${(event: Event) =>
                    props.onCollectDraftChange(
                      "dataset",
                      (event.target as HTMLTextAreaElement).value,
                    )}
                ></textarea>
              </label>
              <div class="knowledge-universe__personal-actions">
                <button
                  type="button"
                  class="btn btn--sm btn--ghost"
                  ?disabled=${props.busy || !props.datasetText.trim()}
                  @click=${() => void props.onImportDataset?.()}
                >
                  ${
                    props.busy
                      ? t("frontstage.workbench.knowledgeUniverse.personal.datasetImporting")
                      : t("frontstage.workbench.knowledgeUniverse.personal.datasetImportAction")
                  }
                </button>
              </div>
            `
          : nothing
      }
      <div class="knowledge-universe__personal-upload">
        <label class="knowledge-universe__field">
          <span>${t("frontstage.workbench.knowledgeUniverse.personal.uploadFileLabel")}</span>
          <input
            id="ku-personal-upload-file"
            type="file"
            accept=${PERSONAL_DOCUMENT_ACCEPT}
            ?disabled=${props.busy}
            @change=${(event: Event) => {
              const input = event.target as HTMLInputElement;
              const file = input.files?.[0];
              if (file) {
                void props.onPickUploadFile(file);
              }
              input.value = "";
            }}
          />
        </label>
        ${
          props.uploadFileName
            ? html`
                <div class="knowledge-universe__personal-upload-selected">
                  ${t("frontstage.workbench.knowledgeUniverse.personal.uploadSelected", {
                    fileName: props.uploadFileName,
                  })}
                </div>
              `
            : html`
                <p class="knowledge-universe__empty-copy">
                  ${t("frontstage.workbench.knowledgeUniverse.personal.uploadHint")}
                </p>
              `
        }
        ${renderFolderUploadPicker(props)}
      </div>
      <div class="knowledge-universe__personal-actions">
        <button
          type="button"
          class="btn btn--sm btn--ghost"
          ?disabled=${props.busy || !props.uploadFileName}
          @click=${() => void props.onUpload()}
        >
          ${t("frontstage.workbench.knowledgeUniverse.personal.uploadAction")}
        </button>
        <button
          type="button"
          class="btn btn--sm btn--ghost"
          @click=${() => props.onOpenMyAccumulation()}
        >
          ${t("frontstage.workbench.knowledgeUniverse.personal.openAccumulation")}
        </button>
      </div>
    </div>

    ${
      props.notice
        ? html`<div class="knowledge-universe__notice" role="status">${props.notice}</div>`
        : nothing
    }
    ${
      props.error
        ? html`<div class="knowledge-universe__error" role="alert">${props.error}</div>`
        : nothing
    }
  `;
}

function renderPersonalManageSection(props: PersonalKnowledgePanelProps) {
  if (!props.manageObjectId) {
    return nothing;
  }
  return html`
    <div class="knowledge-universe__personal-manage">
      <div class="knowledge-universe__data-space-group-title">
        ${t("frontstage.workbench.knowledgeUniverse.personal.manageHeading", {
          title: props.manageObjectTitle ?? "",
        })}
      </div>
      <label class="knowledge-universe__field">
        <span>${t("frontstage.workbench.knowledgeUniverse.personal.manageTagsLabel")}</span>
        <input
          type="text"
          .value=${props.manageTags}
          ?disabled=${props.manageBusy}
          @input=${(event: Event) =>
            props.onManageTagsChange((event.target as HTMLInputElement).value)}
        />
      </label>
      <button
        type="button"
        class="btn btn--sm"
        ?disabled=${props.manageBusy}
        @click=${() => void props.onSaveTags()}
      >
        ${t("frontstage.workbench.knowledgeUniverse.personal.saveTagsAction")}
      </button>
      ${
        props.manageNotice
          ? html`<div class="knowledge-universe__notice" role="status">${props.manageNotice}</div>`
          : nothing
      }
      ${
        props.versions.length
          ? html`
              <div class="knowledge-universe__personal-versions">
                <div class="knowledge-universe__data-space-group-title">
                  ${t("frontstage.workbench.knowledgeUniverse.personal.versionsHeading")}
                </div>
                <ul class="knowledge-universe__version-list">
                  ${props.versions.map(
                    (version) => html`
                      <li>
                        <span class="knowledge-universe__version-label">${version.version}</span>
                        <span class="knowledge-universe__version-summary">${version.summary}</span>
                      </li>
                    `,
                  )}
                </ul>
                <div class="knowledge-universe__version-compare">
                  <label class="knowledge-universe__field">
                    <span>${t("frontstage.workbench.knowledgeUniverse.personal.compareFrom")}</span>
                    <select
                      .value=${props.versionCompareFrom}
                      ?disabled=${props.manageBusy}
                      @change=${(event: Event) =>
                        props.onVersionCompareFromChange((event.target as HTMLSelectElement).value)}
                    >
                      ${props.versions.map(
                        (version) => html`
                          <option value=${version.version}>${version.version}</option>
                        `,
                      )}
                    </select>
                  </label>
                  <label class="knowledge-universe__field">
                    <span>${t("frontstage.workbench.knowledgeUniverse.personal.compareTo")}</span>
                    <select
                      .value=${props.versionCompareTo}
                      ?disabled=${props.manageBusy}
                      @change=${(event: Event) =>
                        props.onVersionCompareToChange((event.target as HTMLSelectElement).value)}
                    >
                      ${props.versions.map(
                        (version) => html`
                          <option value=${version.version}>${version.version}</option>
                        `,
                      )}
                    </select>
                  </label>
                  <button
                    type="button"
                    class="btn btn--sm btn--ghost"
                    ?disabled=${props.manageBusy}
                    @click=${() => void props.onCompareVersions()}
                  >
                    ${t("frontstage.workbench.knowledgeUniverse.personal.compareAction")}
                  </button>
                </div>
                ${
                  props.versionDiff?.changedFields.length
                    ? html`
                        <ul class="knowledge-universe__version-diff">
                          ${props.versionDiff.changedFields.map(
                            (entry) => html`
                              <li>
                                <strong>${entry.field}</strong>
                                <span>
                                  ${formatDiffValue(entry.before)} →
                                  ${formatDiffValue(entry.after)}
                                </span>
                              </li>
                            `,
                          )}
                        </ul>
                      `
                    : props.versionDiff
                      ? html`
                          <p class="knowledge-universe__empty-copy">
                            ${t("frontstage.workbench.knowledgeUniverse.personal.compareEmpty")}
                          </p>
                        `
                      : nothing
                }
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function renderPersonalObjectList(props: PersonalKnowledgePanelProps) {
  if (!props.objects.length) {
    return html`
      <p class="knowledge-universe__empty-copy">
        ${t("frontstage.workbench.knowledgeUniverse.personal.empty")}
      </p>
    `;
  }
  return html`
    <ul class="knowledge-universe__browse-list knowledge-universe__browse-list--flat">
      ${props.objects.map(
        (object) => html`
          <li>
            <div class="knowledge-universe__personal-object-row">
              <button
                type="button"
                class="knowledge-universe__browse-item"
                @click=${() => void props.onSelectObject(object.id)}
              >
                <span class="knowledge-universe__browse-item-title">${object.title}</span>
                <span class="knowledge-universe__browse-item-summary">${object.summary}</span>
                ${
                  object.tags.length
                    ? html`
                        <span class="knowledge-universe__browse-item-tags">
                          ${object.tags.join(" · ")}
                        </span>
                      `
                    : nothing
                }
              </button>
              <button
                type="button"
                class="btn btn--sm btn--ghost"
                @click=${() => void props.onManageObject(object.id, object.title, object.tags)}
              >
                ${t("frontstage.workbench.knowledgeUniverse.personal.manageAction")}
              </button>
            </div>
          </li>
        `,
      )}
    </ul>
  `;
}

export function renderKnowledgeUniversePersonalBrowsePanel(
  props: PersonalKnowledgePanelProps & { onOpenCollectDrawer: () => void },
) {
  return html`
    <section id="ku-personal" class="knowledge-universe__personal-panel">
      <div class="knowledge-universe__personal-browse-head">
        <div class="knowledge-universe__section-heading">
          ${t("frontstage.workbench.knowledgeUniverse.personal.heading")}
        </div>
        <button
          type="button"
          class="btn btn--sm knowledge-universe__personal-collect-cta"
          @click=${() => props.onOpenCollectDrawer()}
        >
          ${t("frontstage.workbench.knowledgeUniverse.personal.collectCta")}
        </button>
      </div>
      ${renderPersonalObjectList(props)}
    </section>
  `;
}

export function renderKnowledgeUniversePersonalDrawer(
  props: PersonalKnowledgePanelProps & {
    open: boolean;
    mode: KnowledgeUniversePersonalDrawerMode;
    onClose: () => void;
  },
) {
  if (!props.open) {
    return nothing;
  }
  const panelTitle =
    props.mode === "manage"
      ? t("frontstage.workbench.knowledgeUniverse.personal.manageDrawerTitle", {
          title: props.manageObjectTitle ?? "",
        })
      : props.mode === "upload"
        ? t("frontstage.workbench.knowledgeUniverse.personal.uploadDrawerTitle")
        : t("frontstage.workbench.knowledgeUniverse.personal.drawerTitle");
  const backLabel = t("frontstage.workbench.knowledgeUniverse.personal.backToList");

  return html`
    <section
      class="employee-workbench__creator-panel knowledge-universe__personal-inline-panel"
      role="region"
      aria-label=${panelTitle}
    >
      <header class="employee-workbench__creator-panel-head">
        <button type="button" class="employee-workbench__creator-panel-back" @click=${() => props.onClose()}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7"></path>
          </svg>
          ${backLabel}
        </button>
        <div class="employee-workbench__creator-panel-copy">
          <div class="employee-workbench__creator-panel-title">${panelTitle}</div>
        </div>
      </header>
      <div class="employee-workbench__creator-body">
        ${
          props.mode === "manage"
            ? renderPersonalManageSection(props)
            : props.mode === "upload"
              ? renderPersonalUploadForm(props)
              : renderPersonalCollectForm(props)
        }
      </div>
    </section>
  `;
}

/** @deprecated Use renderKnowledgeUniversePersonalDrawer */
export function renderKnowledgeUniversePersonalCollectDrawer(
  props: PersonalKnowledgePanelProps & { open: boolean; onClose: () => void },
) {
  return renderKnowledgeUniversePersonalDrawer({
    ...props,
    mode: "collect",
  });
}

/** @deprecated Use browse panel + collect drawer instead. */
export function renderKnowledgeUniversePersonalPanel(props: PersonalKnowledgePanelProps) {
  return html`
    <section id="ku-personal" class="knowledge-universe__personal-panel">
      <div class="knowledge-universe__section-heading">
        ${t("frontstage.workbench.knowledgeUniverse.personal.heading")}
      </div>
      ${renderPersonalCollectForm(props)}
      ${renderPersonalObjectList(props)}
      ${renderPersonalManageSection(props)}
    </section>
  `;
}
