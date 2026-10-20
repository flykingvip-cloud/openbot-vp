import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { icons } from "../../../icons.ts";

export type GroupMemberGovernanceRosterEntry = {
  id: string;
  label: string;
  kind: "human" | "bot";
  presenceStatus?: "online" | "offline" | null;
};

export type GroupMemberGovernanceCandidate = {
  id: string;
  label: string;
  subtitle?: string;
  kind: "human" | "bot";
  actionMode: "add" | "invite";
  orgSegments?: string[];
  disabled?: boolean;
};

type PendingHumanInvite = {
  intentId: string;
  label: string;
  message?: string;
};

type PendingBotInvite = {
  agentId: string;
  label: string;
  ownerId?: string;
  ownerName?: string;
  canApprove?: boolean;
};

type SelectorKind = "human" | "bot" | null;

type GroupMemberGovernancePanelProps = {
  open: boolean;
  presentation?: "inline" | "overlay" | "docked";
  groupTitle?: string;
  readOnly?: boolean;
  showLeaveAction?: boolean;
  currentOwnerUserId?: string | null;
  prompt: string;
  busy: boolean;
  invitingHumanId?: string | null;
  invitingBotId?: string | null;
  error: string | null;
  result: string | null;
  canReset?: boolean;
  currentHumans: GroupMemberGovernanceRosterEntry[];
  currentBots: GroupMemberGovernanceRosterEntry[];
  candidateHumans: GroupMemberGovernanceCandidate[];
  candidateBots: GroupMemberGovernanceCandidate[];
  pendingHumanInvites?: PendingHumanInvite[];
  pendingBotInvites?: PendingBotInvite[];
  /** When set, the signed-in user is the invitee and should see accept/reject. */
  selfPendingInvite?: PendingHumanInvite | null;
  selectedHumanCandidates: GroupMemberGovernanceCandidate[];
  selectedBotCandidates: GroupMemberGovernanceCandidate[];
  selectorKind: SelectorKind;
  search: string;
  onClose: () => void;
  onPromptChange: (value: string) => void;
  onParse: () => void;
  onOpenSelector: (kind: "human" | "bot" | null) => void;
  onSearchChange: (value: string) => void;
  onToggleHumanSelection: (id: string) => void;
  onToggleBotSelection: (id: string) => void;
  onSetHumanSelectionBatch?: ((ids: string[], selected: boolean) => void) | null;
  onSetBotSelectionBatch?: ((ids: string[], selected: boolean) => void) | null;
  onCommitSelection: () => void;
  onInviteHumanCandidate?: ((id: string) => void) | null;
  onInviteBotCandidate?: ((id: string) => void) | null;
  onCancelInvite?: ((intentId: string) => void) | null;
  onRemoveMember: (id: string, kind: "human" | "bot") => void;
  onApproveBotInvite?: ((agentId: string) => void) | null;
  onRejectBotInvite?: ((agentId: string) => void) | null;
  onAcceptSelfInvite?: (() => void) | null;
  onRejectSelfInvite?: (() => void) | null;
  onLeaveGroup?: (() => void) | null;
  onTransferOwnershipToHuman?: ((userId: string) => void) | null;
  onReset?: (() => void) | null;
};

function normalizeQuery(value: string) {
  return value.trim().toLowerCase();
}

function filterCandidates(candidates: GroupMemberGovernanceCandidate[], query: string) {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return candidates;
  }
  return candidates.filter((entry) => {
    const fields = [entry.label, entry.subtitle, ...(entry.orgSegments ?? [])]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    return fields.some((value) => value.includes(normalized));
  });
}

function groupCandidatesByOrg(candidates: GroupMemberGovernanceCandidate[]) {
  const groups = new Map<string, GroupMemberGovernanceCandidate[]>();
  for (const candidate of candidates) {
    const groupLabel =
      candidate.orgSegments?.join(" / ") || t("frontstage.workbench.team.ungrouped");
    const bucket = groups.get(groupLabel) ?? [];
    bucket.push(candidate);
    groups.set(groupLabel, bucket);
  }
  return [...groups.entries()];
}

function memberAvatarInitial(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return "?";
  }
  const codePoint = trimmed.codePointAt(0);
  return codePoint !== undefined ? String.fromCodePoint(codePoint) : "?";
}

