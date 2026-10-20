import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { icons } from "../../../icons.ts";
import { resolveCollaborationGroupSnapshot } from "./collaboration-group-snapshot.ts";
import { renderGroupMemberGovernancePanel } from "./group-member-governance-panel.ts";
import type { WorkbenchHomeModel } from "./workbench-home-model.ts";
import type { WorkbenchShellModel } from "./workbench-shell-model.ts";
import type { WorkbenchCollaborationStageContract } from "./workbench-stage-contracts.ts";
import { renderConversationStageShell } from "./workbench-stage-conversation.ts";
import type {
  WorkbenchCollaborationSpaceSnapshot,
  WorkbenchCollaborationSpacesSnapshot,
} from "./workbench-types.ts";

type CollaborationMemberChip = {
  id: string;
  label: string;
  kind: "human" | "bot";
  avatarUrl?: string | null;
  emoji?: string | null;
  pending?: boolean;
  /** Live WS presence for humans (green bottom-dot when online). */
  presenceStatus?: "online" | "offline" | null;
  runtimeStatus?: "online" | "busy" | "offline" | "unknown" | null;
  lastActiveAt?: string | null;
  currentTask?: string | null;
  openTaskCount?: number | null;
  selectedThisRound?: boolean;
  wrapThisRound?: boolean;
  speakingThisRound?: boolean;
};

function resolveRoundParticipantFlags(
  contract: WorkbenchCollaborationStageContract,
  memberId: string,
) {
  const plan = contract.collaborationRoundPlan;
  if (!plan || plan.sessionKey.trim() !== contract.activeSessionKey.trim()) {
    return { selectedThisRound: false, wrapThisRound: false };
  }
  const participant = plan.participants.find(
    (entry: { agentId: string }) => entry.agentId === memberId,
  );
  if (!participant) {
    return { selectedThisRound: false, wrapThisRound: false };
  }
  return {
    selectedThisRound: participant.tier !== "wrap",
    wrapThisRound: participant.tier === "wrap",
  };
}

const COLLABORATION_CAPSULE_AVATAR_SIZE_PX = 30;
const COLLABORATION_CAPSULE_MEMBER_GAP_PX = 8;
const COLLABORATION_CAPSULE_ZONE_PADDING_PX = 24;
const COLLABORATION_CAPSULE_EMPTY_ZONE_WIDTH_PX = 108;

function readLabel(key: string, fallback: string) {
  const value = t(key);
  return value === key ? fallback : value;
}

