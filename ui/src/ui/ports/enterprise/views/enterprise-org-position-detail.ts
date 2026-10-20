import { html, nothing, type TemplateResult } from "lit";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { canEditEnterpriseSupervisorPolicy } from "../../../supervisor/supervisor-types.ts";
import { formatCost, formatTokens } from "../../../views/usage-metrics.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  isArchivePersonAndSeatDeleteVisible,
  resolveOrganizationSeatDeleteEligibility,
  type SeatDeleteEligibility,
} from "../semantic/organization-seat-deletion.ts";
import {
  ensureSeatArchiveSkillsLoaded,
  getSeatArchiveKnownSkillsMap,
} from "../semantic/seat-ai-archive-skills.ts";
import {
  buildSeatAiArchiveInput,
  buildSeatAiArchiveReadModel,
  SEAT_AI_ARCHIVE_SECTION_ORDER,
  SEAT_AI_ARCHIVE_SECTION_TITLES,
  type SeatAiArchivePhase,
  type SeatAiArchiveReadModel,
  type SeatAiArchiveSectionId,
} from "../semantic/seat-ai-archive.ts";
import { handoverStatusLabel } from "./enterprise-handover-status.ts";
import {
  orgWsBody,
  orgWsDetailStack,
  orgWsField,
  orgWsHeader,
  orgWsKvGrid,
  orgWsMetaList,
  orgWsNotice,
} from "./enterprise-org-workspace-template.ts";
import {
  resolveOrganizationDigitalHumanName,
  resolveOrganizationHumanLabel,
} from "./enterprise-organization-display-label.ts";
import { shouldProceed, requestEnterpriseAppRerender } from "./enterprise-surface-shared.ts";
import "../../../supervisor/supervisor-seat-node-panel.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

/** Hero 分区导航短标题（与 SEAT_AI_ARCHIVE_SECTION_ORDER 对齐）。 */
const ARCHIVE_SECTION_SHORT_TITLES: Record<SeatAiArchiveSectionId, string> = {
  identity: "身份",
  digital: "数字人",
  permissions: "权限",
  skills: "技能",
  contribution: "贡献",
  timeline: "时间线",
};

const archiveActiveSectionBySeatId = new Map<string, SeatAiArchiveSectionId>();

export function resolveArchiveActiveSection(seatId: string): SeatAiArchiveSectionId {
  return archiveActiveSectionBySeatId.get(seatId) ?? "identity";
}

export function setArchiveActiveSection(seatId: string, sectionId: SeatAiArchiveSectionId): void {
  if (!SEAT_AI_ARCHIVE_SECTION_ORDER.includes(sectionId)) {
    return;
  }
  if (archiveActiveSectionBySeatId.get(seatId) === sectionId) {
    return;
  }
  archiveActiveSectionBySeatId.set(seatId, sectionId);
  requestEnterpriseAppRerender();
}

export function resetArchiveActiveSectionsForTests(): void {
  archiveActiveSectionBySeatId.clear();
}

export type OrganizationPositionDetailRow = {
  seatId: string;
  name: string;
  teamLabel: string;
  responsibility: string | null;
  memberUserId: string | null;
  memberDisplayLabel: string | null;
  memberLabel: string | null;
  pendingEmployeeUser?: string | null;
  pendingEmployeeDisplayName?: string | null;
  pendingActivationExpiresAt?: string | null;
  roleCode?: string | null;
  aiEmployeeLabel: string;
  botCount: number;
  groupCount: number;
  totalCost: number | null;
  totalTokens?: number | null;
  sessionCount?: number | null;
  runtimeLabel?: string | null;
  activityLabel?: string | null;
  lastActiveAt?: number | null;
  status: string;
  seatStatus: string;
  defaultAgentId: string | null;
  agentIds: string[];
  defaultSpaceIds: string[];
  memoryScopeIds: string[];
  offer: EnterprisePortReadModel["offerSummaries"][number] | null;
  handover: EnterprisePortReadModel["handoverSummaries"][number] | null;
};

/** Prefer pending-activation email; fall back to displayed identity email. */
export function resolveArchiveActivationSendEmail(params: {
  archive: SeatAiArchiveReadModel;
  row: OrganizationPositionDetailRow;
}): string | null {
  const candidates = [
    params.row.pendingEmployeeUser,
    params.archive.identity.email,
    params.row.offer?.targetEmployeeUser,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim() ?? "";
    if (trimmed.includes("@") && !trimmed.includes(" ")) {
      return trimmed;
    }
  }
  return null;
}

function organizationStatusLabel(value: string): string {
  switch (value) {
    case "VACANT":
      return "空岗";
    case "PENDING_CONFIRM":
      return "待确认";
    case "PENDING_ACTIVATION":
      return "待激活";
    case "HANDOVER":
      return "交接中";
    case "ERROR":
      return "异常";
    default:
      return "正常";
  }
}

function seatStatusLabel(value: string): string {
  switch (value.trim().toLowerCase()) {
    case "vacant":
      return "空岗";
    case "assigned":
      return "已分配";
    case "occupied":
      return "在岗";
    case "pending":
      return "待处理";
    default:
      return value.trim() || "—";
  }
}

/** 激活过期：本地可读时间；title 保留原始 ISO 便于排查。 */
function formatActivationExpiresAt(raw: string): { display: string; title: string } {
  const trimmed = raw.trim();
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) {
    return { display: trimmed, title: trimmed };
  }
  return { display: new Date(ms).toLocaleString(), title: trimmed };
}

function formatArchiveTimestamp(raw: string | null | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }
  return formatActivationExpiresAt(raw).display;
}

