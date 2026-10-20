import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import { filterNoteTagSuggestions } from "./knowledge-universe-note-import.ts";

export type NoteImportFormProps = {
  personalCollectTitle: string;
  personalCollectSummary: string;
  personalActionBusy: boolean;
  libraryWorkspaceNoteTags: string[];
  libraryWorkspaceNoteTagDraft: string;
  libraryWorkspaceNoteTagSuggestionsOpen: boolean;
  libraryWorkspaceNoteTagHistory: string[];
  libraryWorkspaceNoteAiBusy: boolean;
  onPersonalCollectDraftChange: (field: "title" | "summary", value: string) => void;
  onGenerateNoteMetadataFromContent?: () => Promise<void>;
  onLibraryWorkspaceNoteTagDraftChange?: (value: string) => void;
  onLibraryWorkspaceNoteTagSuggestionsOpenChange?: (open: boolean) => void;
  onAddLibraryWorkspaceNoteTag?: (tag: string) => void;
  onRemoveLibraryWorkspaceNoteTag?: (tag: string) => void;
  onCommitLibraryWorkspaceNoteTagDraft?: () => void;
  onImportNoteToSpace?: () => Promise<void>;
  /** Personal panel reuses the same form with a different submit label. */
  submitActionKey?: "submitAction" | "personalSubmitAction";
  submitBusyKey?: "submitBusy" | "personalSubmitBusy";
};

function canSubmitNote(props: NoteImportFormProps): boolean {
  return !props.personalActionBusy && Boolean(props.personalCollectSummary?.trim());
}

export function noteImportFormPropsFromSurface(
  surface: WorkbenchKnowledgeSurface,
): NoteImportFormProps {
  return {
    personalCollectTitle: surface.personalCollectTitle,
    personalCollectSummary: surface.personalCollectSummary,
    personalActionBusy: surface.personalActionBusy,
    libraryWorkspaceNoteTags: surface.libraryWorkspaceNoteTags,
    libraryWorkspaceNoteTagDraft: surface.libraryWorkspaceNoteTagDraft,
    libraryWorkspaceNoteTagSuggestionsOpen: surface.libraryWorkspaceNoteTagSuggestionsOpen,
    libraryWorkspaceNoteTagHistory: surface.libraryWorkspaceNoteTagHistory,
    libraryWorkspaceNoteAiBusy: surface.libraryWorkspaceNoteAiBusy,
    onPersonalCollectDraftChange: (field, value) =>
      surface.onPersonalCollectDraftChange(field, value),
    onGenerateNoteMetadataFromContent: surface.onGenerateNoteMetadataFromContent,
    onLibraryWorkspaceNoteTagDraftChange: surface.onLibraryWorkspaceNoteTagDraftChange,
    onLibraryWorkspaceNoteTagSuggestionsOpenChange:
      surface.onLibraryWorkspaceNoteTagSuggestionsOpenChange,
    onAddLibraryWorkspaceNoteTag: surface.onAddLibraryWorkspaceNoteTag,
    onRemoveLibraryWorkspaceNoteTag: surface.onRemoveLibraryWorkspaceNoteTag,
    onCommitLibraryWorkspaceNoteTagDraft: surface.onCommitLibraryWorkspaceNoteTagDraft,
    onImportNoteToSpace: surface.onImportNoteToSpace,
  };
}

