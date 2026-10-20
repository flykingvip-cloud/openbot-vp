import { html, nothing, type TemplateResult } from "lit";
import type {
  EnterpriseAssetExecutionMode,
  EnterpriseAssetPackageDraft,
  EnterpriseAssetPackageType,
  EnterpriseAssetRiskTag,
  CapabilityShareVisibility,
  CapabilitySummary,
  CapabilityUsageBrief,
} from "../capability/employee-capability/types.ts";
import {
  deriveOrganizationalIncubationBadge,
  organizationalBadgeLabel,
} from "../controllers/asset-incubation/capability-incubation-badge.ts";
import {
  looksLikeTechnicalDiagnosticSummary,
  presentEmployeeFacingSummary,
} from "../controllers/asset-incubation/incubation-autofill.ts";
import { selectVisibleAssetReviewSuggestions } from "../controllers/asset-incubation/review-suggestion-scope.ts";
import type {
  MyAccumulationFilters,
  MyAccumulationSegment,
  MyCapabilityListItem,
} from "../controllers/my-accumulation.ts";
import { filterItemsBySegment } from "../controllers/my-accumulation.ts";
import {
  renderAssetDetailFactPairs,
  renderAssetDetailStatCards,
  renderAssetDetailTimeline,
} from "./asset-detail-sections.ts";
import type { StandardAssetDetailTabId } from "./asset-detail-tabs.ts";
import {
  renderStandardAssetDetailEmptyState,
  renderStandardAssetDetailTabs,
} from "./asset-detail-tabs.ts";
import {
  buildEmployeeAssetDetailVM,
  formatAssetDetailRelativeTime,
  formatMetricCountLabel,
  formatUsageCountLabel,
  formatVersionCountLabel,
} from "./asset-detail-vm.ts";
import { renderCapabilityAttributionPanel } from "./capability-attribution-panel.ts";
import { healthRepairSuggestion, renderCapabilityHealthBadge } from "./capability-health-badge.ts";
import { renderCapabilityUsageBriefPanel } from "./capability-usage-brief-panel.ts";

export type MyAccumulationProps = MyAccumulationFilters & {
  loading: boolean;
  error: string | null;
  items: MyCapabilityListItem[];
  selectedCapability: CapabilitySummary | null;
  selectedLoading: boolean;
  detailTab?: StandardAssetDetailTabId;
  activeSegment?: MyAccumulationSegment;
  showDraftsOnly?: boolean;
  pendingUsageBrief: CapabilityUsageBrief | null;
  availableTags: string[];
  availableCategories: string[];
  availableSources: string[];
  availableShareVisibilities: CapabilityShareVisibility[];
  availableGroups: Array<{ id: string; name: string }>;
  assetSuggestionVisible?: boolean;
  canDepositFromContext?: boolean;
  depositHint?: string | null;
  showEnterpriseSubmitActionFromSuggestion?: boolean;
  onOpenSkillSave?: () => void;
  onOpenSkillSaveAndContinue?: () => void;
  assetReviewSuggestions?: Array<{
    fingerprint: string;
    label: string;
    summary: string;
    recurrenceCount: number;
    suggestedAssetType: MyCapabilityListItem["assetType"];
  }>;
  assetWeeklyDigest?: {
    weekKey: string;
    headline: string;
    entries: Array<{
      id: string;
      kind: "review" | "admin_recommend" | "organizational";
      label: string;
      summary: string;
      capabilityId?: string;
      fingerprint?: string;
      recurrenceCount?: number;
    }>;
  } | null;
  onAcceptAssetReviewSuggestion?: (fingerprint: string) => void;
  onDismissAssetReviewSuggestion?: (fingerprint: string) => void;
  onDismissWeeklyDigest?: () => void;
  onOpenWeeklyDigestEntry?: (entry: {
    id: string;
    kind: "review" | "admin_recommend" | "organizational";
    label: string;
    summary: string;
    capabilityId?: string;
    fingerprint?: string;
  }) => void;
  onSearchChange: (query: string) => void;
  onFilterTagChange: (tag: string | null) => void;
  onFilterCategoryChange: (category: string | null) => void;
  onFilterSourceChange: (source: string | null) => void;
  onFilterShareVisibilityChange: (visibility: CapabilityShareVisibility | null) => void;
  onShowDraftsOnly?: () => void;
  onShowAllCapabilities?: () => void;
  onShowContributedOnly?: () => void;
  onChangeSegment?: (segment: MyAccumulationSegment) => void;
  onChangeDetailTab?: (tab: StandardAssetDetailTabId) => void;
  onSelectCapability: (capabilityId: string) => void;
  onContinueOrganize?: (capabilityId: string) => void;
  onShareToGroup: (capabilityId: string, groupId: string) => void;
  onPrepareEdit: (capabilityId: string) => void;
  onPrepareDelete: (capabilityId: string) => void;
  onEditDraftChange: (patch: Partial<CapabilitySummary>) => void;
  onRunDefinitionAutofill?: (capabilityId: string) => void;
  onDiscardDefinitionChanges?: () => void;
  onUndoDefinitionAutofill?: () => void;
  pendingUsageBriefIntent?: "edit" | "delete";
  onConfirmUsageBrief: () => void;
  onCancelUsageBrief: () => void;
  onOpenRobot?: (robotId: string) => void;
  onOpenGroup?: (groupId: string) => void;
  onSubmitToEnterprise: (capabilityId?: string) => void;
  definitionDirty?: boolean;
  definitionSaving?: boolean;
  definitionSaveNotice?: string | null;
  autofillBusy?: boolean;
  autofillError?: string | null;
  autofillNotice?: string | null;
  autofillCanUndo?: boolean;
  enterpriseSubmissionOpen?: boolean;
  enterpriseSubmissionDraft?: EnterpriseAssetPackageDraft | null;
  enterpriseSubmissionReasonLines?: string[];
  enterpriseSubmissionExpanded?: boolean;
  enterpriseSubmissionBusy?: boolean;
  enterpriseSubmissionError?: string | null;
  onEnterpriseSubmissionChange?: (patch: Partial<EnterpriseAssetPackageDraft>) => void;
  onOpenEnterpriseSubmissionEditor?: () => void;
  onCloseEnterpriseSubmissionEditor?: () => void;
  onConfirmEnterpriseSubmission?: () => void;
  onCancelEnterpriseSubmission?: () => void;
  /** 安装能力到机器人（能力安装治理新增） */
  onInstallCapabilityToRobot?: (capabilityId: string, source: string) => void;
  /** 预览安装风险（能力安装治理新增） */
  onPreviewInstallRisk?: (capabilityId: string, source: string) => void;
  /** 把已有个人资产（含 MCP）安装到指定机器人，走 employee-capability.install-to-robot。 */
  onInstallOwnedAssetToRobot?: (capabilityId: string, agentId: string) => void;
  /** 从机器人行进入安装时携带的目标机器人 id（用于顶部固定「安装到」上下文）。 */
  installTargetRobotId?: string | null;
  /** 目标机器人的展示名，缺省时回退到 id。 */
  installTargetRobotLabel?: string | null;
  /** 当前可安装的机器人列表。 */
  installRobots?: Array<{ id: string; name: string }>;
  ownedInstallBusy?: boolean;
  ownedInstallNotice?: string | null;
};

const PACKAGE_TYPE_OPTIONS: Array<{
  value: EnterpriseAssetPackageType;
  label: string;
}> = [
  { value: "single_capability", label: "单一能力" },
  { value: "template_pack", label: "模板套件" },
  { value: "workflow_pack", label: "流程套件" },
  { value: "knowledge_pack", label: "知识套件" },
  { value: "automation_pack", label: "自动化套件" },
  { value: "composite_pack", label: "复合资产包" },
];

const EXECUTION_MODE_OPTIONS: Array<{
  value: EnterpriseAssetExecutionMode;
  label: string;
}> = [
  { value: "assistive", label: "仅辅助使用" },
  { value: "semi_automatic", label: "半自动执行" },
  { value: "automatic", label: "允许自动执行" },
];

const RISK_TAG_OPTIONS: Array<{
  value: EnterpriseAssetRiskTag;
  label: string;
}> = [
  { value: "external_publish", label: "外部发布" },
  { value: "credential_required", label: "需要凭证" },
  { value: "brand_risk", label: "品牌风险" },
  { value: "customer_data", label: "客户数据" },
  { value: "manual_review_required", label: "人工复核" },
];

