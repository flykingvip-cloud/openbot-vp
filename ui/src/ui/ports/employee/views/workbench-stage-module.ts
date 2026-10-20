import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { isBuiltinStewardAgent } from "../../../builtin-steward-selection.ts";
import { formatRelativeTimestamp } from "../../../format.ts";
import { renderKnowledgeUniversePage } from "../../../views/knowledge-universe-page.ts";
import "../../../views/employee-model-access-section.ts";
import "./employee-evolution-perception-section.ts";
import "./employee-evolution-decision-section.ts";
import "./employee-personal-cron-center.ts";
import "./employee-supervisor-center.ts";
import { renderSaveSkillModal } from "../../../views/save-skill-modal.ts";
import { DEFAULT_DATA_SPACE_DISPLAY_ROOT, type WorkbenchDataSpaceSettings } from "../data-space.ts";
import { employeeEvolutionDecisionSurfaceMountEnabled } from "../evolution-decision/runtime-gate.ts";
import { robotRosterEmptyCopy } from "../robot-roster-status.ts";
import { renderCollaborationGroupMembersTable } from "./collaboration-group-members-table.ts";
import { renderEmployeeAssignedTasksCenter } from "./employee-assigned-tasks-center.ts";
import { renderEmployeeMeetingMinutesCenter } from "./employee-meeting-minutes-center.ts";
import { renderPersonalCronCenter } from "./employee-personal-cron-center.ts";
import { renderEmployeeSupervisorCenter } from "./employee-supervisor-center.ts";
import { renderMyBotWorkspacePanel, type MyBotDetailTabId } from "./my-bot-workspace-panel.ts";
import { renderPersonalSettingsPage } from "./workbench-personal-settings-page.ts";
import {
  wbSettingsDetailToolbar,
  wbSettingsSection,
  wbSettingsSubhead,
} from "./workbench-settings-layout.ts";
import type { WorkbenchShellModel } from "./workbench-shell-model.ts";
import type { WorkbenchStageModuleContract } from "./workbench-stage-contracts.ts";
import {
  WORKBENCH_SYSTEM_SETTINGS_TAB_ORDER,
  type WorkbenchSettingsRobotEntry,
  type WorkbenchSystemAuthorizationKey,
  type WorkbenchSystemSettingsTab,
} from "./workbench-types.ts";