function renderMemberAvatar(
  kind: "human" | "bot",
  label: string,
  presenceStatus?: "online" | "offline" | null,
) {
  const online = kind === "human" && presenceStatus === "online";
  return html`<span class="employee-workbench__member-governance-member-avatar-wrap">
    <span
      class="employee-workbench__member-governance-member-avatar employee-workbench__member-governance-member-avatar--${kind}"
      aria-hidden="true"
      >${memberAvatarInitial(label)}</span
    >
    ${
      online
        ? html`<span
            class="employee-workbench__member-governance-presence-dot"
            title=${t("frontstage.workbench.memberGovernance.online")}
            aria-label=${t("frontstage.workbench.memberGovernance.online")}
          ></span>`
        : nothing
    }
  </span>`;
}

function renderMemberRow(
  entry: GroupMemberGovernanceRosterEntry,
  kind: "human" | "bot",
  options: {
    readOnly: boolean;
    currentOwnerUserId: string | null | undefined;
    onRemoveMember: GroupMemberGovernancePanelProps["onRemoveMember"];
    onTransferOwnershipToHuman: GroupMemberGovernancePanelProps["onTransferOwnershipToHuman"];
  },
) {
  const isOwner = kind === "human" && options.currentOwnerUserId === entry.id;
  return html`<li class="employee-workbench__member-governance-member-row">
    ${renderMemberAvatar(kind, entry.label, entry.presenceStatus)}
    <div class="employee-workbench__member-governance-member-copy">
      <span class="employee-workbench__member-governance-member-name">${entry.label}</span>
      ${
        isOwner
          ? html`<span class="employee-workbench__member-governance-member-badge"
              >${t("frontstage.workbench.memberGovernance.ownerBadge")}</span
            >`
          : nothing
      }
    </div>
    <div class="employee-workbench__member-governance-member-actions">
      ${
        !options.readOnly && kind === "human" && !isOwner && options.onTransferOwnershipToHuman
          ? html`<button
              type="button"
              class="btn btn--sm btn--ghost employee-workbench__member-governance-transfer"
              @click=${() => options.onTransferOwnershipToHuman?.(entry.id)}
            >
              ${t("frontstage.workbench.memberGovernance.transferOwnership")}
            </button>`
          : nothing
      }
      ${
        !options.readOnly
          ? html`<button
              type="button"
              class="btn btn--sm btn--ghost employee-workbench__member-governance-row-remove"
              title=${t("common.remove")}
              @click=${() => options.onRemoveMember(entry.id, kind)}
            >
              ${t("common.remove")}
            </button>`
          : nothing
      }
    </div>
  </li>`;
}

function renderCandidateAction(
  entry: GroupMemberGovernanceCandidate,
  kind: "human" | "bot",
  busy: boolean,
  invitingCandidateId: string | null,
  onInviteCandidate: ((id: string) => void) | undefined,
  commitCandidate: (entry: GroupMemberGovernanceCandidate) => void,
) {
  // Already invited (pending confirmation): keep a persistent "invited · awaiting
  // confirmation" pill so the sent state stays visible in the list, instead of a
  // dead disabled invite button that reads as "nothing happened".
  if (entry.actionMode === "invite" && entry.disabled) {
    return html`<span class="employee-workbench__member-governance-candidate-mode"
      >${t("frontstage.workbench.memberGovernance.invitePending")}</span
    >`;
  }
  // Already-active members: no row action.
  if (entry.disabled) {
    return nothing;
  }
  // Owned bots join directly; peer bots / humans invite with one click.
  if (entry.actionMode === "invite" || (kind === "bot" && entry.actionMode === "add")) {
    const isInviting = invitingCandidateId === entry.id;
    // Only the in-flight row should look "sending". Sibling rows stay idle so a
    // single invite is not perceived as "all invites are going out". While a
    // non-invite busy pass runs (reset / bulk commit), lock every invite button.
    const disabled = isInviting || (busy && !invitingCandidateId);
    const label =
      entry.actionMode === "add"
        ? t("frontstage.workbench.memberGovernance.commitSelection")
        : isInviting
          ? t("frontstage.workbench.memberGovernance.inviteSending")
          : t("frontstage.workbench.memberGovernance.inviteMode");
    return html`<button
      type="button"
      class="btn btn--sm primary employee-workbench__member-governance-candidate-invite"
      ?disabled=${disabled}
      aria-busy=${isInviting ? "true" : "false"}
      @click=${() => onInviteCandidate?.(entry.id) ?? commitCandidate(entry)}
    >
      ${label}
    </button>`;
  }
  return nothing;
}