function linesValue(value: string[]): string {
  return value.join("\n");
}

function parseLines(value: string): string[] {
  return value
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function packageTypeLabel(value: EnterpriseAssetPackageType): string {
  return PACKAGE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function executionModeLabel(value: EnterpriseAssetExecutionMode): string {
  return EXECUTION_MODE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function riskTagLabel(value: EnterpriseAssetRiskTag): string {
  return RISK_TAG_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function assetTypeLabel(assetType: MyCapabilityListItem["assetType"] | undefined): string {
  switch (assetType) {
    case "prompt":
      return "提示";
    case "template":
      return "模版";
    case "workflow":
      return "流程";
    case "knowledge":
      return "知识";
    case "agent":
      return "Agent";
    case "tool":
      return "Tool";
    case "mcp":
      return "MCP";
    default:
      return "能力";
  }
}

const ROBOT_INSTALLABLE_ASSET_TYPES = new Set<MyCapabilityListItem["assetType"]>([
  "capability",
  "workflow",
  "prompt",
  "template",
  "agent",
  "tool",
  "mcp",
]);

function canInstallOwnedAssetToRobot(capability: CapabilitySummary): boolean {
  return (
    !capability.isDraft && ROBOT_INSTALLABLE_ASSET_TYPES.has(capability.assetType ?? "capability")
  );
}

function renderOwnedRobotInstall(
  capability: CapabilitySummary,
  props: MyAccumulationProps,
): TemplateResult {
  const robots = props.installRobots ?? [];
  const defaultRobotId =
    props.installTargetRobotId?.trim() ||
    robots.find((robot) => robot.id === (capability.usage.robots[0]?.id ?? ""))?.id ||
    robots[0]?.id ||
    "";
  const installedIds = new Set(capability.usage.robots.map((robot) => robot.id));
  const installedNames = capability.usage.robots
    .map((robot) => robot.name.trim() || robot.id)
    .filter(Boolean);
  return html`
    <div class="my-accumulation__owned-install">
      ${
        installedNames.length > 0
          ? html`<p>已装在 ${installedNames.join("、")}</p>`
          : html`
              <p>还没有装到任何机器人。选一只后直接挂上。</p>
            `
      }
      ${
        robots.length === 0
          ? html`
              <p>当前没有可安装的机器人。</p>
            `
          : html`
              <div class="my-accumulation__detail-utilities">
                <label class="my-accumulation__detail-utility-select">
                  <span>目标机器人</span>
                  <select class="my-accumulation__robot-install-select">
                    ${robots.map(
                      (robot) => html`
                        <option value=${robot.id} ?selected=${robot.id === defaultRobotId}>
                          ${robot.name || robot.id}${installedIds.has(robot.id) ? "（已装）" : ""}
                        </option>
                      `,
                    )}
                  </select>
                </label>
                <button
                  type="button"
                  ?disabled=${props.ownedInstallBusy === true || !props.onInstallOwnedAssetToRobot}
                  @click=${(event: Event) => {
                    const root = (event.currentTarget as HTMLElement).closest(
                      ".my-accumulation__owned-install",
                    );
                    const agentId =
                      root?.querySelector<HTMLSelectElement>(
                        ".my-accumulation__robot-install-select",
                      )?.value ?? defaultRobotId;
                    if (agentId) {
                      props.onInstallOwnedAssetToRobot?.(capability.id, agentId);
                    }
                  }}
                >
                  ${props.ownedInstallBusy ? "安装中…" : "安装到这只机器人"}
                </button>
              </div>
            `
      }
      ${
        props.ownedInstallNotice
          ? html`<p class="my-accumulation__owned-install-notice">${props.ownedInstallNotice}</p>`
          : nothing
      }
    </div>
  `;
}

function isContributedVisibility(visibility: CapabilityShareVisibility): boolean {
  return (
    visibility === "审核中" ||
    visibility === "需要修改后再次提交" ||
    visibility === "已进入企业资产库"
  );
}

function renderSegmentButton(
  label: string,
  active: boolean,
  count: number,
  onClick?: (() => void) | null,
): TemplateResult {
  return html`
    <button
      type="button"
      class="my-accumulation__segment ${active ? "is-active" : ""}"
      aria-pressed=${String(active)}
      ?disabled=${!onClick}
      @click=${() => onClick?.()}
    >
      <span>${label}</span>
      <span class="my-accumulation__segment-count">${count}</span>
    </button>
  `;
}

function canSelectSegment(props: MyAccumulationProps, segment: MyAccumulationSegment): boolean {
  if (props.onChangeSegment) {
    return true;
  }
  if (segment === "all") {
    return Boolean(props.onShowAllCapabilities);
  }
  if (segment === "drafts") {
    return Boolean(props.onShowDraftsOnly);
  }
  if (segment === "contributed") {
    return Boolean(props.onShowContributedOnly);
  }
  return false;
}

function selectSegment(props: MyAccumulationProps, segment: MyAccumulationSegment): void {
  if (props.onChangeSegment) {
    props.onChangeSegment(segment);
    return;
  }
  if (segment === "all") {
    props.onShowAllCapabilities?.();
    return;
  }
  if (segment === "drafts") {
    props.onShowDraftsOnly?.();
    return;
  }
  if (segment === "contributed") {
    props.onShowContributedOnly?.();
  }
}

function renderWeeklyDigestCard(props: MyAccumulationProps): TemplateResult | typeof nothing {
  const digest = props.assetWeeklyDigest;
  if (!digest || digest.entries.length === 0) {
    return nothing;
  }
  return html`
    <article class="my-accumulation__suggestion my-accumulation__suggestion--digest">
      <div class="my-accumulation__item-main">
        <div class="my-accumulation__item-title-row">
          <span class="my-accumulation__item-title">本周资产回顾</span>
          <span class="my-accumulation__suggestion-flag">回顾</span>
        </div>
        <span class="my-accumulation__item-summary">${digest.headline}</span>
      </div>
      <div class="my-accumulation__digest-entries">
        ${digest.entries.map(
          (entry) => html`
            <div class="my-accumulation__digest-entry">
              <div class="my-accumulation__digest-entry-head">
                <span class="my-accumulation__digest-entry-label">${entry.label}</span>
                <span class="my-accumulation__digest-entry-kind">${digestEntryKindLabel(entry.kind)}</span>
              </div>
              <span class="my-accumulation__digest-entry-summary">${entry.summary}</span>
              <button
                type="button"
                class="btn btn--ghost btn--sm"
                @click=${() => props.onOpenWeeklyDigestEntry?.(entry)}
              >
                查看
              </button>
            </div>
          `,
        )}
      </div>
      <div class="my-accumulation__item-actions">
        <button
          type="button"
          class="btn btn--ghost"
          @click=${() => props.onDismissWeeklyDigest?.()}
        >
          本周已阅
        </button>
      </div>
    </article>
  `;
}

function digestEntryKindLabel(kind: "review" | "admin_recommend" | "organizational"): string {
  if (kind === "admin_recommend") {
    return "管理员推荐";
  }
  if (kind === "organizational") {
    return "组织级候选";
  }
  return "稳定模式";
}

function visibleAssetReviewSuggestions(props: MyAccumulationProps) {
  return selectVisibleAssetReviewSuggestions(props.assetReviewSuggestions ?? []);
}

function renderAssetReviewSuggestionCards(
  props: MyAccumulationProps,
): TemplateResult | typeof nothing {
  const suggestions = visibleAssetReviewSuggestions(props);
  if (suggestions.length === 0) {
    return nothing;
  }
  return html`
    <article class="my-accumulation__suggestion my-accumulation__suggestion--review">
      <div class="my-accumulation__item-main">
        <div class="my-accumulation__item-title-row">
          <span class="my-accumulation__item-title">可整理的工作模式</span>
          <span class="my-accumulation__suggestion-flag">${suggestions.length} 项建议</span>
        </div>
        <span class="my-accumulation__item-summary">
          这些是重复出现的工作方式，确认后才会成为资产。
        </span>
      </div>
      <div class="my-accumulation__suggestion-rows">
        ${suggestions.map(
          (entry) => html`
            <div class="my-accumulation__suggestion-row">
              <div class="my-accumulation__suggestion-row-copy">
                <strong>${entry.label}</strong>
                <span>过去 30 天出现 ${entry.recurrenceCount} 次</span>
              </div>
              <div class="my-accumulation__item-actions">
                <button
                  type="button"
                  class="btn btn--ghost"
                  @click=${() => props.onDismissAssetReviewSuggestion?.(entry.fingerprint)}
                >
                  暂不处理
                </button>
                <button
                  type="button"
                  class="btn btn--primary"
                  @click=${() => props.onAcceptAssetReviewSuggestion?.(entry.fingerprint)}
                >
                  整理为草稿
                </button>
              </div>
            </div>
          `,
        )}
      </div>
    </article>
  `;
}

function renderPendingDepositCard(props: MyAccumulationProps): TemplateResult | typeof nothing {
  if (!props.assetSuggestionVisible || !props.canDepositFromContext || !props.onOpenSkillSave) {
    return nothing;
  }
  return html`
    <article class="my-accumulation__suggestion my-accumulation__suggestion--candidate">
      <div class="my-accumulation__item-main">
        <div class="my-accumulation__item-title-row">
          <span class="my-accumulation__item-title">本次任务可资产化建议</span>
          <span class="my-accumulation__suggestion-flag">建议</span>
        </div>
        <span class="my-accumulation__item-summary">
          ${props.depositHint ?? "这次任务里有一项内容适合沉淀为资产，确认后可整理为资产草稿。"}
        </span>
      </div>
      <div class="my-accumulation__item-foot">
        <span>
          ${
            props.showEnterpriseSubmitActionFromSuggestion
              ? "系统判断这项内容更像成熟工作流，可先整理，再直接推进到企业资产包提交流程。"
              : "系统会先和你协作整理，审定后再纳入资产列表。"
          }
        </span>
      </div>
      <div class="my-accumulation__item-actions">
        ${
          props.showEnterpriseSubmitActionFromSuggestion && props.onOpenSkillSaveAndContinue
            ? html`
                <button
                  type="button"
                  class="btn"
                  @click=${props.onOpenSkillSaveAndContinue}
                >
                  直接整理并提交企业
                </button>
              `
            : nothing
        }
        <button
          type="button"
          class="btn ${props.showEnterpriseSubmitActionFromSuggestion ? "" : "btn--primary"}"
          @click=${props.onOpenSkillSave}
        >
          开始整理
        </button>
      </div>
    </article>
  `;
}

function emptyStateCopy(
  segment: MyAccumulationSegment,
  hasSearch: boolean,
): { title: string; body: string } {
  if (hasSearch) {
    return {
      title: "没有匹配的资产",
      body: "换个关键词试试，或切回全部查看现有资产。",
    };
  }
  if (segment === "drafts") {
    return {
      title: "还没有待整理草稿",
      body: "当你同意整理任务中的资产建议后，这里会出现资产草稿。",
    };
  }
  if (segment === "reviewing") {
    return {
      title: "还没有审核中的资产",
      body: "提交企业后，审核进度会出现在这里。",
    };
  }
  if (segment === "contributed") {
    return {
      title: "还没有已入企业的资产",
      body: "通过审核的资产会出现在这里。",
    };
  }
  if (segment === "optimize") {
    return {
      title: "暂时没有需要优化的资产",
      body: "运行异常或被退回修改的资产会出现在这里。",
    };
  }
  return {
    title: "还没有可安装的资产",
    body: "技能、流程或工具会出现在这里。知识文档请放在知识库。",
  };
}

function openPrimaryOptimizationTarget(
  item: MyCapabilityListItem,
  props: MyAccumulationProps,
): void {
  const target = item.optimizationTargets?.[0];
  if (!target) {
    props.onSelectCapability(item.id);
    return;
  }
  if (target.kind === "robot") {
    props.onOpenRobot?.(target.id);
    return;
  }
  props.onOpenGroup?.(target.id);
}

function renderEmployeeFilesEmptyState(): TemplateResult {
  return html`
    <section class="my-accumulation__detail-section" aria-label="文件清单">
      ${renderStandardAssetDetailEmptyState({
        title: "个人端暂不展示技术文件",
        description:
          "当前详情页聚焦你的整理、复用和企业提交过程，不直接展开 SKILL.md、脚本和附属文件。",
      })}
    </section>
  `;
}

function renderIncubationReadinessNotice(
  capability: CapabilitySummary,
): TemplateResult | typeof nothing {
  const readiness = capability.incubationReadiness;
  if (!readiness || readiness.ready) {
    return nothing;
  }
  const gapLabels = [...new Set(readiness.gaps.map((gap) => gap.label))];
  const blocking = !readiness.admissible;
  return html`
    <div
      class="my-accumulation__readiness-notice ${blocking ? "is-blocking" : "is-recommended"}"
      role="note"
      aria-label="规范内容填充提示"
    >
      <strong>
        ${blocking ? "尚未完成规范内容填充，暂不能纳入孵化通道" : "建议补齐规范内容后再推广"}
      </strong>
      ${
        gapLabels.length > 0
          ? html`
              <ul class="my-accumulation__readiness-gaps">
                ${gapLabels.map((label) => html`<li>${label}</li>`)}
              </ul>
            `
          : nothing
      }
      ${
        blocking
          ? html`
              <span>在下方补齐上述内容并保存后，即可共享到协作小组或提交企业。</span>
            `
          : nothing
      }
    </div>
  `;
}

function renderDefinitionGapChecklist(capability: CapabilitySummary): TemplateResult {
  const readiness = capability.incubationReadiness;
  const gaps = readiness?.gaps ?? [];
  const filledCount = Math.max(0, 5 - gaps.length);
  const progressLabel = readiness?.ready
    ? "规范内容已补齐"
    : `已补齐约 ${filledCount}/5 项关键字段`;
  return html`
    <section class="my-accumulation__organize-checklist" aria-label="待补齐清单">
      <div class="my-accumulation__organize-checklist-head">
        <strong>整理进度</strong>
        <span>${progressLabel}</span>
      </div>
      ${
        gaps.length > 0
          ? html`
              <ul>
                ${gaps.map(
                  (gap) => html`
                    <li class=${gap.severity === "block" ? "is-block" : "is-recommend"}>
                      <span>${gap.severity === "block" ? "必填" : "建议"}</span>
                      ${gap.label}
                    </li>
                  `,
                )}
              </ul>
            `
          : html`
              <p>关键字段已具备，确认后可保存并提交企业。</p>
            `
      }
      <p class="my-accumulation__organize-checklist-hint">
        多数字段可由「智能补齐」自动生成；你只需确认业务含义是否准确。
      </p>
    </section>
  `;
}

function renderDefinitionOrganizeActions(
  capability: CapabilitySummary,
  props: MyAccumulationProps,
): TemplateResult {
  const dirty = props.definitionDirty === true;
  const saving = props.definitionSaving === true;
  const autofillBusy = props.autofillBusy === true;
  const canUndo = props.autofillCanUndo === true;
  const admissible = capability.incubationReadiness?.admissible !== false;
  const submitBlocked = dirty || !admissible || saving || autofillBusy;
  const submitTitle = dirty
    ? "请先保存整理后再提交企业"
    : !admissible
      ? "请先补齐必填规范内容后再提交企业"
      : undefined;
  return html`
    <div class="my-accumulation__organize-actions" role="toolbar" aria-label="整理操作">
      <button
        type="button"
        class="my-accumulation__organize-actions-secondary"
        ?disabled=${autofillBusy || saving}
        @click=${() => props.onRunDefinitionAutofill?.(capability.id)}
      >
        ${autofillBusy ? "补齐中…" : "智能补齐"}
      </button>
      ${
        canUndo
          ? html`
              <button
                type="button"
                class="my-accumulation__organize-actions-secondary"
                ?disabled=${autofillBusy || saving}
                title="撤销最近一次智能补齐填入的内容"
                @click=${() => props.onUndoDefinitionAutofill?.()}
              >
                撤销补齐
              </button>
            `
          : nothing
      }
      <button
        type="button"
        class="my-accumulation__organize-actions-primary"
        ?disabled=${saving || autofillBusy || !dirty}
        title=${dirty ? "将当前修改保存生效" : "没有待保存的修改"}
        @click=${() => props.onPrepareEdit(capability.id)}
      >
        ${saving ? "保存中…" : dirty ? "保存整理" : "已保存"}
      </button>
      ${
        dirty
          ? html`
              <button
                type="button"
                class="my-accumulation__organize-actions-secondary"
                ?disabled=${saving || autofillBusy}
                title="放弃未保存修改并重新加载"
                @click=${() => props.onDiscardDefinitionChanges?.()}
              >
                放弃修改
              </button>
            `
          : nothing
      }
      <button
        type="button"
        ?disabled=${submitBlocked}
        title=${submitTitle ?? nothing}
        @click=${() => props.onSubmitToEnterprise(capability.id)}
      >
        提交企业
      </button>
    </div>
    ${
      props.autofillError
        ? html`<p class="my-accumulation__organize-feedback is-error" role="alert">${props.autofillError}</p>`
        : nothing
    }
    ${
      props.autofillNotice
        ? html`<p class="my-accumulation__organize-feedback">${props.autofillNotice}</p>`
        : nothing
    }
    ${
      props.definitionSaveNotice
        ? html`<p class="my-accumulation__organize-feedback is-success">${props.definitionSaveNotice}</p>`
        : nothing
    }
    ${
      dirty
        ? html`
            <p class="my-accumulation__organize-feedback is-warn">
              有未保存修改。切换资产或离开「定义」页前请先保存，或点「放弃修改」。
            </p>
          `
        : nothing
    }
  `;
}

function renderDefinitionOrganizeForm(
  capability: CapabilitySummary,
  props: MyAccumulationProps,
): TemplateResult {
  return html`
    <section
      class="my-accumulation__detail-section my-accumulation__detail-section--editor my-accumulation__organize-form"
      aria-label="规范字段"
    >
      <h3>规范字段</h3>
      <label>
        <span>名称</span>
        <input
          .value=${capability.name}
          ?disabled=${props.definitionSaving === true || props.autofillBusy === true}
          @input=${(event: Event) =>
            props.onEditDraftChange({
              name: (event.target as HTMLInputElement).value,
            })}
        />
      </label>
      <label>
        <span>一句话价值说明</span>
        <textarea
          .value=${capability.summary}
          ?disabled=${props.definitionSaving === true || props.autofillBusy === true}
          @input=${(event: Event) =>
            props.onEditDraftChange({
              summary: (event.target as HTMLTextAreaElement).value,
            })}
        ></textarea>
      </label>
      <label>
        <span>适用场景（每行一项）</span>
        <textarea
          .value=${capability.usageExamples.join("\n")}
          ?disabled=${props.definitionSaving === true || props.autofillBusy === true}
          @input=${(event: Event) =>
            props.onEditDraftChange({
              usageExamples: (event.target as HTMLTextAreaElement).value
                .split(/\n+/)
                .map((entry) => entry.trim())
                .filter(Boolean),
            })}
        ></textarea>
      </label>
      <label>
        <span>输入说明</span>
        <textarea
          .value=${capability.inputDescription}
          ?disabled=${props.definitionSaving === true || props.autofillBusy === true}
          @input=${(event: Event) =>
            props.onEditDraftChange({
              inputDescription: (event.target as HTMLTextAreaElement).value,
            })}
        ></textarea>
      </label>
      <label>
        <span>输出说明</span>
        <textarea
          .value=${capability.outputDescription}
          ?disabled=${props.definitionSaving === true || props.autofillBusy === true}
          @input=${(event: Event) =>
            props.onEditDraftChange({
              outputDescription: (event.target as HTMLTextAreaElement).value,
            })}
        ></textarea>
      </label>
      <label>
        <span>标签（用逗号分隔）</span>
        <input
          .value=${capability.tags.join("，")}
          ?disabled=${props.definitionSaving === true || props.autofillBusy === true}
          @input=${(event: Event) =>
            props.onEditDraftChange({
              tags: (event.target as HTMLInputElement).value
                .split(/[，,]/)
                .map((entry) => entry.trim())
                .filter(Boolean),
            })}
        />
      </label>
      <label>
        <span>分类</span>
        <input
          .value=${capability.category}
          ?disabled=${props.definitionSaving === true || props.autofillBusy === true}
          @input=${(event: Event) =>
            props.onEditDraftChange({
              category: (event.target as HTMLInputElement).value,
            })}
        />
      </label>
    </section>
  `;
}

function renderEmployeeFilesTab(capability: CapabilitySummary): TemplateResult {
  // 知识类资产的核心价值是其内容本身，应在此展示（而非一律隐藏）。
  if (capability.assetType === "knowledge") {
    const content = capability.outputDescription?.trim();
    return html`
      <section class="my-accumulation__detail-section" aria-label="知识内容">
        <h3>知识内容</h3>
        ${renderIncubationReadinessNotice(capability)}
        ${
          content
            ? html`<p class="my-accumulation__detail-content">${content}</p>`
            : html`
                <p>还没有可展示的正文。请在"定义"页补充这份知识的正文/内容后，再共享或提交。</p>
              `
        }
      </section>
    `;
  }
  return renderEmployeeFilesEmptyState();
}

function renderEmployeeOverviewTab(
  capability: CapabilitySummary,
  vm: ReturnType<typeof buildEmployeeAssetDetailVM>,
): TemplateResult {
  const overviewFacts = vm.overviewFacts.map((fact) =>
    fact.label === "一句话说明"
      ? { ...fact, value: presentEmployeeFacingSummary(capability.summary) }
      : fact,
  );
  const technicalSummary = looksLikeTechnicalDiagnosticSummary(capability.summary);
  return html`
    ${renderIncubationReadinessNotice(capability)}
    <div class="my-accumulation__detail-overview">
      ${renderAssetDetailStatCards({
        items: vm.overviewStats,
        containerClass: "my-accumulation__detail-stats",
        itemClass: "my-accumulation__detail-stat",
        labelClass: "",
        valueClass: "",
      })}
    </div>

    <section class="my-accumulation__detail-section" aria-label="当前摘要">
      <h3>当前摘要</h3>
      ${
        technicalSummary
          ? html`
              <div class="my-accumulation__diag-fold" role="note">
                <strong>检测到系统诊断原文</strong>
                <p>${presentEmployeeFacingSummary(capability.summary)}</p>
                <details>
                  <summary>查看原始诊断（可选）</summary>
                  <pre class="my-accumulation__diag-fold-raw">${capability.summary}</pre>
                </details>
              </div>
            `
          : renderAssetDetailFactPairs({
              items: overviewFacts,
              containerClass: "my-accumulation__detail-pairs",
              itemClass: "my-accumulation__detail-pair",
              labelClass: "",
              valueClass: "",
            })
      }
      ${
        !technicalSummary
          ? nothing
          : renderAssetDetailFactPairs({
              items: overviewFacts.filter((fact) => fact.label !== "一句话说明"),
              containerClass: "my-accumulation__detail-pairs",
              itemClass: "my-accumulation__detail-pair",
              labelClass: "",
              valueClass: "",
            })
      }
    </section>
  `;
}

function renderEmployeeDefinitionTab(
  capability: CapabilitySummary,
  vm: ReturnType<typeof buildEmployeeAssetDetailVM>,
  props: MyAccumulationProps,
  showEditor: boolean,
): TemplateResult {
  if (showEditor) {
    return html`
      <div class="my-accumulation__organize-workbench">
        ${renderDefinitionOrganizeActions(capability, props)}
        ${renderDefinitionGapChecklist(capability)}
        ${renderIncubationReadinessNotice(capability)}
        ${renderDefinitionOrganizeForm(capability, props)}
        <details class="my-accumulation__system-details">
          <summary>系统详情（可选）</summary>
          <section class="my-accumulation__detail-section" aria-label="资产状态">
            <h3>资产状态</h3>
            ${renderAssetDetailFactPairs({
              items: vm.definitionFacts.slice(0, 5),
              containerClass: "my-accumulation__detail-pairs",
              itemClass: "my-accumulation__detail-pair",
              labelClass: "",
              valueClass: "",
            })}
          </section>
        </details>
      </div>
    `;
  }
  return html`
    <div class="my-accumulation__detail-grid">
      <div class="my-accumulation__detail-stack">
        <section class="my-accumulation__detail-section" aria-label="资产状态">
          <h3>资产状态</h3>
          <p>个人端主要看业务整理结果；如果要看技术定义来源，可后续在平台治理台查看 SKILL.md / manifest。</p>
          ${renderAssetDetailFactPairs({
            items: vm.definitionFacts.slice(0, 5),
            containerClass: "my-accumulation__detail-pairs",
            itemClass: "my-accumulation__detail-pair",
            labelClass: "",
            valueClass: "",
          })}
        </section>

        <section class="my-accumulation__detail-section" aria-label="适用场景">
          <h3>适用场景</h3>
          ${
            capability.usageExamples.length > 0
              ? html`
                  <ul class="my-accumulation__detail-list">
                    ${capability.usageExamples.map((example) => html`<li>${example}</li>`)}
                  </ul>
                `
              : html`
                  <p>暂无</p>
                `
          }
        </section>

        <section class="my-accumulation__detail-section" aria-label="输入与输出">
          <h3>输入与输出</h3>
          ${renderAssetDetailFactPairs({
            items: vm.definitionFacts.slice(5),
            containerClass: "my-accumulation__detail-pairs",
            itemClass: "my-accumulation__detail-pair",
            labelClass: "",
            valueClass: "",
          })}
        </section>
      </div>
    </div>
  `;
}

function renderEmployeeRuntimeTab(
  capability: CapabilitySummary,
  props: MyAccumulationProps,
  repairSuggestion: string | null,
): TemplateResult {
  return html`
    <div class="my-accumulation__detail-grid">
      <div class="my-accumulation__detail-stack">
        <section class="my-accumulation__detail-section" aria-label="复用与运行">
          <h3>复用与运行</h3>
          <div class="my-accumulation__detail-pairs">
            <div class="my-accumulation__detail-pair">
              <span>使用状态</span>
              <strong>
                ${
                  capability.usageMetrics.robotCount > 0
                    ? `已被 ${capability.usageMetrics.robotCount} 个机器人使用`
                    : "尚未被机器人使用"
                }
              </strong>
            </div>
            <div class="my-accumulation__detail-pair">
              <span>协作组复用</span>
              <strong>${formatMetricCountLabel(capability.usageMetrics.groupCount, "个协作组")}</strong>
            </div>
            <div class="my-accumulation__detail-pair">
              <span>最近调用</span>
              <strong>${formatAssetDetailRelativeTime(capability.usageMetrics.lastUsedAt)}</strong>
            </div>
          </div>
        </section>

        ${
          repairSuggestion
            ? html`
                <section class="my-accumulation__detail-section" aria-label="修复建议">
                  <h3>修复建议</h3>
                  <p>${repairSuggestion}</p>
                </section>
              `
            : nothing
        }
      </div>

      <div class="my-accumulation__detail-stack">
        ${renderCapabilityAttributionPanel({
          attribution: capability.attribution,
          loading: false,
          onOpenRobot: props.onOpenRobot,
        })}
      </div>
    </div>
  `;
}

function renderEmployeeVersionsTab(
  capability: CapabilitySummary,
  props: MyAccumulationProps,
  vm: ReturnType<typeof buildEmployeeAssetDetailVM>,
  hasSecondarySections: boolean,
): TemplateResult {
  return html`
    <div class="my-accumulation__detail-grid">
      <div class="my-accumulation__detail-stack">
        <section class="my-accumulation__detail-section" aria-label="版本口径">
          <h3>版本口径</h3>
          ${renderAssetDetailFactPairs({
            items: vm.versionFacts,
            containerClass: "my-accumulation__detail-pairs",
            itemClass: "my-accumulation__detail-pair",
            labelClass: "",
            valueClass: "",
          })}
        </section>
      </div>
    </div>
    ${
      hasSecondarySections
        ? html`
            <div class="my-accumulation__detail-grid my-accumulation__detail-grid--secondary">
              <section class="my-accumulation__detail-section" aria-label="版本动态">
                <h3>版本动态</h3>
                ${renderAssetDetailTimeline({
                  items: vm.versionTimeline,
                  itemClass: "asset-detail-page__timeline-item",
                  timeClass: "asset-detail-page__timeline-time",
                  primaryClass: "asset-detail-page__timeline-author",
                  secondaryClass: "asset-detail-page__timeline-summary",
                  tagClass: "asset-detail-page__tag",
                  emptyTitle: "暂时没有版本动态",
                  emptyDescription: "当前还没有更多整理迭代记录。",
                })}
              </section>

              <section class="my-accumulation__detail-section" aria-label="继续优化">
                <h3>继续优化</h3>
                ${
                  vm.optimizationTimeline.length > 0
                    ? html`
                        ${renderAssetDetailTimeline({
                          items: vm.optimizationTimeline,
                          itemClass: "asset-detail-page__timeline-item",
                          timeClass: "asset-detail-page__timeline-time",
                          primaryClass: "asset-detail-page__timeline-author",
                          secondaryClass: "asset-detail-page__timeline-summary",
                          tagClass: "asset-detail-page__tag",
                          emptyTitle: "暂无优化入口",
                          emptyDescription: "当前还没有可回跳的优化场景。",
                        })}
                        <div class="my-accumulation__detail-actions">
                          ${capability.optimizationTargets?.map((target) =>
                            target.kind === "robot"
                              ? html`
                                  <button type="button" @click=${() => props.onOpenRobot?.(target.id)}>
                                    进入 ${target.name}
                                  </button>
                                `
                              : html`
                                  <button type="button" @click=${() => props.onOpenGroup?.(target.id)}>
                                    进入 ${target.name}
                                  </button>
                                `,
                          )}
                        </div>
                      `
                    : renderStandardAssetDetailEmptyState({
                        title: "暂无优化入口",
                        description: "当前还没有可回跳的优化场景。",
                      })
                }
              </section>
            </div>
          `
        : html`
            <section class="my-accumulation__detail-section" aria-label="版本动态">
              ${renderStandardAssetDetailEmptyState({
                title: "暂时没有额外版本动态",
                description: "当前还没有更多整理迭代或可回跳优化的上下文。",
              })}
            </section>
          `
    }
  `;
}

function renderEmployeeInstallTab(
  capability: CapabilitySummary,
  props: MyAccumulationProps,
  vm: ReturnType<typeof buildEmployeeAssetDetailVM>,
  contributed: boolean,
): TemplateResult {
  const dirty = props.definitionDirty === true;
  const admissible = capability.incubationReadiness?.admissible !== false;
  const shareBlocked = dirty || !admissible;
  const admissionHint = dirty
    ? "请先保存整理后再分享或提交"
    : capability.incubationReadiness && !capability.incubationReadiness.admissible
      ? "请先在“定义”页完成规范内容填充后再分享或提交"
      : undefined;
  return html`
    <section class="my-accumulation__detail-section" aria-label="分享与分发">
      <h3>分享与分发</h3>
      ${renderIncubationReadinessNotice(capability)}
      ${renderAssetDetailFactPairs({
        items: vm.installFacts,
        containerClass: "my-accumulation__detail-pairs",
        itemClass: "my-accumulation__detail-pair",
        labelClass: "",
        valueClass: "",
      })}
      ${
        vm.shareTimeline.length > 0
          ? html`
              <h4>分享记录</h4>
              ${renderAssetDetailTimeline({
                items: vm.shareTimeline,
                itemClass: "asset-detail-page__timeline-item",
                timeClass: "asset-detail-page__timeline-time",
                primaryClass: "asset-detail-page__timeline-author",
                secondaryClass: "asset-detail-page__timeline-summary",
                tagClass: "asset-detail-page__tag",
                emptyTitle: "暂无分享记录",
                emptyDescription: "还没有将此资产分享到协作小组。",
              })}
            `
          : nothing
      }
    </section>

    <section class="my-accumulation__detail-section" aria-label="安装到机器人">
      <h3>安装到机器人</h3>
      ${
        canInstallOwnedAssetToRobot(capability)
          ? renderOwnedRobotInstall(capability, props)
          : html`
              <p>草稿或知识资产不能直接装到机器人。</p>
            `
      }
      ${
        capability.assetType === "mcp"
          ? nothing
          : html`
              <div class="my-accumulation__detail-utilities">
                <button
                  type="button"
                  @click=${() => props.onPreviewInstallRisk?.(capability.id, "platform-marketplace")}
                >
                  从平台市场安装
                </button>
                <button
                  type="button"
                  @click=${() =>
                    props.onPreviewInstallRisk?.(capability.id, "enterprise-distributed")}
                >
                  从企业分发安装
                </button>
                <button
                  type="button"
                  @click=${() => props.onPreviewInstallRisk?.(capability.id, "external-local")}
                >
                  从外部/本地安装
                </button>
              </div>
            `
      }
    </section>

    <div class="my-accumulation__detail-utilities" aria-label="更多操作">
      <label class="my-accumulation__detail-utility-select">
        <span>协作小组</span>
        <select class="my-accumulation__group-select">
          ${props.availableGroups.map((group) => html`<option value=${group.id}>${group.name}</option>`)}
        </select>
      </label>
      <button
        type="button"
        ?disabled=${shareBlocked}
        title=${admissionHint ?? nothing}
        @click=${(event: Event) => {
          const root = (event.currentTarget as HTMLElement).closest(
            ".my-accumulation__item-expanded",
          );
          const groupId =
            root?.querySelector<HTMLSelectElement>(".my-accumulation__group-select")?.value ??
            props.availableGroups[0]?.id ??
            "";
          props.onShareToGroup(capability.id, groupId);
        }}
      >
        分享到协作小组
      </button>
      ${
        !contributed
          ? html`
              <button
                type="button"
                ?disabled=${shareBlocked}
                title=${admissionHint ?? nothing}
                @click=${() => props.onSubmitToEnterprise(capability.id)}
              >
                提交企业
              </button>
            `
          : nothing
      }
      <button
        type="button"
        class="my-accumulation__danger"
        @click=${() => props.onPrepareDelete(capability.id)}
      >
        删除
      </button>
    </div>
  `;
}

function renderInlineDetail(
  capability: CapabilitySummary,
  props: MyAccumulationProps,
): TemplateResult {
  const contributed = isContributedVisibility(capability.shareVisibility);
  const repairSuggestion = healthRepairSuggestion(capability.health);
  const hasSecondarySections =
    Boolean(capability.recentUpdate) || Boolean(capability.optimizationTargets?.length);
  const showEditor = capability.isDraft || capability.shareVisibility === "需要修改后再次提交";
  const vm = buildEmployeeAssetDetailVM({
    capability,
    availableGroups: props.availableGroups,
  });
  const detailTab = props.detailTab ?? "overview";
  const detailTabs = vm.tabs.map((tab) =>
    tab.id === "definition" && props.definitionDirty === true ? { ...tab, badge: "未保存" } : tab,
  );
  return html`
    <div class="my-accumulation__item-expanded">
      <section class="my-accumulation__detail-section my-accumulation__detail-section--full">
        ${renderStandardAssetDetailTabs({
          activeTab: detailTab,
          onChange: (tab) => props.onChangeDetailTab?.(tab),
          tabs: detailTabs,
        })}
      </section>

      ${
        detailTab === "overview"
          ? renderEmployeeOverviewTab(capability, vm)
          : detailTab === "definition"
            ? renderEmployeeDefinitionTab(capability, vm, props, showEditor)
            : detailTab === "files"
              ? renderEmployeeFilesTab(capability)
              : detailTab === "versions"
                ? renderEmployeeVersionsTab(capability, props, vm, hasSecondarySections)
                : detailTab === "runtime"
                  ? renderEmployeeRuntimeTab(capability, props, repairSuggestion)
                  : renderEmployeeInstallTab(capability, props, vm, contributed)
      }
    </div>
  `;
}

function renderListItem(item: MyCapabilityListItem, props: MyAccumulationProps): TemplateResult {
  const isSelected = props.selectedCapability?.id === item.id;
  const updatedLabel = formatAssetDetailRelativeTime(
    item.updatedAt ?? item.recentUpdate?.at ?? item.usageBrief.lastUsedAt,
  );
  const sourceLabel =
    item.sourceContextLabel ?? `来自${item.sourceRobotName ?? "最近一次工作整理"}`;
  const stageLabel = item.enterpriseLifecycle?.stageLabel ?? item.shareVisibility;
  const submittedVersion = item.versionInfo.submittedVersion ?? "未提交";
  const orgBadge = deriveOrganizationalIncubationBadge(item);

  return html`
    <article class=${`my-accumulation__item ${isSelected ? "is-active" : ""}`}>
      <div class="my-accumulation__item-main">
        <div class="my-accumulation__item-title-row">
          <span class="my-accumulation__item-active-flag">[${assetTypeLabel(item.assetType)}]</span>
          ${
            orgBadge
              ? html`
                  <span class="my-accumulation__item-org-badge">${organizationalBadgeLabel(orgBadge)}</span>
                `
              : nothing
          }
          <button
            type="button"
            class="my-accumulation__item-title"
            aria-pressed=${String(isSelected)}
            @click=${() => props.onSelectCapability(item.id)}
          >
            ${item.name}
          </button>
        </div>
        <span class="my-accumulation__item-summary">${presentEmployeeFacingSummary(item.summary)}</span>
      </div>
      ${
        !isSelected
          ? html`
              <div class="my-accumulation__item-meta-line">
                <span>状态：${item.isDraft ? "待完善" : stageLabel}</span>
                <span>版本：${item.versionInfo.currentVersion}</span>
                <span>已提交版本：${submittedVersion}</span>
                <span>最近更新：${updatedLabel}</span>
                ${
                  item.isDraft
                    ? html`
                        <span class="my-accumulation__draft">待完善</span>
                      `
                    : nothing
                }
              </div>
              <div class="my-accumulation__item-meta-line">
                <span>来源：${sourceLabel}</span>
                <span>调用：${formatUsageCountLabel(item.usageMetrics.totalUsageCount)}</span>
                <span>复用：${formatMetricCountLabel(item.usageMetrics.robotCount, "个机器人")}</span>
                <span>整理：${formatVersionCountLabel(item.versionInfo.versionCount)}</span>
                ${renderCapabilityHealthBadge({ label: item.health, variant: "inline" })}
              </div>
            `
          : nothing
      }
      <div class="my-accumulation__item-actions">
        <span class="my-accumulation__item-actions-label">操作：</span>
        ${
          item.isDraft || item.shareVisibility === "需要修改后再次提交"
            ? html`
                <button
                  type="button"
                  @click=${() =>
                    props.onContinueOrganize
                      ? props.onContinueOrganize(item.id)
                      : props.onSelectCapability(item.id)}
                >
                  继续整理
                </button>
              `
            : nothing
        }
        ${
          !isContributedVisibility(item.shareVisibility)
            ? html`
                <button
                  type="button"
                  ?disabled=${
                    props.definitionDirty === true && props.selectedCapability?.id === item.id
                  }
                  title=${
                    props.definitionDirty === true && props.selectedCapability?.id === item.id
                      ? "请先保存整理后再提交企业"
                      : nothing
                  }
                  @click=${() => props.onSubmitToEnterprise(item.id)}
                >
                  提交企业
                </button>
              `
            : nothing
        }
        ${
          isContributedVisibility(item.shareVisibility) && !isSelected
            ? html`
                <button type="button" @click=${() => props.onSelectCapability(item.id)}>查看审核反馈</button>
              `
            : nothing
        }
        ${
          !isSelected
            ? html`
                <button type="button" @click=${() => props.onSelectCapability(item.id)}>查看资产详情</button>
              `
            : nothing
        }
        ${
          item.optimizationTargets?.length && !isSelected
            ? html`
                <button type="button" @click=${() => openPrimaryOptimizationTarget(item, props)}>
                  回到原场景继续优化
                </button>
              `
            : nothing
        }
        <button
          type="button"
          class="my-accumulation__danger"
          @click=${() => props.onPrepareDelete(item.id)}
        >删除</button>
      </div>
      ${
        item.recentUpdate && !isSelected
          ? html`
              <div class="my-accumulation__item-recap">版本迭代：${item.recentUpdate.headline}</div>
            `
          : nothing
      }
      ${
        isSelected && props.selectedCapability
          ? props.selectedLoading
            ? html`
                <div class="my-accumulation__item-expanded">正在加载资产详情</div>
              `
            : renderInlineDetail(props.selectedCapability, props)
          : nothing
      }
    </article>
  `;
}

function renderEnterpriseSubmissionModal(
  props: MyAccumulationProps,
): TemplateResult | typeof nothing {
  if (!props.enterpriseSubmissionOpen || !props.enterpriseSubmissionDraft) {
    return nothing;
  }
  const draft = props.enterpriseSubmissionDraft;
  const expanded = props.enterpriseSubmissionExpanded === true;
  const reasonLines = props.enterpriseSubmissionReasonLines ?? [];
  return html`
    <div class="quick-capability-save-modal" role="dialog" aria-modal="true">
      <div class="quick-capability-save-modal__panel">
        <header class="quick-capability-save-modal__header">
          <h2>提交企业资产包</h2>
          <button
            type="button"
            aria-label="关闭"
            ?disabled=${props.enterpriseSubmissionBusy}
            @click=${props.onCancelEnterpriseSubmission}
          >
            ×
          </button>
        </header>
        <section class="quick-capability-save-modal__hint" aria-label="提交说明">
          <strong>${expanded ? "你可以继续微调自动补齐结果" : "系统已自动补齐企业提交信息，请先确认"}</strong>
          <p>企业管理员会基于业务场景、执行方式、依赖项和风险标签来决定是否审核通过、是否要求企业托管凭证，以及是否进入孵化。</p>
        </section>
        ${
          props.enterpriseSubmissionError
            ? html`<p class="quick-capability-save-modal__error" role="alert">${props.enterpriseSubmissionError}</p>`
            : nothing
        }
        ${
          expanded
            ? html`
                <label class="quick-capability-save-modal__field">
                  <span>资产包名称</span>
                  <input
                    type="text"
                    .value=${draft.packageTitle}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @input=${(event: InputEvent) =>
                      props.onEnterpriseSubmissionChange?.({
                        packageTitle: (event.target as HTMLInputElement).value,
                      })}
                  />
                </label>
                <label class="quick-capability-save-modal__field">
                  <span>资产包简介</span>
                  <textarea
                    .value=${draft.packageSummary}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @input=${(event: InputEvent) =>
                      props.onEnterpriseSubmissionChange?.({
                        packageSummary: (event.target as HTMLTextAreaElement).value,
                      })}
                  ></textarea>
                </label>
                <label class="quick-capability-save-modal__field">
                  <span>资产包类型</span>
                  <select
                    .value=${draft.assetPackageType}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @change=${(event: Event) =>
                      props.onEnterpriseSubmissionChange?.({
                        assetPackageType: (event.target as HTMLSelectElement)
                          .value as EnterpriseAssetPackageType,
                      })}
                  >
                    ${PACKAGE_TYPE_OPTIONS.map(
                      (option) => html`<option value=${option.value}>${option.label}</option>`,
                    )}
                  </select>
                </label>
                <label class="quick-capability-save-modal__field">
                  <span>业务场景</span>
                  <textarea
                    .value=${draft.businessScenario}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @input=${(event: InputEvent) =>
                      props.onEnterpriseSubmissionChange?.({
                        businessScenario: (event.target as HTMLTextAreaElement).value,
                      })}
                  ></textarea>
                </label>
                <label class="quick-capability-save-modal__field">
                  <span>输入物（每行一项）</span>
                  <textarea
                    .value=${linesValue(draft.inputArtifacts)}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @input=${(event: InputEvent) =>
                      props.onEnterpriseSubmissionChange?.({
                        inputArtifacts: parseLines((event.target as HTMLTextAreaElement).value),
                      })}
                  ></textarea>
                </label>
                <label class="quick-capability-save-modal__field">
                  <span>输出物（每行一项）</span>
                  <textarea
                    .value=${linesValue(draft.outputArtifacts)}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @input=${(event: InputEvent) =>
                      props.onEnterpriseSubmissionChange?.({
                        outputArtifacts: parseLines((event.target as HTMLTextAreaElement).value),
                      })}
                  ></textarea>
                </label>
                <label class="quick-capability-save-modal__field">
                  <span>依赖项（每行一项）</span>
                  <textarea
                    .value=${linesValue(draft.dependencies)}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @input=${(event: InputEvent) =>
                      props.onEnterpriseSubmissionChange?.({
                        dependencies: parseLines((event.target as HTMLTextAreaElement).value),
                      })}
                  ></textarea>
                </label>
                <label class="quick-capability-save-modal__field">
                  <span>执行方式</span>
                  <select
                    .value=${draft.executionMode}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @change=${(event: Event) =>
                      props.onEnterpriseSubmissionChange?.({
                        executionMode: (event.target as HTMLSelectElement)
                          .value as EnterpriseAssetExecutionMode,
                      })}
                  >
                    ${EXECUTION_MODE_OPTIONS.map(
                      (option) => html`<option value=${option.value}>${option.label}</option>`,
                    )}
                  </select>
                </label>
                <fieldset class="quick-capability-save-modal__field">
                  <span>风险标签</span>
                  <div class="quick-capability-save-modal__visibility">
                    ${RISK_TAG_OPTIONS.map(
                      (option) => html`
                        <label class="quick-capability-save-modal__option">
                          <input
                            type="checkbox"
                            .checked=${draft.riskTags.includes(option.value)}
                            ?disabled=${props.enterpriseSubmissionBusy}
                            @change=${(event: Event) => {
                              const checked = (event.target as HTMLInputElement).checked;
                              const next = checked
                                ? [...draft.riskTags, option.value]
                                : draft.riskTags.filter((entry) => entry !== option.value);
                              props.onEnterpriseSubmissionChange?.({
                                riskTags: [...new Set(next)],
                              });
                            }}
                          />
                          <span>${option.label}</span>
                        </label>
                      `,
                    )}
                  </div>
                </fieldset>
                <label class="quick-capability-save-modal__field">
                  <span>适用团队（每行一项）</span>
                  <textarea
                    .value=${linesValue(draft.targetTeams)}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @input=${(event: InputEvent) =>
                      props.onEnterpriseSubmissionChange?.({
                        targetTeams: parseLines((event.target as HTMLTextAreaElement).value),
                      })}
                  ></textarea>
                </label>
                <label class="quick-capability-save-modal__field">
                  <span>补充说明</span>
                  <textarea
                    .value=${draft.notes}
                    ?disabled=${props.enterpriseSubmissionBusy}
                    @input=${(event: InputEvent) =>
                      props.onEnterpriseSubmissionChange?.({
                        notes: (event.target as HTMLTextAreaElement).value,
                      })}
                  ></textarea>
                </label>
                <div class="quick-capability-save-modal__visibility">
                  <label class="quick-capability-save-modal__option">
                    <input
                      type="checkbox"
                      .checked=${draft.verifiedInProduction}
                      ?disabled=${props.enterpriseSubmissionBusy}
                      @change=${(event: Event) =>
                        props.onEnterpriseSubmissionChange?.({
                          verifiedInProduction: (event.target as HTMLInputElement).checked,
                        })}
                    />
                    <span>已在真实业务中验证</span>
                  </label>
                  <label class="quick-capability-save-modal__option">
                    <input
                      type="checkbox"
                      .checked=${draft.needsEnterpriseSecrets}
                      ?disabled=${props.enterpriseSubmissionBusy}
                      @change=${(event: Event) =>
                        props.onEnterpriseSubmissionChange?.({
                          needsEnterpriseSecrets: (event.target as HTMLInputElement).checked,
                        })}
                    />
                    <span>需要企业托管凭证</span>
                  </label>
                </div>
              `
            : html`
                <section class="quick-capability-save-modal__field" aria-label="自动补齐结果预览">
                  <span>资产包名称</span>
                  <strong>${draft.packageTitle}</strong>
                </section>
                <section class="quick-capability-save-modal__field" aria-label="资产包简介">
                  <span>资产包简介</span>
                  <div>${draft.packageSummary}</div>
                </section>
                <section class="quick-capability-save-modal__field" aria-label="自动补齐要点">
                  <span>自动补齐要点</span>
                  <div class="quick-capability-save-modal__visibility">
                    <span class="quick-capability-save-modal__option">${packageTypeLabel(draft.assetPackageType)}</span>
                    <span class="quick-capability-save-modal__option">${executionModeLabel(draft.executionMode)}</span>
                    <span class="quick-capability-save-modal__option">${draft.verifiedInProduction ? "已验证" : "待验证"}</span>
                    <span class="quick-capability-save-modal__option">${draft.needsEnterpriseSecrets ? "需要企业托管凭证" : "无需企业托管凭证"}</span>
                  </div>
                </section>
                <section class="quick-capability-save-modal__field" aria-label="业务场景">
                  <span>业务场景</span>
                  <div>${draft.businessScenario}</div>
                </section>
                <section class="quick-capability-save-modal__field" aria-label="输入输出摘要">
                  <span>输入与输出</span>
                  <div>输入：${draft.inputArtifacts.join("、") || "未补齐"}</div>
                  <div>输出：${draft.outputArtifacts.join("、") || "未补齐"}</div>
                </section>
                <section class="quick-capability-save-modal__field" aria-label="依赖与风险">
                  <span>依赖与风险</span>
                  <div>依赖：${draft.dependencies.join("、") || "未补齐"}</div>
                  <div>风险：${draft.riskTags.map(riskTagLabel).join("、") || "未标记"}</div>
                </section>
                <section class="quick-capability-save-modal__field" aria-label="适用团队">
                  <span>适用团队</span>
                  <div>${draft.targetTeams.join("、") || "未补齐"}</div>
                </section>
                ${
                  reasonLines.length > 0
                    ? html`
                        <section class="quick-capability-save-modal__field" aria-label="系统判断依据">
                          <span>系统判断依据</span>
                          <ul>
                            ${reasonLines.map((line) => html`<li>${line}</li>`)}
                          </ul>
                        </section>
                      `
                    : nothing
                }
                ${
                  draft.notes
                    ? html`
                        <section class="quick-capability-save-modal__field" aria-label="补充说明">
                          <span>补充说明</span>
                          <div>${draft.notes}</div>
                        </section>
                      `
                    : nothing
                }
              `
        }
        <footer class="quick-capability-save-modal__actions">
          <button
            type="button"
            ?disabled=${props.enterpriseSubmissionBusy}
            @click=${props.onCancelEnterpriseSubmission}
          >
            取消
          </button>
          <button
            type="button"
            ?disabled=${props.enterpriseSubmissionBusy}
            @click=${expanded ? props.onCloseEnterpriseSubmissionEditor : props.onOpenEnterpriseSubmissionEditor}
          >
            ${expanded ? "返回确认视图" : "展开编辑"}
          </button>
          <button
            type="button"
            ?disabled=${props.enterpriseSubmissionBusy}
            @click=${props.onConfirmEnterpriseSubmission}
          >
            ${props.enterpriseSubmissionBusy ? "提交中…" : "提交企业"}
          </button>
        </footer>
      </div>
    </div>
  `;
}

export function renderMyAccumulation(props: MyAccumulationProps): TemplateResult {
  const draftCount = filterItemsBySegment(props.items, "drafts").length;
  const reviewingCount = filterItemsBySegment(props.items, "reviewing").length;
  const enterpriseCount = filterItemsBySegment(props.items, "contributed").length;
  const optimizeCount = filterItemsBySegment(props.items, "optimize").length;
  const activeSegment = props.activeSegment ?? (props.showDraftsOnly ? "drafts" : "all");
  const activeListTitle =
    activeSegment === "drafts"
      ? "资产草稿"
      : activeSegment === "reviewing"
        ? "审核中"
        : activeSegment === "contributed"
          ? "已入企业"
          : activeSegment === "optimize"
            ? "需优化"
            : "资产列表";
  const visibleItems = filterItemsBySegment(props.items, activeSegment);
  const hasSearch = props.searchQuery.trim().length > 0;
  const emptyCopy = emptyStateCopy(activeSegment, hasSearch);
  const showPendingDepositCandidate =
    activeSegment === "drafts" &&
    props.assetSuggestionVisible &&
    props.canDepositFromContext &&
    Boolean(props.onOpenSkillSave);
  const showReviewRail =
    activeSegment === "all" &&
    (Boolean(props.assetWeeklyDigest?.entries.length) ||
      visibleAssetReviewSuggestions(props).length > 0);
  const hasSuggestionRail = showReviewRail || showPendingDepositCandidate;

  return html`
    <section class="my-accumulation my-accumulation--flat" aria-label="我的资产">
      <header class="my-accumulation__header">
        <h1 class="my-accumulation__sr-title">我的资产</h1>

        ${
          props.installTargetRobotId
            ? html`
                <div class="callout my-accumulation__install-target" role="status">
                  安装到：<strong>${props.installTargetRobotLabel || props.installTargetRobotId}</strong>
                  · 在下方选择要安装到该机器人的能力
                </div>
              `
            : nothing
        }

        <div class="my-accumulation__navigation-row">
          <nav class="my-accumulation__segments" aria-label="资产分段">
            ${renderSegmentButton(
              "全部",
              activeSegment === "all",
              props.items.length,
              canSelectSegment(props, "all") ? () => selectSegment(props, "all") : null,
            )}
            ${renderSegmentButton(
              "草稿",
              activeSegment === "drafts",
              draftCount,
              canSelectSegment(props, "drafts") ? () => selectSegment(props, "drafts") : null,
            )}
            ${renderSegmentButton(
              "审核中",
              activeSegment === "reviewing",
              reviewingCount,
              canSelectSegment(props, "reviewing") ? () => selectSegment(props, "reviewing") : null,
            )}
            ${renderSegmentButton(
              "已入企业",
              activeSegment === "contributed",
              enterpriseCount,
              canSelectSegment(props, "contributed")
                ? () => selectSegment(props, "contributed")
                : null,
            )}
            ${renderSegmentButton(
              "需优化",
              activeSegment === "optimize",
              optimizeCount,
              canSelectSegment(props, "optimize") ? () => selectSegment(props, "optimize") : null,
            )}
          </nav>
          <label class="my-accumulation__filter my-accumulation__filter--search">
            <span class="my-accumulation__sr-title">搜索资产</span>
            <input
              aria-label="搜索资产"
              .value=${props.searchQuery}
              placeholder="搜索名称、说明或你记得的关键词"
              @input=${(event: Event) =>
                props.onSearchChange((event.target as HTMLInputElement).value)}
            />
          </label>
        </div>
      </header>

      ${props.error ? html`<p class="my-accumulation__error">${props.error}</p>` : nothing}
      ${
        props.loading
          ? html`
              <p class="my-accumulation__loading">正在加载我的资产</p>
            `
          : nothing
      }

      <div class="my-accumulation__body">
        ${
          hasSuggestionRail
            ? html`
                <section class="my-accumulation__suggestions" aria-label="整理建议">
                  <h2 class="my-accumulation__suggestions-title">整理建议</h2>
                  ${showReviewRail ? renderWeeklyDigestCard(props) : nothing}
                  ${showReviewRail ? renderAssetReviewSuggestionCards(props) : nothing}
                  ${showPendingDepositCandidate ? renderPendingDepositCard(props) : nothing}
                </section>
              `
            : nothing
        }
        <section class="my-accumulation__list-panel">
          <h2 id="my-asset-list-title" class="my-accumulation__sr-title">${activeListTitle}</h2>
          <div class="my-accumulation__list">
            ${
              visibleItems.length > 0
                ? visibleItems.map((item) => renderListItem(item, props))
                : html`
                    <div class="my-accumulation__empty-state">
                      <strong>${emptyCopy.title}</strong>
                      <p>${emptyCopy.body}</p>
                    </div>
                  `
            }
          </div>
        </section>
      </div>

      ${renderCapabilityUsageBriefPanel({
        usage: props.pendingUsageBrief,
        loading: false,
        actionLabel: props.pendingUsageBriefIntent === "delete" ? "删除" : "编辑",
        onOpenRobot: props.onOpenRobot,
        onConfirm: props.onConfirmUsageBrief,
        onCancel: props.onCancelUsageBrief,
      })}
      ${renderEnterpriseSubmissionModal(props)}
    </section>
  `;
}