/** Compact horizontal choice chips — preferred over full-width vertical segment cards. */
function renderChoiceChips(params: {
  label: string;
  hint?: string;
  value: string;
  disabled?: boolean;
  options: Array<{ value: string; label: string; title?: string }>;
  onChange: (value: string) => void;
}) {
  return html`
    <div class="wb-groups__field">
      <div class="wb-groups__field-label-row">
        <span class="employee-workbench__settings-field-label">${params.label}</span>
        ${params.hint ? html`<span class="wb-groups__field-hint">${params.hint}</span>` : nothing}
      </div>
      <div class="wb-groups__chips" role="radiogroup" aria-label=${params.label}>
        ${params.options.map(
          (opt) => html`
            <button
              type="button"
              class="wb-groups__chip ${params.value === opt.value ? "is-active" : ""}"
              role="radio"
              aria-checked=${String(params.value === opt.value)}
              title=${opt.title ?? opt.label}
              ?disabled=${Boolean(params.disabled)}
              @click=${() => {
                if (!params.disabled && params.value !== opt.value) {
                  params.onChange(opt.value);
                }
              }}
            >
              ${opt.label}
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

function renderToggleRow(params: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return html`
    <button
      type="button"
      class="employee-workbench__settings-toggle ${params.checked ? "is-active" : ""}"
      role="switch"
      aria-checked=${String(params.checked)}
      title=${params.description?.trim() || ""}
      ?disabled=${Boolean(params.disabled)}
      @click=${() => params.onToggle(!params.checked)}
    >
      <span class="employee-workbench__settings-toggle-copy">
        <span class="employee-workbench__settings-toggle-title">${params.title}</span>
        ${
          params.description
            ? html`
                <span class="employee-workbench__settings-toggle-description">
                  ${params.description}
                </span>
              `
            : nothing
        }
      </span>
      <span class="employee-workbench__settings-toggle-track" aria-hidden="true">
        <span class="employee-workbench__settings-toggle-thumb"></span>
      </span>
    </button>
  `;
}

type SettingsContract = NonNullable<WorkbenchStageModuleContract["settings"]>;

function renderSettingsPill(label: string, tone: "default" | "ok" | "warn" = "default") {
  return html`
    <span class="employee-workbench__settings-pill employee-workbench__settings-pill--${tone}">
      ${label}
    </span>
  `;
}

function renderSettingsGroupMetric(label: string, value: string | number) {
  return html`
    <div class="wb-groups__kv-row">
      <dt>${label}</dt>
      <dd>${value}</dd>
    </div>
  `;
}

type SystemAuthorizationItem = {
  key: WorkbenchSystemAuthorizationKey;
  title: string;
  description: string;
  granted: boolean | null;
};

function renderShieldIcon() {
  return html`
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
      <path d="M12 3l7 3v5.5c0 4.2-2.7 7.8-7 9.5-4.3-1.7-7-5.3-7-9.5V6l7-3z"></path>
      <path d="M12 8v5"></path>
      <path d="M12 16h.01"></path>
    </svg>
  `;
}

function renderSystemAuthorizationList(
  items: SystemAuthorizationItem[],
  settings: SettingsContract,
) {
  return html`
    <section class="employee-workbench__settings-authorization-panel">
      <div class="employee-workbench__settings-section-head">
        <div>
          <div class="employee-workbench__settings-section-title">系统授权</div>
          <div class="employee-workbench__settings-section-subtitle">
            OpenBot 在本机执行、通知和自动化所需的系统权限。
          </div>
        </div>
      </div>
      <div class="employee-workbench__settings-authorization-list employee-workbench__settings-authorization-list--flat">
        ${items.map((item) => {
          const tone = item.granted === true ? "ok" : item.granted === false ? "warn" : "default";
          const label =
            item.granted === true ? "已授权" : item.granted === false ? "未授权" : "待确认";
          return html`
            <div class="employee-workbench__settings-authorization-item">
              <span class="employee-workbench__settings-authorization-icon" aria-hidden="true">
                ${renderShieldIcon()}
              </span>
              <span class="employee-workbench__settings-authorization-copy">
                <span class="employee-workbench__settings-authorization-title">
                  ${item.title}
                  ${renderSettingsPill(label, tone)}
                </span>
                <span class="employee-workbench__settings-authorization-description">
                  ${item.description}
                </span>
              </span>
              <button
                type="button"
                class="btn btn--primary"
                title="打开系统设置完成授权"
                @click=${() => settings.onOpenSystemAuthorization(item.key)}
              >
                去授权
              </button>
            </div>
          `;
        })}
      </div>
    </section>
  `;
}

function renderDataSpacePanel(dataSpace: WorkbenchDataSpaceSettings) {
  const isManaged = dataSpace.mode === "managed";
  return html`
    <section
      class="employee-workbench__settings-workspace-panel employee-workbench__settings-workspace-panel--flat"
      aria-label="OpenBot 数据空间"
    >
      <div class="employee-workbench__settings-workspace-copy">
        <div class="employee-workbench__settings-section-title">OpenBot 数据空间</div>
        <div class="employee-workbench__settings-section-subtitle">
          ${
            isManaged
              ? "您的数据存储在 OpenBot 云端，由平台加密托管。员工端不提供目录浏览或路径配置。"
              : "安装后默认使用本机数据目录。机器人、协作小组与知识空间会在其下自动生成结构化子目录。"
          }
        </div>
      </div>
      ${
        isManaged
          ? html`
              <div class="callout employee-workbench__settings-callout">
                数据由 OpenBot 云端托管。如需导出或迁移，请联系管理员或使用 Mac 客户端（Phase 2）。
              </div>
            `
          : html`
              <div class="employee-workbench__settings-workspace-row">
                <div class="employee-workbench__settings-field-label">数据根目录（只读）</div>
                <div class="employee-workbench__settings-workspace-path mono">
                  ${dataSpace.displayRoot || DEFAULT_DATA_SPACE_DISPLAY_ROOT}
                </div>
              </div>
              <div class="employee-workbench__settings-status-copy">
                路径定制与迁移请前往「个人设置 → 高级 → 数据目录」。
              </div>
            `
      }
    </section>
  `;
}

function readLabel(key: string, fallback: string) {
  const value = t(key);
  return value === key ? fallback : value;
}

const SYSTEM_SETTINGS_TAB_LABELS: Record<
  WorkbenchSystemSettingsTab,
  { key?: string; fallback: string }
> = {
  security: {
    key: "frontstage.workbench.settings.systemModules.security.title",
    fallback: "安全与隐私",
  },
  devices: { fallback: "我的设备" },
  robots: {
    key: "frontstage.workbench.settings.systemModules.robots.title",
    fallback: "我的机器人",
  },
  groups: {
    key: "frontstage.workbench.settings.systemModules.groups.title",
    fallback: "我的协作小组",
  },
  models: { fallback: "AI 模型" },
  evolution: {
    key: "frontstage.workbench.settings.systemModules.evolution.title",
    fallback: "进化",
  },
};

function systemSettingsTabLabel(tab: WorkbenchSystemSettingsTab): string {
  const label = SYSTEM_SETTINGS_TAB_LABELS[tab];
  return label.key ? readLabel(label.key, label.fallback) : label.fallback;
}

/**
 * 员工端 Runtime 简略态（Strong Separation Phase 1）。
 * 仅三色：可用 / 异常 / 离线（unconfigured → 未知）。
 * 不展示渠道明细、hostId、GPU —— 完整 Runtime 仅在机巢运营 Tab。
 */
function formatRobotHealthLabel(health: WorkbenchSettingsRobotEntry["health"]): string | null {
  switch (health) {
    case "online":
      return "可用";
    case "degraded":
      return "异常";
    case "offline":
      return "离线";
    case "unconfigured":
      return "未知";
    default:
      return null;
  }
}

function formatSettingsGroupConfidentiality(tier: string | null | undefined) {
  switch (tier?.trim()) {
    case "public":
      return "公开";
    case "internal":
      return "内部";
    case "restricted":
      return "受限";
    case "secret":
      return "机密";
    default:
      return "未设置";
  }
}

function formatSettingsGroupVisibility(scope: string | null | undefined) {
  switch (scope?.trim()) {
    case "group_only":
      return "仅小组内";
    case "tenant":
      return "租户内";
    case "organization":
      return "组织内";
    default:
      return "未设置";
  }
}

function resolveSettingsGroupEntryKey(entry: {
  groupId?: string | null;
  sessionKey?: string | null;
}) {
  return entry.groupId?.trim() || entry.sessionKey?.trim() || "";
}

function renderSettingsTextarea(params: {
  value: string;
  placeholder?: string;
  onInput: (value: string) => void;
  rows?: number;
  disabled?: boolean;
}) {
  return html`
    <textarea
      class="employee-workbench__settings-textarea"
      rows=${String(params.rows ?? 4)}
      .value=${params.value}
      placeholder=${params.placeholder ?? ""}
      ?disabled=${Boolean(params.disabled)}
      @input=${(event: Event) => params.onInput((event.currentTarget as HTMLTextAreaElement).value)}
    ></textarea>
  `;
}

function buildFallbackSettingsDraft(group: NonNullable<SettingsContract["selectedGroupEntry"]>) {
  const maxVisible =
    typeof group.policyMaxVisibleBotRepliesPerRound === "number" &&
    Number.isFinite(group.policyMaxVisibleBotRepliesPerRound)
      ? Math.max(1, Math.min(50, Math.round(group.policyMaxVisibleBotRepliesPerRound)))
      : 5;
  return {
    groupId: resolveSettingsGroupEntryKey(group),
    title: group.title,
    avatar: group.avatar ?? "",
    visibilityScope: group.visibilityScope ?? "group_only",
    purpose: group.purpose ?? "",
    currentMission: group.currentMission ?? "",
    coordinatorBotId: group.coordinatorBotId ?? "",
    collaborationMode: group.collaborationMode ?? "discussion_driven",
    confidentialityTier: group.confidentialityTier ?? "internal",
    successCriteriaText: (group.successCriteria ?? []).join("\n"),
    rulesSummaryText: (group.systemInstructions?.length
      ? group.systemInstructions
      : (group.rulesSummary ?? [])
    ).join("\n"),
    finalDecisionMode: group.finalDecisionPolicy?.mode ?? "human_required",
    finalDecisionRole: group.finalDecisionPolicy?.defaultFinalDeciderRole ?? "owner",
    allowAgentPublishProposal: group.finalDecisionPolicy?.allowAgentPublishProposal !== false,
    openDiscussionWithoutMention: group.policyOpenDiscussion !== false,
    maxVisibleBotRepliesPerRound: maxVisible,
  };
}

/** 协作小组草稿中「可编辑字段」的可比较子集，用于未保存变更检测。 */
type SettingsGroupDraftComparable = {
  title: string;
  avatar: string;
  visibilityScope: string;
  purpose: string;
  currentMission: string;
  coordinatorBotId: string;
  collaborationMode: string;
  confidentialityTier: string;
  successCriteriaText: string;
  rulesSummaryText: string;
  finalDecisionMode: string;
  finalDecisionRole: string;
  allowAgentPublishProposal: boolean;
  openDiscussionWithoutMention: boolean;
  maxVisibleBotRepliesPerRound: number;
};

/**
 * 判断当前草稿相对基线（来自小组实体）是否存在未保存修改。
 * 驱动保存按钮高亮与切换小组时的确认弹窗（顶栏不再单独展示 pill）。
 */
function isSettingsGroupDraftDirty(
  draft: SettingsGroupDraftComparable,
  baseline: SettingsGroupDraftComparable,
) {
  return (
    draft.title !== baseline.title ||
    draft.avatar !== baseline.avatar ||
    draft.visibilityScope !== baseline.visibilityScope ||
    draft.purpose !== baseline.purpose ||
    draft.currentMission !== baseline.currentMission ||
    draft.coordinatorBotId !== baseline.coordinatorBotId ||
    draft.collaborationMode !== baseline.collaborationMode ||
    draft.confidentialityTier !== baseline.confidentialityTier ||
    draft.successCriteriaText !== baseline.successCriteriaText ||
    draft.rulesSummaryText !== baseline.rulesSummaryText ||
    draft.finalDecisionMode !== baseline.finalDecisionMode ||
    draft.finalDecisionRole !== baseline.finalDecisionRole ||
    draft.allowAgentPublishProposal !== baseline.allowAgentPublishProposal ||
    draft.openDiscussionWithoutMention !== baseline.openDiscussionWithoutMention ||
    draft.maxVisibleBotRepliesPerRound !== baseline.maxVisibleBotRepliesPerRound
  );
}

function renderSkillSavePanel(settings: SettingsContract) {
  return renderSaveSkillModal({
    open: true,
    busy: settings.skillSaveModalBusy ?? false,
    error: settings.skillSaveModalError ?? null,
    formData: settings.skillSaveModalFormData ?? null,
    extractedPreview: settings.skillExtractedPreview ?? null,
    availableGroups: settings.skillAvailableGroups ?? [],
    preferEnterpriseSubmitAction: settings.skillSaveModalPreferEnterpriseSubmit ?? false,
    showEnterpriseSubmitAction: settings.skillSaveModalShowEnterpriseSubmitAction ?? false,
    onFormChange: (patch) => settings.onSkillSaveFormChange?.(patch),
    onSave: () => void settings.onSubmitSkillSave?.(),
    onSaveAndSubmit: () => void settings.onSubmitSkillSaveAndContinue?.(),
    onClose: () => settings.onCloseSkillSave?.(),
  });
}

function renderSystemSettingsPage(
  settings: SettingsContract,
  _itemTitle: string,
  _subtitle: string,
) {
  const dataSpace = settings.dataSpace ?? {
    mode: "local" as const,
    displayRoot: DEFAULT_DATA_SPACE_DISPLAY_ROOT,
    isConfigured: true,
  };
  const robotEntries = settings.robotEntries ?? [];
  const groupEntries = settings.groupEntries ?? [];
  const activeTab = settings.systemTab;
  const skillSaveOpen = Boolean(settings.skillSaveModalOpen && settings.skillSaveModalFormData);
  const selectedGroupKey =
    settings.selectedGroupKey ??
    (settings.selectedGroupEntry
      ? resolveSettingsGroupEntryKey(settings.selectedGroupEntry)
      : null) ??
    settings.selectedGroupDraft?.groupId ??
    null;
  const selectedGroup =
    groupEntries.find((entry) => resolveSettingsGroupEntryKey(entry) === selectedGroupKey) ??
    settings.selectedGroupEntry ??
    groupEntries[0] ??
    null;
  const selectedGroupEntryKey = selectedGroup ? resolveSettingsGroupEntryKey(selectedGroup) : "";
  const selectSettingsGroup = (entry: NonNullable<SettingsContract["groupEntries"]>[number]) => {
    const key = resolveSettingsGroupEntryKey(entry);
    if (key) {
      settings.onSystemSettingsGroupSelect(key);
    }
  };
  const groupDraft =
    selectedGroup &&
    settings.selectedGroupDraft &&
    settings.selectedGroupDraft.groupId === selectedGroupEntryKey
      ? settings.selectedGroupDraft
      : selectedGroup
        ? buildFallbackSettingsDraft(selectedGroup)
        : null;
  const canEditSelectedGroup = selectedGroup?.role === "owner";
  const groupBaseline = selectedGroup ? buildFallbackSettingsDraft(selectedGroup) : null;
  const groupDirty = Boolean(
    groupDraft && groupBaseline && isSettingsGroupDraftDirty(groupDraft, groupBaseline),
  );
  // 未保存修改时用户尝试切换到的目标小组（触发自绘确认弹窗）。
  const pendingSwitchGroupId = settings.systemSettingsPendingGroupId ?? null;
  const pendingSwitchTargetGroup = pendingSwitchGroupId
    ? (groupEntries.find((entry) => resolveSettingsGroupEntryKey(entry) === pendingSwitchGroupId) ??
      null)
    : null;
  const authorizationItems: SystemAuthorizationItem[] = [
    {
      key: "fullDiskAccess",
      title: "完全磁盘访问权限",
      description: "允许访问本地磁盘上的工作文件与沉淀目录，确保工作区读写与整理正常运行。",
      granted: settings.authorizationFullDiskAccessGranted ?? null,
    },
    {
      key: "accessibility",
      title: "辅助功能",
      description: "允许键盘快捷键、系统级交互与部分桌面协同操作正常工作。",
      granted: settings.authorizationAccessibilityGranted ?? null,
    },
    {
      key: "automation",
      title: "自动化",
      description: "允许向其他 App 发送指令，用于日历、提醒、文件与流程自动化联动。",
      granted: settings.authorizationAutomationGranted ?? null,
    },
    {
      key: "notifications",
      title: "通知",
      description: "允许发送桌面通知，在任务完成、审批变化或消息到达时及时提醒你。",
      granted: settings.authorizationNotificationsGranted ?? null,
    },
  ];
  const selectedRobotId = settings.myBotDetail?.agentId ?? null;
  const selectedRobot =
    robotEntries.find((entry) => entry.id === selectedRobotId) ?? robotEntries[0] ?? null;
  // Keep detail projection in sync with the visible selection (groups-style default).
  if (activeTab === "robots" && selectedRobot && selectedRobotId !== selectedRobot.id) {
    queueMicrotask(() => settings.onOpenMyBotDetail?.(selectedRobot.id));
  }
  const focusAuthAgentId = settings.robotIdentityGrantFocusAgentId ?? null;
  if (
    activeTab === "robots" &&
    focusAuthAgentId &&
    selectedRobot?.id === focusAuthAgentId &&
    settings.myBotDetail?.detailTab !== "auth"
  ) {
    queueMicrotask(() => {
      settings.onMyBotDetailTabChange?.("auth");
      settings.onRobotIdentityGrantFocusHandled?.();
    });
  }
  const activeRobotDetailTab = (settings.myBotDetail?.detailTab ?? "identity") as MyBotDetailTabId;
  const dataSpaceReady = dataSpace.isConfigured;
  const workspaceGovernanceCount = robotEntries.length + groupEntries.length;
  return html`
    <section class="employee-workbench__module-page employee-workbench__module-page--settings">
      <div class="employee-workbench__settings-grid employee-workbench__settings-grid--system">
        <section
          class="employee-workbench__settings-card employee-workbench__settings-card--system ${
            activeTab === "groups"
              ? "is-groups-workspace"
              : activeTab === "robots"
                ? "is-robots-workspace"
                : activeTab === "devices"
                  ? "is-devices-workspace"
                  : ""
          }"
        >
          ${
            skillSaveOpen
              ? renderSkillSavePanel(settings)
              : html`
          <div
            class="employee-workbench__settings-tabs employee-workbench__system-settings-tabs"
            role="tablist"
          >
            ${WORKBENCH_SYSTEM_SETTINGS_TAB_ORDER.map(
              (tab) => html`
                <button
                  type="button"
                  class="employee-workbench__settings-tab ${activeTab === tab ? "is-active" : ""}"
                  role="tab"
                  aria-selected=${String(activeTab === tab)}
                  data-system-settings-tab=${tab}
                  @click=${() => settings.onSystemTabChange(tab)}
                >
                  ${systemSettingsTabLabel(tab)}
                </button>
              `,
            )}
          </div>

          ${
            activeTab === "security"
              ? html`
          <div class="employee-workbench__settings-section">
            <div class="employee-workbench__settings-section-head">
              <div class="employee-workbench__settings-section-title">
                ${readLabel("frontstage.workbench.settings.systemModules.security.title", "安全与隐私")}
              </div>
            </div>
            <div
              class="employee-workbench__settings-status-grid employee-workbench__settings-status-grid--compact employee-workbench__settings-status-grid--flat"
            >
              <div class="employee-workbench__settings-status-card">
                <div class="employee-workbench__settings-field-label">数据空间</div>
                <div class="employee-workbench__settings-title">${dataSpaceReady ? "就绪" : "待初始化"}</div>
                <div class="employee-workbench__settings-status-copy">
                  ${
                    dataSpace.mode === "managed"
                      ? "云端托管"
                      : dataSpaceReady
                        ? "本机默认目录已就绪"
                        : "安装后将自动初始化"
                  }
                </div>
              </div>
              <div class="employee-workbench__settings-status-card">
                <div class="employee-workbench__settings-field-label">可治理对象</div>
                <div class="employee-workbench__settings-title">${String(workspaceGovernanceCount)}</div>
                <div class="employee-workbench__settings-status-copy">机器人与协作小组分别管理工作区</div>
              </div>
              <div class="employee-workbench__settings-status-card">
                <div class="employee-workbench__settings-field-label">网关状态</div>
                <div class="employee-workbench__settings-status-main">
                  ${
                    settings.connected
                      ? renderSettingsPill(t("common.ok"), "ok")
                      : renderSettingsPill(t("common.offline"), "warn")
                  }
                </div>
                <div class="employee-workbench__settings-status-copy">本地配置与保存依赖网关连接</div>
              </div>
            </div>
            ${renderDataSpacePanel(dataSpace)}
            ${renderSystemAuthorizationList(authorizationItems, settings)}
          </div>
              `
              : nothing
          }

          ${activeTab === "devices" ? renderMyDevicesSection(settings) : nothing}

          ${
            activeTab === "models"
              ? html`
          <div class="employee-workbench__settings-section">
            <employee-model-access-section
              .client=${settings.client ?? null}
              .embedded=${true}
            ></employee-model-access-section>
          </div>
              `
              : nothing
          }

          ${
            activeTab === "evolution"
              ? html`
          <employee-evolution-perception-section
            .client=${settings.client ?? null}
            .connected=${Boolean(settings.connected)}
          ></employee-evolution-perception-section>
          ${
            employeeEvolutionDecisionSurfaceMountEnabled()
              ? html`
                  <employee-evolution-decision-section></employee-evolution-decision-section>
                `
              : nothing
          }
              `
              : nothing
          }

          ${
            activeTab === "robots"
              ? html`
          <div
            class="employee-workbench__settings-section employee-workbench__settings-section--robots"
            data-wb-settings-pilot="robots"
            data-ui-build="20260806T142600Z"
          >
            <div class="wb-bots wb-bots--flat">
              <aside class="wb-bots__anchor wb-groups__anchor" aria-label="机器人列表">
                <div class="wb-bots__anchor-head wb-groups__anchor-head">
                  <div class="wb-bots__anchor-copy">
                    <span class="wb-bots__anchor-title">我的机器人</span>
                    <span class="wb-bots__anchor-count wb-groups__anchor-count"
                      >${robotEntries.length} 个</span
                    >
                  </div>
                </div>
                <div class="wb-bots__anchor-list wb-groups__anchor-list">
                  ${
                    robotEntries.length > 0
                      ? robotEntries.map((entry) => {
                          const activeAtLabel = entry.lastActiveAt
                            ? formatRelativeTimestamp(entry.lastActiveAt)
                            : null;
                          const metaLabel =
                            activeAtLabel ?? formatRobotHealthLabel(entry.health) ?? "";
                          const mark = entry.emoji
                            ? (Array.from(entry.emoji)[0] ?? "机")
                            : entry.name.trim().charAt(0) || "机";
                          return html`
                            <button
                              type="button"
                              class="wb-bots__row wb-groups__row ${
                                selectedRobot?.id === entry.id ? "is-active" : ""
                              }"
                              @click=${() => settings.onOpenMyBotDetail?.(entry.id)}
                            >
                              <span class="wb-groups__row-mark" aria-hidden="true">${mark}</span>
                              <div class="wb-groups__row-body">
                                <div class="wb-bots__row-main wb-groups__row-main">
                                  <span class="wb-bots__row-title wb-groups__row-title">
                                    ${entry.name}
                                  </span>
                                  <span class="wb-bots__row-role wb-groups__row-role">
                                    ${
                                      entry.source === "owned"
                                        ? readLabel(
                                            "frontstage.workbench.settings.systemModules.robots.mine",
                                            "我拥有",
                                          )
                                        : readLabel(
                                            "frontstage.workbench.settings.systemModules.robots.participating",
                                            "我参与",
                                          )
                                    }
                                  </span>
                                </div>
                                ${
                                  metaLabel
                                    ? html`
                                        <div class="wb-bots__row-meta wb-groups__row-meta">
                                          ${metaLabel}
                                        </div>
                                      `
                                    : nothing
                                }
                              </div>
                            </button>
                          `;
                        })
                      : html`
                          <div
                            class="employee-workbench__settings-manage-empty employee-workbench__settings-manage-empty--soft"
                            data-robot-roster-status=${settings.robotRosterStatus ?? "ready"}
                          >
                            ${robotRosterEmptyCopy(settings.robotRosterStatus)}
                          </div>
                        `
                  }
                </div>
              </aside>

              <div class="wb-bots__stage">
                ${
                  selectedRobot
                    ? renderMyBotWorkspacePanel({
                        entry: selectedRobot,
                        loading: Boolean(settings.myBotDetail?.loading),
                        error: settings.myBotDetail?.error ?? null,
                        saving: Boolean(settings.myBotDetail?.saving),
                        bot: settings.myBotDetail?.bot ?? null,
                        identityDraft: settings.myBotDetail?.identityDraft ?? null,
                        activeTab: activeRobotDetailTab,
                        onTabChange: (tab) => settings.onMyBotDetailTabChange?.(tab),
                        onIdentityDraftChange: (patch) =>
                          settings.onMyBotIdentityDraftChange?.(patch),
                        onSaveIdentity: () => void settings.onSaveMyBotIdentity?.(),
                        onExploreCapabilities: () =>
                          settings.onOpenInstallCapability(selectedRobot.id),
                        onOpenGroup: (groupId) => settings.onMyBotOpenGroup?.(groupId),
                        onSelectSession: (sessionKey) => settings.onSelectSession(sessionKey),
                        userOperationalIdentitySnapshot: settings.userOperationalIdentitySnapshot,
                        userOperationalIdentityBusy: Boolean(settings.userOperationalIdentityBusy),
                        userOperationalIdentityError: settings.userOperationalIdentityError ?? null,
                        userOperationalIdentityNotice:
                          settings.userOperationalIdentityNotice ?? null,
                        onApplyRobotIdentityGrants: (input) =>
                          void settings.onApplyRobotIdentityGrants?.(input),
                        onApplyRobotEnterpriseIdentities: (input) =>
                          void settings.onApplyRobotEnterpriseIdentities?.(input),
                        onAddPersonalIdentity: () => {
                          settings.onOpenPersonalOperationalIdentity?.({
                            openEditor: true,
                            agentId: selectedRobot.id,
                          });
                        },
                        onLoadRobotEnterpriseIdentities: (agentId) =>
                          settings.onLoadRobotEnterpriseIdentities?.(agentId),
                        ownedRobotDeleteBusyId: settings.ownedRobotDeleteBusyId,
                        ownedRobotDeleteError: settings.ownedRobotDeleteError,
                        ownedRobotDeleteDisposition: settings.ownedRobotDeleteDisposition,
                        onOwnedRobotDeleteDispositionChange: (value) =>
                          settings.onOwnedRobotDeleteDispositionChange?.(value),
                        onConfirmOwnedRobotDelete: () =>
                          void settings.onConfirmOwnedRobotDelete?.(),
                        onPrepareOwnedRobotDelete: (agentId, name) =>
                          settings.onOpenOwnedRobotDeletePrompt?.(agentId, name),
                      })
                    : html`
                        <div
                          class="employee-workbench__settings-manage-empty employee-workbench__settings-manage-empty--soft wb-bots__empty"
                        >
                          从左侧选择一个机器人，在此查看身份、授权与工作区。
                        </div>
                      `
                }
              </div>
            </div>
          </div>
              `
              : nothing
          }

          ${
            activeTab === "groups"
              ? html`
          <div class="employee-workbench__settings-section employee-workbench__settings-section--groups">
            ${
              pendingSwitchTargetGroup
                ? html`
                    <div
                      class="employee-workbench__settings-confirm-overlay"
                      role="dialog"
                      aria-modal="true"
                      aria-label="未保存修改确认"
                    >
                      <div class="employee-workbench__settings-confirm-card">
                        <div class="employee-workbench__settings-confirm-title">
                          保存对「${selectedGroup?.title ?? ""}」的修改？
                        </div>
                        <div class="employee-workbench__settings-confirm-body">
                          你有未保存的修改。切换到「${pendingSwitchTargetGroup.title}」前，请选择如何处理。
                        </div>
                        <div class="employee-workbench__settings-confirm-actions">
                          <button
                            type="button"
                            class="btn"
                            ?disabled=${settings.systemGroupSaving}
                            @click=${() => void settings.onResolveSystemSettingsGroupSwitch?.("cancel")}
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            class="btn btn--danger"
                            ?disabled=${settings.systemGroupSaving}
                            @click=${() => void settings.onResolveSystemSettingsGroupSwitch?.("discard")}
                          >
                            放弃修改
                          </button>
                          <button
                            type="button"
                            class="btn btn--primary"
                            ?disabled=${settings.systemGroupSaving}
                            @click=${() => void settings.onResolveSystemSettingsGroupSwitch?.("save")}
                          >
                            ${settings.systemGroupSaving ? t("common.loading") : "保存并切换"}
                          </button>
                        </div>
                      </div>
                    </div>
                  `
                : nothing
            }
            <div class="wb-groups wb-groups--flat" data-wb-settings-pilot="groups">
              <aside class="wb-groups__anchor" aria-label="协作小组列表">
                <div class="wb-groups__anchor-head">
                  <div class="wb-bots__anchor-copy">
                    <span class="wb-bots__anchor-title">我的协作小组</span>
                    <span class="wb-groups__anchor-count">${groupEntries.length} 个</span>
                  </div>
                </div>
                <div class="wb-groups__anchor-list">
                  ${
                    groupEntries.length > 0
                      ? groupEntries.map((entry) => {
                          const mark = (entry.title.trim().charAt(0) || "组").slice(0, 1);
                          return html`
                            <button
                              type="button"
                              class="wb-groups__row ${
                                selectedGroupEntryKey === resolveSettingsGroupEntryKey(entry)
                                  ? "is-active"
                                  : ""
                              }"
                              @pointerup=${(event: PointerEvent) => {
                                if (event.button === 0) {
                                  selectSettingsGroup(entry);
                                }
                              }}
                              @click=${() => selectSettingsGroup(entry)}
                            >
                              <span class="wb-groups__row-mark" aria-hidden="true">${mark}</span>
                              <div class="wb-groups__row-body">
                                <div class="wb-groups__row-main">
                                  <span class="wb-groups__row-title">${entry.title}</span>
                                  <span class="wb-groups__row-role">
                                    ${entry.memberCount} 人 ·
                                    ${
                                      entry.role === "owner"
                                        ? readLabel(
                                            "frontstage.workbench.settings.systemModules.groups.roleOwner",
                                            "组长",
                                          )
                                        : readLabel(
                                            "frontstage.workbench.settings.systemModules.groups.roleMember",
                                            "成员",
                                          )
                                    }
                                  </span>
                                </div>
                              </div>
                            </button>
                          `;
                        })
                      : html`
                          <div class="employee-workbench__settings-manage-empty employee-workbench__settings-manage-empty--soft">
                            ${readLabel(
                              "frontstage.workbench.settings.systemModules.groups.empty",
                              "还没有可管理的协作小组。可在左侧协作空间旁创建。",
                            )}
                          </div>
                        `
                  }
                </div>
              </aside>

              <div class="wb-groups__stage">
                ${
                  selectedGroup && groupDraft
                    ? html`
                        <div class="wb-groups__stage-inner">
                          ${wbSettingsDetailToolbar({
                            title: selectedGroup.title,
                            dirty: Boolean(canEditSelectedGroup && groupDirty),
                            actions: html`
                              <button
                                type="button"
                                class="btn"
                                @click=${() => settings.onOpenSystemSettingsGroupMembers()}
                              >
                                管理成员
                              </button>
                              <button
                                type="button"
                                class="btn"
                                @click=${() => settings.onExportSystemSettingsGroupSummary()}
                              >
                                导出摘要
                              </button>
                              <button
                                type="button"
                                class="btn ${groupDirty && canEditSelectedGroup ? "btn--primary" : ""}"
                                ?disabled=${settings.systemGroupSaving || !canEditSelectedGroup}
                                @click=${() => void settings.onSaveSystemSettingsGroup()}
                              >
                                ${
                                  settings.systemGroupSaving
                                    ? t("common.loading")
                                    : canEditSelectedGroup
                                      ? "保存设置"
                                      : "仅群主可编辑"
                                }
                              </button>
                            `,
                          })}

                          <dl class="wb-groups__kv">
                            ${renderSettingsGroupMetric(
                              "人类成员",
                              String(selectedGroup.activeHumanCount ?? 0),
                            )}
                            ${renderSettingsGroupMetric(
                              "机器人成员",
                              String(selectedGroup.activeBotCount ?? 0),
                            )}
                            ${renderSettingsGroupMetric(
                              "待审批",
                              String(
                                (selectedGroup.pendingHumanInviteCount ?? 0) +
                                  (selectedGroup.pendingBotInviteCount ?? 0),
                              ),
                            )}
                            ${renderSettingsGroupMetric(
                              "我的角色",
                              selectedGroup.role === "owner" ? "群主" : "成员",
                            )}
                          </dl>

                          ${
                            settings.systemGroupError
                              ? html`
                                  <div class="callout callout--danger employee-workbench__settings-callout">
                                    ${settings.systemGroupError}
                                  </div>
                                `
                              : nothing
                          }
                          ${
                            settings.systemGroupNotice
                              ? html`
                                  <div class="callout employee-workbench__settings-callout">
                                    ${settings.systemGroupNotice}
                                  </div>
                                `
                              : nothing
                          }

                          <div class="wb-groups__sections">
                            ${wbSettingsSection({
                              title: "基本信息",
                              content: html`
                                <div class="wb-groups__form-grid employee-workbench__settings-form-grid">
                                  <label class="employee-workbench__settings-field">
                                    <span class="employee-workbench__settings-field-label">名称</span>
                                    <input
                                      class="employee-workbench__settings-input"
                                      type="text"
                                      .value=${groupDraft.title}
                                      ?disabled=${!canEditSelectedGroup}
                                      @input=${(event: Event) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          title: (event.currentTarget as HTMLInputElement).value,
                                        })}
                                    />
                                  </label>
                                  <label class="employee-workbench__settings-field">
                                    <span class="employee-workbench__settings-field-label">头像</span>
                                    <input
                                      class="employee-workbench__settings-input"
                                      type="text"
                                      .value=${groupDraft.avatar}
                                      ?disabled=${!canEditSelectedGroup}
                                      placeholder="emoji 或标识"
                                      @input=${(event: Event) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          avatar: (event.currentTarget as HTMLInputElement).value,
                                        })}
                                    />
                                  </label>
                                  <label class="employee-workbench__settings-field">
                                    <span class="employee-workbench__settings-field-label">群主</span>
                                    <input
                                      class="employee-workbench__settings-input"
                                      type="text"
                                      .value=${selectedGroup.ownerLabel ?? ""}
                                      disabled
                                    />
                                  </label>
                                  <label class="employee-workbench__settings-field">
                                    <span class="employee-workbench__settings-field-label">主负责人（协调机器人）</span>
                                    <select
                                      class="employee-workbench__settings-input"
                                      .value=${groupDraft.coordinatorBotId}
                                      ?disabled=${!canEditSelectedGroup}
                                      @change=${(event: Event) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          coordinatorBotId: (
                                            event.currentTarget as HTMLSelectElement
                                          ).value,
                                        })}
                                    >
                                      <option value="">无主负责人</option>
                                      ${(selectedGroup.memberRows ?? [])
                                        .filter(
                                          (row) =>
                                            row.kind === "bot" &&
                                            row.memberId.trim() &&
                                            !isBuiltinStewardAgent(row.memberId),
                                        )
                                        .map(
                                          (row) => html`
                                            <option value=${row.memberId}>
                                              ${row.name || row.memberId}
                                            </option>
                                          `,
                                        )}
                                    </select>
                                  </label>
                                </div>
                              `,
                            })}

                            ${wbSettingsSection({
                              title: "使命",
                              wide: true,
                              content: html`
                                <div class="employee-workbench__settings-form-grid">
                                  <div class="employee-workbench__settings-control">
                                    <div class="employee-workbench__settings-field-label">长期定位</div>
                                    ${renderSettingsTextarea({
                                      value: groupDraft.purpose,
                                      rows: 3,
                                      disabled: !canEditSelectedGroup,
                                      placeholder: "这个小组长期负责什么，服务哪些目标。",
                                      onInput: (value) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          purpose: value,
                                        }),
                                    })}
                                  </div>
                                  <div class="employee-workbench__settings-control">
                                    <div class="employee-workbench__settings-field-label">当前使命</div>
                                    ${renderSettingsTextarea({
                                      value: groupDraft.currentMission,
                                      rows: 3,
                                      disabled: !canEditSelectedGroup,
                                      placeholder: "当前阶段最重要的任务或目标。",
                                      onInput: (value) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          currentMission: value,
                                        }),
                                    })}
                                  </div>
                                </div>
                                <div class="employee-workbench__settings-control">
                                  <div class="employee-workbench__settings-field-label">成功标准</div>
                                  ${renderSettingsTextarea({
                                    value: groupDraft.successCriteriaText,
                                    rows: 3,
                                    disabled: !canEditSelectedGroup,
                                    placeholder: "每行一条成功标准。",
                                    onInput: (value) =>
                                      settings.onSystemSettingsGroupDraftChange({
                                        successCriteriaText: value,
                                      }),
                                  })}
                                </div>
                              `,
                            })}

                            ${wbSettingsSection({
                              title: "成员",
                              wide: true,
                              content: html`
                                ${
                                  settings.collaborationGroupProjectionLoading
                                    ? html`
                                        <p class="employee-workbench__settings-section-subtitle">正在加载贡献度…</p>
                                      `
                                    : nothing
                                }
                                ${renderCollaborationGroupMembersTable(
                                  (() => {
                                    const projection = settings.collaborationGroupProjection;
                                    const projectionMatches =
                                      projection &&
                                      (projection.basic.groupId === selectedGroup.groupId ||
                                        projection.basic.sessionKey === selectedGroup.sessionKey);
                                    return projectionMatches
                                      ? projection.members
                                      : (selectedGroup.memberRows ?? []);
                                  })(),
                                )}
                              `,
                            })}

                            ${wbSettingsSection({
                              title: "群治理",
                              wide: true,
                              content: html`
                                <div class="wb-groups__governance-grid" data-wb-groups-governance>
                                  <div class="wb-groups__governance-panel">
                                    ${wbSettingsSubhead("决策")}
                                    ${renderChoiceChips({
                                      label: "最终决策模式",
                                      value: groupDraft.finalDecisionMode,
                                      disabled: !canEditSelectedGroup,
                                      options: [
                                        {
                                          value: "human_required",
                                          label: "人类确认",
                                          title: "最终结论必须由人类确认",
                                        },
                                        {
                                          value: "delegated_low_risk",
                                          label: "低风险委托",
                                          title: "低风险情况下允许机器人协助推进",
                                        },
                                      ],
                                      onChange: (value) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          finalDecisionMode: value,
                                        }),
                                    })}
                                    ${renderChoiceChips({
                                      label: "默认拍板角色",
                                      value: groupDraft.finalDecisionRole,
                                      disabled: !canEditSelectedGroup,
                                      options: [
                                        { value: "owner", label: "群主" },
                                        { value: "admin", label: "管理员" },
                                      ],
                                      onChange: (value) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          finalDecisionRole: value,
                                        }),
                                    })}
                                    <div class="wb-groups__toggle-row">
                                      ${renderToggleRow({
                                        title: "允许机器人发布提案",
                                        checked: groupDraft.allowAgentPublishProposal,
                                        disabled: !canEditSelectedGroup,
                                        onToggle: (checked) =>
                                          canEditSelectedGroup
                                            ? settings.onSystemSettingsGroupDraftChange({
                                                allowAgentPublishProposal: checked,
                                              })
                                            : undefined,
                                      })}
                                    </div>
                                  </div>

                                  <div class="wb-groups__governance-panel">
                                    ${wbSettingsSubhead("保密与可见")}
                                    ${renderChoiceChips({
                                      label: "保密等级",
                                      value: groupDraft.confidentialityTier,
                                      disabled: !canEditSelectedGroup,
                                      options: ["public", "internal", "restricted", "secret"].map(
                                        (tier) => ({
                                          value: tier,
                                          label: formatSettingsGroupConfidentiality(tier),
                                        }),
                                      ),
                                      onChange: (value) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          confidentialityTier: value,
                                        }),
                                    })}
                                    ${renderChoiceChips({
                                      label: "可见范围",
                                      value: groupDraft.visibilityScope,
                                      disabled: !canEditSelectedGroup,
                                      options: ["group_only", "tenant", "organization"].map(
                                        (scope) => ({
                                          value: scope,
                                          label: formatSettingsGroupVisibility(scope),
                                        }),
                                      ),
                                      onChange: (value) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          visibilityScope: value,
                                        }),
                                    })}
                                  </div>

                                  <div class="wb-groups__governance-panel">
                                    ${wbSettingsSubhead("协作规则")}
                                    ${renderChoiceChips({
                                      label: "协作模式",
                                      value: groupDraft.collaborationMode,
                                      disabled: !canEditSelectedGroup,
                                      options: [
                                        { value: "discussion_driven", label: "讨论驱动" },
                                        { value: "task_driven", label: "任务驱动" },
                                        { value: "review_driven", label: "评审驱动" },
                                      ],
                                      onChange: (value) =>
                                        settings.onSystemSettingsGroupDraftChange({
                                          collaborationMode: value,
                                        }),
                                    })}
                                    <div class="employee-workbench__settings-control">
                                      <div class="employee-workbench__settings-field-label">
                                        自定义协作规则
                                      </div>
                                      <p class="employee-workbench__settings-field-hint">
                                        行为指导，不等于系统强制约束。不能替代系统底线或本群协作策略。
                                      </p>
                                      ${renderSettingsTextarea({
                                        value: groupDraft.rulesSummaryText,
                                        rows: 3,
                                        disabled: !canEditSelectedGroup,
                                        placeholder:
                                          "例如：重要结论先复述约束；未列出的工具不要重试。",
                                        onInput: (value) =>
                                          settings.onSystemSettingsGroupDraftChange({
                                            rulesSummaryText: value,
                                          }),
                                      })}
                                    </div>
                                    <div class="wb-groups__rules-row">
                                      <div class="wb-groups__toggle-row">
                                        ${renderToggleRow({
                                          title: "开放讨论（无需 @）",
                                          checked: groupDraft.openDiscussionWithoutMention,
                                          disabled: !canEditSelectedGroup,
                                          onToggle: (checked) =>
                                            canEditSelectedGroup
                                              ? settings.onSystemSettingsGroupDraftChange({
                                                  openDiscussionWithoutMention: checked,
                                                })
                                              : undefined,
                                        })}
                                      </div>
                                      <label
                                        class="employee-workbench__settings-field wb-groups__compact-number"
                                      >
                                        <span class="employee-workbench__settings-field-label"
                                          >每轮最大可见回复</span
                                        >
                                        <input
                                          class="employee-workbench__settings-input"
                                          type="number"
                                          min="1"
                                          max="50"
                                          .value=${String(groupDraft.maxVisibleBotRepliesPerRound)}
                                          ?disabled=${!canEditSelectedGroup}
                                          @input=${(event: Event) => {
                                            const raw = Number(
                                              (event.currentTarget as HTMLInputElement).value,
                                            );
                                            const next = Number.isFinite(raw)
                                              ? Math.max(1, Math.min(50, Math.round(raw)))
                                              : 5;
                                            settings.onSystemSettingsGroupDraftChange({
                                              maxVisibleBotRepliesPerRound: next,
                                            });
                                          }}
                                        />
                                      </label>
                                    </div>
                                  </div>
                                </div>

                                <div class="wb-groups__danger">
                                  <div class="wb-groups__danger-head">
                                    <div class="wb-groups__danger-title">危险操作</div>
                                    <div class="wb-groups__danger-note">
                                      ${
                                        canEditSelectedGroup
                                          ? "重置或解散会影响全体成员，且不可撤销。"
                                          : "仅群主可执行重置或解散。"
                                      }
                                    </div>
                                  </div>
                                  <div class="wb-groups__danger-actions">
                                    <button
                                      type="button"
                                      class="btn"
                                      ?disabled=${settings.systemGroupSaving || !canEditSelectedGroup}
                                      @click=${() => void settings.onResetSystemSettingsGroup()}
                                    >
                                      ${settings.systemGroupSaving ? t("common.loading") : "重置协作小组"}
                                    </button>
                                    <button
                                      type="button"
                                      class="btn btn--danger"
                                      ?disabled=${settings.systemGroupSaving || !canEditSelectedGroup}
                                      @click=${() => void settings.onDissolveSystemSettingsGroup()}
                                    >
                                      ${settings.systemGroupSaving ? t("common.loading") : "解散协作小组"}
                                    </button>
                                  </div>
                                </div>
                              `,
                            })}
                          </div>
                        </div>
                      `
                    : html`
                        <div class="employee-workbench__settings-manage-empty wb-groups__empty">
                          从左侧选择一个协作小组开始配置。
                        </div>
                      `
                }
              </div>
            </div>
          </div>
              `
              : nothing
          }
              `
          }
        </section>
      </div>
    </section>
  `;
}