function renderInlineSelector(
  kind: "human" | "bot",
  search: string,
  candidates: GroupMemberGovernanceCandidate[],
  selected: GroupMemberGovernanceCandidate[],
  busy: boolean,
  invitingCandidateId: string | null,
  onSearchChange: (value: string) => void,
  onToggleSelection: (id: string) => void,
  onCommitSelection: () => void,
  onInviteCandidate: ((id: string) => void) | undefined,
  onClose: () => void,
) {
  const filtered = filterCandidates(candidates, search);
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const grouped = groupCandidatesByOrg(filtered);
  const commitCandidate = (entry: GroupMemberGovernanceCandidate) => {
    if (!selectedIds.has(entry.id)) {
      onToggleSelection(entry.id);
    }
    onCommitSelection();
  };
  const selectTitle =
    kind === "human"
      ? t("frontstage.workbench.memberGovernance.selectHumans")
      : t("frontstage.workbench.memberGovernance.selectBots");

  return html`
    <div
      class="employee-workbench__member-governance-inline-selector"
      role="region"
      aria-label=${selectTitle}
    >
      <div class="employee-workbench__member-governance-inline-selector-head">
        <span class="employee-workbench__member-governance-inline-selector-title">${selectTitle}</span>
        <button
          type="button"
          class="btn btn--sm btn--ghost employee-workbench__member-governance-inline-selector-close"
          aria-label=${t("common.cancel")}
          @click=${() => onClose()}
        >
          ${icons.x}
        </button>
      </div>
      <div class="employee-workbench__member-governance-search">
        <span class="employee-workbench__member-governance-search-icon">${icons.search}</span>
        <input
          .value=${search}
          @input=${(event: Event) => onSearchChange((event.currentTarget as HTMLInputElement).value)}
          placeholder=${
            kind === "human"
              ? t("frontstage.workbench.memberGovernance.searchHumans")
              : t("frontstage.workbench.memberGovernance.searchBots")
          }
        />
      </div>
      <div class="employee-workbench__member-governance-inline-candidates">
        ${
          grouped.length > 0
            ? grouped.map(
                ([groupLabel, entries]) => html`
                  <div class="employee-workbench__member-governance-candidate-group">
                    <div class="employee-workbench__member-governance-candidate-group-title">
                      ${groupLabel}
                    </div>
                    ${entries.map(
                      (entry) => html`
                        <div
                          class="employee-workbench__member-governance-candidate employee-workbench__member-governance-candidate--compact employee-workbench__member-governance-candidate--${kind} ${
                            entry.disabled ? "is-disabled" : ""
                          }"
                        >
                          <div class="employee-workbench__member-governance-candidate-copy">
                            <div class="employee-workbench__member-governance-candidate-label">
                              ${entry.label}
                            </div>
                            ${
                              entry.subtitle
                                ? html`
                                  <div class="employee-workbench__member-governance-candidate-subtitle">
                                    ${entry.subtitle}
                                  </div>
                                `
                                : nothing
                            }
                          </div>
                          ${renderCandidateAction(
                            entry,
                            kind,
                            busy,
                            invitingCandidateId,
                            onInviteCandidate,
                            commitCandidate,
                          )}
                        </div>
                      `,
                    )}
                  </div>
                `,
              )
            : html`
                <div class="employee-workbench__member-governance-empty">
                  ${t("frontstage.workbench.memberGovernance.noCandidates")}
                </div>
              `
        }
      </div>
      ${
        kind === "human"
          ? html`<div class="employee-workbench__member-governance-inline-actions">
              <button type="button" class="btn btn--sm btn--ghost" @click=${() => onClose()}>
                ${t("common.cancel")}
              </button>
            </div>`
          : nothing
      }
    </div>
  `;
}