function handoverNextActionLabel(status: string): string {
  switch (status) {
    case "draft":
      return "指定继任者";
    case "asset_review":
      return "补全审查摘要并提交";
    case "pending_approval":
      return "批准冻结岗位";
    case "frozen":
      return "发送岗位绑定确认";
    case "rebound":
    case "completed":
      return "查看交接结果";
    default:
      return "继续处理";
  }
}

/** 岗位详情删除资格：委托共享语义，与 gateway deleteVacantPositionSeat 对齐。 */
export function resolveSeatDeleteEligibility(
  row: OrganizationPositionDetailRow,
): SeatDeleteEligibility {
  return resolveOrganizationSeatDeleteEligibility(row);
}

export function buildOrganizationPositionArchive(
  row: OrganizationPositionDetailRow,
  readModel: EnterprisePortReadModel,
): SeatAiArchiveReadModel {
  return buildSeatAiArchiveReadModel(
    buildSeatAiArchiveInput(row, {
      ...readModel,
      knownSkillsBySeatId: getSeatArchiveKnownSkillsMap(),
    }),
  );
}

function openActivationEditor(params: {
  row: OrganizationPositionDetailRow;
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
}) {
  params.seatOfferEditor.onOpen({
    mode: "activation",
    seatId: params.row.seatId,
    seatTitle: params.row.name,
    seatStatus: params.row.seatStatus,
    defaultAgentId: params.row.defaultAgentId,
    availableAgentIds: params.row.agentIds,
    defaultSpaceIds: params.row.defaultSpaceIds,
    memoryScopeAvailable: params.row.memoryScopeIds.length > 0,
    employeeEmail: params.row.pendingEmployeeUser ?? params.row.offer?.targetEmployeeUser ?? null,
  });
}

/** 在岗 / 待激活 / 交接：打开邮箱编辑（激活补全或更换成员确认）。 */
function openEmailChangeEditor(params: {
  row: OrganizationPositionDetailRow;
  archive: SeatAiArchiveReadModel;
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
}) {
  const mode = params.archive.phase === "pending_activation" ? "activation" : "offer";
  params.seatOfferEditor.onOpen({
    mode,
    seatId: params.row.seatId,
    seatTitle: params.row.name,
    seatStatus: params.row.seatStatus,
    defaultAgentId: params.row.defaultAgentId,
    availableAgentIds: params.row.agentIds,
    defaultSpaceIds: params.row.defaultSpaceIds,
    memoryScopeAvailable: params.row.memoryScopeIds.length > 0,
    employeeEmail:
      params.archive.identity.email ??
      params.row.pendingEmployeeUser ??
      params.row.offer?.targetEmployeeUser ??
      null,
  });
}

export function resolveArchivePrimaryActionLabels(phase: SeatAiArchivePhase): {
  primary: string;
  secondary: string | null;
} {
  switch (phase) {
    case "vacant_shell":
      return { primary: "邀请新成员", secondary: "分配在职成员" };
    case "pending_activation":
      // Email edit lives next to the identity email field only — avoid a duplicate CTA in hero.
      return { primary: "发送激活邮件", secondary: null };
    case "handover":
      return { primary: "查看交接", secondary: "更换成员" };
    case "occupied":
    default:
      // 在岗：交接为主流程；更换成员降权为次要 ghost，避免 footer 大红 CTA 抢视觉。
      return { primary: "发起交接", secondary: "更换成员" };
  }
}

function resolveEmailActionLabel(params: { phase: SeatAiArchivePhase; hasEmail: boolean }): string {
  if (params.phase === "pending_activation") {
    return params.hasEmail ? "编辑邮箱资料" : "补填邮箱";
  }
  if (params.phase === "vacant_shell") {
    return "填写邀请邮箱";
  }
  return params.hasEmail ? "更改邮箱" : "补填邮箱";
}