type EmployeeDeviceKind =
  | "browser"
  | "mac-app"
  | "ios-app"
  | "android-app"
  | "cli"
  | "internal"
  | "other";

const EMPLOYEE_DEVICE_KIND_LABELS: Record<EmployeeDeviceKind, string> = {
  browser: "浏览器",
  "mac-app": "Mac 应用",
  "ios-app": "iPhone 应用",
  "android-app": "Android 应用",
  cli: "命令行",
  internal: "系统内部连接",
  other: "其他客户端",
};

function classifyEmployeeDeviceKind(device: {
  clientId?: string;
  clientMode?: string;
  deviceFamily?: string;
}): EmployeeDeviceKind {
  const clientId = (device.clientId ?? "").toLowerCase();
  const clientMode = (device.clientMode ?? "").toLowerCase();
  // Gateway self-connections are infrastructure, not user logins.
  if (clientMode === "backend" || clientId.includes("gateway-client")) {
    return "internal";
  }
  if (
    clientId.includes("control-ui") ||
    clientId.includes("webchat") ||
    (device.deviceFamily ?? "").toLowerCase() === "browser"
  ) {
    return "browser";
  }
  if (clientId.includes("macos")) {
    return "mac-app";
  }
  if (clientId.includes("ios")) {
    return "ios-app";
  }
  if (clientId.includes("android")) {
    return "android-app";
  }
  if (clientId === "cli" || clientId.includes("node-host")) {
    return "cli";
  }
  return "other";
}