export function renderNoteImportForm(props: NoteImportFormProps) {
  const tagSuggestions = filterNoteTagSuggestions({
    history: props.libraryWorkspaceNoteTagHistory ?? [],
    selected: props.libraryWorkspaceNoteTags ?? [],
    query: props.libraryWorkspaceNoteTagDraft ?? "",
  });
  const submitActionKey = props.submitActionKey ?? "submitAction";
  const submitBusyKey = props.submitBusyKey ?? "submitBusy";

  return html`
    <div class="ku-space-import__form ku-space-import__channel" data-testid="ku-space-import-form-note">
      <label class="knowledge-universe__field ku-space-import__note-field">
        <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.note.contentLabel")}</span>
        <div class="ku-space-import__note-editor">
          <textarea
            rows="8"
            class="ku-space-import__input"
            data-testid="ku-space-import-note-content"
            .value=${props.personalCollectSummary ?? ""}
            placeholder=${t(
              "frontstage.workbench.knowledgeUniverse.importToSpace.note.contentPlaceholder",
            )}
            ?disabled=${props.personalActionBusy || props.libraryWorkspaceNoteAiBusy}
            @input=${(event: Event) =>
              props.onPersonalCollectDraftChange(
                "summary",
                (event.target as HTMLTextAreaElement).value,
              )}
          ></textarea>
          <button
            type="button"
            class="btn btn--sm ku-space-import__note-ai-btn"
            data-testid="ku-space-import-note-ai-generate"
            ?disabled=${
              props.personalActionBusy ||
              props.libraryWorkspaceNoteAiBusy ||
              !props.personalCollectSummary?.trim()
            }
            @click=${() => void props.onGenerateNoteMetadataFromContent?.()}
          >
            ${
              props.libraryWorkspaceNoteAiBusy
                ? t("frontstage.workbench.knowledgeUniverse.importToSpace.note.aiBusy")
                : t("frontstage.workbench.knowledgeUniverse.importToSpace.note.aiGenerate")
            }
          </button>
        </div>
      </label>

      <label class="knowledge-universe__field ku-space-import__note-field">
        <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.note.titleLabel")}</span>
        <input
          type="text"
          class="ku-space-import__input"
          data-testid="ku-space-import-note-title"
          .value=${props.personalCollectTitle ?? ""}
          placeholder=${t("frontstage.workbench.knowledgeUniverse.importToSpace.note.titlePlaceholder")}
          ?disabled=${props.personalActionBusy}
          @input=${(event: Event) =>
            props.onPersonalCollectDraftChange("title", (event.target as HTMLInputElement).value)}
        />
      </label>

      <div class="knowledge-universe__field ku-space-import__note-field">
        <span>${t("frontstage.workbench.knowledgeUniverse.importToSpace.note.tagsLabel")}</span>
        <div
          class="ku-space-import__tag-input"
          data-testid="ku-space-import-note-tags"
          @click=${() => props.onLibraryWorkspaceNoteTagSuggestionsOpenChange?.(true)}
        >
          <div class="ku-space-import__tag-chips">
            ${(props.libraryWorkspaceNoteTags ?? []).map(
              (tag) => html`
                <span class="ku-space-import__tag-chip">
                  ${tag}
                  <button
                    type="button"
                    class="ku-space-import__tag-chip-remove"
                    aria-label=${t(
                      "frontstage.workbench.knowledgeUniverse.importToSpace.note.removeTag",
                      {
                        tag,
                      },
                    )}
                    ?disabled=${props.personalActionBusy}
                    @click=${(event: Event) => {
                      event.stopPropagation();
                      props.onRemoveLibraryWorkspaceNoteTag?.(tag);
                    }}
                  >
                    ×
                  </button>
                </span>
              `,
            )}
            <input
              type="text"
              class="ku-space-import__tag-input-field"
              data-testid="ku-space-import-note-tag-input"
              .value=${props.libraryWorkspaceNoteTagDraft ?? ""}
              placeholder=${t("frontstage.workbench.knowledgeUniverse.importToSpace.note.tagsPlaceholder")}
              ?disabled=${props.personalActionBusy}
              @input=${(event: Event) => {
                props.onLibraryWorkspaceNoteTagDraftChange?.(
                  (event.target as HTMLInputElement).value,
                );
                props.onLibraryWorkspaceNoteTagSuggestionsOpenChange?.(true);
              }}
              @keydown=${(event: KeyboardEvent) => {
                if (event.key === "Enter" || event.key === "," || event.key === "，") {
                  event.preventDefault();
                  props.onCommitLibraryWorkspaceNoteTagDraft?.();
                } else if (
                  event.key === "Backspace" &&
                  !(props.libraryWorkspaceNoteTagDraft ?? "").trim() &&
                  (props.libraryWorkspaceNoteTags ?? []).length > 0
                ) {
                  const last = props.libraryWorkspaceNoteTags?.at(-1);
                  if (last) {
                    props.onRemoveLibraryWorkspaceNoteTag?.(last);
                  }
                }
              }}
              @focus=${() => props.onLibraryWorkspaceNoteTagSuggestionsOpenChange?.(true)}
              @blur=${() => {
                window.setTimeout(() => {
                  props.onLibraryWorkspaceNoteTagSuggestionsOpenChange?.(false);
                }, 120);
              }}
            />
          </div>
          ${
            props.libraryWorkspaceNoteTagSuggestionsOpen && tagSuggestions.length > 0
              ? html`
                  <div class="ku-space-import__tag-suggestions" data-testid="ku-space-import-note-tag-suggestions">
                    ${tagSuggestions.map(
                      (tag) => html`
                        <button
                          type="button"
                          class="ku-space-import__tag-suggestion"
                          @mousedown=${(event: Event) => event.preventDefault()}
                          @click=${() => props.onAddLibraryWorkspaceNoteTag?.(tag)}
                        >
                          ${tag}
                        </button>
                      `,
                    )}
                  </div>
                `
              : nothing
          }
        </div>
      </div>

      <div class="ku-space-import__actions">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="ku-space-import-note-submit"
          ?disabled=${!canSubmitNote(props)}
          @click=${() => void props.onImportNoteToSpace?.()}
        >
          ${
            props.personalActionBusy
              ? t(`frontstage.workbench.knowledgeUniverse.importToSpace.note.${submitBusyKey}`)
              : t(`frontstage.workbench.knowledgeUniverse.importToSpace.note.${submitActionKey}`)
          }
        </button>
      </div>
    </div>
  `;
}
