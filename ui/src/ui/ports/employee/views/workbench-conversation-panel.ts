/**
 * Conversation list panel for employee workbench (CL-P1-03).
 * Shows recent / archived conversations under the current assistant.
 */
import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { ConversationRecordView } from "../semantic/view-controller-facade.ts";

export type WorkbenchConversationPanelProps = {
  open: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  agentId: string | null;
  activeSessionKey: string;
  activeConversationId: string | null;
  rows: ConversationRecordView[];
  showArchived: boolean;
  hasMore?: boolean;
  onToggleOpen: () => void;
  onToggleArchived: () => void;
  onCreate: () => void;
  onSelect: (conversationId: string) => void;
  onRename: (conversationId: string, title: string, etag: string) => void;
  onClose?: (conversationId: string, etag: string) => void;
  onArchive: (conversationId: string, etag: string) => void;
  onRestore: (conversationId: string, etag: string) => void;
  onLoadMore?: () => void;
};

function formatUpdatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return "";
    }
    return d.toLocaleString();
  } catch {
    return "";
  }
}

function statusLabel(status: ConversationRecordView["lifecycleStatus"]): string {
  switch (status) {
    case "ACTIVE":
      return t("frontstage.workbench.conversations.statusActive");
    case "CLOSED":
      return t("frontstage.workbench.conversations.statusClosed");
    case "ARCHIVED":
      return t("frontstage.workbench.conversations.statusArchived");
    case "DELETED":
      return t("frontstage.workbench.conversations.statusDeleted");
    default:
      return status;
  }
}

export function renderWorkbenchConversationPanel(props: WorkbenchConversationPanelProps) {
  if (!props.agentId) {
    return nothing;
  }

  const activeRows = props.rows.filter((r) => r.lifecycleStatus !== "ARCHIVED");
  const visible = props.showArchived ? props.rows : activeRows;

  return html`
    <div class="employee-workbench__conversation-panel">
      <div class="employee-workbench__conversation-panel-toolbar">
        <button
          type="button"
          class="btn btn--sm employee-workbench__conversation-panel-toggle"
          aria-expanded=${props.open ? "true" : "false"}
          @click=${() => props.onToggleOpen()}
        >
          ${t("frontstage.workbench.conversations.title")}
          <span class="employee-workbench__conversation-panel-count">${activeRows.length}</span>
        </button>
        <button
          type="button"
          class="btn btn--sm btn--primary"
          ?disabled=${props.busy || props.loading}
          title=${t("frontstage.workbench.conversations.createConversationSub")}
          @click=${() => props.onCreate()}
        >
          ${t("frontstage.workbench.conversations.createConversation")}
        </button>
      </div>

      ${
        props.open
          ? html`
            <div class="employee-workbench__conversation-panel-body" role="region">
              <div class="employee-workbench__conversation-panel-filters">
                <label class="employee-workbench__conversation-panel-filter">
                  <input
                    type="checkbox"
                    .checked=${props.showArchived}
                    @change=${() => props.onToggleArchived()}
                  />
                  ${t("frontstage.workbench.conversations.showArchived")}
                </label>
              </div>

              ${
                props.error
                  ? html`
                    <div class="employee-workbench__member-governance-banner is-error">
                      ${props.error}
                    </div>
                  `
                  : nothing
              }

              ${
                props.loading
                  ? html`
                    <div class="employee-workbench__conversation-panel-empty">
                      ${t("common.loading")}
                    </div>
                  `
                  : visible.length === 0
                    ? html`
                      <div class="employee-workbench__conversation-panel-empty">
                        ${t("frontstage.workbench.conversations.empty")}
                      </div>
                    `
                    : html`
                      <ul class="employee-workbench__conversation-list">
                        ${visible.map((row) => {
                          const isActive = row.conversationId === props.activeConversationId;
                          const isArchived = row.lifecycleStatus === "ARCHIVED";
                          return html`
                            <li
                              class="employee-workbench__conversation-item ${
                                isActive ? "is-active" : ""
                              } ${isArchived ? "is-archived" : ""}"
                            >
                              <button
                                type="button"
                                class="employee-workbench__conversation-item-main"
                                ?disabled=${props.busy}
                                @click=${() => props.onSelect(row.conversationId)}
                              >
                                <span class="employee-workbench__conversation-item-title">
                                  ${row.title}
                                </span>
                                <span class="employee-workbench__conversation-item-meta">
                                  ${statusLabel(row.lifecycleStatus)}
                                  · ${formatUpdatedAt(row.updatedAt)}
                                </span>
                              </button>
                              <div class="employee-workbench__conversation-item-actions">
                                ${
                                  !isArchived
                                    ? html`
                                      <button
                                        type="button"
                                        class="btn btn--sm"
                                        ?disabled=${props.busy}
                                        title=${t("frontstage.workbench.conversations.rename")}
                                        @click=${() => {
                                          const next = window.prompt(
                                            t("frontstage.workbench.conversations.renamePrompt"),
                                            row.title,
                                          );
                                          if (next && next.trim() && next.trim() !== row.title) {
                                            props.onRename(
                                              row.conversationId,
                                              next.trim(),
                                              row.etag,
                                            );
                                          }
                                        }}
                                      >
                                        ${t("frontstage.workbench.conversations.rename")}
                                      </button>
                                      ${
                                        props.onClose && row.lifecycleStatus === "ACTIVE"
                                          ? html`
                                            <button
                                              type="button"
                                              class="btn btn--sm"
                                              ?disabled=${props.busy}
                                              title=${t("frontstage.workbench.conversations.close")}
                                              @click=${() =>
                                                props.onClose?.(row.conversationId, row.etag)}
                                            >
                                              ${t("frontstage.workbench.conversations.close")}
                                            </button>
                                          `
                                          : nothing
                                      }
                                      <button
                                        type="button"
                                        class="btn btn--sm"
                                        ?disabled=${props.busy}
                                        title=${t("frontstage.workbench.conversations.archive")}
                                        @click=${() => {
                                          if (
                                            window.confirm(
                                              t(
                                                "frontstage.workbench.conversations.archiveConfirm",
                                              ),
                                            )
                                          ) {
                                            props.onArchive(row.conversationId, row.etag);
                                          }
                                        }}
                                      >
                                        ${t("frontstage.workbench.conversations.archive")}
                                      </button>
                                    `
                                    : html`
                                      <button
                                        type="button"
                                        class="btn btn--sm"
                                        ?disabled=${props.busy}
                                        title=${t("frontstage.workbench.conversations.restore")}
                                        @click=${() => props.onRestore(row.conversationId, row.etag)}
                                      >
                                        ${t("frontstage.workbench.conversations.restore")}
                                      </button>
                                    `
                                }
                              </div>
                            </li>
                          `;
                        })}
                      </ul>
                      ${
                        props.hasMore && props.onLoadMore
                          ? html`
                            <div class="employee-workbench__conversation-panel-load-more">
                              <button
                                type="button"
                                class="btn btn--sm"
                                ?disabled=${props.loading || props.busy}
                                @click=${() => props.onLoadMore?.()}
                              >
                                ${t("frontstage.workbench.conversations.loadMore")}
                              </button>
                            </div>
                          `
                          : nothing
                      }
                    `
              }
            </div>
          `
          : nothing
      }
    </div>
  `;
}