function renderArchivePrimaryActions(params: {
  phase: SeatAiArchivePhase;
  row: OrganizationPositionDetailRow;
  archive: SeatAiArchiveReadModel;
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
  handoverEditor: EnterpriseSurfaceProps["handoverEditor"];
  onBindMember: (seatId: string, teamPath: string, mode?: "offer" | "activation") => void;
  activationBusy?: boolean;
  onSendActivationEmails?: (emails: string[]) => void | Promise<void>;
}): TemplateResult {
  const { phase, row, archive } = params;
  const labels = resolveArchivePrimaryActionLabels(phase);
  const sendBusy = Boolean(params.activationBusy);

  if (phase === "vacant_shell") {
    return html`
      <button
        class="btn btn--primary btn--sm"
        type="button"
        data-archive-cta="primary"
        ?disabled=${sendBusy}
        @click=${() => openActivationEditor({ row, seatOfferEditor: params.seatOfferEditor })}
      >
        ${labels.primary}
      </button>
      <button
        class="btn btn--sm"
        type="button"
        data-archive-cta="secondary"
        ?disabled=${sendBusy}
        @click=${() => params.onBindMember(row.seatId, row.teamLabel, "offer")}
      >
        ${labels.secondary}
      </button>
    `;
  }

  if (phase === "pending_activation") {
    return html`
      ${
        archive.identity.canSendActivation
          ? html`
              <button
                class="btn btn--primary btn--sm"
                type="button"
                data-archive-cta="primary"
                ?disabled=${sendBusy}
                title=${sendBusy ? "正在发送激活邮件…" : "向待激活成员重发激活邮件"}
                @click=${() => {
                  const email = resolveArchiveActivationSendEmail({ archive, row });
                  if (!email) {
                    openActivationEditor({ row, seatOfferEditor: params.seatOfferEditor });
                    return;
                  }
                  const send =
                    params.onSendActivationEmails ??
                    params.actions.organization.onSendActivationEmails;
                  void send([email]);
                }}
              >
                ${sendBusy ? "发送中…" : labels.primary}
              </button>
            `
          : html`
              <button
                class="btn btn--primary btn--sm"
                type="button"
                data-archive-cta="primary"
                ?disabled=${sendBusy}
                @click=${() => openActivationEditor({ row, seatOfferEditor: params.seatOfferEditor })}
              >
                补邮箱并发送
              </button>
            `
      }
    `;
  }

  if (phase === "handover" && row.handover && params.handoverEditor) {
    return html`
      <button
        class="btn btn--primary btn--sm"
        type="button"
        data-archive-cta="primary"
        @click=${() =>
          params.handoverEditor.onOpen({
            handoverCaseId: row.handover!.handoverCaseId,
            seatTitle: row.handover!.seatTitle,
            status: row.handover!.status,
            incomingEmployeeUser: row.handover!.incomingEmployeeUser,
          })}
      >
        ${labels.primary}
      </button>
      <button
        class="btn btn--sm btn--ghost"
        type="button"
        data-archive-cta="secondary"
        title="更换席位绑定的成员"
        @click=${() =>
          params.seatOfferEditor.onOpen({
            seatId: row.seatId,
            seatTitle: row.name,
            seatStatus: row.seatStatus,
            defaultAgentId: row.defaultAgentId,
            availableAgentIds: row.agentIds,
            defaultSpaceIds: row.defaultSpaceIds,
            memoryScopeAvailable: row.memoryScopeIds.length > 0,
            employeeEmail: row.offer?.targetEmployeeUser ?? null,
          })}
      >
        ${labels.secondary}
      </button>
    `;
  }

  return html`
    <button
      class="btn btn--sm"
      type="button"
      data-archive-cta="primary"
      ?disabled=${!params.tenantId || row.status === "VACANT"}
      @click=${() => {
        if (!params.tenantId) {
          return;
        }
        if (!shouldProceed(`确认对岗位 ${row.name} 发起交接吗？`)) {
          return;
        }
        void params.actions.organization.onStartSeatHandover(params.tenantId, row.seatId);
      }}
    >
      ${labels.primary}
    </button>
    <button
      class="btn btn--sm btn--ghost"
      type="button"
      data-archive-cta="secondary"
      title="更换席位绑定的成员"
      @click=${() =>
        params.seatOfferEditor.onOpen({
          seatId: row.seatId,
          seatTitle: row.name,
          seatStatus: row.seatStatus,
          defaultAgentId: row.defaultAgentId,
          availableAgentIds: row.agentIds,
          defaultSpaceIds: row.defaultSpaceIds,
          memoryScopeAvailable: row.memoryScopeIds.length > 0,
          employeeEmail: row.offer?.targetEmployeeUser ?? null,
        })}
    >
      ${labels.secondary}
    </button>
  `;
}

function renderArchiveSectionPlaceholder(text: string | null): TemplateResult {
  return html`<p class="enterprise-org-ws__hint">${text ?? "待完善"}</p>`;
}

/** 开发监督 Node：挂在「数字人」分区，不与权限清单混排。 */
function renderArchiveSupervisorBlock(params: {
  client: EnterpriseSurfaceProps["client"];
  tenantId: string | null;
  seatId: string;
  canEdit: boolean;
}): TemplateResult {
  return html`
    <div class="enterprise-org-archive__supervisor" data-archive-supervisor>
      <div class="enterprise-org-archive__supervisor-title">开发监督 Node</div>
      <p class="enterprise-org-ws__hint">
        ${
          params.canEdit
            ? "将席位绑定到员工 Mac Node，以在本机 IDE CLI 上执行监督任务。"
            : "查看席位与 Node 绑定状态（只读）。修改绑定需 enterprise-admin 权限。"
        }
      </p>
      <supervisor-seat-node-panel
        .client=${params.client ?? null}
        .tenantId=${params.tenantId}
        .seatId=${params.seatId}
        .editable=${params.canEdit}
        variant="embedded"
      ></supervisor-seat-node-panel>
    </div>
  `;
}

/** 档案详情操作分组：标签 + 按钮行，避免多意图按钮平铺混排。 */
function renderArchiveActionGroup(params: {
  label: string;
  kind?: "lifecycle" | "meta" | "ownership" | "offer" | "danger";
  testId: string;
  actions: TemplateResult | typeof nothing;
}): TemplateResult | typeof nothing {
  if (params.actions === nothing) {
    return nothing;
  }
  const kind = params.kind ?? "lifecycle";
  return html`
    <div
      class="enterprise-org-archive__action-group enterprise-org-archive__action-group--${kind}"
      data-archive-action-group=${params.testId}
    >
      <div class="enterprise-org-archive__action-group-label">${params.label}</div>
      <div class="enterprise-org-ws__footer-inline-actions">${params.actions}</div>
    </div>
  `;
}