function formatEmployeeDevicePlatform(platform?: string): string | null {
  const raw = (platform ?? "").trim();
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (lower.includes("iphone")) {
    return "iPhone";
  }
  if (lower.includes("ipad")) {
    return "iPad";
  }
  if (lower.includes("mac") || lower === "darwin") {
    return "Mac";
  }
  if (lower.includes("android")) {
    return "Android";
  }
  if (lower.includes("win")) {
    return "Windows";
  }
  if (lower.includes("cros")) {
    return "ChromeOS";
  }
  if (lower.includes("linux")) {
    return "Linux";
  }
  return raw;
}

function resolveEmployeeDeviceTitle(device: {
  displayName?: string;
  platform?: string;
  clientId?: string;
  clientMode?: string;
  deviceFamily?: string;
}): string {
  const explicit = device.displayName?.trim();
  if (explicit) {
    return explicit;
  }
  const kindLabel = EMPLOYEE_DEVICE_KIND_LABELS[classifyEmployeeDeviceKind(device)];
  const platformLabel = formatEmployeeDevicePlatform(device.platform);
  return platformLabel ? `${kindLabel} · ${platformLabel}` : kindLabel;
}

function resolveEmployeeDeviceLastActiveMs(device: {
  tokens?: Array<{ lastUsedAtMs?: number; rotatedAtMs?: number; createdAtMs?: number }>;
  approvedAtMs?: number;
  createdAtMs?: number;
}): number | null {
  const candidates: number[] = [];
  const push = (value?: number) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      candidates.push(value);
    }
  };
  for (const token of device.tokens ?? []) {
    push(token.lastUsedAtMs);
    push(token.rotatedAtMs);
    push(token.createdAtMs);
  }
  push(device.approvedAtMs);
  push(device.createdAtMs);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