function renderRosterBlock(
  title: string,
  kind: "human" | "bot",
  entries: GroupMemberGovernanceRosterEntry[],
  selectorProps: {
    selectorOpen: boolean;
    search: string;
    candidates: GroupMemberGovernanceCandidate[];
    selected: GroupMemberGovernanceCandidate[];
    busy: boolean;
    invitingCandidateId: string | null;
    onOpenSelector: GroupMemberGovernancePanelProps["onOpenSelector"];
    onSearchChange: GroupMemberGovernancePanelProps["onSearchChange"];
    onToggleSelection: (id: string) => void;
    onCommitSelection: GroupMemberGovernancePanelProps["onCommitSelection"];
    onInviteCandidate: ((id: string) => void) | undefined;
  },
  options: {
    readOnly: boolean;
    currentOwnerUserId: string | null | undefined;
    onRemoveMember: GroupMemberGovernancePanelProps["onRemoveMember"];
    onTransferOwnershipToHuman: GroupMemberGovernancePanelProps["onTransferOwnershipToHuman"];
  },
) {
  const addLabel =
    kind === "human"
      ? t("frontstage.workbench.memberGovernance.addHuman")
      : t("frontstage.workbench.memberGovernance.addBot");
  const openSelector = () => {
    if (!selectorProps.selectorOpen) {
      selectorProps.onOpenSelector(kind);
    }
  };
  return html`<section
    class="employee-workbench__member-governance-roster-block ${
      selectorProps.selectorOpen
        ? "employee-workbench__member-governance-roster-block--selector-open"
        : ""
    }"
  >
    <header class="employee-workbench__member-governance-roster-head">
      <div class="employee-workbench__member-governance-roster-title">
        <span>${title}</span>
        <span class="employee-workbench__member-governance-roster-count">${entries.length}</span>
      </div>
      ${
        !options.readOnly
          ? html`<button
              type="button"
              class="btn btn--sm btn--ghost employee-workbench__member-governance-roster-add ${
                selectorProps.selectorOpen ? "is-active" : ""
              }"
              aria-expanded=${selectorProps.selectorOpen ? "true" : "false"}
              @click=${openSelector}
            >
              ${addLabel}
            </button>`
          : nothing
      }
    </header>
    ${
      entries.length > 0
        ? html`<ul class="employee-workbench__member-governance-roster-list">
            ${entries.map((entry) => renderMemberRow(entry, kind, options))}
          </ul>`
        : !selectorProps.selectorOpen
          ? html`<div class="employee-workbench__member-governance-empty">
              <p>${t("frontstage.workbench.memberGovernance.empty")}</p>
            </div>`
          : nothing
    }
    ${
      selectorProps.selectorOpen
        ? renderInlineSelector(
            kind,
            selectorProps.search,
            selectorProps.candidates,
            selectorProps.selected,
            selectorProps.busy,
            selectorProps.invitingCandidateId,
            selectorProps.onSearchChange,
            selectorProps.onToggleSelection,
            selectorProps.onCommitSelection,
            selectorProps.onInviteCandidate,
            () => selectorProps.onOpenSelector(null),
          )
        : nothing
    }
  </section>`;
}

