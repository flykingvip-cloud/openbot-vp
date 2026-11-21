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
import type { MyBotDomainVector } from "../semantic/my-bot-read-model.ts";
import type { UserOperationalIdentitySnapshot } from "../semantic/view-controller-facade.ts";
import {
  buildCapabilityRadar,
  capabilityDomainLabel,
  capabilityDomainOrder,
  type RobotCapabilityAtlas,
  type RobotCapabilityNode,
  type RobotCapabilityOrigin,
} from "./my-bot-capability-atlas.ts";
import type { RobotDataOpenItem, RobotDataSurface } from "./my-bot-data-surface.ts";
import { renderPersonalDevicesPanel } from "./personal-devices-page.ts";
import { normalizeGrowthReport } from "./workbench-growth-report.ts";
import { robotIdentityAgentScope } from "./workbench-robot-operational-identity-panel.ts";
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
  dataSurface?: RobotDataSurface | null;
  onEnsureRobotData?: (agentId: string) => void;
  capabilityAtlas?: RobotCapabilityAtlas | null;
  onEnsureCapabilityAtlas?: (agentId: string) => void;
  onOpenRobotDataItem?: (item: RobotDataOpenItem) => void;
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

function atlasFor(props: MyBotWorkspacePanelProps): RobotCapabilityAtlas | null {
  const agentId = props.entry.id;
  const atlas = props.capabilityAtlas;
  return atlas?.agentId === agentId ? atlas : null;
}

function ensureAtlas(props: MyBotWorkspacePanelProps): void {
  const atlas = atlasFor(props);
  if (!atlas || (!atlas.loaded && !atlas.loading)) {
    props.onEnsureCapabilityAtlas?.(props.entry.id);
  }
}

function renderCapabilityRow(cap: RobotCapabilityNode) {
  return html`
    <li class="wb-bots__list-row">
      <span class="wb-bots__list-title">${cap.name}</span>
      <span class="wb-bots__list-meta">
        ${capabilityOriginLabel(cap.origin)}${cap.callCount > 0 ? ` · ${cap.callCount} 次` : ""}
      </span>
    </li>
  `;
}

function capabilityOriginLabel(origin: RobotCapabilityOrigin): string {
  switch (origin) {
    case "created":
      return "改造";
    case "evolved":
      return "进化";
    case "used":
      return "使用";
    default:
      return "安装";
  }
}

function renderCapabilityRadar(vector: MyBotDomainVector) {
  const axes = capabilityDomainOrder().filter((domain) => domain !== "general");
  const cx = 88;
  const cy = 88;
  const radius = 58;
  const levels = [0.25, 0.5, 0.75, 1];
  const pointAt = (index: number, value: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / axes.length;
    const reach = radius * Math.max(0, Math.min(1, value));
    return { x: cx + Math.cos(angle) * reach, y: cy + Math.sin(angle) * reach };
  };
  const polygon = axes
    .map((domain, index) => {
      const point = pointAt(index, vector[domain]);
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    })
    .join(" ");
  return html`
    <div class="wb-bots__radar" data-cap-radar>
      <svg viewBox="0 0 176 176" role="img" aria-label="能力雷达图">
        ${levels.map((level) => {
          const ring = axes
            .map((_, index) => {
              const point = pointAt(index, level);
              return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
            })
            .join(" ");
          return html`<polygon class="wb-bots__radar-grid" points=${ring}></polygon>`;
        })}
        ${axes.map((_, index) => {
          const tip = pointAt(index, 1);
          return html`<line
            class="wb-bots__radar-axis"
            x1=${cx}
            y1=${cy}
            x2=${tip.x.toFixed(1)}
            y2=${tip.y.toFixed(1)}
          ></line>`;
        })}
        <polygon class="wb-bots__radar-area" points=${polygon}></polygon>
        ${axes.map((domain, index) => {
          const tip = pointAt(index, 1.22);
          return html`<text
            class="wb-bots__radar-label"
            x=${tip.x.toFixed(1)}
            y=${tip.y.toFixed(1)}
            text-anchor="middle"
            dominant-baseline="middle"
          >
            ${capabilityDomainLabel(domain)}
          </text>`;
        })}
      </svg>
    </div>
  `;
}