function renderArchiveOwnershipActions(params: {
  row: OrganizationPositionDetailRow;
  tenantId: string | null;
  readModel: EnterprisePortReadModel;
  actions: EnterpriseSurfaceProps["actions"];
  ownershipTransferEditor: EnterpriseSurfaceProps["ownershipTransferEditor"];
}): TemplateResult | typeof nothing {
  const { row, tenantId } = params;
  if (!row.defaultAgentId || !tenantId || !row.memberLabel) {
    return nothing;
  }
  return html`
    <button
      class="btn btn--sm"
      type="button"
      data-archive-ownership="revoke"
      @click=${() => {
        if (!shouldProceed(`确认解绑岗位 ${row.name} 当前机器人的归属吗？`)) {
          return;
        }
        void params.actions.organization.onRevokeOwnership(
          tenantId,
          "agent",
          row.defaultAgentId!,
          row.memberLabel!,
          row.memberLabel!,
          "organization position detail manual revoke",
        );
      }}
    >
      解绑机器人归属
    </button>
    <button
      class="btn btn--sm"
      type="button"
      data-archive-ownership="transfer"
      ?disabled=${!params.readModel.memberSummaries.some(
        (entry) => entry.user !== row.memberLabel && entry.seatTitle,
      )}
      @click=${() => {
        const nextOwner = params.readModel.memberSummaries.find(
          (entry) => entry.user !== row.memberLabel && entry.seatTitle,
        );
        if (!tenantId || !row.defaultAgentId || !row.memberLabel) {
          return;
        }
        params.ownershipTransferEditor?.onOpen({
          tenantId,
          subjectKind: "agent",
          subjectId: row.defaultAgentId,
          subjectLabel: resolveOrganizationDigitalHumanName(row.name),
          positionId: row.seatId,
          positionLabel: row.name,
          currentManagerUserId: row.memberUserId ?? row.memberLabel,
          currentManagerLabel:
            resolveOrganizationHumanLabel(row.memberDisplayLabel) ??
            resolveOrganizationHumanLabel(row.memberLabel) ??
            "未绑定成员",
          suggestedUserId: nextOwner?.user ?? null,
        });
      }}
    >
      转移机器人归属
    </button>
  `;
}

function renderArchiveOfferActions(params: {
  row: OrganizationPositionDetailRow;
  tenantId: string | null;
  actions: EnterpriseSurfaceProps["actions"];
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
}): TemplateResult | typeof nothing {
  const { row, tenantId } = params;
  if (!row.offer) {
    return nothing;
  }
  return html`
    <button
      class="btn btn--sm btn--primary"
      type="button"
      data-archive-offer="open"
      @click=${() =>
        params.seatOfferEditor.onOpen({
          seatId: row.seatId,
          seatTitle: row.name,
          seatStatus: row.seatStatus,
          defaultAgentId: row.defaultAgentId,
          availableAgentIds: row.agentIds,
          defaultSpaceIds: row.defaultSpaceIds,
          memoryScopeAvailable: row.memoryScopeIds.length > 0,
          employeeEmail: row.offer?.targetEmployeeUser ?? null,
        })}
    >
      打开确认
    </button>
    ${
      tenantId
        ? html`
            <button
              class="btn btn--sm"
              type="button"
              data-archive-offer="remind"
              @click=${() => {
                if (
                  !shouldProceed(`确认向 ${row.offer!.targetEmployeeUser} 发送岗位绑定提醒邮件吗？`)
                ) {
                  return;
                }
                void params.actions.organization.onRemindSeatOffer(
                  tenantId,
                  row.offer!.offerId,
                  row.offer!.targetEmployeeUser,
                );
              }}
            >
              发送提醒
            </button>
            <button
              class="btn btn--sm btn--danger"
              type="button"
              data-archive-offer="cancel"
              @click=${() => {
                if (
                  !shouldProceed(
                    `确认撤回发送给 ${row.offer!.targetEmployeeUser} 的岗位绑定确认吗？`,
                  )
                ) {
                  return;
                }
                void params.actions.organization.onCancelSeatOffer(tenantId, row.offer!.offerId);
              }}
            >
              撤回确认
            </button>
          `
        : nothing
    }
  `;
}

function renderArchiveCompletenessMeter(completeness: number): TemplateResult {
  const clamped = Math.max(0, Math.min(100, completeness));
  return html`
    <div class="enterprise-org-archive__meter" data-archive-completeness-meter>
      <div class="enterprise-org-archive__meter-head">
        <span class="enterprise-org-archive__meter-label">档案完善度</span>
        <strong class="enterprise-org-archive__meter-value" data-archive-completeness-value
          >${clamped}%</strong
        >
      </div>
      <div
        class="enterprise-org-archive__meter-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${String(clamped)}
        aria-label="AI 电子档案完善度"
      >
        <span class="enterprise-org-archive__meter-fill" style="width: ${clamped}%"></span>
      </div>
    </div>
  `;
}

function renderArchiveEmailValue(params: {
  email: string;
  emailMissing: boolean;
  actionLabel: string;
  onEditEmail: () => void;
}): TemplateResult {
  return html`
    <div class="enterprise-org-archive__email-row" data-archive-email-row>
      <span data-archive-email class=${params.emailMissing ? "is-missing" : ""}
        >${params.email || "未提供"}</span
      >
      <button
        class="btn btn--sm btn--ghost enterprise-org-archive__email-edit"
        type="button"
        data-archive-email-edit
        title=${params.actionLabel}
        @click=${params.onEditEmail}
      >
        ${params.actionLabel}
      </button>
    </div>
  `;
}

function renderArchiveIdentityMemberFields(params: {
  archive: SeatAiArchiveReadModel;
  onEditEmail: () => void;
}): TemplateResult {
  const { archive } = params;
  const member = archive.identity.memberLabel.trim();
  const email = (archive.identity.emailDisplay ?? "").trim();
  const emailMissing = !email || email === "未提供";
  const sameAsEmail =
    Boolean(member) && !emailMissing && member.toLowerCase() === email.toLowerCase();
  const actionLabel = resolveEmailActionLabel({
    phase: archive.phase,
    hasEmail: !emailMissing,
  });
  const emailValue = renderArchiveEmailValue({
    email,
    emailMissing,
    actionLabel,
    onEditEmail: params.onEditEmail,
  });

  if (sameAsEmail) {
    return orgWsField({
      label: "成员邮箱",
      content: emailValue,
    });
  }

  return html`
    ${orgWsField({
      label: "当前成员",
      content: html`<span>${member || "—"}</span>`,
    })}
    ${orgWsField({
      label: "邮箱",
      content: emailValue,
    })}
  `;
}

