/**
 * My Bots master-detail right stage — top sub-tabs (flat polish).
 * Aligns with collaboration-groups IA + ui-secondary-page-refinement.
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import { isBuiltinStewardAgent } from "../../../builtin-steward-selection.ts";
import type {
  MyBotCapabilityProjection,
  MyBotGrowthProjection,
  MyBotGrowthRecommendationView,
  MyBotProjection,
  MyBotWorkingStyleProjection,
} from "../semantic/my-bot-read-model.ts";
import type { UserOperationalIdentitySnapshot } from "../semantic/view-controller-facade.ts";
import { renderPersonalDevicesPanel } from "./personal-devices-page.ts";
import { normalizeGrowthReport, renderGrowthReportSummary } from "./workbench-growth-report.ts";
import { wbSettingsDetailToolbar } from "./workbench-settings-layout.ts";
import type {
  WorkbenchMyBotIdentityDraft,
  WorkbenchSettingsRobotEntry,
} from "./workbench-types.ts";

export type MyBotDetailTabId =
  | "identity"
  | "capabilities"
  | "growth"
  | "auth"
  | "collaboration"
  | "data"
  | "devices"
  | "danger";

const TAB_DEFS: Array<{
  id: MyBotDetailTabId;
  /** Static label for legacy tabs; growth uses labelKey. */
  label?: string;
  labelKey?: string;
  ownedOnly?: boolean;
}> = [
  { id: "identity", labelKey: "frontstage.workbench.growth.dossier.zone.identity" },
  { id: "capabilities", labelKey: "frontstage.workbench.growth.dossier.zone.capability" },
  { id: "growth", labelKey: "frontstage.workbench.growth.dossier.tab" },
  { id: "auth", label: "运营授权" },
  { id: "collaboration", label: "协作" },
  { id: "data", label: "数据" },
  { id: "devices", label: "已连接设备" },
  { id: "danger", label: "删除", ownedOnly: true },
];

function resolveTabLabel(tab: (typeof TAB_DEFS)[number]): string {
  if (tab.labelKey) {
    return t(tab.labelKey);
  }
  return tab.label ?? tab.id;
}

export type MyBotWorkspacePanelProps = {
  entry: WorkbenchSettingsRobotEntry;
  loading: boolean;
  error: string | null;
  saving: boolean;
  bot: MyBotProjection | null;
  identityDraft: WorkbenchMyBotIdentityDraft | null;
  activeTab: MyBotDetailTabId;
  onTabChange: (tab: MyBotDetailTabId) => void;
  onIdentityDraftChange: (patch: Partial<WorkbenchMyBotIdentityDraft>) => void;
  onSaveIdentity: () => void;
  onExploreCapabilities: () => void;
  onOpenGroup: (groupId: string) => void;
  onSelectSession: (sessionKey: string) => void;
  userOperationalIdentitySnapshot?: UserOperationalIdentitySnapshot | null;
  userOperationalIdentityBusy?: boolean;
  userOperationalIdentityError?: string | null;
  userOperationalIdentityNotice?: string | null;
  onApplyRobotIdentityGrants?: (input: {
    agentId: string;
    agentScope: "owned" | "shared" | "group";
    desired: Array<{
      identityId: string;
      allowedActions: string[];
      resourceScope?: { groups: string[]; docs: string[]; calendars: string[] };
      confirmMode?: "read_only" | "draft_then_confirm" | "limited_auto";
      expiresAt?: string;
    }>;
  }) => void;
  onApplyRobotEnterpriseIdentities?: (input: {
    agentId: string;
    desiredIdentityIds: string[];
  }) => void;
  onAddPersonalIdentity?: () => void;
  onLoadRobotEnterpriseIdentities?: (agentId: string) => void;
  ownedRobotDeleteBusyId?: string | null;
  ownedRobotDeleteError?: string | null;
  ownedRobotDeleteDisposition?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind";
  onOwnedRobotDeleteDispositionChange?: (
    value: "delete_all" | "keep_artifacts_conversations" | "soft_unbind",
  ) => void;
  onConfirmOwnedRobotDelete?: () => void;
  onPrepareOwnedRobotDelete?: (agentId: string, name: string) => void;
};

function renderStars(stars: number): string {
  const n = Math.max(1, Math.min(5, Math.round(stars)));
  return `${"★".repeat(n)}${"☆".repeat(5 - n)}`;
}

function sourceLabel(source: MyBotCapabilityProjection["source"]): string {
  switch (source) {
    case "personal":
      return "个人";
    case "group":
      return "小组";
    case "enterprise":
      return "企业";
    default:
      return "市场";
  }
}