const RECENT_DEVICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const BROWSER_CLIENT_LABELS = new Set(["Chrome", "Safari", "Firefox", "Edge", "Opera", "Browser"]);

function resolveEmployeeClientLabel(kind: EmployeeDeviceKind): string {
  switch (kind) {
    case "browser":
      return "浏览器";
    case "mac-app":
      return "Mac 应用";
    case "ios-app":
      return "iPhone 应用";
    case "android-app":
      return "Android 应用";
    case "cli":
      return "命令行";
    default:
      return "客户端";
  }
}

function resolveEmployeeDeviceColumns(
  device: {
    displayName?: string;
    platform?: string;
    clientId?: string;
    clientMode?: string;
    deviceFamily?: string;
  },
  kind: EmployeeDeviceKind,
): { deviceName: string; clientName: string } {
  const explicit = device.displayName?.trim();
  const platformLabel = formatEmployeeDevicePlatform(device.platform) ?? "未知设备";
  const defaultClient = resolveEmployeeClientLabel(kind);

  if (explicit) {
    const parts = explicit
      .split("·")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const left = parts[0];
      const right = parts[parts.length - 1];
      if (BROWSER_CLIENT_LABELS.has(left)) {
        return {
          deviceName: right,
          clientName: left === "Browser" ? "浏览器" : left,
        };
      }
      if (left === "浏览器" || left === defaultClient) {
        return { deviceName: right, clientName: left };
      }
      if (kind !== "browser") {
        return { deviceName: explicit, clientName: defaultClient };
      }
      return { deviceName: right, clientName: left };
    }
    return { deviceName: explicit, clientName: defaultClient };
  }

  return { deviceName: platformLabel, clientName: defaultClient };
}