function renderArchiveSectionNav(params: {
  archive: SeatAiArchiveReadModel;
  activeSection: SeatAiArchiveSectionId;
  seatId: string;
}): TemplateResult {
  const { archive, activeSection, seatId } = params;
  return html`
    <div class="enterprise-org-archive__section-nav" data-archive-section-nav>
      <div class="enterprise-org-archive__section-nav-meta">
        <span>档案分区</span>
        <strong data-archive-section-filled-count
          >${SEAT_AI_ARCHIVE_SECTION_ORDER.filter((id) => archive.sections[id].filled).length}/${SEAT_AI_ARCHIVE_SECTION_ORDER.length}</strong
        >
        <span>已完善</span>
      </div>
      <div class="enterprise-org-archive__section-chips" role="tablist" aria-label="档案分区">
        ${SEAT_AI_ARCHIVE_SECTION_ORDER.map((id) => {
          const filled = archive.sections[id].filled;
          const active = id === activeSection;
          return html`
            <button
              class="enterprise-org-archive__section-chip ${filled ? "is-filled" : "is-gap"}${
                active ? " is-active" : ""
              }"
              type="button"
              role="tab"
              aria-selected=${active ? "true" : "false"}
              data-archive-section-chip=${id}
              data-filled=${filled ? "true" : "false"}
              data-active=${active ? "true" : "false"}
              title=${archive.sections[id].placeholder ?? SEAT_AI_ARCHIVE_SECTION_TITLES[id]}
              @click=${() => setArchiveActiveSection(seatId, id)}
            >
              <span class="enterprise-org-archive__section-chip-dot" aria-hidden="true"></span>
              ${ARCHIVE_SECTION_SHORT_TITLES[id]}
            </button>
          `;
        })}
      </div>
    </div>
  `;
}

function renderArchiveSection(params: {
  id: SeatAiArchiveSectionId;
  archive: SeatAiArchiveReadModel;
  content: TemplateResult;
  active: boolean;
}): TemplateResult | typeof nothing {
  if (!params.active) {
    return nothing;
  }
  const state = params.archive.sections[params.id];
  return html`
    <section
      class="enterprise-org-ws__section enterprise-org-archive__section enterprise-org-archive__panel"
      data-archive-section=${params.id}
      data-archive-panel=${params.id}
      data-filled=${state.filled ? "true" : "false"}
      role="tabpanel"
      aria-label=${SEAT_AI_ARCHIVE_SECTION_TITLES[params.id]}
    >
      <div class="enterprise-org-archive__section-head">
        <div class="enterprise-org-ws__section-title">
          ${SEAT_AI_ARCHIVE_SECTION_TITLES[params.id]}
        </div>
        <span
          class="enterprise-org-archive__section-badge ${state.filled ? "is-filled" : "is-gap"}"
          data-archive-section-badge=${params.id}
          >${state.filled ? "已完善" : "待完善"}</span
        >
      </div>
      ${params.content}
    </section>
  `;
}

function archivePersonLabel(row: OrganizationPositionDetailRow): string {
  return row.memberDisplayLabel?.trim() || row.memberLabel?.trim() || "该成员";
}

function renderArchiveDangerZone(params: {
  row: OrganizationPositionDetailRow;
  deleteEligibility: SeatDeleteEligibility;
  onDeleteSeat?: (seatId: string, seatTitle: string, teamPath: string) => void;
  onDeleteSeatAndMember?: (seatId: string, seatTitle: string, teamPath: string) => void;
  onGuideUnbind?: () => void;
}): TemplateResult {
  const { row, deleteEligibility } = params;
  const canDelete = deleteEligibility.allowed && Boolean(params.onDeleteSeat);
  const canDeletePersonAndSeat =
    isArchivePersonAndSeatDeleteVisible(row) && Boolean(params.onDeleteSeatAndMember);
  const deleteTitle = canDelete
    ? row.pendingEmployeeUser?.trim()
      ? "删除后将撤回待激活邀请，且不可恢复"
      : "删除后不可恢复"
    : (deleteEligibility.reason ?? "当前状态不可删除");
  const confirmMessage = row.pendingEmployeeUser?.trim()
    ? `确认删除岗位「${row.name}」？将撤回待激活邀请，此操作不可撤销。`
    : `确认删除岗位「${row.name}」？此操作不可撤销。`;
  const personAndSeatConfirm = `确认人岗同删？将从本企业注销「${archivePersonLabel(row)}」，并删除岗位「${row.name}」。岗位不再保留，进行中的交接会取消，且不可恢复。`;
  return html`
    <div
      class="enterprise-org-archive__danger-actions"
      data-archive-danger-zone
      data-archive-footer-actions
    >
      ${
        !canDelete && deleteEligibility.nextStep === "unbind_or_handover" && params.onGuideUnbind
          ? html`
              <button
                class="btn btn--sm"
                type="button"
                data-archive-danger-guide="unbind"
                @click=${params.onGuideUnbind}
              >
                先流转成员
              </button>
            `
          : nothing
      }
      ${
        canDeletePersonAndSeat
          ? html`
              <button
                class="btn btn--sm btn--danger"
                type="button"
                data-archive-danger="delete-seat-and-member"
                title="因人设岗时，同时注销成员并删除岗位，不可恢复"
                @click=${() => {
                  if (!params.onDeleteSeatAndMember) {
                    return;
                  }
                  if (!shouldProceed(personAndSeatConfirm)) {
                    return;
                  }
                  params.onDeleteSeatAndMember(row.seatId, row.name, row.teamLabel);
                }}
              >
                人岗同删
              </button>
            `
          : nothing
      }
      <button
        class="btn btn--sm btn--danger"
        type="button"
        data-archive-danger="delete-seat"
        title=${deleteTitle}
        ?disabled=${!canDelete}
        @click=${() => {
          if (!canDelete || !params.onDeleteSeat) {
            return;
          }
          if (!shouldProceed(confirmMessage)) {
            return;
          }
          params.onDeleteSeat(row.seatId, row.name, row.teamLabel);
        }}
      >
        删除岗位
      </button>
    </div>
  `;
}