function statusLabel(status: MyBotProjection["identity"]["status"]): string {
  switch (status) {
    case "online":
      return "可用";
    case "degraded":
      return "异常";
    case "offline":
      return "离线";
    default:
      return "未知";
  }
}

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderKvRows(rows: Array<{ label: string; value: string; mono?: boolean }>) {
  return html`
    <div class="wb-bots__kv" role="list">
      ${rows.map(
        (row) => html`
          <div class="wb-bots__kv-row" role="listitem">
            <span class="wb-bots__kv-label">${row.label}</span>
            <span class="wb-bots__kv-value ${row.mono ? "mono" : ""}">${row.value}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderEmpty(message: string) {
  return html`<div class="wb-bots__empty">${message}</div>`;
}

function renderSection(title: string, body: TemplateResult, actions?: TemplateResult) {
  return html`
    <section class="wb-bots__section">
      <div class="wb-bots__section-head">
        <h3 class="wb-bots__section-title">${title}</h3>
        ${actions ?? nothing}
      </div>
      <div class="wb-bots__section-body">${body}</div>
    </section>
  `;
}

function isIdentityDraftDirty(
  draft: WorkbenchMyBotIdentityDraft | null,
  bot: MyBotProjection | null,
): boolean {
  if (!draft || !bot) {
    return false;
  }
  return (
    draft.name !== (bot.identity.name ?? "") ||
    draft.positioning !== (bot.identity.positioning ?? "") ||
    draft.role !== (bot.identity.role ?? "") ||
    draft.personaTraits !== (bot.identity.personaTraits ?? "") ||
    draft.model !== (bot.identity.model ?? "")
  );
}

function renderField(
  label: string,
  value: string,
  placeholder: string,
  onInput: (value: string) => void,
  opts?: { multiline?: boolean },
) {
  if (opts?.multiline) {
    return html`
      <label class="wb-bots__field">
        <span class="wb-bots__field-label">${label}</span>
        <textarea
          class="wb-bots__field-input wb-bots__field-input--area"
          rows="2"
          .value=${value}
          placeholder=${placeholder}
          @input=${(event: Event) => onInput((event.target as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
    `;
  }
  return html`
    <label class="wb-bots__field">
      <span class="wb-bots__field-label">${label}</span>
      <input
        class="wb-bots__field-input"
        type="text"
        .value=${value}
        placeholder=${placeholder}
        @input=${(event: Event) => onInput((event.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

function renderIdentityTab(props: MyBotWorkspacePanelProps) {
  const bot = props.bot;
  const draft = props.identityDraft;
  const canEdit = props.entry.source === "owned";
  if (!bot) {
    return renderEmpty("正在加载身份…");
  }
  if (canEdit && draft) {
    return html`
      <div class="wb-bots__field-stack">
        ${renderField("名称", draft.name, "给机器人起一个名字", (value) =>
          props.onIdentityDraftChange({ name: value }),
        )}
        ${renderField(
          "定位",
          draft.positioning,
          "一句话说明它擅长什么",
          (value) => props.onIdentityDraftChange({ positioning: value }),
          { multiline: true },
        )}
        ${renderField("角色", draft.role, "例如：助理、分析师", (value) =>
          props.onIdentityDraftChange({ role: value }),
        )}
        ${renderField(
          "人格",
          draft.personaTraits,
          "语气与风格偏好",
          (value) => props.onIdentityDraftChange({ personaTraits: value }),
          { multiline: true },
        )}
        ${renderField("模型", draft.model, "provider/model", (value) =>
          props.onIdentityDraftChange({ model: value }),
        )}
      </div>
    `;
  }
  return html`
    ${renderKvRows([
      { label: "定位", value: bot.identity.positioning || "—" },
      { label: "角色", value: bot.identity.role || "—" },
      { label: "人格", value: bot.identity.personaTraits || "—" },
      { label: "模型", value: bot.identity.model || "—", mono: true },
    ])}
    <p class="wb-bots__hint">参与中的机器人仅可查看。</p>
  `;
}

function renderCapabilitiesTab(props: MyBotWorkspacePanelProps) {
  const bot = props.bot;
  if (!bot) {
    return renderEmpty("正在加载能力…");
  }
  return html`
    <div class="wb-bots__stack">
      ${renderSection(
        "已安装",
        bot.capabilities.length === 0
          ? renderEmpty("还没有安装能力。")
          : html`
              <ul class="wb-bots__list">
                ${bot.capabilities.map(
                  (cap) => html`
                    <li class="wb-bots__list-row">
                      <div class="wb-bots__list-main">
                        <span class="wb-bots__list-title">${cap.name}</span>
                        <span class="wb-bots__list-meta" aria-label="熟练度 ${cap.stars} 星">
                          ${renderStars(cap.stars)}
                        </span>
                      </div>
                      <span class="wb-bots__tag">${sourceLabel(cap.source)}</span>
                    </li>
                  `,
                )}
              </ul>
            `,
        html`
          <button
            type="button"
            class="wb-bots__text-action"
            @click=${() => props.onExploreCapabilities()}
          >
            探索能力
          </button>
        `,
      )}

      ${renderSection(
        "扮演",
        bot.personas.length === 0
          ? renderEmpty("暂无扮演身份。")
          : html`
              <ul class="wb-bots__list">
                ${bot.personas.map(
                  (persona) => html`
                    <li class="wb-bots__list-row wb-bots__list-row--stack">
                      <span class="wb-bots__list-title">${persona.label}</span>
                      ${
                        persona.description
                          ? html`<span class="wb-bots__list-sub">${persona.description}</span>`
                          : nothing
                      }
                    </li>
                  `,
                )}
              </ul>
            `,
      )}
    </div>
  `;
}

type GrowthZoneId = "capability" | "performance" | "suggestion";

function recommendationCtaLabel(rec: MyBotGrowthRecommendationView | null | undefined): string {
  switch (rec?.kind) {
    case "start_work":
      return t("frontstage.workbench.growth.recommend.ctaStartWork");
    case "confirm_identity":
      return t("frontstage.workbench.growth.recommend.ctaConfirmIdentity");
    case "install_capabilities":
      return t("frontstage.workbench.growth.recommend.ctaInstallCapabilities");
    case "verify_with_task":
      return t("frontstage.workbench.growth.recommend.ctaVerifyWithTask");
    default:
      return t("frontstage.workbench.growth.recommend.ctaNone");
  }
}

function recommendationReasonLabel(rec: MyBotGrowthRecommendationView | null | undefined): string {
  switch (rec?.kind) {
    case "start_work":
      return t("frontstage.workbench.growth.dossier.reason.startWork");
    case "confirm_identity":
      return t("frontstage.workbench.growth.dossier.reason.confirmIdentity");
    case "install_capabilities":
      return rec.gaps.length > 0
        ? t("frontstage.workbench.growth.dossier.reason.installCapabilitiesCount", {
            count: rec.gaps.length,
          })
        : t("frontstage.workbench.growth.dossier.reason.installCapabilities");
    case "verify_with_task":
      return t("frontstage.workbench.growth.dossier.reason.verifyWithTask");
    default:
      return t("frontstage.workbench.growth.dossier.reason.none");
  }
}

function applyGrowthRecommendation(
  props: MyBotWorkspacePanelProps,
  rec: MyBotGrowthRecommendationView | null | undefined,
): void {
  switch (rec?.kind) {
    case "confirm_identity":
      props.onTabChange("identity");
      return;
    case "install_capabilities":
      props.onExploreCapabilities();
      return;
    case "start_work":
    case "verify_with_task":
      props.onSelectSession(props.entry.sessionKey);
      return;
    default:
      return;
  }
}

function renderDimensionBars(growth: MyBotGrowthProjection): TemplateResult {
  const dims = growth.dimensions ?? {
    identity: 0,
    capability: 0,
    knowledge: 0,
    habits: 0,
  };
  const rows: Array<{ label: string; value: number }> = [
    { label: t("frontstage.workbench.growth.dimension.identity"), value: dims.identity },
    { label: t("frontstage.workbench.growth.dimension.capability"), value: dims.capability },
    { label: t("frontstage.workbench.growth.dimension.knowledge"), value: dims.knowledge },
    { label: t("frontstage.workbench.growth.dossier.experience"), value: dims.habits },
  ];
  return html`
    <ul class="wb-bots__dim-list" data-wb-bots-growth-dims>
      ${rows.map(
        (row) => html`
          <li class="wb-bots__dim-row">
            <span class="wb-bots__dim-label">${row.label}</span>
            <span class="wb-bots__dim-track" aria-hidden="true">
              <span
                class="wb-bots__dim-fill"
                style="width:${Math.max(0, Math.min(100, Math.round(row.value)))}%"
              ></span>
            </span>
            <span class="wb-bots__dim-value">${Math.round(row.value)}%</span>
          </li>
        `,
      )}
    </ul>
  `;
}

function workingStyleFieldLabel(field: keyof MyBotWorkingStyleProjection["style"]): string {
  return t(`frontstage.workbench.growth.dossier.workingStyle.field.${field}`);
}

function workingStyleValueLabel(
  field: keyof MyBotWorkingStyleProjection["style"],
  value: string,
): string {
  const key = `frontstage.workbench.growth.dossier.workingStyle.value.${field}.${value}`;
  const translated = t(key);
  return translated === key ? value : translated;
}

function renderWorkingStyleEffect(
  lastChange: MyBotWorkingStyleProjection["lastChange"],
): TemplateResult {
  if (!lastChange) {
    return html`<p class="wb-bots__hint">${t("frontstage.workbench.growth.dossier.workingStyle.noChange")}</p>`;
  }
  const status = lastChange.effectStatus;
  const statusLabel =
    status === null
      ? t("frontstage.workbench.growth.dossier.workingStyle.effect.pending")
      : t(`frontstage.workbench.growth.dossier.workingStyle.effect.${status}`);
  return html`
    <p class="wb-bots__hint">
      ${t("frontstage.workbench.growth.dossier.workingStyle.lastChange", {
        status: statusLabel,
      })}
      ${
        lastChange.rolledBack
          ? html`<span class="wb-bots__tag">${t("frontstage.workbench.growth.dossier.workingStyle.rolledBack")}</span>`
          : nothing
      }
    </p>
  `;
}

function renderWorkingStyleEvidence(workingStyle: MyBotWorkingStyleProjection): TemplateResult {
  const evidence = workingStyle.evidence;
  const updatedLabel =
    workingStyle.updatedAtMs !== null && workingStyle.updatedAtMs > 0
      ? new Date(workingStyle.updatedAtMs).toLocaleString()
      : t("frontstage.workbench.growth.dossier.status.noData");
  return html`
    <p class="wb-bots__hint" data-wb-bots-working-style-evidence>
      ${t("frontstage.workbench.growth.dossier.workingStyle.evidenceSummary", {
        tasksTotal: evidence.tasksTotal,
        minLearning: evidence.minSamplesForLearning,
        minAutonomous: evidence.minSamplesForAutonomous,
        updated: updatedLabel,
      })}
      ${
        evidence.learningEligible
          ? nothing
          : html`<span class="wb-bots__tag"
            >${t("frontstage.workbench.growth.dossier.workingStyle.insufficientSamples")}</span
          >`
      }
    </p>
  `;
}

function renderWorkingStyleSection(
  workingStyle: MyBotWorkingStyleProjection | null | undefined,
): TemplateResult {
  if (!workingStyle) {
    return html`<p class="wb-bots__hint">${t("frontstage.workbench.growth.dossier.workingStyle.pending")}</p>`;
  }
  if (!workingStyle.learned) {
    return html`
      <div class="wb-bots__working-style" data-wb-bots-working-style>
        <h4 class="wb-bots__subheading">${t("frontstage.workbench.growth.dossier.workingStyle.title")}</h4>
        ${renderWorkingStyleEvidence(workingStyle)}
        <p class="wb-bots__hint">${t("frontstage.workbench.growth.dossier.workingStyle.notLearned")}</p>
      </div>
    `;
  }
  const style = workingStyle.style;
  const fields: Array<keyof MyBotWorkingStyleProjection["style"]> = [
    "outputFormat",
    "reportingCadence",
    "decisionPreference",
    "riskPreference",
    "communicationTone",
  ];
  return html`
    <div class="wb-bots__working-style" data-wb-bots-working-style>
      <h4 class="wb-bots__subheading">${t("frontstage.workbench.growth.dossier.workingStyle.title")}</h4>
      ${renderWorkingStyleEvidence(workingStyle)}
      ${renderKvRows(
        fields.map((field) => ({
          label: workingStyleFieldLabel(field),
          value: workingStyleValueLabel(field, style[field]),
        })),
      )}
      ${renderWorkingStyleEffect(workingStyle.lastChange)}
    </div>
  `;
}

function renderGrowthTab(props: MyBotWorkspacePanelProps) {
  const bot = props.bot;
  if (!bot) {
    return renderEmpty(t("frontstage.workbench.growth.dossier.loading"));
  }
  const growth = bot.growth;
  const completeness = growth.completeness ?? {
    identity: 0,
    capability: 0,
    performance: 0,
    suggestion: 0,
  };
  const zones: Array<{ id: GrowthZoneId; label: string; value: number }> = [
    {
      id: "capability",
      label: t("frontstage.workbench.growth.dossier.zone.capability"),
      value: completeness.capability,
    },
    {
      id: "performance",
      label: t("frontstage.workbench.growth.dossier.zone.performance"),
      value: completeness.performance,
    },
    {
      id: "suggestion",
      label: t("frontstage.workbench.growth.dossier.zone.suggestion"),
      value: completeness.suggestion,
    },
  ];
  const gaps = growth.capabilityGaps ?? [];
  const unmet = gaps.filter((gap) => gap.status === "missing");
  const report = normalizeGrowthReport(growth.growthReport ?? null);
  const rec = growth.recommendation ?? null;
  const ctaLabel = recommendationCtaLabel(rec);
  const hasActionableRec = Boolean(rec && rec.kind !== "none");

  return html`
    <div class="wb-bots__stack wb-bots__growth-dossier" data-wb-bots-growth-dossier>
      <nav
        class="wb-bots__zone-nav"
        aria-label=${t("frontstage.workbench.growth.dossier.zoneNavAria")}
      >
        ${zones.map(
          (zone) => html`
            <a class="wb-bots__zone-chip" href="#wb-bots-zone-${zone.id}">
              <span>${zone.label}</span>
              <strong>${zone.value}%</strong>
            </a>
          `,
        )}
      </nav>

      ${renderSection(
        t("frontstage.workbench.growth.dossier.zone.capability"),
        html`
          <div id="wb-bots-zone-capability" data-wb-bots-zone="capability">
            ${renderDimensionBars(growth)}
            ${renderWorkingStyleSection(growth.workingStyle)}
            ${renderKvRows([
              {
                label: t("frontstage.workbench.growth.dossier.field.installedSkills"),
                value: String(bot.capabilities.length),
              },
              {
                label: t("frontstage.workbench.growth.dossier.field.capabilityReady"),
                value: growth.funnel?.hasFirstSkillInstalled
                  ? t("frontstage.workbench.growth.dossier.status.started")
                  : t("frontstage.workbench.growth.dossier.status.pendingInstall"),
              },
              {
                label: t("frontstage.workbench.growth.dossier.field.gaps"),
                value:
                  unmet.length > 0
                    ? t("frontstage.workbench.growth.dossier.status.gapsCount", {
                        count: unmet.length,
                      })
                    : t("frontstage.workbench.growth.dossier.status.none"),
              },
            ])}
            ${
              unmet.length === 0
                ? html`<p class="wb-bots__hint">
                    ${t("frontstage.workbench.growth.dossier.noUnmetGaps")}
                  </p>`
                : html`
                    <ul class="wb-bots__list">
                      ${unmet.map(
                        (gap) => html`
                          <li class="wb-bots__list-row">
                            <span class="wb-bots__list-title">${gap.label || gap.key}</span>
                            <span class="wb-bots__tag"
                              >${t("frontstage.workbench.growth.dossier.pendingGapTag")}</span
                            >
                          </li>
                        `,
                      )}
                    </ul>
                  `
            }
          </div>
        `,
      )}

      ${renderSection(
        t("frontstage.workbench.growth.dossier.zone.performance"),
        html`
          <div id="wb-bots-zone-performance" data-wb-bots-zone="performance">
            ${renderKvRows([
              {
                label: t("frontstage.workbench.growth.dossier.field.activationScore"),
                value: `${Math.round(growth.activationScore ?? 0)}`,
              },
              {
                label: t("frontstage.workbench.growth.dossier.field.operationalScore"),
                value:
                  growth.operationalScore === null || growth.operationalScore === undefined
                    ? t("frontstage.workbench.growth.dossier.status.noData")
                    : String(Math.round(growth.operationalScore)),
              },
              {
                label: t("frontstage.workbench.growth.dossier.field.level"),
                value: t("frontstage.workbench.growth.dossier.status.levelValue", {
                  level: growth.level,
                }),
              },
            ])}
            ${
              growth.falseReady
                ? html`
                    <p class="wb-bots__hint wb-bots__hint--warn" data-wb-bots-false-ready>
                      ${t("frontstage.workbench.growth.dossier.falseReadyHint")}
                    </p>
                  `
                : nothing
            }
            ${
              report
                ? renderGrowthReportSummary(report)
                : html`<p class="wb-bots__hint">
                    ${t("frontstage.workbench.growth.dossier.reportPending")}
                  </p>`
            }
            ${
              growth.recentEvents.length === 0
                ? nothing
                : html`
                    <ul class="wb-bots__timeline">
                      ${growth.recentEvents.map(
                        (event) => html`
                          <li>
                            <span>${event.text}</span>
                            ${event.at ? html`<time>${event.at.slice(0, 10)}</time>` : nothing}
                          </li>
                        `,
                      )}
                    </ul>
                  `
            }
          </div>
        `,
      )}

      ${renderSection(
        t("frontstage.workbench.growth.dossier.zone.suggestion"),
        html`
          <div id="wb-bots-zone-suggestion" data-wb-bots-zone="suggestion">
            <p class="wb-bots__hint">${recommendationReasonLabel(rec)}</p>
            ${
              hasActionableRec
                ? html`
                    <button
                      type="button"
                      class="btn btn--primary"
                      data-wb-bots-growth-cta
                      @click=${() => applyGrowthRecommendation(props, rec)}
                    >
                      ${ctaLabel}
                    </button>
                  `
                : html`<p class="wb-bots__hint">
                    ${t("frontstage.workbench.growth.dossier.keepPace")}
                  </p>`
            }
            ${
              report?.suggestedWorkflows && report.suggestedWorkflows.length > 0
                ? html`
                    <ul class="wb-bots__list">
                      ${report.suggestedWorkflows.map(
                        (item) => html`
                          <li class="wb-bots__list-row wb-bots__list-row--stack">
                            <span class="wb-bots__list-title">${item}</span>
                          </li>
                        `,
                      )}
                    </ul>
                  `
                : nothing
            }
          </div>
        `,
      )}
    </div>
  `;
}

function renderAuthTab(props: MyBotWorkspacePanelProps) {
  const entry = props.entry;
  const agentId = entry.id;
  const scope = entry.source === "owned" ? "owned" : "shared";
  const snapshot = props.userOperationalIdentitySnapshot;
  const busy = Boolean(props.userOperationalIdentityBusy);
  const allIdentities = snapshot?.identities ?? [];
  const feishuGate = snapshot?.feishuEmployeeChannel;
  const feishuChannelOpen = Boolean(
    feishuGate &&
    !feishuGate.childExecutionBlocked &&
    feishuGate.employeeUiHint !== "enterprise_not_open",
  );
  const feishuIdentities = feishuChannelOpen
    ? allIdentities.filter(
        (identity) => identity.provider === "feishu-personal" && identity.status === "active",
      )
    : [];
  const bindableIdentities = allIdentities.filter(
    (identity) => identity.status === "active" && identity.provider !== "feishu-personal",
  );
  const catalog = snapshot?.providerCatalog ?? [];
  const grants = (snapshot?.grants ?? []).filter(
    (grant) => grant.agentId === agentId && grant.status === "active",
  );
  const grantedIdentityIds = new Set(grants.map((grant) => grant.identityId));
  const enterpriseEntries = snapshot?.enterpriseAccessByAgent?.[agentId];
  const actionsForProvider = (provider: string): string[] => {
    const catalogEntry = catalog.find((item) => item.provider === provider);
    const actions = catalogEntry?.operationalActions.map((item) => item.action) ?? [];
    return actions.length > 0 ? actions : ["*"];
  };
  const providerByIdentity = new Map(
    bindableIdentities.map((identity) => [identity.identityId, identity.provider]),
  );

  if (enterpriseEntries === undefined) {
    props.onLoadRobotEnterpriseIdentities?.(agentId);
  }

  const submit = (event: Event) => {
    const root = (event.currentTarget as HTMLElement).closest("[data-wb-bots-auth]");
    const checked = Array.from(
      root?.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][data-identity-id]:checked',
      ) ?? [],
    );
    const personalDesired = checked
      .filter(
        (checkbox) =>
          checkbox.dataset.kind === "personal" || checkbox.dataset.provider === "feishu-personal",
      )
      .map((checkbox) => {
        const identityId = checkbox.dataset.identityId ?? "";
        if (checkbox.dataset.provider === "feishu-personal") {
          const row = checkbox.closest("li");
          const allowedActions = Array.from(
            row?.querySelectorAll<HTMLInputElement>("input[data-feishu-action]:checked") ?? [],
          )
            .map((input) => input.dataset.feishuAction ?? "")
            .filter(Boolean);
          const list = (selector: string) =>
            (row?.querySelector<HTMLInputElement>(selector)?.value ?? "")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
          const confirmMode = row?.querySelector<HTMLSelectElement>(
            "[data-feishu-confirm-mode]",
          )?.value;
          const expiresAt =
            row?.querySelector<HTMLInputElement>("[data-feishu-expires]")?.value.trim() ||
            undefined;
          return {
            identityId,
            allowedActions,
            resourceScope: {
              groups: list("[data-feishu-groups]"),
              docs: list("[data-feishu-docs]"),
              calendars: list("[data-feishu-calendars]"),
            },
            confirmMode:
              confirmMode === "read_only" ||
              confirmMode === "draft_then_confirm" ||
              confirmMode === "limited_auto"
                ? confirmMode
                : "draft_then_confirm",
            expiresAt,
          };
        }
        const provider = checkbox.dataset.provider || providerByIdentity.get(identityId) || "";
        const listed = checkbox.dataset.actions?.split(",").filter(Boolean) ?? [];
        return {
          identityId,
          allowedActions: listed.length > 0 ? listed : actionsForProvider(provider),
        };
      });
    const enterpriseDesired = checked
      .filter(
        (checkbox) =>
          checkbox.dataset.kind === "enterprise" && checkbox.dataset.provider !== "feishu-personal",
      )
      .map((checkbox) => checkbox.dataset.identityId ?? "")
      .filter(Boolean);
    props.onApplyRobotIdentityGrants?.({ agentId, agentScope: scope, desired: personalDesired });
    props.onApplyRobotEnterpriseIdentities?.({ agentId, desiredIdentityIds: enterpriseDesired });
  };

  return html`
    <div class="wb-bots__auth" data-wb-bots-auth>
      ${
        props.userOperationalIdentityError
          ? html`<div class="callout callout--danger employee-workbench__settings-callout">${props.userOperationalIdentityError}</div>`
          : nothing
      }
      ${
        props.userOperationalIdentityNotice
          ? html`<div class="callout employee-workbench__settings-callout">${props.userOperationalIdentityNotice}</div>`
          : nothing
      }
      ${renderSection(
        "企业身份",
        enterpriseEntries === undefined
          ? renderEmpty("正在加载…")
          : enterpriseEntries.length === 0 && feishuIdentities.length === 0
            ? renderEmpty("企业暂未开放身份。")
            : html`
                <ul class="wb-bots__check-list">
                  ${feishuIdentities.map((identity) => {
                    const grant = grants.find((item) => item.identityId === identity.identityId);
                    const selected = new Set(grant?.allowedActions ?? []);
                    return html`
                      <li>
                        <label class="wb-bots__check-row">
                          <input
                            type="checkbox"
                            data-kind="enterprise"
                            data-provider="feishu-personal"
                            data-identity-id=${identity.identityId}
                            ?checked=${grantedIdentityIds.has(identity.identityId)}
                            ?disabled=${busy}
                          />
                          <span class="wb-bots__check-copy">
                            <span class="wb-bots__list-title">${identity.displayName}</span>
                            <span class="wb-bots__list-sub">${identity.providerLabel}</span>
                          </span>
                        </label>
                        <div class="wb-bots__hint">
                          <label
                            ><input
                              type="checkbox"
                              data-feishu-action="read"
                              ?checked=${selected.has("read")}
                              ?disabled=${busy}
                            />
                            读取</label
                          >
                          <label
                            ><input
                              type="checkbox"
                              data-feishu-action="draft"
                              ?checked=${selected.has("draft")}
                              ?disabled=${busy}
                            />
                            起草</label
                          >
                          <label
                            ><input
                              type="checkbox"
                              data-feishu-action="send"
                              ?checked=${selected.has("send")}
                              ?disabled=${busy}
                            />
                            发送</label
                          >
                          <label
                            >群
                            <input
                              data-feishu-groups
                              .value=${grant?.resourceScope?.groups.join(", ") ?? ""}
                              ?disabled=${busy}
                          /></label>
                          <label
                            >文档
                            <input
                              data-feishu-docs
                              .value=${grant?.resourceScope?.docs.join(", ") ?? ""}
                              ?disabled=${busy}
                          /></label>
                          <label
                            >日历
                            <input
                              data-feishu-calendars
                              .value=${grant?.resourceScope?.calendars.join(", ") ?? ""}
                              ?disabled=${busy}
                          /></label>
                          <label
                            >确认方式
                            <select data-feishu-confirm-mode ?disabled=${busy}>
                              <option
                                value="read_only"
                                ?selected=${grant?.confirmMode === "read_only"}
                              >
                                只读
                              </option>
                              <option
                                value="draft_then_confirm"
                                ?selected=${
                                  (grant?.confirmMode ?? "draft_then_confirm") ===
                                  "draft_then_confirm"
                                }
                              >
                                起草后确认
                              </option>
                              <option
                                value="limited_auto"
                                ?selected=${grant?.confirmMode === "limited_auto"}
                              >
                                有限自动
                              </option>
                            </select>
                          </label>
                          <label
                            >有效期
                            <input
                              data-feishu-expires
                              placeholder="可空，ISO 时间"
                              .value=${grant?.expiresAt ?? ""}
                              ?disabled=${busy}
                          /></label>
                        </div>
                      </li>
                    `;
                  })}
                  ${(enterpriseEntries ?? []).map(
                    (item) => html`
                      <li>
                        <label class="wb-bots__check-row">
                          <input
                            type="checkbox"
                            data-kind="enterprise"
                            data-identity-id=${item.identityId}
                            ?checked=${item.enrolled}
                            ?disabled=${busy || item.status !== "active"}
                          />
                          <span class="wb-bots__check-copy">
                            <span class="wb-bots__list-title">${item.displayName}</span>
                            <span class="wb-bots__list-sub">${item.providerLabel}</span>
                          </span>
                        </label>
                      </li>
                    `,
                  )}
                </ul>
              `,
      )}

      ${renderSection(
        "个人身份",
        bindableIdentities.length === 0
          ? renderEmpty("还没有个人身份。")
          : html`
              <ul class="wb-bots__check-list">
                ${bindableIdentities.map((identity) => {
                  const granted = grantedIdentityIds.has(identity.identityId);
                  return html`
                    <li>
                      <label class="wb-bots__check-row">
                        <input
                          type="checkbox"
                          data-kind="personal"
                          data-identity-id=${identity.identityId}
                          ?checked=${granted}
                          ?disabled=${busy}
                        />
                        <span class="wb-bots__check-copy">
                          <span class="wb-bots__list-title">${identity.displayName}</span>
                          <span class="wb-bots__list-sub">${identity.providerLabel}</span>
                        </span>
                      </label>
                    </li>
                  `;
                })}
              </ul>
            `,
        html`
          <button
            type="button"
            class="wb-bots__text-action"
            @click=${() => props.onAddPersonalIdentity?.()}
          >
            添加身份
          </button>
        `,
      )}

      <div class="wb-bots__footer">
        <span class="wb-bots__hint">
          ${
            feishuIdentities.length > 0
              ? "确认后只写入该机器人的明确授权"
              : scope === "owned"
                ? "确认后立即生效"
                : "确认后需二次校验"
          }
        </span>
        <button type="button" class="btn btn--primary" ?disabled=${busy} @click=${submit}>
          ${busy ? "提交中…" : "确认授权"}
        </button>
      </div>
    </div>
  `;
}

function renderCollaborationTab(props: MyBotWorkspacePanelProps) {
  const bot = props.bot;
  if (!bot) {
    return renderEmpty("正在加载协作…");
  }
  if (bot.collaborations.length === 0) {
    return renderEmpty("尚未参与协作小组。");
  }
  return html`
    <ul class="wb-bots__list">
      ${bot.collaborations.map(
        (group) => html`
          <li>
            <button
              type="button"
              class="wb-bots__nav-row"
              @click=${() => props.onOpenGroup(group.groupId)}
            >
              <span class="wb-bots__list-title">${group.title}</span>
              <span class="wb-bots__nav-chevron" aria-hidden="true">›</span>
            </button>
          </li>
        `,
      )}
    </ul>
  `;
}

function renderDataTab(props: MyBotWorkspacePanelProps) {
  const bot = props.bot;
  if (!bot) {
    return renderEmpty("正在加载数据…");
  }
  const workspacePath = props.entry.workspacePath?.trim() || "尚未配置";
  return html`
    ${renderKvRows([
      { label: "记忆容量", value: formatBytes(bot.data.memorySize) },
      { label: "长期记忆", value: String(bot.data.longTermCount ?? 0) },
      { label: "知识库", value: String(bot.data.kbCount ?? 0) },
      { label: "工作区", value: workspacePath, mono: true },
    ])}
    ${
      bot.data.recentLearning.length === 0
        ? nothing
        : html`
            <section class="wb-bots__section">
              <div class="wb-bots__section-head">
                <h3 class="wb-bots__section-title">近期学习</h3>
              </div>
              <ul class="wb-bots__timeline">
                ${bot.data.recentLearning.map((item) => html`<li><span>${item.text}</span></li>`)}
              </ul>
            </section>
          `
    }
  `;
}

function renderDevicesTab(props: MyBotWorkspacePanelProps) {
  return renderPersonalDevicesPanel({
    digitalHumanId: props.entry.id,
    digitalHumanName: props.entry.name,
    title: "已连接设备",
    surface: "detail",
  });
}

function renderDangerTab(props: MyBotWorkspacePanelProps) {
  const entry = props.entry;
  const busy = props.ownedRobotDeleteBusyId === entry.id;
  const displayName = entry.name?.trim() || entry.id;

  return html`
    <section class="wb-bots__danger">
      <div class="wb-bots__danger-head">
        <h3 class="wb-bots__danger-title">删除「${displayName}」</h3>
        <p class="wb-bots__danger-sub">删除后不可恢复。确认即从你的机器人列表中移除。</p>
      </div>
      ${
        props.ownedRobotDeleteError
          ? html`<div class="callout danger">${props.ownedRobotDeleteError}</div>`
          : nothing
      }
      <div class="wb-bots__footer wb-bots__footer--end">
        <button
          type="button"
          class="btn btn--danger"
          ?disabled=${busy}
          @click=${() => {
            props.onPrepareOwnedRobotDelete?.(entry.id, displayName);
            props.onConfirmOwnedRobotDelete?.();
          }}
        >
          ${busy ? "删除中…" : "确认删除"}
        </button>
      </div>
    </section>
  `;
}

function renderTabBody(props: MyBotWorkspacePanelProps): TemplateResult {
  switch (props.activeTab) {
    case "identity":
      return renderIdentityTab(props);
    case "capabilities":
      return renderCapabilitiesTab(props);
    case "growth":
      return renderGrowthTab(props);
    case "auth":
      return renderAuthTab(props);
    case "collaboration":
      return renderCollaborationTab(props);
    case "data":
      return renderDataTab(props);
    case "devices":
      return renderDevicesTab(props);
    case "danger":
      return renderDangerTab(props);
    default:
      return html`${nothing}`;
  }
}

export function renderMyBotWorkspacePanel(props: MyBotWorkspacePanelProps) {
  const canEditIdentity = props.entry.source === "owned";
  const canDelete = canEditIdentity && !isBuiltinStewardAgent(props.entry.id);
  const dirty = canEditIdentity && isIdentityDraftDirty(props.identityDraft, props.bot);
  const tabs = TAB_DEFS.filter((tab) => !tab.ownedOnly || canDelete);
  // Keep status line minimal — ownership already appears on the left anchor row.
  const statusBits = [
    props.bot ? statusLabel(props.bot.identity.status) : null,
    canEditIdentity ? null : "只读",
  ].filter(Boolean);
  const displayName =
    (canEditIdentity ? props.identityDraft?.name?.trim() : "") || props.entry.name;
  const titleEmoji = props.entry.emoji ? `${props.entry.emoji} ` : "";

  return html`
    <div class="wb-bots__stage-inner">
      ${wbSettingsDetailToolbar({
        title: `${titleEmoji}${displayName}`,
        dirty,
        mission:
          statusBits.length > 0
            ? html`<div class="wb-bots__status-line">${statusBits.join(" · ")}</div>`
            : nothing,
        actions: html`
          <button
            type="button"
            class="btn"
            title="进入该机器人的工作区"
            @click=${() => props.onSelectSession(props.entry.sessionKey)}
          >
            ${props.entry.source === "owned" ? "进入工作区" : "进入会话"}
          </button>
          ${
            canEditIdentity && dirty
              ? html`
                  <button
                    type="button"
                    class="btn btn--primary"
                    ?disabled=${props.saving}
                    @click=${() => props.onSaveIdentity()}
                  >
                    ${props.saving ? "保存中…" : "保存身份"}
                  </button>
                `
              : nothing
          }
        `,
      })}

      ${
        props.error
          ? html`<div class="callout callout--danger employee-workbench__settings-callout">${props.error}</div>`
          : nothing
      }

      <div class="wb-bots__tabs" role="tablist" aria-label="机器人详情分类">
        ${tabs.map(
          (tab) => html`
            <button
              type="button"
              class="wb-bots__tab ${props.activeTab === tab.id ? "is-active" : ""}"
              role="tab"
              aria-selected=${String(props.activeTab === tab.id)}
              data-wb-bots-tab=${tab.id}
              @click=${() => props.onTabChange(tab.id)}
            >
              ${resolveTabLabel(tab)}
            </button>
          `,
        )}
      </div>

      <div class="wb-bots__tab-panel" role="tabpanel" data-wb-bots-tab-panel=${props.activeTab}>
        ${
          props.loading && !props.bot && props.activeTab !== "devices"
            ? html`
                <div class="wb-bots__empty">正在加载详情…</div>
              `
            : renderTabBody(props)
        }
      </div>
    </div>
  `;
}