function formatEmployeeLoginTimestampZh(
  timestampMs: number | null | undefined,
  fallback = "—",
): string {
  if (timestampMs == null || !Number.isFinite(timestampMs)) {
    return fallback;
  }
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestampMs));
  } catch {
    return fallback;
  }
}

type EmployeeDeviceListEntry = {
  device: {
    deviceId: string;
    displayName?: string;
    platform?: string;
    deviceFamily?: string;
    clientId?: string;
    clientMode?: string;
  };
  kind: EmployeeDeviceKind;
  lastActiveMs: number | null;
  isCurrent: boolean;
};

/** Collapse same-browser sessions that differ only by local deviceId. */
function dedupeEmployeeDeviceEntries(
  entries: EmployeeDeviceListEntry[],
): EmployeeDeviceListEntry[] {
  const fingerprint = (entry: EmployeeDeviceListEntry) =>
    [
      entry.kind,
      (entry.device.clientId ?? "").trim().toLowerCase(),
      (entry.device.clientMode ?? "").trim().toLowerCase(),
      (entry.device.platform ?? "").trim().toLowerCase(),
      (entry.device.displayName ?? "").trim().toLowerCase(),
      formatEmployeeDevicePlatform(entry.device.platform) ?? "",
    ].join("|");

  const byFingerprint = new Map<string, EmployeeDeviceListEntry>();
  for (const entry of entries) {
    // Only collapse browser logins; apps/CLI may legitimately share a host label.
    if (entry.kind !== "browser") {
      byFingerprint.set(`id:${entry.device.deviceId}`, entry);
      continue;
    }
    const key = fingerprint(entry);
    const existing = byFingerprint.get(key);
    if (!existing) {
      byFingerprint.set(key, entry);
      continue;
    }
    const preferEntry =
      entry.isCurrent && !existing.isCurrent
        ? entry
        : !entry.isCurrent && existing.isCurrent
          ? existing
          : (entry.lastActiveMs ?? 0) >= (existing.lastActiveMs ?? 0)
            ? entry
            : existing;
    byFingerprint.set(key, preferEntry);
  }
  return [...byFingerprint.values()];
}