function initials(label: string) {
  const words = label
    .split(/[\s_-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);
  const value = words.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return value || "OB";
}

function normalizeLabel(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

function isCurrentMemberStatus(status: string | null | undefined) {
  return !status || status === "active";
}

function readManagedSpaceMembers(
  managedSpace: WorkbenchCollaborationSpaceSnapshot | null,
): CollaborationMemberChip[] {
  if (!managedSpace) {
    return [];
  }
  const members = managedSpace.members;
  const humans = members.humans
    .filter((entry) => isCurrentMemberStatus(entry.status))
    .map((entry) => ({
      id: entry.userId,
      label: normalizeLabel(entry.name, entry.handle?.trim() || entry.userId),
      kind: "human" as const,
      presenceStatus:
        entry.presenceStatus === "online" || entry.presenceStatus === "offline"
          ? entry.presenceStatus
          : null,
      lastActiveAt: entry.lastActiveAt ?? null,
    }));
  const bots = members.bots
    .filter((entry) => isCurrentMemberStatus(entry.status))
    .map((entry) => ({
      id: entry.agentId,
      label: normalizeLabel(entry.name, entry.agentId),
      kind: "bot" as const,
      runtimeStatus: entry.runtimeStatus ?? null,
      lastActiveAt: entry.lastActiveAt ?? null,
      currentTask: entry.currentTask ?? null,
      openTaskCount: entry.openTaskCount ?? null,
    }));
  return [...humans, ...bots];
}

function readContractMembers(
  contract: WorkbenchCollaborationStageContract,
): CollaborationMemberChip[] {
  return (contract.groupMembers ?? []).map((entry) => ({
    id: entry.id,
    label: normalizeLabel(entry.name, entry.handle?.trim() || entry.id),
    kind: entry.kind === "bot" ? "bot" : "human",
    avatarUrl: entry.avatarUrl ?? null,
  }));
}

function enrichBotIdentity(
  member: CollaborationMemberChip,
  contract: WorkbenchCollaborationStageContract,
): CollaborationMemberChip {
  if (member.kind !== "bot") {
    return member;
  }
  const ownedAgent = contract.ownedAgents.find((entry) => entry.id === member.id) ?? null;
  const label = normalizeLabel(
    ownedAgent?.name,
    normalizeLabel(ownedAgent?.identity?.name, member.label),
  );
  return {
    ...member,
    label,
    emoji: ownedAgent?.identity?.emoji?.trim() || null,
  };
}

function resolveSpeakingThisRound(
  contract: WorkbenchCollaborationStageContract,
  memberId: string,
): boolean {
  const speakingId = contract.collaborationSpeakingAgentId?.trim();
  if (!speakingId) {
    return false;
  }
  return speakingId === memberId.trim();
}

function enrichCollaborationMember(
  member: CollaborationMemberChip,
  contract: WorkbenchCollaborationStageContract,
): CollaborationMemberChip {
  if (member.kind !== "bot") {
    return member;
  }
  const enriched = enrichBotIdentity(member, contract);
  const roundFlags = resolveRoundParticipantFlags(contract, member.id);
  return {
    ...enriched,
    ...roundFlags,
    speakingThisRound: resolveSpeakingThisRound(contract, member.id),
  };
}

function memberDedupeKey(member: CollaborationMemberChip): string {
  const id = member.id.trim().toLowerCase();
  if (member.kind === "human") {
    if (id.includes("@")) {
      return `human:email:${id}`;
    }
    const label = member.label.trim().toLowerCase();
    if (label) {
      return `human:label:${label}`;
    }
  }
  return `${member.kind}:${id}`;
}

function dedupeMembers(
  members: CollaborationMemberChip[],
  contract: WorkbenchCollaborationStageContract,
) {
  const byKey = new Map<string, CollaborationMemberChip>();
  for (const candidate of members.map((entry) => enrichCollaborationMember(entry, contract))) {
    const key = memberDedupeKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    byKey.set(key, {
      ...existing,
      ...candidate,
      label: existing.label.length >= candidate.label.length ? existing.label : candidate.label,
      avatarUrl: existing.avatarUrl ?? candidate.avatarUrl ?? null,
      emoji: existing.emoji ?? candidate.emoji ?? null,
      pending: existing.pending && candidate.pending,
      presenceStatus: existing.presenceStatus ?? candidate.presenceStatus ?? null,
      runtimeStatus: existing.runtimeStatus ?? candidate.runtimeStatus ?? null,
      lastActiveAt: existing.lastActiveAt ?? candidate.lastActiveAt ?? null,
      currentTask: existing.currentTask ?? candidate.currentTask ?? null,
      openTaskCount: existing.openTaskCount ?? candidate.openTaskCount ?? null,
      selectedThisRound: existing.selectedThisRound || candidate.selectedThisRound,
      wrapThisRound: existing.wrapThisRound || candidate.wrapThisRound,
    });
  }
  return [...byKey.values()];
}

function resolveStatusDot(member: CollaborationMemberChip) {
  // Humans: same bottom green-dot language as member-governance (online only).
  if (member.kind === "human") {
    return member.presenceStatus === "online" ? "green" : null;
  }
  if (member.runtimeStatus === "online") {
    return "green";
  }
  if (member.runtimeStatus === "busy") {
    return "yellow";
  }
  if (member.runtimeStatus === "offline") {
    return "red";
  }
  return null;
}

function buildMemberTooltip(member: CollaborationMemberChip) {
  const details = [
    member.label,
    member.kind === "human" && member.presenceStatus === "online" ? "在线" : "",
    member.currentTask ? `当前任务：${member.currentTask}` : "",
    member.openTaskCount ? `未完成任务：${member.openTaskCount}` : "",
    member.lastActiveAt ? `最后活跃：${member.lastActiveAt}` : "",
  ].filter(Boolean);
  return details.join("\n");
}

function buildMemberAriaLabel(member: CollaborationMemberChip) {
  if (member.kind === "human" && member.presenceStatus === "online") {
    return `${member.label}，在线`;
  }
  return member.label;
}

function resolveCollaborationMembers(
  shellModel: WorkbenchShellModel,
  spacesResult: WorkbenchCollaborationSpacesSnapshot | undefined,
  contract: WorkbenchCollaborationStageContract,
) {
  const snapshot = resolveCollaborationGroupSnapshot({
    selectionKey: shellModel.selectedSpaceItem?.selectionKey ?? null,
    activeSessionKey: contract.activeSessionKey,
    spacesResult: spacesResult ?? { spaces: [] },
    teamSpaces: [],
    sessionsResult: null,
  });
  const managedMembers = readManagedSpaceMembers(snapshot?.managedSpace ?? null);
  return {
    snapshot,
    members: dedupeMembers(
      managedMembers.length > 0 ? managedMembers : readContractMembers(contract),
      contract,
    ),
  };
}

function renderMemberAvatar(member: CollaborationMemberChip) {
  if (member.avatarUrl) {
    return html`<img
      class="employee-workbench__collaboration-capsule-avatar-image"
      src=${member.avatarUrl}
      alt=${member.label}
    />`;
  }
  if (member.emoji) {
    return html`<span class="employee-workbench__collaboration-capsule-avatar-emoji">${member.emoji}</span>`;
  }
  return html`<span class="employee-workbench__collaboration-capsule-avatar-text">
    ${initials(member.label)}
  </span>`;
}

function renderMemberZone(
  title: string,
  members: CollaborationMemberChip[],
  tone: "human" | "bot",
  solo = false,
) {
  return html`
    <div
      class="employee-workbench__collaboration-capsule-zone employee-workbench__collaboration-capsule-zone--${tone} ${
        solo ? "employee-workbench__collaboration-capsule-zone--solo" : ""
      }"
    >
      <div class="employee-workbench__collaboration-capsule-list" role="list" aria-label=${title}>
        ${
          members.length > 0
            ? members.map(
                (member) => html`
                <span
                  class="employee-workbench__collaboration-capsule-member ${
                    member.pending ? "is-pending" : ""
                  } ${member.speakingThisRound ? "is-speaking-this-round" : ""}"
                  role="listitem"
                  aria-label=${buildMemberAriaLabel(member)}
                  title=${buildMemberTooltip(member)}
                >
                  <span class="employee-workbench__collaboration-capsule-avatar-wrap">
                    <span
                      class="employee-workbench__collaboration-capsule-avatar employee-workbench__collaboration-capsule-avatar--${member.kind}"
                    >
                      ${renderMemberAvatar(member)}
                    </span>
                    ${
                      member.speakingThisRound
                        ? html`
                            <span class="employee-workbench__collaboration-capsule-speaking-dot" aria-hidden="true"></span>
                          `
                        : nothing
                    }
                    ${
                      resolveStatusDot(member)
                        ? html`
                          <span
                            class="employee-workbench__collaboration-capsule-status employee-workbench__collaboration-capsule-status--${resolveStatusDot(member)}"
                            aria-hidden="true"
                          ></span>
                        `
                        : nothing
                    }
                    ${
                      member.pending
                        ? html`
                          <span class="employee-workbench__collaboration-capsule-member-badge">
                            ${readLabel("frontstage.workbench.memberGovernance.pending", "待")}
                          </span>
                        `
                        : nothing
                    }
                  </span>
                  <span
                    class="employee-workbench__collaboration-capsule-member-tooltip"
                    aria-hidden="true"
                  >
                    ${buildMemberTooltip(member)}
                  </span>
                </span>
              `,
              )
            : html`
              <span class="employee-workbench__collaboration-capsule-empty">
                ${
                  tone === "bot"
                    ? readLabel("frontstage.workbench.memberGovernance.empty", "暂无机器人")
                    : readLabel("frontstage.workbench.memberGovernance.empty", "暂无成员")
                }
              </span>
            `
        }
      </div>
    </div>
  `;
}

function computeCapsuleZoneWidth(members: CollaborationMemberChip[]) {
  if (members.length <= 0) {
    return COLLABORATION_CAPSULE_EMPTY_ZONE_WIDTH_PX;
  }
  return (
    COLLABORATION_CAPSULE_ZONE_PADDING_PX +
    members.length * COLLABORATION_CAPSULE_AVATAR_SIZE_PX +
    Math.max(0, members.length - 1) * COLLABORATION_CAPSULE_MEMBER_GAP_PX
  );
}

function tierLabel(tier: string) {
  switch (tier) {
    case "mention":
      return "点名";
    case "duty":
      return "职责";
    case "relevance":
      return "话题";
    case "wrap":
      return "收口";
    default:
      return tier;
  }
}

function renderCollaborationOptionalSuggestions(contract: WorkbenchCollaborationStageContract) {
  const suggestions = contract.collaborationOptionalSuggestions ?? [];
  if (suggestions.length === 0) {
    return nothing;
  }
  return html`
    <div class="employee-workbench__collaboration-optional-suggestions" aria-label="可选补充">
      ${suggestions.map(
        (suggestion) => html`
          <details class="employee-workbench__collaboration-optional-suggestion">
            <summary class="employee-workbench__collaboration-optional-suggestion-summary">
              <span class="employee-workbench__collaboration-optional-suggestion-title">
                ${suggestion.title}
              </span>
              <span class="employee-workbench__collaboration-optional-suggestion-agent">
                ${suggestion.agentName}
              </span>
            </summary>
            <div class="employee-workbench__collaboration-optional-suggestion-body">
              <p>${suggestion.body}</p>
              <button
                type="button"
                class="btn btn--sm btn--ghost employee-workbench__collaboration-optional-suggestion-dismiss"
                @click=${(event: Event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  contract.onDismissCollaborationOptionalSuggestion?.(suggestion.id);
                }}
              >
                收起
              </button>
            </div>
          </details>
        `,
      )}
    </div>
  `;
}

function renderCollaborationMissionAdvanceActions(contract: WorkbenchCollaborationStageContract) {
  const roundPlan =
    contract.collaborationRoundPlan?.sessionKey.trim() === contract.activeSessionKey.trim()
      ? contract.collaborationRoundPlan
      : null;
  const staleAlert = roundPlan?.alerts?.find(
    (alert: { kind: string }) => alert.kind === "onboarding_mission_stale",
  );
  if (
    !staleAlert &&
    !contract.collaborationMissionAdvanceNotice &&
    !contract.collaborationMissionAdvanceError
  ) {
    return nothing;
  }
  return html`
    <div class="employee-workbench__collaboration-mission-advance">
      ${
        staleAlert
          ? html`
            <p class="employee-workbench__collaboration-mission-advance-hint">
              ${staleAlert.message}
            </p>
            <button
              type="button"
              class="btn btn--sm employee-workbench__collaboration-mission-advance-btn"
              data-guidance-team-hint="true"
              data-guidance-optional-cta="advance_team_mission"
              ?disabled=${Boolean(contract.collaborationMissionAdvanceBusy)}
              @click=${() => void contract.onAdvanceCollaborationMission?.()}
            >
              ${contract.collaborationMissionAdvanceBusy ? "升级中…" : "升级群使命"}
            </button>
          `
          : nothing
      }
      ${
        contract.collaborationMissionAdvanceNotice
          ? html`
            <p class="employee-workbench__collaboration-mission-advance-notice">
              ${contract.collaborationMissionAdvanceNotice}
            </p>
          `
          : nothing
      }
      ${
        contract.collaborationMissionAdvanceError
          ? html`
            <p class="employee-workbench__collaboration-mission-advance-error">
              ${contract.collaborationMissionAdvanceError}
            </p>
          `
          : nothing
      }
    </div>
  `;
}

export function renderCollaborationStatusCapsule(
  shellModel: WorkbenchShellModel,
  _model: WorkbenchHomeModel,
  spacesResult: WorkbenchCollaborationSpacesSnapshot | undefined,
  contract: WorkbenchCollaborationStageContract,
) {
  const { members } = resolveCollaborationMembers(shellModel, spacesResult, contract);
  const humans = members.filter((entry) => entry.kind === "human");
  const bots = members.filter((entry) => entry.kind === "bot");
  const zones: Array<{
    tone: "human" | "bot";
    members: CollaborationMemberChip[];
    width: number;
    title: string;
  }> = [];
  if (humans.length > 0) {
    zones.push({
      tone: "human",
      members: humans,
      width: computeCapsuleZoneWidth(humans),
      title: readLabel("frontstage.workbench.memberGovernance.humans", "成员"),
    });
  }
  if (bots.length > 0) {
    zones.push({
      tone: "bot",
      members: bots,
      width: computeCapsuleZoneWidth(bots),
      title: readLabel("frontstage.workbench.memberGovernance.bots", "机器人"),
    });
  }
  if (zones.length === 0) {
    zones.push({
      tone: "human",
      members: [],
      width: computeCapsuleZoneWidth([]),
      title: readLabel("frontstage.workbench.memberGovernance.humans", "成员"),
    });
  }
  const trackWidth = zones.reduce((sum, zone) => sum + zone.width, 0);
  const soloZone = zones.length === 1;
  const capsuleTrackStyle = [
    `--employee-workbench-collaboration-track-width: ${trackWidth}px`,
    `grid-template-columns: ${zones.map((zone) => `${zone.width}px`).join(" ")}`,
  ].join("; ");
  return html`
    <div class="employee-workbench__collaboration-capsule-wrap">
      <section class="employee-workbench__collaboration-capsule employee-workbench__collaboration-capsule--flat">
        <div
          class="employee-workbench__collaboration-capsule-track"
          style=${capsuleTrackStyle}
        >
          ${zones.map(
            (zone) => html`
              ${renderMemberZone(zone.title, zone.members, zone.tone, soloZone)}
            `,
          )}
        </div>
      </section>
      ${renderCollaborationMissionAdvanceActions(contract)}
      ${renderCollaborationOptionalSuggestions(contract)}
    </div>
  `;
}

export function renderCollaborationStatusTools(
  shellModel: WorkbenchShellModel,
  _model: WorkbenchHomeModel,
  spacesResult: WorkbenchCollaborationSpacesSnapshot | undefined,
  contract: WorkbenchCollaborationStageContract,
) {
  const { members } = resolveCollaborationMembers(shellModel, spacesResult, contract);
  const memberPanelOpen = contract.memberGovernanceDrawerOpen === true;
  const filePreviewOpen = contract.artifactPreviewOpen === true;
  const pendingApprovalCount = Math.max(0, contract.pendingBotApprovalCount ?? 0);
  const memberToolLabel =
    pendingApprovalCount > 0
      ? `${readLabel("frontstage.workbench.memberGovernance.title", "管理协作成员")}，待审批 ${pendingApprovalCount}`
      : readLabel("frontstage.workbench.memberGovernance.title", "管理协作成员");
  return html`
    <div class="employee-workbench__stage-collaboration-tools-wrap">
      <div class="employee-workbench__stage-collaboration-tools">
      <button
        type="button"
        class="btn btn--sm employee-workbench__stage-collaboration-tool ${
          memberPanelOpen ? "is-active" : ""
        }"
        aria-pressed=${memberPanelOpen ? "true" : "false"}
        aria-label=${memberToolLabel}
        @click=${() => contract.onOpenMemberGovernance()}
      >
        ${icons.users}
        <span>${members.length}</span>
        ${
          pendingApprovalCount > 0
            ? html`<span
                class="employee-workbench__stage-collaboration-tool-badge"
                aria-hidden="true"
                >${pendingApprovalCount}</span
              >`
            : nothing
        }
      </button>
      <button
        type="button"
        class="btn btn--sm employee-workbench__stage-collaboration-tool ${
          filePreviewOpen ? "is-active" : ""
        }"
        aria-pressed=${filePreviewOpen ? "true" : "false"}
        aria-label=${readLabel("chat.openArtifact", "预览群组文件")}
        @click=${() => contract.onOpenFilePreview()}
      >
        ${icons.fileText}
      </button>
    </div>
    </div>
  `;
}

export function renderCollaborationReasonDrawer(contract: WorkbenchCollaborationStageContract) {
  if (!contract.collaborationReasonDrawerOpen) {
    return nothing;
  }
  const roundPlan =
    contract.collaborationRoundPlan?.sessionKey.trim() === contract.activeSessionKey.trim()
      ? contract.collaborationRoundPlan
      : null;
  return html`
    <div
      class="employee-workbench__collaboration-drawer-overlay"
      role="presentation"
      @click=${() => contract.onCloseCollaborationReasonDrawer?.()}
    >
      <aside
        class="employee-workbench__collaboration-drawer"
        role="dialog"
        aria-label="本轮参与原因"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <header class="employee-workbench__collaboration-drawer-head">
          <h3 class="employee-workbench__collaboration-drawer-title">为什么这些成员参与</h3>
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            aria-label="关闭"
            @click=${() => contract.onCloseCollaborationReasonDrawer?.()}
          >
            ${icons.x}
          </button>
        </header>
        <div class="employee-workbench__collaboration-drawer-body">
          ${
            roundPlan?.participants?.length
              ? html`
                <ul class="employee-workbench__collaboration-reason-list">
                  ${roundPlan.participants.map(
                    (participant: {
                      displayName: string;
                      tier: string;
                      reasonText: string;
                    }) => html`
                      <li class="employee-workbench__collaboration-reason-item">
                        <span class="employee-workbench__collaboration-reason-name">
                          ${participant.displayName}
                        </span>
                        <span class="employee-workbench__collaboration-reason-tier">
                          ${tierLabel(participant.tier)}
                        </span>
                        <p class="employee-workbench__collaboration-reason-text">
                          ${participant.reasonText}
                        </p>
                      </li>
                    `,
                  )}
                </ul>
              `
              : html`
                  <p class="muted">暂无本轮参与说明</p>
                `
          }
        </div>
      </aside>
    </div>
  `;
}

export function renderCollaborationRulesDrawer(contract: WorkbenchCollaborationStageContract) {
  if (!contract.collaborationRulesDrawerOpen) {
    return nothing;
  }
  const sections = contract.collaborationRulesSections ?? [];
  const rules = contract.collaborationRulesSummary ?? [];
  return html`
    <div
      class="employee-workbench__collaboration-drawer-overlay"
      role="presentation"
      @click=${() => contract.onCloseCollaborationRulesDrawer?.()}
    >
      <aside
        class="employee-workbench__collaboration-drawer"
        role="dialog"
        aria-label="协作规则说明"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <header class="employee-workbench__collaboration-drawer-head">
          <h3 class="employee-workbench__collaboration-drawer-title">协作规则说明</h3>
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            aria-label="关闭"
            @click=${() => contract.onCloseCollaborationRulesDrawer?.()}
          >
            ${icons.x}
          </button>
        </header>
        <div class="employee-workbench__collaboration-drawer-body">
          ${
            sections.length > 0
              ? html`
                <div class="employee-workbench__collaboration-rules-sections">
                  ${sections.map(
                    (section) => html`
                      <section
                        class="employee-workbench__collaboration-rules-section"
                        data-enforcement=${section.enforcement}
                      >
                        <header class="employee-workbench__collaboration-rules-section-head">
                          <h4 class="employee-workbench__collaboration-rules-section-title">
                            ${section.title}
                          </h4>
                          <span class="employee-workbench__collaboration-rules-enforcement">
                            ${section.enforcementLabel}
                          </span>
                        </header>
                        <p class="employee-workbench__collaboration-rules-section-hint">
                          ${section.hint}
                        </p>
                        <ul class="employee-workbench__collaboration-rules-list">
                          ${section.lines.map(
                            (rule) => html`
                              <li class="employee-workbench__collaboration-rules-item">${rule}</li>
                            `,
                          )}
                        </ul>
                      </section>
                    `,
                  )}
                </div>
              `
              : rules.length > 0
                ? html`
                <ul class="employee-workbench__collaboration-rules-list">
                  ${rules.map(
                    (rule) => html`
                      <li class="employee-workbench__collaboration-rules-item">${rule}</li>
                    `,
                  )}
                </ul>
              `
                : html`
                    <p class="muted">暂无协作规则摘要</p>
                  `
          }
        </div>
      </aside>
    </div>
  `;
}

function renderMemberGovernanceDock(content: import("lit").TemplateResult) {
  return html`
    <aside
      class="employee-workbench__member-governance-drawer employee-workbench__member-governance-drawer--docked"
      role="complementary"
      aria-label=${readLabel("frontstage.workbench.memberGovernance.title", "成员管理")}
    >
      ${content}
    </aside>
  `;
}

function renderMemberGovernanceUnavailablePanel(
  presentation: "docked" | "inline" | "overlay" = "overlay",
) {
  return html`
    <section
      class="employee-workbench__member-governance-panel employee-workbench__member-governance-panel--${presentation} employee-workbench__member-governance-panel--flat employee-workbench__member-governance-panel--unavailable"
    >
      <header class="employee-workbench__member-governance-panel-head">
        <div class="employee-workbench__member-governance-panel-identity">
          <h2 class="employee-workbench__member-governance-group-name">
            ${readLabel("frontstage.workbench.memberGovernance.title", "成员管理")}
          </h2>
        </div>
      </header>
      <p class="employee-workbench__member-governance-unavailable">
        ${readLabel(
          "frontstage.workbench.memberGovernance.unavailable",
          "暂时无法加载成员管理，请确认协作小组已创建完成后再试。",
        )}
      </p>
    </section>
  `;
}

function renderMemberGovernancePanelForContract(
  contract: WorkbenchCollaborationStageContract,
  presentation: "docked" | "inline" | "overlay",
) {
  const state = contract.memberGovernance;
  if (!state) {
    return renderMemberGovernanceUnavailablePanel(presentation);
  }
  const selfPendingInvite = state.selfPendingInvite ?? null;
  const isInvitee = Boolean(selfPendingInvite);
  const isReadOnly = state.activeGroupRole === "member" || isInvitee;
  const selectedHumanIds = new Set(state.selectedHumanIds);
  const selectedBotIds = new Set(state.selectedBotIds);
  return renderGroupMemberGovernancePanel({
    open: true,
    presentation,
    groupTitle: state.title,
    readOnly: isReadOnly,
    // Invitees are not members yet — leave only after accepting.
    showLeaveAction: state.activeGroupRole === "member" && !isInvitee,
    currentOwnerUserId: state.currentOwnerUserId ?? null,
    prompt: state.prompt,
    busy: state.busy,
    invitingHumanId: state.invitingHumanId ?? null,
    invitingBotId: state.invitingBotId ?? null,
    error: state.error,
    result: state.result,
    canReset: state.canReset,
    currentHumans: state.currentHumans,
    currentBots: state.currentBots,
    candidateHumans: state.candidateHumans,
    candidateBots: state.candidateBots,
    pendingHumanInvites: state.pendingHumanInvites,
    pendingBotInvites: state.pendingBotInvites,
    selfPendingInvite,
    selectedHumanCandidates: state.candidateHumans.filter((entry) =>
      selectedHumanIds.has(entry.id),
    ),
    selectedBotCandidates: state.candidateBots.filter((entry) => selectedBotIds.has(entry.id)),
    selectorKind: state.selectorKind,
    search: state.search,
    onClose: () => contract.onClosePreview(),
    onPromptChange: (value) => contract.onMemberGovernancePromptChange(value),
    onParse: () => contract.onMemberGovernanceParse(),
    onOpenSelector: (kind) => contract.onMemberGovernanceOpenSelector(kind),
    onSearchChange: (value) => contract.onMemberGovernanceSearchChange(value),
    onToggleHumanSelection: (id) => contract.onMemberGovernanceToggleHumanSelection(id),
    onToggleBotSelection: (id) => contract.onMemberGovernanceToggleBotSelection(id),
    onCommitSelection: () => contract.onMemberGovernanceCommitSelection(),
    onInviteHumanCandidate: (id) => contract.onMemberGovernanceInviteHuman(id),
    onInviteBotCandidate: (id) => contract.onMemberGovernanceInviteBot(id),
    onCancelInvite: isReadOnly
      ? null
      : (intentId) => contract.onMemberGovernanceCancelInvite(intentId),
    onRemoveMember: (id, kind) => contract.onMemberGovernanceRemoveMember(id, kind),
    onApproveBotInvite: (agentId) => contract.onMemberGovernanceApproveBotInvite(agentId),
    onRejectBotInvite: (agentId) => contract.onMemberGovernanceRejectBotInvite(agentId),
    onAcceptSelfInvite: () => contract.onMemberGovernanceAcceptSelfInvite(),
    onRejectSelfInvite: () => contract.onMemberGovernanceRejectSelfInvite(),
    onLeaveGroup: () => contract.onLeaveCollaborationGroup?.(),
    onTransferOwnershipToHuman: (userId) =>
      contract.onTransferCollaborationGroupOwnershipToHuman?.(userId),
    onReset: () => contract.onMemberGovernanceReset(),
  });
}

export function renderCollaborationMemberGovernanceDrawer(
  contract: WorkbenchCollaborationStageContract,
) {
  const governancePanel = renderMemberGovernancePanelForContract(contract, "docked");
  return renderMemberGovernanceDock(governancePanel as import("lit").TemplateResult);
}

/** Full-stage member management (settings / invite deep-link), not chat + docked drawer. */
export function renderCollaborationMembersManagementPage(
  contract: WorkbenchCollaborationStageContract,
) {
  return html`
    <section
      class="employee-workbench__collaboration-stage employee-workbench__collaboration-stage--flat employee-workbench__collaboration-stage--members-page"
      aria-label=${readLabel("frontstage.workbench.memberGovernance.title", "成员管理")}
    >
      <div
        class="employee-workbench__collaboration-stage-main employee-workbench__collaboration-stage-main--flat employee-workbench__collaboration-stage-main--members-page"
      >
        ${renderMemberGovernancePanelForContract(contract, "inline")}
      </div>
    </section>
  `;
}

export function renderCollaborationStagePage(
  conversation: {
    authPanel: import("lit").TemplateResult | null;
    chatContent: import("lit").TemplateResult;
    chatComposer: import("lit").TemplateResult | null;
  },
  shellModel: WorkbenchShellModel,
  _model: WorkbenchHomeModel,
  contract: WorkbenchCollaborationStageContract,
  _spacesResult: WorkbenchCollaborationSpacesSnapshot | undefined,
) {
  if (conversation.authPanel) {
    return html`
      <section class="employee-workbench__collaboration-stage employee-workbench__collaboration-stage--flat">
        <div class="employee-workbench__collaboration-stage-main employee-workbench__collaboration-stage-main--flat">
          <div class="employee-workbench__auth-stage">${conversation.authPanel}</div>
        </div>
      </section>
    `;
  }

  return html`
    <section
      class="employee-workbench__collaboration-stage employee-workbench__collaboration-stage--flat ${
        contract.memberGovernanceDrawerOpen
          ? "employee-workbench__collaboration-stage--with-member-governance"
          : ""
      }"
    >
      <div class="employee-workbench__collaboration-stage-main employee-workbench__collaboration-stage-main--flat">
        ${
          renderConversationStageShell({
            authPanel: conversation.authPanel,
            chatContent: conversation.chatContent,
            chatComposer: conversation.chatComposer,
            activeSessionKey: contract.activeSessionKey,
          }) ?? nothing
        }
      </div>
      ${
        contract.memberGovernanceDrawerOpen
          ? renderCollaborationMemberGovernanceDrawer(contract)
          : nothing
      }
    </section>
  `;
}