export function renderGroupMemberGovernancePanel(props: GroupMemberGovernancePanelProps) {
  if (!props.open) {
    return nothing;
  }

  const groupTitle =
    props.groupTitle?.trim() || t("frontstage.workbench.memberGovernance.unknownGroup");
  const presentation = props.presentation ?? "overlay";
  const readOnly = props.readOnly === true;
  const humanCount = props.currentHumans.length;
  const botCount = props.currentBots.length;
  const rosterOptions = {
    readOnly,
    currentOwnerUserId: props.currentOwnerUserId,
    onRemoveMember: props.onRemoveMember,
    onTransferOwnershipToHuman: props.onTransferOwnershipToHuman ?? null,
  };
  const humanSelectorOpen = props.selectorKind === "human";
  const botSelectorOpen = props.selectorKind === "bot";

  return html`
    <section
      class="employee-workbench__member-governance-panel employee-workbench__member-governance-panel--${presentation}"
    >
      <header class="employee-workbench__member-governance-panel-head">
        <div class="employee-workbench__member-governance-panel-identity">
          <h2 class="employee-workbench__member-governance-group-name">
            ${t("frontstage.workbench.memberGovernance.title")}——${groupTitle}
          </h2>
          <div class="employee-workbench__member-governance-chips">
            <span class="employee-workbench__member-governance-chip"
              >${t("frontstage.workbench.memberGovernance.humanCountChip", {
                count: String(humanCount),
              })}</span
            >
            <span class="employee-workbench__member-governance-chip"
              >${t("frontstage.workbench.memberGovernance.botCountChip", {
                count: String(botCount),
              })}</span
            >
            ${
              readOnly
                ? html`<span
                    class="employee-workbench__member-governance-chip employee-workbench__member-governance-chip--muted"
                    >${t("frontstage.workbench.memberGovernance.readOnlyMode")}</span
                  >`
                : nothing
            }
          </div>
        </div>
      </header>

      <div class="employee-workbench__member-governance-content">
        ${
          props.selfPendingInvite
            ? html`<div
                class="employee-workbench__member-governance-banner employee-workbench__member-governance-self-invite"
                role="region"
                aria-label=${t("frontstage.workbench.memberGovernance.selfInviteTitle")}
              >
                <div class="employee-workbench__member-governance-self-invite-copy">
                  <div class="employee-workbench__member-governance-self-invite-title">
                    ${t("frontstage.workbench.memberGovernance.selfInviteTitle")}
                  </div>
                  <div class="employee-workbench__member-governance-self-invite-hint">
                    ${t("frontstage.workbench.memberGovernance.selfInviteHint", {
                      group: groupTitle,
                    })}
                  </div>
                </div>
                <div class="employee-workbench__member-governance-inline-actions">
                  <button
                    type="button"
                    class="btn btn--sm"
                    ?disabled=${props.busy}
                    @click=${() => props.onRejectSelfInvite?.()}
                  >
                    ${t("frontstage.workbench.memberGovernance.reject")}
                  </button>
                  <button
                    type="button"
                    class="btn btn--sm primary"
                    ?disabled=${props.busy}
                    @click=${() => props.onAcceptSelfInvite?.()}
                  >
                    ${t("frontstage.workbench.memberGovernance.acceptInvite")}
                  </button>
                </div>
              </div>`
            : nothing
        }
        ${
          props.error
            ? html`<div
                class="employee-workbench__member-governance-banner is-error"
                role="alert"
              >
                ${props.error}
              </div>`
            : nothing
        }
        ${
          props.result
            ? html`<div
                class="employee-workbench__member-governance-banner is-success"
                role="status"
                aria-live="polite"
              >
                ${props.result}
              </div>`
            : nothing
        }

        <section class="employee-workbench__member-governance-roster">
          ${renderRosterBlock(
            t("frontstage.workbench.memberGovernance.humans"),
            "human",
            props.currentHumans,
            {
              selectorOpen: humanSelectorOpen,
              search: props.search,
              candidates: props.candidateHumans,
              selected: props.selectedHumanCandidates,
              busy: props.busy,
              invitingCandidateId: props.invitingHumanId ?? null,
              onOpenSelector: props.onOpenSelector,
              onSearchChange: props.onSearchChange,
              onToggleSelection: props.onToggleHumanSelection,
              onCommitSelection: props.onCommitSelection,
              onInviteCandidate: props.onInviteHumanCandidate ?? undefined,
            },
            rosterOptions,
          )}
          ${renderRosterBlock(
            t("frontstage.workbench.memberGovernance.bots"),
            "bot",
            props.currentBots,
            {
              selectorOpen: botSelectorOpen,
              search: props.search,
              candidates: props.candidateBots,
              selected: props.selectedBotCandidates,
              busy: props.busy,
              invitingCandidateId: props.invitingBotId ?? null,
              onOpenSelector: props.onOpenSelector,
              onSearchChange: props.onSearchChange,
              onToggleSelection: props.onToggleBotSelection,
              onCommitSelection: props.onCommitSelection,
              onInviteCandidate: props.onInviteBotCandidate ?? undefined,
            },
            rosterOptions,
          )}
        </section>

        ${
          (props.pendingHumanInvites && props.pendingHumanInvites.length > 0) ||
          (props.pendingBotInvites && props.pendingBotInvites.length > 0)
            ? html`
                <section class="employee-workbench__member-governance-pending">
                  <div class="employee-workbench__member-governance-pending-title">
                    ${t("frontstage.workbench.memberGovernance.pendingInvites")}
                  </div>
                  ${
                    props.pendingHumanInvites?.map((invite) => {
                      const isSelfInvite = props.selfPendingInvite?.intentId === invite.intentId;
                      return html`
                        <div class="employee-workbench__member-governance-selected-row">
                          <div>${invite.label}</div>
                          ${
                            isSelfInvite
                              ? html`
                                  <div class="employee-workbench__member-governance-inline-actions">
                                    <button
                                      type="button"
                                      class="btn btn--sm"
                                      ?disabled=${props.busy}
                                      @click=${() => props.onRejectSelfInvite?.()}
                                    >
                                      ${t("frontstage.workbench.memberGovernance.reject")}
                                    </button>
                                    <button
                                      type="button"
                                      class="btn btn--sm primary"
                                      ?disabled=${props.busy}
                                      @click=${() => props.onAcceptSelfInvite?.()}
                                    >
                                      ${t("frontstage.workbench.memberGovernance.acceptInvite")}
                                    </button>
                                  </div>
                                `
                              : props.onCancelInvite
                                ? html`
                                    <button
                                      type="button"
                                      class="btn btn--sm btn--icon"
                                      @click=${() => props.onCancelInvite?.(invite.intentId)}
                                    >
                                      ${icons.x}
                                    </button>
                                  `
                                : nothing
                          }
                        </div>
                      `;
                    }) ?? nothing
                  }
                  ${
                    props.pendingBotInvites?.map(
                      (invite) => html`
                        <div class="employee-workbench__member-governance-selected-row">
                          <div class="employee-workbench__member-governance-candidate-copy">
                            <div class="employee-workbench__member-governance-candidate-label">
                              ${invite.label}
                            </div>
                            <div class="employee-workbench__member-governance-candidate-subtitle">
                              ${
                                invite.canApprove
                                  ? t("frontstage.workbench.memberGovernance.approveOwnedBotHint")
                                  : invite.ownerName
                                    ? t("frontstage.workbench.memberGovernance.pendingOwnerHint", {
                                        owner: invite.ownerName,
                                      })
                                    : t("frontstage.workbench.memberGovernance.pendingOwnerGeneric")
                              }
                            </div>
                          </div>
                          ${
                            invite.canApprove
                              ? html`
                                  <div class="employee-workbench__member-governance-inline-actions">
                                    <button
                                      type="button"
                                      class="btn btn--sm"
                                      @click=${() => props.onRejectBotInvite?.(invite.agentId)}
                                    >
                                      ${t("frontstage.workbench.memberGovernance.reject")}
                                    </button>
                                    <button
                                      type="button"
                                      class="btn btn--sm primary"
                                      @click=${() => props.onApproveBotInvite?.(invite.agentId)}
                                    >
                                      ${t("frontstage.workbench.memberGovernance.approve")}
                                    </button>
                                  </div>
                                `
                              : html`
                                  <span class="employee-workbench__member-governance-candidate-mode">
                                    ${t("frontstage.workbench.memberGovernance.awaitingOwner")}
                                  </span>
                                `
                          }
                        </div>
                      `,
                    ) ?? nothing
                  }
                </section>
              `
            : nothing
        }

        ${
          !readOnly
            ? html`
                <details class="employee-workbench__member-governance-assist">
                  <summary class="employee-workbench__member-governance-assist-summary">
                    ${t("frontstage.workbench.memberGovernance.assistTitle")}
                  </summary>
                  <div class="employee-workbench__member-governance-assist-body">
                    <p class="employee-workbench__member-governance-assist-hint">
                      ${t("frontstage.workbench.memberGovernance.assistHint")}
                    </p>
                    <textarea
                      .value=${props.prompt}
                      @input=${(event: Event) =>
                        props.onPromptChange((event.currentTarget as HTMLTextAreaElement).value)}
                      placeholder=${t("frontstage.workbench.memberGovernance.promptPlaceholder")}
                    ></textarea>
                    <div class="employee-workbench__member-governance-prompt-actions">
                      ${
                        props.canReset
                          ? html`
                              <button
                                type="button"
                                class="btn btn--sm btn--ghost"
                                ?disabled=${props.busy}
                                @click=${() => props.onReset?.()}
                              >
                                ${t("frontstage.workbench.memberGovernance.reset")}
                              </button>
                            `
                          : nothing
                      }
                      <button
                        type="button"
                        class="btn btn--sm primary"
                        ?disabled=${props.busy}
                        @click=${props.onParse}
                      >
                        ${t("frontstage.workbench.memberGovernance.askDaibai")}
                      </button>
                    </div>
                  </div>
                </details>
              `
            : nothing
        }
      </div>

      ${
        readOnly && props.showLeaveAction
          ? html`<footer class="employee-workbench__member-governance-panel-foot">
              <button
                type="button"
                class="btn btn--sm btn--ghost employee-workbench__member-governance-leave"
                @click=${props.onLeaveGroup}
              >
                ${t("frontstage.workbench.memberGovernance.leaveGroup")}
              </button>
            </footer>`
          : nothing
      }

    </section>
  `;
}