function formatEmployeeRelativeTimeZh(
  timestampMs: number | null | undefined,
  options?: { dateFallback?: boolean; fallback?: string },
): string {
  const fallback = options?.fallback ?? "未知";
  if (timestampMs == null || !Number.isFinite(timestampMs)) {
    return fallback;
  }
  const diff = Date.now() - timestampMs;
  const absDiff = Math.abs(diff);
  const isPast = diff >= 0;
  const sec = Math.round(absDiff / 1000);
  if (sec < 60) {
    return isPast ? "刚刚" : "不到 1 分钟";
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return isPast ? `${min} 分钟前` : `${min} 分钟后`;
  }
  const hr = Math.round(min / 60);
  if (hr < 48) {
    return isPast ? `${hr} 小时前` : `${hr} 小时后`;
  }
  const day = Math.round(hr / 24);
  if (!options?.dateFallback || day <= 7) {
    return isPast ? `${day} 天前` : `${day} 天后`;
  }
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
    }).format(new Date(timestampMs));
  } catch {
    return `${day} 天前`;
  }
}

function formatEmployeeDurationZh(ms?: number | null, fallback = "—"): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return fallback;
  }
  if (ms < 1000) {
    return `${Math.round(ms)} 毫秒`;
  }
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec} 秒`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min} 分钟`;
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return `${hr} 小时`;
  }
  const day = Math.round(hr / 24);
  return `${day} 天`;
}

function renderEmployeeDeviceIcon(kind: EmployeeDeviceKind) {
  switch (kind) {
    case "browser":
      return html`
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="14" rx="2"></rect>
          <path d="M3 8h18"></path>
          <circle cx="6.5" cy="6.2" r="0.7" fill="currentColor" stroke="none"></circle>
        </svg>
      `;
    case "mac-app":
      return html`
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="11" rx="1.5"></rect>
          <path d="M2 19h20"></path>
        </svg>
      `;
    case "ios-app":
    case "android-app":
      return html`
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="7" y="3" width="10" height="18" rx="2"></rect>
          <path d="M10 6h4"></path>
        </svg>
      `;
    case "cli":
      return html`
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2"></rect>
          <path d="M7 9l3 3-3 3"></path>
          <path d="M12 15h5"></path>
        </svg>
      `;
    default:
      return html`
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="4" width="14" height="16" rx="2"></rect>
          <path d="M9 8h6"></path>
          <path d="M9 12h4"></path>
        </svg>
      `;
  }
}

function renderEmployeeDeviceRow(entry: EmployeeDeviceListEntry, settings: SettingsContract) {
  const { device, kind, lastActiveMs, isCurrent } = entry;
  const { deviceName, clientName } = resolveEmployeeDeviceColumns(device, kind);
  const onlineForMs =
    isCurrent && settings.devicePairingConnectedAtMs
      ? Math.max(0, Date.now() - settings.devicePairingConnectedAtMs)
      : null;
  return html`
    <div
      class="employee-workbench__devices-table-row ${isCurrent ? "is-current" : ""}"
      title=${device.deviceId}
    >
      <span class="employee-workbench__devices-col employee-workbench__devices-col--device">
        ${deviceName}
        ${
          isCurrent
            ? html`
                <span class="employee-workbench__settings-pill employee-workbench__settings-pill--ok">当前</span>
              `
            : nothing
        }
      </span>
      <span class="employee-workbench__devices-col employee-workbench__devices-col--client">${clientName}</span>
      <span class="employee-workbench__devices-col employee-workbench__devices-col--time">
        ${formatEmployeeLoginTimestampZh(lastActiveMs)}
        ${onlineForMs !== null ? html`<span class="employee-workbench__devices-online">在线 ${formatEmployeeDurationZh(onlineForMs)}</span>` : nothing}
      </span>
      <span class="employee-workbench__devices-col employee-workbench__devices-col--action">
        <button
          type="button"
          class="btn btn--sm"
          title=${isCurrent ? "移除当前设备后需重新登录配对" : "移除此设备"}
          @click=${() => void settings.onRemoveMyDevice?.(device.deviceId)}
        >
          移除
        </button>
      </span>
    </div>
  `;
}

function renderMyDevicesSection(settings: SettingsContract) {
  const listLoaded = settings.devicePairingList != null;
  const pairing = settings.devicePairingList ?? { pending: [], paired: [] };
  const pending = Array.isArray(pairing.pending) ? pairing.pending : [];
  const pairedAll = Array.isArray(pairing.paired) ? pairing.paired : [];
  const currentDeviceId = settings.devicePairingCurrentDeviceId ?? null;
  const connected = Boolean(settings.connected);

  const classified = pairedAll.map((device) => ({
    device,
    kind: classifyEmployeeDeviceKind(device),
    lastActiveMs: resolveEmployeeDeviceLastActiveMs(device),
    isCurrent: Boolean(currentDeviceId && device.deviceId === currentDeviceId),
  }));
  const internalOnly =
    classified.length > 0 && classified.every((entry) => entry.kind === "internal");
  const visibleDevices = dedupeEmployeeDeviceEntries(
    classified.filter((entry) => entry.kind !== "internal"),
  ).toSorted((a, b) => {
    if (a.isCurrent !== b.isCurrent) {
      return a.isCurrent ? -1 : 1;
    }
    return (b.lastActiveMs ?? 0) - (a.lastActiveMs ?? 0);
  });
  const nowMs = Date.now();
  const isInactiveEntry = (entry: EmployeeDeviceListEntry) =>
    !entry.isCurrent &&
    (entry.lastActiveMs === null || nowMs - entry.lastActiveMs > RECENT_DEVICE_WINDOW_MS);
  const recentDevices = visibleDevices.filter((entry) => !isInactiveEntry(entry));
  const inactiveDevices = visibleDevices.filter(isInactiveEntry);
  const emptyCopy = !connected
    ? "网关未连接，无法加载设备列表。"
    : settings.devicePairingLoading || !listLoaded
      ? "正在加载设备…"
      : internalOnly
        ? "仅检测到系统内部连接，暂无用户登录设备。"
        : inactiveDevices.length > 0
          ? "近期无活跃登录设备，可在下方查看更早记录。"
          : "暂无登录设备。刷新后仍为空时，请重新登录一次以认领当前浏览器。";

  return html`
    <div class="employee-workbench__settings-section employee-workbench__settings-section--devices">
      <div class="employee-workbench__settings-section-head employee-workbench__settings-section-head--row employee-workbench__settings-section-head--flat">
        <div>
          <div class="employee-workbench__settings-section-title">我的设备</div>
        </div>
        <button
          type="button"
          class="btn"
          ?disabled=${settings.devicePairingLoading || !connected}
          @click=${() => void settings.onRefreshMyDevices?.()}
        >
          ${settings.devicePairingLoading ? t("common.loading") : "刷新"}
        </button>
      </div>

      ${
        settings.devicePairingError
          ? html`
              <div class="callout callout--danger employee-workbench__settings-callout">
                ${settings.devicePairingError}
              </div>
            `
          : nothing
      }

      <div class="employee-workbench__devices-section">
        <div class="employee-workbench__devices-panel employee-workbench__devices-panel--flat">
          ${
            recentDevices.length > 0
              ? html`
                  <div
                    class="employee-workbench__devices-table employee-workbench__devices-table--flat"
                  >
                    <div class="employee-workbench__devices-table-head employee-workbench__type-column-head">
                      <span>设备</span>
                      <span>客户端</span>
                      <span>最近登录</span>
                      <span></span>
                    </div>
                    ${recentDevices.map((entry) => renderEmployeeDeviceRow(entry, settings))}
                  </div>
                `
              : html`
                  <div class="employee-workbench__settings-manage-empty employee-workbench__settings-manage-empty--soft">
                    ${emptyCopy}
                  </div>
                `
          }
          ${
            inactiveDevices.length > 0
              ? html`
                  <details class="employee-workbench__devices-inactive">
                    <summary>更早的设备（${String(inactiveDevices.length)}）</summary>
                    <div class="employee-workbench__devices-inactive-body">
                      <div class="employee-workbench__settings-password-actions">
                        <button
                          type="button"
                          class="btn"
                          @click=${() =>
                            void settings.onRemoveMyDevices?.(
                              inactiveDevices.map((entry) => entry.device.deviceId),
                            )}
                        >
                          全部移除
                        </button>
                      </div>
                      <div
                        class="employee-workbench__devices-table employee-workbench__devices-table--flat"
                      >
                        <div class="employee-workbench__devices-table-head employee-workbench__type-column-head">
                          <span>设备</span>
                          <span>客户端</span>
                          <span>最近登录</span>
                          <span></span>
                        </div>
                        ${inactiveDevices.map((entry) => renderEmployeeDeviceRow(entry, settings))}
                      </div>
                    </div>
                  </details>
                `
              : nothing
          }
        </div>

        ${
          pending.length > 0
            ? html`
                <div class="employee-workbench__devices-panel employee-workbench__devices-panel--alert">
                  <div class="employee-workbench__devices-panel-head">
                    <div class="employee-workbench__settings-field-label">新设备配对请求</div>
                  </div>
                  <div
                    class="employee-workbench__settings-manage-list employee-workbench__settings-manage-list--flat"
                  >
                  ${pending.map((request) => {
                    const title =
                      request.displayName?.trim() || resolveEmployeeDeviceTitle(request);
                    const kind = classifyEmployeeDeviceKind(request);
                    return html`
                      <div class="employee-workbench__settings-manage-item employee-workbench__devices-row">
                        <div class="employee-workbench__devices-row__icon">
                          ${renderEmployeeDeviceIcon(kind)}
                        </div>
                        <div class="employee-workbench__settings-manage-copy">
                          <div class="employee-workbench__settings-manage-title">
                            ${title}
                            ${renderSettingsPill(request.isRepair ? "重新配对" : "待批准", "warn")}
                          </div>
                          <div class="employee-workbench__settings-manage-meta">
                            请求时间：${formatEmployeeRelativeTimeZh(request.ts, {
                              dateFallback: true,
                            })}
                            ${request.remoteIp ? html` · 来源 IP：${request.remoteIp}` : nothing}
                            ${
                              request.isRepair
                                ? html`
                                    · 该设备此前已配对，本次为权限或信息变更
                                  `
                                : nothing
                            }
                          </div>
                        </div>
                        <div class="employee-workbench__devices-row__action">
                          <div class="employee-workbench__settings-password-actions employee-workbench__settings-password-actions--inline">
                            <button
                              type="button"
                              class="btn btn--primary"
                              @click=${() => void settings.onApproveMyDevicePairing?.(request.requestId)}
                            >
                              批准
                            </button>
                            <button
                              type="button"
                              class="btn"
                              @click=${() => void settings.onRejectMyDevicePairing?.(request.requestId)}
                            >
                              拒绝
                            </button>
                          </div>
                        </div>
                      </div>
                    `;
                  })}
                  </div>
                </div>
              `
            : nothing
        }

      </div>
    </div>
  `;
}