/** 岗位 AI 电子档案：治理列表与组织结构操作区共用同一模板。 */
export function renderOrganizationPositionDetail(params: {
  row: OrganizationPositionDetailRow;
  readModel: EnterprisePortReadModel;
  client?: GatewayBrowserClient | null;
  actions: EnterpriseSurfaceProps["actions"];
  seatOfferEditor: NonNullable<EnterpriseSurfaceProps["seatOfferEditor"]>;
  createPositionEditor: NonNullable<EnterpriseSurfaceProps["createPositionEditor"]>;
  handoverEditor: EnterpriseSurfaceProps["handoverEditor"];
  ownershipTransferEditor: EnterpriseSurfaceProps["ownershipTransferEditor"];
  onBindMember: (seatId: string, teamPath: string, mode?: "offer" | "activation") => void;
  onDeleteSeat?: (seatId: string, seatTitle: string, teamPath: string) => void;
  onDeleteSeatAndMember?: (seatId: string, seatTitle: string, teamPath: string) => void;
  onClose: () => void;
  onBackToGovernance?: () => void;
  /** Surface-owned busy/feedback for activation send (avoids silent failures). */
  activationBusy?: boolean;
  activationError?: string | null;
  activationNotice?: string | null;
  onSendActivationEmails?: (emails: string[]) => void | Promise<void>;
}): TemplateResult {
  const { row } = params;
  ensureSeatArchiveSkillsLoaded({
    client: params.client,
    seatId: row.seatId,
    agentIds: row.agentIds,
    defaultAgentId: row.defaultAgentId,
  });
  const archive = buildOrganizationPositionArchive(row, params.readModel);
  const activeSection = resolveArchiveActiveSection(row.seatId);
  const deleteEligibility = resolveSeatDeleteEligibility(row);
  const tenantId = params.readModel.currentTenantId;
  const canEditSupervisor = canEditEnterpriseSupervisorPolicy(params.readModel.membershipRole);
  const riskItems = [
    archive.phase === "vacant_shell" ? "岗位尚未绑定成员，完善身份后可发送激活邮件。" : null,
    row.offer ? `存在待确认绑定：${row.offer.targetEmployeeUser}` : null,
    archive.phase === "handover" && row.handover
      ? `${handoverStatusLabel(row.handover.status)} · ${handoverNextActionLabel(row.handover.status)}`
      : null,
  ].filter(Boolean) as string[];
  const primaryActions = renderArchivePrimaryActions({
    phase: archive.phase,
    row,
    archive,
    tenantId,
    actions: params.actions,
    seatOfferEditor: params.seatOfferEditor,
    handoverEditor: params.handoverEditor,
    onBindMember: params.onBindMember,
    activationBusy: params.activationBusy,
    onSendActivationEmails: params.onSendActivationEmails,
  });
  const activationExpiry = archive.identity.pendingActivationExpiresAt
    ? formatActivationExpiresAt(archive.identity.pendingActivationExpiresAt)
    : null;
  const onEditEmail = () =>
    openEmailChangeEditor({
      row,
      archive,
      seatOfferEditor: params.seatOfferEditor,
    });
  const activationFeedback =
    params.activationError || params.activationNotice
      ? orgWsNotice({
          kind: params.activationError ? "danger" : "ok",
          content: html`<strong>${params.activationError ?? params.activationNotice}</strong>`,
        })
      : nothing;

  return html`
    <section
      class="enterprise-org-workspace enterprise-org-ws enterprise-org-ws--flat enterprise-org-position-detail enterprise-org-archive"
      data-archive-phase=${archive.phase}
      data-archive-completeness=${String(archive.completeness)}
    >
      ${orgWsHeader({
        title: row.name,
        onClose: params.onClose,
      })}
      ${orgWsBody(html`
        <div class="enterprise-org-archive__hero" data-archive-hero>
          <div class="enterprise-org-archive__hero-meta">
            <span class="enterprise-org-archive__phase-pill" data-archive-phase-label
              >${archive.phaseLabel}</span
            >
            <span class="enterprise-org-archive__hero-status"
              >${organizationStatusLabel(archive.identity.organizationStatus)}</span
            >
          </div>
          ${renderArchiveCompletenessMeter(archive.completeness)}
          ${renderArchiveSectionNav({
            archive,
            activeSection,
            seatId: row.seatId,
          })}
          ${activationFeedback}
        </div>
        ${
          riskItems.length
            ? orgWsNotice({
                kind: "danger",
                content: html`
                  <div class="enterprise-org-ws__risk-list">
                    ${riskItems.map((item) => html`<div>${item}</div>`)}
                  </div>
                `,
              })
            : nothing
        }
        ${orgWsDetailStack(html`
          ${renderArchiveSection({
            id: "identity",
            archive,
            active: activeSection === "identity",
            content: html`
              ${orgWsField({
                label: "部门路径",
                content: html`<span>${archive.identity.teamLabel || "未分组"}</span>`,
              })}
              ${renderArchiveIdentityMemberFields({ archive, onEditEmail })}
              ${
                archive.phase === "vacant_shell" || archive.phase === "pending_activation"
                  ? orgWsField({
                      label: "席位状态",
                      content: html`<span>${seatStatusLabel(archive.identity.seatStatus)}</span>`,
                    })
                  : nothing
              }
              ${
                activationExpiry
                  ? orgWsField({
                      label: "激活过期",
                      content: html`<span title=${activationExpiry.title}
                        >${activationExpiry.display}</span
                      >`,
                    })
                  : nothing
              }
              ${
                row.responsibility
                  ? orgWsField({
                      label: "岗位职责",
                      alignTop: true,
                      content: html`<p class="enterprise-org-ws__hint">${row.responsibility}</p>`,
                    })
                  : nothing
              }
              ${renderArchiveActionGroup({
                label: "待确认绑定",
                kind: "offer",
                testId: "identity-offer",
                actions: renderArchiveOfferActions({
                  row,
                  tenantId,
                  actions: params.actions,
                  seatOfferEditor: params.seatOfferEditor,
                }),
              })}
              ${
                archive.sections.identity.placeholder
                  ? renderArchiveSectionPlaceholder(archive.sections.identity.placeholder)
                  : nothing
              }
            `,
          })}
          ${renderArchiveSection({
            id: "digital",
            archive,
            active: activeSection === "digital",
            content: html`
              ${orgWsField({
                label: "岗位数字人",
                content: html`<span>${resolveOrganizationDigitalHumanName(row.name)}</span>`,
              })}
              ${orgWsField({
                label: "Bot / 协作组",
                content: html`<span
                  >${archive.digital.botCount}/5 · ${archive.digital.groupCount}/5</span
                >`,
              })}
              ${
                archive.digital.usageAttributionNote
                  ? html`<p class="enterprise-org-ws__hint" data-archive-usage-attribution>
                      ${archive.digital.usageAttributionNote}
                    </p>`
                  : nothing
              }
              <div class="enterprise-org-archive__usage-grid" data-archive-usage-grid>
                ${orgWsKvGrid([
                  {
                    label: "本月 Token",
                    value: archive.digital.usagePendingMember
                      ? "待绑定后统计"
                      : archive.digital.totalTokens == null
                        ? "--"
                        : formatTokens(archive.digital.totalTokens),
                    mono: true,
                  },
                  {
                    label: "本月成本",
                    value: archive.digital.usagePendingMember
                      ? "待绑定后统计"
                      : archive.digital.totalCost == null
                        ? "--"
                        : formatCost(archive.digital.totalCost),
                    mono: true,
                  },
                  {
                    label: "本月会话",
                    value: archive.digital.usagePendingMember
                      ? "待绑定后统计"
                      : archive.digital.sessionCount == null
                        ? "--"
                        : String(archive.digital.sessionCount),
                    mono: true,
                  },
                ])}
              </div>
              ${
                archive.digital.runtimeLabel
                  ? orgWsField({
                      label: "运行态",
                      content: html`<span>${archive.digital.runtimeLabel}</span>`,
                    })
                  : nothing
              }
              ${
                archive.digital.agentIds.length
                  ? orgWsField({
                      label: "关联 Bot",
                      alignTop: true,
                      content: html`
                        <div class="chip-row enterprise-org-ws__chip-row">
                          ${archive.digital.agentIds.map((agentId) => {
                            const agent = params.readModel.meshAgents.find(
                              (item) => item.agentId === agentId,
                            );
                            const label =
                              resolveOrganizationHumanLabel(agent?.name) ??
                              resolveOrganizationDigitalHumanName(row.name);
                            return html`<span class="chip">${label}</span>`;
                          })}
                        </div>
                      `,
                    })
                  : nothing
              }
              ${renderArchiveActionGroup({
                label: "数字人归属",
                kind: "ownership",
                testId: "digital-ownership",
                actions: renderArchiveOwnershipActions({
                  row,
                  tenantId,
                  readModel: params.readModel,
                  actions: params.actions,
                  ownershipTransferEditor: params.ownershipTransferEditor,
                }),
              })}
              ${renderArchiveSupervisorBlock({
                client: params.client,
                tenantId,
                seatId: row.seatId,
                canEdit: canEditSupervisor,
              })}
              ${
                archive.sections.digital.placeholder
                  ? renderArchiveSectionPlaceholder(archive.sections.digital.placeholder)
                  : nothing
              }
            `,
          })}
          ${renderArchiveSection({
            id: "permissions",
            archive,
            active: activeSection === "permissions",
            content: html`
                ${
                  archive.permissions.identities.length
                    ? orgWsMetaList(archive.permissions.identities)
                    : renderArchiveSectionPlaceholder(archive.sections.permissions.placeholder)
                }
              `,
          })}
            ${renderArchiveSection({
              id: "skills",
              archive,
              active: activeSection === "skills",
              content: html`
                ${
                  archive.skills.items.length
                    ? html`
                        <div class="chip-row enterprise-org-ws__chip-row">
                          ${archive.skills.items.map((skill) => html`<span class="chip">${skill}</span>`)}
                        </div>
                      `
                    : renderArchiveSectionPlaceholder(archive.skills.placeholder)
                }
              `,
            })}
            ${renderArchiveSection({
              id: "contribution",
              archive,
              active: activeSection === "contribution",
              content: html`
                ${orgWsField({
                  label: "可继承资产合计",
                  content: html`<span>${archive.contribution.breakdown.total}</span>`,
                })}
                ${orgWsField({
                  label: "Bot / 空间 / 记忆域",
                  content: html`<span
                    >${archive.contribution.breakdown.agentCount} /
                    ${archive.contribution.breakdown.spaceCount} /
                    ${archive.contribution.breakdown.memoryScopeCount}</span
                  >`,
                })}
                ${orgWsField({
                  label: "身份绑定",
                  content: html`<span
                    >${archive.contribution.breakdown.identityBindingCount}</span
                  >`,
                })}
                ${orgWsField({
                  label: "Mesh 会话（参考）",
                  content: html`<span>${archive.contribution.breakdown.meshSessionCount}</span>`,
                })}
                ${
                  archive.contribution.placeholder
                    ? renderArchiveSectionPlaceholder(archive.contribution.placeholder)
                    : nothing
                }
              `,
            })}
            ${renderArchiveSection({
              id: "timeline",
              archive,
              active: activeSection === "timeline",
              content: html`
                ${
                  archive.timeline.activityLabel
                    ? orgWsField({
                        label: "最近活动",
                        content: html`<span>${archive.timeline.activityLabel}</span>`,
                      })
                    : nothing
                }
                ${
                  archive.timeline.lastActiveAt != null
                    ? orgWsField({
                        label: "最近活跃",
                        content: html`<span
                          >${new Date(archive.timeline.lastActiveAt).toLocaleString()}</span
                        >`,
                      })
                    : nothing
                }
                ${orgWsField({
                  label: "日均工时",
                  content: html`<span
                    >${
                      archive.timeline.avgDailyHours != null
                        ? `${archive.timeline.avgDailyHours.toFixed(1)}h`
                        : "暂无可靠数据源"
                    }</span
                  >`,
                })}
                ${
                  archive.timeline.events.length
                    ? html`
                        <ul class="enterprise-org-ws__meta-list" data-archive-timeline>
                          ${archive.timeline.events.map(
                            (event) => html`
                              <li
                                class="enterprise-org-ws__meta-item"
                                data-event-id=${event.id}
                                data-event-source=${event.source}
                              >
                                <div class="enterprise-org-ws__meta-copy">
                                  <strong>${event.label}</strong>
                                  ${
                                    event.at
                                      ? html`<span title=${event.at}
                                          >${formatArchiveTimestamp(event.at) ?? event.at}</span
                                        >`
                                      : nothing
                                  }
                                </div>
                              </li>
                            `,
                          )}
                        </ul>
                      `
                    : renderArchiveSectionPlaceholder(archive.sections.timeline.placeholder)
                }
              `,
            })}
        `)}
        <div class="enterprise-org-ws__empty" hidden data-archive-section-index>
          ${SEAT_AI_ARCHIVE_SECTION_ORDER.map(
            (id) => html`<span data-section=${id}>${SEAT_AI_ARCHIVE_SECTION_TITLES[id]}</span>`,
          )}
        </div>
      `)}
      <footer class="enterprise-org-ws__footer enterprise-org-archive__footer" data-archive-footer>
        <div class="enterprise-org-archive__footer-toolbar" data-archive-footer-toolbar>
          <div class="enterprise-org-archive__footer-actions" data-archive-identity-actions>
            <div
              class="enterprise-org-ws__footer-inline-actions"
              data-archive-action-group="identity-lifecycle"
            >
              ${primaryActions}
            </div>
            <button
              class="btn btn--sm btn--ghost"
              type="button"
              data-archive-meta="edit-position"
              data-archive-action-group="identity-meta"
              ?disabled=${Boolean(params.activationBusy)}
              @click=${() =>
                params.createPositionEditor.onOpen({
                  seatId: row.seatId,
                  seatTitle: row.name,
                  teamLabel: row.teamLabel === "未分组" ? null : row.teamLabel,
                  responsibility: row.responsibility,
                  employeeEmail:
                    resolveArchiveActivationSendEmail({ archive, row }) ??
                    archive.identity.email ??
                    null,
                })}
            >
              编辑
            </button>
            ${renderArchiveDangerZone({
              row,
              deleteEligibility,
              onDeleteSeat: params.onDeleteSeat,
              onDeleteSeatAndMember: params.onDeleteSeatAndMember,
              onGuideUnbind: () => {
                if (archive.phase === "handover" && row.handover && params.handoverEditor) {
                  params.handoverEditor.onOpen({
                    handoverCaseId: row.handover.handoverCaseId,
                    seatTitle: row.handover.seatTitle,
                    status: row.handover.status,
                    incomingEmployeeUser: row.handover.incomingEmployeeUser,
                  });
                  return;
                }
                params.seatOfferEditor.onOpen({
                  seatId: row.seatId,
                  seatTitle: row.name,
                  seatStatus: row.seatStatus,
                  defaultAgentId: row.defaultAgentId,
                  availableAgentIds: row.agentIds,
                  defaultSpaceIds: row.defaultSpaceIds,
                  memoryScopeAvailable: row.memoryScopeIds.length > 0,
                  employeeEmail: row.offer?.targetEmployeeUser ?? row.memberUserId ?? null,
                });
              },
            })}
          </div>
          <div class="enterprise-org-archive__footer-nav" data-archive-footer-nav>
            ${
              params.onBackToGovernance
                ? html`
                    <button
                      class="btn btn--sm btn--ghost"
                      type="button"
                      data-archive-nav="back-governance"
                      @click=${params.onBackToGovernance}
                    >
                      返回模块首页
                    </button>
                  `
                : nothing
            }
          </div>
        </div>
      </footer>
    </section>
  `;
}