function renderCapabilitiesTab(props: MyBotWorkspacePanelProps) {
  const bot = props.bot;
  const atlas = atlasFor(props);
  ensureAtlas(props);
  if (!atlas?.loaded) {
    return renderEmpty("正在读取能力与知识…");
  }
  if (atlas.error && atlas.capabilities.length === 0 && atlas.knowledge.length === 0) {
    return renderEmpty(atlas.error);
  }
  const groups = capabilityDomainOrder()
    .map((domain) => ({
      domain,
      label: capabilityDomainLabel(domain),
      items: atlas.capabilities.filter((cap) => cap.domain === domain),
    }))
    .filter((group) => group.items.length > 0);
  const personas = bot?.personas ?? [];
  const radar = buildCapabilityRadar(atlas.capabilities);
  return html`
    <div class="wb-bots__stack" data-wb-bots-capability-atlas>
      ${renderSection(
        "能力地图",
        html`
          <div class="wb-bots__cap-map" data-wb-bots-capability-map>
            ${renderCapabilityRadar(radar)}
            ${
              groups.length === 0
                ? renderEmpty("还没有安装、改造或使用过的能力。")
                : html`
                    <ul class="wb-bots__radar-legend">
                      ${groups.map((group) => {
                        const evidence = group.items.reduce((sum, cap) => sum + cap.weight, 0);
                        return html`<li>
                          <span>${group.label}</span><strong>${Math.round(evidence)}</strong>
                        </li>`;
                      })}
                    </ul>
                    ${groups.map(
                      (group) => html`
                        <div class="wb-bots__cap-domain">
                          <span class="wb-bots__cap-domain-label">${group.label}</span>
                          <ul class="wb-bots__list">
                            ${group.items.map((cap) => renderCapabilityRow(cap))}
                          </ul>
                        </div>
                      `,
                    )}
                  `
            }
          </div>
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
        "知识图谱",
        atlas.knowledge.length === 0
          ? renderEmpty("还没有这个机器人记住的知识。")
          : html`
              <div class="wb-bots__kg" data-wb-bots-knowledge-graph>
                <div class="wb-bots__kg-root">${bot?.identity.name || props.entry.name}</div>
                <ul class="wb-bots__kg-list">
                  ${atlas.knowledge.map(
                    (node) => html`
                      <li class="wb-bots__kg-node">
                        <span class="wb-bots__list-title">${node.label}</span>
                        ${
                          node.documents.length === 0
                            ? nothing
                            : html`
                                <ul class="wb-bots__kg-docs">
                                  ${node.documents.map((title) => html`<li>${title}</li>`)}
                                </ul>
                              `
                        }
                      </li>
                    `,
                  )}
                </ul>
              </div>
            `,
      )}
      ${
        personas.length === 0
          ? nothing
          : renderSection(
              "扮演",
              html`
                <ul class="wb-bots__list">
                  ${personas.map(
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
            )
      }
    </div>
  `;
}

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
  const count = rec?.gaps.length ?? 0;
  switch (rec?.reason) {
    case "growth.recommend.start_work":
      return t("frontstage.workbench.growth.dossier.reason.startWork");
    case "growth.recommend.confirm_identity":
      return t("frontstage.workbench.growth.dossier.reason.confirmIdentity");
    case "growth.recommend.install_for_task":
      return t("frontstage.workbench.growth.dossier.reason.installCapabilitiesCount", { count });
    case "growth.recommend.install_capabilities":
      return count > 0
        ? t("frontstage.workbench.growth.dossier.reason.installCapabilitiesCount", { count })
        : t("frontstage.workbench.growth.dossier.reason.installCapabilities");
    case "growth.recommend.verify_with_task":
      return t("frontstage.workbench.growth.dossier.reason.verifyWithTask");
    case "growth.recommend.none":
      return t("frontstage.workbench.growth.dossier.reason.none");
    default:
      return rec?.reason && !rec.reason.startsWith("growth.")
        ? rec.reason
        : t("frontstage.workbench.growth.dossier.reason.none");
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

function renderDimensionBars(growth: MyBotGrowthProjection): TemplateResult | typeof nothing {
  const dims = growth.dimensions;
  if (!dims) {
    return nothing;
  }
  const rows = [
    { label: t("frontstage.workbench.growth.dimension.capability"), value: dims.capability },
    { label: t("frontstage.workbench.growth.dimension.knowledge"), value: dims.knowledge },
    { label: t("frontstage.workbench.growth.dossier.experience"), value: dims.habits },
  ].filter((row) => Number.isFinite(row.value));
  if (rows.every((row) => row.value <= 0)) {
    return nothing;
  }
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

const WORKING_STYLE_FIELDS = [
  "outputFormat",
  "reportingCadence",
  "decisionPreference",
  "riskPreference",
  "communicationTone",
] as const satisfies ReadonlyArray<keyof MyBotWorkingStyleProjection["style"]>;

function growthEventLabel(event: { milestoneKey?: string; text: string }): string {
  const candidates = [event.milestoneKey, event.text].filter((value): value is string =>
    Boolean(value),
  );
  for (const candidate of candidates) {
    const key = `frontstage.workbench.growth.dossier.milestone.${candidate}`;
    const translated = t(key);
    if (translated !== key) {
      return translated;
    }
  }
  return event.text;
}

function impactAmount(item: { value: number; unit?: string }): string {
  const unit =
    item.unit === "hours"
      ? t("frontstage.workbench.growth.dossier.report.hoursUnit")
      : (item.unit ?? "");
  return `${item.value}${unit}`;
}

function renderWorkingStyleSection(
  workingStyle: MyBotWorkingStyleProjection | null | undefined,
): TemplateResult | typeof nothing {
  if (!workingStyle) {
    return nothing;
  }
  const tasksTotal = workingStyle.evidence?.tasksTotal ?? 0;
  if (!workingStyle.learned && tasksTotal <= 0) {
    return nothing;
  }
  if (!workingStyle.learned) {
    return html`
      <div class="wb-bots__working-style" data-wb-bots-working-style>
        <h4 class="wb-bots__subheading">${t("frontstage.workbench.growth.dossier.workingStyle.title")}</h4>
        ${renderWorkingStyleEvidence(workingStyle)}
      </div>
    `;
  }
  const style = workingStyle.style;
  const recorded = workingStyle.recordedKeys;
  const fields = recorded
    ? WORKING_STYLE_FIELDS.filter((field) => recorded.includes(field))
    : [...WORKING_STYLE_FIELDS];
  return html`
    <div class="wb-bots__working-style" data-wb-bots-working-style>
      <h4 class="wb-bots__subheading">${t("frontstage.workbench.growth.dossier.workingStyle.title")}</h4>
      ${renderKvRows(
        fields.map((field) => ({
          label: workingStyleFieldLabel(field),
          value: workingStyleValueLabel(field, style[field]),
        })),
      )}
      ${renderWorkingStyleEffect(workingStyle.lastChange)}
      ${renderWorkingStyleEvidence(workingStyle)}
    </div>
  `;
}

function capabilityPractice(cap: MyBotCapabilityProjection): TemplateResult | typeof nothing {
  if (typeof cap.successRate === "number" && Number.isFinite(cap.successRate)) {
    return html`<span class="wb-bots__list-meta" aria-label="${cap.stars}">${renderStars(cap.stars)}</span>`;
  }
  if ((cap.callCount ?? 0) > 0) {
    return html`<span class="wb-bots__list-meta"
      >${t("frontstage.workbench.growth.dossier.resume.calls", { count: cap.callCount ?? 0 })}</span
    >`;
  }
  return nothing;
}

function renderGrowthTab(props: MyBotWorkspacePanelProps) {
  const bot = props.bot;
  if (!bot) {
    return renderEmpty(t("frontstage.workbench.growth.dossier.loading"));
  }
  ensureAtlas(props);
  const atlas = atlasFor(props);
  const growth = bot.growth;
  const gaps = growth.capabilityGaps ?? [];
  const unmet = gaps.filter((gap) => gap.status === "missing");
  const report = normalizeGrowthReport(growth.growthReport ?? null);
  const rec = growth.recommendation ?? null;
  const ctaLabel = recommendationCtaLabel(rec);
  const hasActionableRec = Boolean(rec && rec.kind !== "none");
  const impact = report?.businessImpact ?? [];
  const insights = report?.topInsights ?? [];
  const events = growth.recentEvents;
  const hasMeasuredScore =
    typeof growth.operationalScore === "number" && Number.isFinite(growth.operationalScore);
  const hasWork = impact.length > 0 || insights.length > 0 || events.length > 0 || hasMeasuredScore;
  const skillSource = atlas?.loaded
    ? atlas.capabilities.map((cap) => ({
        name: cap.name,
        stars: 1,
        source: "personal" as const,
        relationId: cap.id,
        callCount: cap.callCount,
        successRate: null,
      }))
    : props.onEnsureCapabilityAtlas
      ? []
      : [...bot.capabilities];
  const skills = skillSource.toSorted(
    (a, b) =>
      (b.callCount ?? 0) - (a.callCount ?? 0) ||
      (b.successRate ?? -1) - (a.successRate ?? -1) ||
      a.name.localeCompare(b.name, "zh"),
  );
  const dimensionBars = renderDimensionBars(growth);
  const workingStyle = renderWorkingStyleSection(growth.workingStyle);
  const showLevel = growth.level > 0;
  const showMaturity = dimensionBars !== nothing || workingStyle !== nothing || showLevel;
  const workflows = report?.suggestedWorkflows ?? [];
  const showSkills = skills.length > 0 || unmet.length > 0;
  const showSuggestion = hasActionableRec || workflows.length > 0;
  const outputs = atlas?.loaded ? atlas.outputs : [];

  return html`
    <div class="wb-bots__stack wb-bots__growth-dossier" data-wb-bots-growth-dossier>
      ${
        !hasWork && !showSkills && !showMaturity && !showSuggestion
          ? html`<p class="wb-bots__hint">${t("frontstage.workbench.growth.dossier.resume.leadEmpty")}</p>`
          : nothing
      }
      ${
        hasWork
          ? renderSection(
              t("frontstage.workbench.growth.dossier.resume.doneTitle"),
              html`
                <div id="wb-bots-zone-performance" data-wb-bots-zone="performance">
                  ${
                    impact.length === 0 && !hasMeasuredScore
                      ? nothing
                      : html`
                          <div class="wb-bots__growth-metrics">
                            ${impact.map(
                              (item) => html`
                                <div class="wb-bots__growth-metric">
                                  <span class="wb-bots__growth-metric-label">${item.description}</span>
                                  <strong class="wb-bots__growth-metric-value"
                                    >${impactAmount(item)}</strong
                                  >
                                </div>
                              `,
                            )}
                            ${
                              hasMeasuredScore
                                ? html`
                                    <div class="wb-bots__growth-metric">
                                      <span class="wb-bots__growth-metric-label">
                                        ${t("frontstage.workbench.growth.dossier.field.operationalScore")}
                                      </span>
                                      <strong class="wb-bots__growth-metric-value">
                                        ${Math.round(growth.operationalScore ?? 0)}
                                      </strong>
                                    </div>
                                  `
                                : nothing
                            }
                          </div>
                        `
                  }
                  ${
                    insights.length === 0
                      ? nothing
                      : html`
                          <ul class="wb-bots__timeline">
                            ${insights.map((item) => html`<li><span>${item}</span></li>`)}
                          </ul>
                        `
                  }
                  ${
                    events.length === 0
                      ? nothing
                      : html`
                          ${
                            impact.length > 0 || hasMeasuredScore
                              ? html`<p class="wb-bots__growth-subhead">
                                  ${t("frontstage.workbench.growth.dossier.resume.history")}
                                </p>`
                              : nothing
                          }
                          <ul class="wb-bots__timeline">
                            ${events.map(
                              (event) => html`
                                <li>
                                  <span>${event.taskRef?.title || growthEventLabel(event)}</span>
                                  ${
                                    event.at ? html`<time>${event.at.slice(0, 10)}</time>` : nothing
                                  }
                                </li>
                              `,
                            )}
                          </ul>
                        `
                  }
                  ${
                    growth.falseReady
                      ? html`
                          <p class="wb-bots__hint wb-bots__hint--warn" data-wb-bots-false-ready>
                            ${t("frontstage.workbench.growth.dossier.falseReadyHint")}
                          </p>
                        `
                      : nothing
                  }
                </div>
              `,
            )
          : nothing
      }

      ${
        outputs.length === 0
          ? nothing
          : renderSection(
              "产出",
              html`
                <ul class="wb-bots__list" data-wb-bots-outputs>
                  ${outputs.map(
                    (item) => html`
                      <li class="wb-bots__list-row">
                        <span class="wb-bots__list-title">${item.title}</span>
                      </li>
                    `,
                  )}
                </ul>
              `,
            )
      }

      ${
        showSkills
          ? renderSection(
              skills.length > 0
                ? t("frontstage.workbench.growth.dossier.resume.skillsTitle")
                : t("frontstage.workbench.growth.dossier.field.gaps"),
              html`
                <div id="wb-bots-zone-capability" data-wb-bots-zone="capability">
                  ${
                    skills.length === 0
                      ? nothing
                      : html`
                          <ul class="wb-bots__list">
                            ${skills.map(
                              (cap) => html`
                                <li class="wb-bots__list-row">
                                  <div class="wb-bots__list-main">
                                    <span class="wb-bots__list-title">${cap.name}</span>
                                    ${capabilityPractice(cap)}
                                  </div>
                                </li>
                              `,
                            )}
                          </ul>
                        `
                  }
                  ${
                    unmet.length === 0
                      ? nothing
                      : html`
                          <div class="wb-bots__growth-gaps">
                          ${
                            skills.length > 0
                              ? html`<p class="wb-bots__growth-subhead">
                                  ${t("frontstage.workbench.growth.dossier.field.gaps")}
                                </p>`
                              : nothing
                          }
                          <ul class="wb-bots__list">
                            ${unmet.map(
                              (gap) => html`
                                <li class="wb-bots__list-row">
                                  <span class="wb-bots__list-title">${gap.label || gap.key}</span>
                                </li>
                              `,
                            )}
                          </ul>
                          <button
                            type="button"
                            class="wb-bots__text-action"
                            @click=${() => props.onExploreCapabilities()}
                          >
                            ${t("frontstage.workbench.growth.recommend.ctaInstallCapabilities")}
                          </button>
                          </div>
                        `
                  }
                </div>
              `,
            )
          : nothing
      }

      ${
        showMaturity
          ? renderSection(
              t("frontstage.workbench.growth.dossier.resume.maturityTitle"),
              html`
                ${dimensionBars}
                ${
                  showLevel
                    ? renderKvRows([
                        {
                          label: t("frontstage.workbench.growth.dossier.field.level"),
                          value: t("frontstage.workbench.growth.dossier.status.levelValue", {
                            level: growth.level,
                          }),
                        },
                      ])
                    : nothing
                }
                ${workingStyle}
              `,
            )
          : nothing
      }

      ${
        showSuggestion
          ? renderSection(
              t("frontstage.workbench.growth.dossier.zone.suggestion"),
              html`
                <div id="wb-bots-zone-suggestion" data-wb-bots-zone="suggestion">
                  ${
                    hasActionableRec
                      ? html`<p class="wb-bots__hint">${recommendationReasonLabel(rec)}</p>`
                      : nothing
                  }
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
                      : nothing
                  }
                  ${
                    workflows.length === 0
                      ? nothing
                      : html`
                          <ul class="wb-bots__list">
                            ${workflows.map(
                              (item) => html`
                                <li class="wb-bots__list-row wb-bots__list-row--stack">
                                  <span class="wb-bots__list-title">${item}</span>
                                </li>
                              `,
                            )}
                          </ul>
                        `
                  }
                </div>
              `,
            )
          : nothing
      }
    </div>
  `;
}

function renderAuthTab(props: MyBotWorkspacePanelProps) {
  const entry = props.entry;
  const agentId = entry.id;
  const scope = robotIdentityAgentScope(entry);
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
    const personalDesired: Parameters<
      NonNullable<MyBotWorkspacePanelProps["onApplyRobotIdentityGrants"]>
    >[0]["desired"] = checked
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
                            <select
                              data-feishu-confirm-mode
                              .value=${grant?.confirmMode ?? "draft_then_confirm"}
                              ?disabled=${busy}
                            >
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

function renderDataFileList(
  files: Array<{ name: string; label: string; bytes: number }>,
  open: (file: { name: string; label: string }) => void,
) {
  return html`
    <ul class="wb-bots__list">
      ${files.map(
        (file) => html`
          <li>
            <button type="button" class="wb-bots__nav-row" @click=${() => open(file)}>
              <span class="wb-bots__list-title">${file.label}</span>
              <span class="wb-bots__list-sub">${formatBytes(file.bytes)}</span>
            </button>
          </li>
        `,
      )}
    </ul>
  `;
}

function renderDataTab(props: MyBotWorkspacePanelProps) {
  const agentId = props.entry.id;
  const surface = props.dataSurface?.agentId === agentId ? props.dataSurface : null;
  if (!surface || (!surface.loaded && !surface.loading)) {
    props.onEnsureRobotData?.(agentId);
  }
  if (!surface || surface.loading) {
    return renderEmpty("正在读取文件…");
  }
  const memoryBytes = surface.memoryFiles.reduce((sum, file) => sum + file.bytes, 0);
  const memoryCount = surface.memoryFiles.length + surface.atoms.length;
  const openFile = (file: { name: string; label: string }) =>
    props.onOpenRobotDataItem?.({ kind: "file", agentId, name: file.name, label: file.label });
  return html`
    <div data-wb-bots-data>
      ${surface.error ? html`<div class="callout callout--danger">${surface.error}</div>` : nothing}
      <section class="wb-bots__section">
        <div class="wb-bots__section-head">
          <h3 class="wb-bots__section-title">
            记忆
            ${
              memoryCount > 0
                ? html`<span class="wb-bots__list-sub"
                    >${memoryCount} 项${memoryBytes > 0 ? ` · ${formatBytes(memoryBytes)}` : ""}</span
                  >`
                : nothing
            }
          </h3>
        </div>
        ${
          memoryCount === 0
            ? renderEmpty("还没有可打开的记忆文件。")
            : html`
                ${surface.memoryFiles.length > 0 ? renderDataFileList(surface.memoryFiles, openFile) : nothing}
                ${
                  surface.atoms.length === 0
                    ? nothing
                    : html`
                        <ul class="wb-bots__list">
                          ${surface.atoms.map(
                            (atom) => html`
                              <li>
                                <button
                                  type="button"
                                  class="wb-bots__nav-row"
                                  @click=${() =>
                                    props.onOpenRobotDataItem?.({
                                      kind: "atom",
                                      agentId,
                                      id: atom.id,
                                      text: atom.text,
                                    })}
                                >
                                  <span class="wb-bots__list-title">${atom.text}</span>
                                </button>
                              </li>
                            `,
                          )}
                        </ul>
                      `
                }
              `
        }
      </section>
      <section class="wb-bots__section">
        <div class="wb-bots__section-head">
          <h3 class="wb-bots__section-title">知识库</h3>
        </div>
        ${
          surface.knowledge.length === 0
            ? renderEmpty("还没有绑定到这个机器人的知识库文档。")
            : html`
                <ul class="wb-bots__list">
                  ${surface.knowledge.map(
                    (document) => html`
                      <li>
                        <button
                          type="button"
                          class="wb-bots__nav-row"
                          @click=${() =>
                            props.onOpenRobotDataItem?.({
                              kind: "knowledge",
                              agentId,
                              knowledgeBaseId: document.knowledgeBaseId,
                              documentId: document.documentId,
                              title: document.title,
                            })}
                        >
                          <span class="wb-bots__list-main">
                            <span class="wb-bots__list-title">${document.title}</span>
                            <span class="wb-bots__list-sub">${document.baseTitle}</span>
                          </span>
                          <span class="wb-bots__nav-chevron" aria-hidden="true">›</span>
                        </button>
                      </li>
                    `,
                  )}
                </ul>
              `
        }
      </section>
      <section class="wb-bots__section">
        <div class="wb-bots__section-head">
          <h3 class="wb-bots__section-title">工作区</h3>
        </div>
        <p class="wb-bots__kv-value mono">${surface.workspace || "工作区路径还没有返回。"}</p>
        ${
          surface.workspaceFiles.length === 0
            ? renderEmpty("工作区里还没有可打开的文件。")
            : renderDataFileList(surface.workspaceFiles, openFile)
        }
      </section>
      ${
        surface.open
          ? html`
              <section class="wb-bots__section" data-wb-bots-data-open>
                <div class="wb-bots__section-head">
                  <h3 class="wb-bots__section-title">${surface.open.title}</h3>
                </div>
                <pre class="wb-bots__file-view">${surface.open.text}</pre>
              </section>
            `
          : nothing
      }
    </div>
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
  const groupCount = props.bot?.collaborations.length ?? 0;

  return html`
    <section class="wb-bots__danger">
      <div class="wb-bots__danger-head">
        <h3 class="wb-bots__danger-title">删除「${displayName}」</h3>
        <p class="wb-bots__danger-sub">
          删除后不可恢复。确认即从你的机器人列表中移除。
          ${groupCount > 0 ? `将同时退出 ${groupCount} 个协作小组。` : ""}
        </p>
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
  const statusBits = [canEditIdentity ? null : "只读"].filter(Boolean);
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