function renderTasksTabLabel(label: string, count: number | undefined) {
  if (!count || count <= 0) {
    return label;
  }
  const badge = count > 99 ? "99+" : String(count);
  return html`${label}<span class="employee-workbench__tasks-module-tab-badge">${badge}</span>`;
}

function renderTasksModulePage(settings: NonNullable<WorkbenchStageModuleContract["settings"]>) {
  const subTab = settings.tasksSubTab ?? "cron";
  const counts = settings.myTasksLaneCounts;
  const body =
    subTab === "supervisor"
      ? html`
          <div
            class="employee-workbench__settings-section employee-workbench__settings-section--flush employee-workbench__tasks-lane"
          >
            ${
              settings.supervisorProps
                ? renderEmployeeSupervisorCenter(settings.supervisorProps)
                : html`
                    <div class="employee-workbench__settings-manage-empty">
                      开发监督任务视图不可用（未连接 Gateway）。
                    </div>
                  `
            }
          </div>
        `
      : subTab === "assigned"
        ? html`
            <div
              class="employee-workbench__settings-section employee-workbench__settings-section--flush employee-workbench__tasks-lane"
            >
              ${
                settings.assignedTasksProps
                  ? renderEmployeeAssignedTasksCenter(settings.assignedTasksProps)
                  : html`
                      <div class="employee-workbench__settings-manage-empty">
                        待我处理任务视图不可用（未连接 Gateway）。
                      </div>
                    `
              }
            </div>
          `
        : subTab === "minutes"
          ? html`
              <div
                class="employee-workbench__settings-section employee-workbench__settings-section--flush employee-workbench__tasks-lane"
              >
                ${renderEmployeeMeetingMinutesCenter({
                  client: settings.assignedTasksProps?.client ?? null,
                })}
              </div>
            `
          : html`
              <div
                class="employee-workbench__settings-section employee-workbench__settings-section--flush employee-workbench__tasks-lane"
              >
                ${
                  settings.cronProps
                    ? renderPersonalCronCenter(settings.cronProps)
                    : html`
                        <div class="employee-workbench__settings-manage-empty">个人定时任务视图不可用。</div>
                      `
                }
              </div>
            `;
  return html`
    <section class="employee-workbench__module-page employee-workbench__module-page--tasks">
      <div class="employee-workbench__tasks-module-head">
        <div class="employee-workbench__tasks-module-tabs" role="tablist" aria-label="我的任务">
          <button
            type="button"
            class="employee-workbench__tasks-module-tab ${subTab === "cron" ? "is-active" : ""}"
            role="tab"
            aria-selected=${String(subTab === "cron")}
            @click=${() => settings.onTasksSubTabChange("cron")}
          >
            ${renderTasksTabLabel("定时任务", counts?.cronCount)}
          </button>
          <button
            type="button"
            class="employee-workbench__tasks-module-tab ${subTab === "assigned" ? "is-active" : ""}"
            role="tab"
            aria-selected=${String(subTab === "assigned")}
            @click=${() => settings.onTasksSubTabChange("assigned")}
          >
            ${renderTasksTabLabel("待我处理", counts?.assignedCount)}
          </button>
          <button
            type="button"
            class="employee-workbench__tasks-module-tab ${subTab === "supervisor" ? "is-active" : ""}"
            role="tab"
            aria-selected=${String(subTab === "supervisor")}
            @click=${() => settings.onTasksSubTabChange("supervisor")}
          >
            ${renderTasksTabLabel("开发监督", counts?.supervisedCount)}
          </button>
          <button
            type="button"
            class="employee-workbench__tasks-module-tab ${subTab === "minutes" ? "is-active" : ""}"
            role="tab"
            aria-selected=${String(subTab === "minutes")}
            @click=${() => settings.onTasksSubTabChange("minutes")}
          >
            会议纪要
          </button>
        </div>
      </div>
      ${body}
    </section>
  `;
}

export function renderModuleContentPage(
  contract: WorkbenchStageModuleContract,
  shellModel: WorkbenchShellModel,
  itemTitle: string,
  subtitle: string,
) {
  if (shellModel.primaryModule === "knowledge") {
    const surface = contract.knowledge;
    if (surface) {
      return renderKnowledgeUniversePage(surface, {
        myAccumulationProps: contract.settings?.myAccumulationProps ?? null,
      });
    }
    return html`
      <section class="employee-workbench__module-page card">
        <div class="employee-workbench__panel-title">${itemTitle}</div>
        <div class="employee-workbench__panel-subtitle">${subtitle}</div>
        <div class="employee-workbench__module-empty">
          ${t("frontstage.workbench.nav.knowledgeVerse")}
        </div>
      </section>
    `;
  }

  if (shellModel.primaryModule === "tasks") {
    const settings = contract.settings;
    if (!settings) {
      return html`
        <section class="employee-workbench__module-page card">
          <div class="employee-workbench__panel-title">${itemTitle}</div>
          <div class="employee-workbench__panel-subtitle">${subtitle}</div>
        </section>
      `;
    }
    return renderTasksModulePage(settings);
  }

  if (shellModel.primaryModule === "settings") {
    const settings = contract.settings;
    if (!settings) {
      return html`
        <section class="employee-workbench__module-page card">
          <div class="employee-workbench__panel-title">${itemTitle}</div>
          <div class="employee-workbench__panel-subtitle">${subtitle}</div>
        </section>
      `;
    }
    return settings.view === "personal"
      ? renderPersonalSettingsPage(settings, itemTitle, subtitle)
      : renderSystemSettingsPage(settings, itemTitle, subtitle);
  }

  return html`
    <section class="employee-workbench__module-page card">
      <div class="employee-workbench__panel-title">${itemTitle}</div>
      <div class="employee-workbench__panel-subtitle">${subtitle}</div>
    </section>
  `;
}
