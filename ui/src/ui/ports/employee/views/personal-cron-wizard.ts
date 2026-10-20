import { html, nothing } from "lit";
import type { CronJob } from "../../../types.ts";
import type { CronFormState } from "../../../ui-types.ts";
import type { CronProps } from "../../../views/cron.ts";
import {
  formatPersonalCronScheduleLabel,
  resolvePersonalCronExecutionTarget,
} from "./personal-cron-center.helpers.ts";
import {
  buildDataBindingPickerItems,
  canAutoRepairWizardDataBindings,
  createDataBindingFromPickerItem,
  diagnoseWizardDataBindings,
  formatDataBindingInsertNotice,
  formatTemplateBindingPreview,
  formatTemplateIntegrityBadge,
  insertDataBindingIntoIntent,
  issueSupportsKnowledgeNavigation,
  listActiveDataBindings,
  listLegacyPromptTokens,
  resolveIssueKnowledgeNavigation,
  scoreTemplateDataBindings,
  scoreWizardDataBindings,
  summarizeTemplateDataBindings,
  upsertDataBinding,
} from "./personal-cron-data-bindings.ts";
import {
  compileTaskPrompt,
  inferDescriptionFromIntent,
  lintTaskDraft,
  type TaskQualityLint,
} from "./personal-cron-task-compiler.ts";
import {
  applyMetaToCronForm,
  categoryLabel,
  DEFAULT_PERSONAL_CRON_TASK_META,
  PERSONAL_CRON_CATEGORY_OPTIONS,
  type PersonalCronTaskMeta,
  inferSchedulePresetFromForm,
  parsePersonalCronTaskMeta,
  parseCompiledPromptFromPayload,
  priorityLabel,
} from "./personal-cron-task-meta.ts";
import {
  applyTemplateToWizardMeta,
  BUILTIN_PERSONAL_CRON_TEMPLATES,
  type PersonalCronTaskTemplate,
} from "./personal-cron-task-templates.ts";

/** Step 0 = 创建方式；1–7 = 配置与确认 */
export const WIZARD_STEP_COUNT = 6;

export const WIZARD_STEPS = [
  { id: 0, title: "创建方式", newOnly: true },
  { id: 1, title: "基本信息" },
  { id: 2, title: "时间触发" },
  { id: 3, title: "任务与执行" },
  { id: 4, title: "目标验收" },
  { id: 5, title: "通知设置" },
  { id: 6, title: "确认创建" },
] as const;

export type CronWizardCreateMode = "blank" | "template" | "copy";

export type CronWizardState = {
  step: number;
  /** 向导内持久化的任务名称，避免步骤切换时父级 form 尚未刷新导致丢失 */
  taskName: string;
  meta: PersonalCronTaskMeta;
  visibleDescription: string;
  userIntent: string;
  showAdvancedCron: boolean;
  submitAttempted: boolean;
  createMode: CronWizardCreateMode;
  selectedTemplateId: string | null;
  selectedCopyJobId: string | null;
  noticeMessage: string | null;
  polishSummary: string | null;
  /** 创建成功后自动存为个人模板 */
  autoSavePersonalTemplate: boolean;
  /** 创建成功后同步到团队模板库 */
  syncTeamTemplate: boolean;
  recommendSummary: string | null;
  aiBusy: boolean;
  /** 是否展开「插入数据源」面板 */
  dataBindingsPanelOpen: boolean;
  /** 是否已尝试过旧版占位符一键迁移 */
  legacyMigrationAttempted: boolean;
};

export type CreateWizardOptions = {
  isEditing?: boolean;
  startAtTemplate?: boolean;
};

export function createWizardStateFromForm(
  form: CronFormState,
  options: CreateWizardOptions = {},
): CronWizardState {
  const parsed = parsePersonalCronTaskMeta(form.description);
  const hasStoredMeta = (form.description ?? "").includes("<!--openbot-task-meta:");
  const schedulePreset = hasStoredMeta
    ? parsed.meta.schedulePreset
    : inferSchedulePresetFromForm(form);
  const fromPayload = parseCompiledPromptFromPayload(form.payloadText);
  const userIntent = parsed.meta.intentText.trim() || fromPayload.intentText;

  return {
    step: options.isEditing ? 1 : options.startAtTemplate ? 0 : 0,
    taskName: form.name,
    meta: {
      ...parsed.meta,
      schedulePreset,
      goal: parsed.meta.goal || fromPayload.goal,
      acceptanceRules:
        parsed.meta.acceptanceRules.length > 0
          ? parsed.meta.acceptanceRules
          : fromPayload.acceptanceRules,
      selectedAgents:
        parsed.meta.selectedAgents.length > 0
          ? parsed.meta.selectedAgents
          : form.agentId
            ? [form.agentId]
            : [],
      selectedGroups:
        parsed.meta.selectedGroups.length > 0
          ? parsed.meta.selectedGroups
          : form.sessionKey
            ? [form.sessionKey]
            : [],
    },
    visibleDescription: parsed.visibleDescription,
    userIntent,
    showAdvancedCron: schedulePreset === "custom" || form.scheduleKind === "cron",
    submitAttempted: false,
    createMode: options.startAtTemplate ? "template" : "blank",
    selectedTemplateId: null,
    selectedCopyJobId: null,
    noticeMessage: null,
    polishSummary: null,
    recommendSummary: null,
    autoSavePersonalTemplate: !options.isEditing,
    syncTeamTemplate: false,
    aiBusy: false,
    dataBindingsPanelOpen: false,
    legacyMigrationAttempted: false,
  };
}

export function applyTemplateToWizardState(
  wizard: CronWizardState,
  template: PersonalCronTaskTemplate,
): CronWizardState {
  return {
    ...wizard,
    createMode: "template",
    selectedTemplateId: template.id,
    userIntent: template.intentText,
    visibleDescription: template.summary,
    meta: applyTemplateToWizardMeta(template, wizard.meta),
  };
}

export function applyCopyJobToWizardState(wizard: CronWizardState, job: CronJob): CronWizardState {
  const parsed = parsePersonalCronTaskMeta(job.description);
  const fromPayload = parseCompiledPromptFromPayload(
    job.payload.kind === "agentTurn" ? (job.payload.message ?? "") : "",
  );
  return {
    ...wizard,
    createMode: "copy",
    selectedCopyJobId: job.id,
    userIntent: parsed.meta.intentText || fromPayload.intentText,
    visibleDescription: parsed.visibleDescription || fromPayload.intentText.slice(0, 120),
    meta: {
      ...parsed.meta,
      selectedAgents: job.agentId ? [job.agentId] : parsed.meta.selectedAgents,
      selectedGroups: job.sessionKey ? [job.sessionKey] : parsed.meta.selectedGroups,
    },
  };
}

export function resolveWizardTaskName(wizard: CronWizardState, form: CronFormState): string {
  return wizard.taskName.trim() ? wizard.taskName : form.name;
}

export function resolveWizardStepBlockers(
  step: number,
  form: CronFormState,
  wizard: CronWizardState,
): TaskQualityLint[] {
  const meta = wizard.meta;
  const taskName = resolveWizardTaskName(wizard, form);
  const hasSchedule =
    meta.schedulePreset === "once"
      ? Boolean(form.scheduleAt.trim()) && Number.isFinite(Date.parse(form.scheduleAt))
      : meta.schedulePreset === "custom"
        ? Boolean(form.cronExpr.trim())
        : true;

  const blockers = lintTaskDraft({
    intentText: wizard.userIntent,
    meta,
    taskName,
    hasSchedule,
  }).filter((item) => item.level === "error" && item.step === step);

  if (
    step === 2 &&
    meta.schedulePreset === "once" &&
    form.scheduleAt.trim() &&
    !Number.isFinite(Date.parse(form.scheduleAt))
  ) {
    blockers.push({ level: "error", message: "执行时间格式无效", step: 2 });
  }

  return blockers;
}

export function syncWizardToForm(
  wizard: CronWizardState,
  form: CronFormState,
): Partial<CronFormState> {
  const taskName = resolveWizardTaskName(wizard, form);
  const metaWithIntent = { ...wizard.meta, intentText: wizard.userIntent.trim() };
  const compiled = compileTaskPrompt({
    intentText: wizard.userIntent,
    meta: metaWithIntent,
    taskName,
  });
  return {
    ...applyMetaToCronForm(form, metaWithIntent, wizard.visibleDescription),
    name: taskName,
    payloadText: compiled.message,
    enabled: form.enabled,
  };
}

function renderStepNav(step: number, isEditing: boolean) {
  const steps = WIZARD_STEPS.filter((item) => !isEditing || item.id > 0);
  return html`
    <nav class="employee-cron-wizard__steps" aria-label="新建任务步骤">
      ${steps.map(
        (item) => html`
          <div
            class="employee-cron-wizard__step ${
              item.id === step ? "is-active" : item.id < step ? "is-done" : ""
            }"
          >
            <span class="employee-cron-wizard__step-index">${item.id === 0 ? "★" : String(item.id)}</span>
            <span class="employee-cron-wizard__step-label">${item.title}</span>
          </div>
        `,
      )}
    </nav>
  `;
}

function renderField(
  label: string,
  body: unknown,
  hint?: string,
  inlineHint?: string,
  headExtra?: unknown,
) {
  return html`
    <label class="employee-cron-wizard__field">
      <span class="employee-cron-wizard__field-head">
        <span class="employee-cron-wizard__field-head-main">
          <span class="employee-cron-wizard__label">${label}</span>
          ${
            inlineHint
              ? html`<span class="employee-cron-wizard__hint employee-cron-wizard__hint--inline">${inlineHint}</span>`
              : nothing
          }
        </span>
        ${headExtra ?? nothing}
      </span>
      ${body}
      ${hint ? html`<span class="employee-cron-wizard__hint">${hint}</span>` : nothing}
    </label>
  `;
}

function renderStep0(params: {
  wizard: CronWizardState;
  jobs: CronJob[];
  personalTemplates: PersonalCronTaskTemplate[];
  teamTemplates: PersonalCronTaskTemplate[];
  teamTemplateSyncAvailable: boolean;
  executionAgents: Array<{ id: string; label: string }>;
  executionGroups: Array<{ sessionKey: string; label: string }>;
  dataCapabilities: NonNullable<CronProps["dataCapabilities"]>;
  personalKnowledge: NonNullable<CronProps["personalKnowledgeSources"]>;
  enterpriseKnowledge: NonNullable<CronProps["enterpriseKnowledgeSources"]>;
  onWizardChange: (patch: Partial<CronWizardState>) => void;
  onApplyTemplate: (template: PersonalCronTaskTemplate) => void;
  onApplyCopy: (job: CronJob) => void;
  onDeletePersonalTemplate: (templateId: string) => void;
  onDeleteTeamTemplate: (templateId: string) => void;
}) {
  const {
    wizard,
    jobs,
    personalTemplates,
    teamTemplates,
    teamTemplateSyncAvailable,
    executionAgents,
    executionGroups,
    dataCapabilities,
    personalKnowledge,
    enterpriseKnowledge,
    onWizardChange,
    onApplyTemplate,
    onApplyCopy,
    onDeletePersonalTemplate,
    onDeleteTeamTemplate,
  } = params;
  const mode = wizard.createMode;

  const catalogParams = {
    dataCapabilities,
    personalKnowledge,
    enterpriseKnowledge,
  };

  const renderTemplateButton = (
    item: PersonalCronTaskTemplate,
    deletable: boolean,
    onDelete: (id: string) => void,
  ) => {
    const bindingPreview = formatTemplateBindingPreview(item);
    const bindingTags = summarizeTemplateDataBindings(item);
    const templateScore = scoreTemplateDataBindings({ template: item, ...catalogParams });
    const integrityBadge = formatTemplateIntegrityBadge(templateScore);
    const integrityGrade = templateScore.grade;
    return html`
    <div
      class="employee-cron-wizard__template ${wizard.selectedTemplateId === item.id ? "is-active" : ""}"
    >
      <button type="button" class="employee-cron-wizard__template-main" @click=${() => onApplyTemplate(item)}>
        ${
          deletable
            ? html`
                <span class="employee-cron-wizard__template-name">${item.name}</span>
                <span class="employee-cron-wizard__template-summary">${item.summary}</span>
              `
            : html`
                <span class="employee-cron-wizard__template-head">
                  <span class="employee-cron-wizard__template-name">${item.name}</span>
                  <span class="employee-cron-wizard__template-tag">${categoryLabel(item.category)}</span>
                </span>
                <span class="employee-cron-wizard__template-summary">${item.summary}</span>
              `
        }
        ${
          integrityBadge
            ? html`
                <span
                  class="employee-cron-wizard__template-integrity employee-cron-wizard__template-integrity--${integrityGrade.toLowerCase()}"
                >
                  ${integrityBadge}
                </span>
              `
            : nothing
        }
        ${
          bindingPreview
            ? html`
                <span class="employee-cron-wizard__template-binding-preview">${bindingPreview}</span>
                <span class="employee-cron-wizard__template-binding-tags">
                  ${bindingTags.map(
                    (binding) => html`
                      <span class="employee-cron-wizard__template-binding-tag">${binding.label}</span>
                    `,
                  )}
                </span>
              `
            : nothing
        }
      </button>
      ${
        deletable
          ? html`
              <div class="employee-cron-wizard__template-aside">
                <span class="employee-cron-wizard__template-tag">${categoryLabel(item.category)}</span>
                <button
                  type="button"
                  class="employee-cron-wizard__template-delete btn btn--sm"
                  @click=${() => onDelete(item.id)}
                >
                  删除
                </button>
              </div>
            `
          : nothing
      }
    </div>
  `;
  };

  return html`
    ${renderField(
      "选择创建方式",
      html`
        <div class="employee-cron-wizard__cards employee-cron-wizard__cards--mode">
          ${(
            [
              ["blank", "空白创建"],
              ["template", "任务模板"],
              ["copy", "复制已有"],
            ] as const
          ).map(
            ([value, label]) => html`
              <button
                type="button"
                class="employee-cron-wizard__card employee-cron-wizard__card--mode ${
                  mode === value ? "is-active" : ""
                }"
                @click=${() => onWizardChange({ createMode: value })}
              >
                ${label}
              </button>
            `,
          )}
        </div>
      `,
    )}
    ${
      mode === "template"
        ? html`
            <div class="employee-cron-wizard__template-section">
              <div class="employee-cron-wizard__label">系统推荐</div>
              <div class="employee-cron-wizard__hint">内置预设，点击套用；不可编辑或删除。</div>
              <div class="employee-cron-wizard__template-list">
                ${BUILTIN_PERSONAL_CRON_TEMPLATES.map((item) => renderTemplateButton(item, false, () => {}))}
              </div>
            </div>
            ${
              personalTemplates.length > 0
                ? html`
                    <div class="employee-cron-wizard__template-section">
                      <div class="employee-cron-wizard__label">我的模板</div>
                      <div class="employee-cron-wizard__hint">
                        保存在本浏览器；点击套用后可修改，在确认页「存为模板」可更新。
                      </div>
                      <div class="employee-cron-wizard__template-list">
                        ${personalTemplates.map((item) => renderTemplateButton(item, true, onDeletePersonalTemplate))}
                      </div>
                    </div>
                  `
                : html`
                    <div class="employee-cron-wizard__hint">暂无个人模板。完成配置后可在「确认创建」页存为模板。</div>
                  `
            }
            ${
              teamTemplateSyncAvailable && teamTemplates.length > 0
                ? html`
                    <div class="employee-cron-wizard__template-section">
                      <div class="employee-cron-wizard__label">团队模板</div>
                      <div class="employee-cron-wizard__hint">
                        来自服务端团队模板库（Gateway）；可删除，修改需重新保存同步。
                      </div>
                      <div class="employee-cron-wizard__template-list">
                        ${teamTemplates.map((item) => renderTemplateButton(item, true, onDeleteTeamTemplate))}
                      </div>
                    </div>
                  `
                : teamTemplateSyncAvailable
                  ? html`
                      <div class="employee-cron-wizard__hint">暂无团队模板。创建任务时可勾选「同步到团队模板库」。</div>
                    `
                  : nothing
            }
            ${
              wizard.selectedTemplateId
                ? (() => {
                    const selected =
                      BUILTIN_PERSONAL_CRON_TEMPLATES.find(
                        (item) => item.id === wizard.selectedTemplateId,
                      ) ??
                      personalTemplates.find((item) => item.id === wizard.selectedTemplateId) ??
                      teamTemplates.find((item) => item.id === wizard.selectedTemplateId);
                    if (!selected) {
                      return nothing;
                    }
                    const bindings = summarizeTemplateDataBindings(selected);
                    return html`
                      <div class="employee-cron-wizard__template-preview">
                        <div class="employee-cron-wizard__label">模板预览 · ${selected.name}</div>
                        <div class="employee-cron-wizard__hint">${selected.summary}</div>
                        ${
                          bindings.length > 0
                            ? html`
                                <div class="employee-cron-wizard__template-preview-bindings">
                                  ${bindings.map(
                                    (binding) => html`
                                      <span class="employee-cron-wizard__template-binding-tag">${binding.label}</span>
                                    `,
                                  )}
                                </div>
                              `
                            : html`
                                <div class="employee-cron-wizard__hint">此模板未预置数据源绑定。</div>
                              `
                        }
                      </div>
                    `;
                  })()
                : nothing
            }
          `
        : nothing
    }
    ${
      mode === "copy"
        ? html`
            <div class="employee-cron-wizard__copy-section">
              <div class="employee-cron-wizard__label">选择要复制的任务</div>
              ${
                jobs.length === 0
                  ? html`
                      <div class="employee-cron-wizard__hint">暂无历史任务可复制，请先创建或使用模板。</div>
                    `
                  : html`
                      <div class="employee-cron-wizard__copy-list">
                        ${jobs.slice(0, 12).map((job) => {
                          const target = resolvePersonalCronExecutionTarget(job, {
                            agents: executionAgents,
                            groups: executionGroups,
                          });
                          const schedule = formatPersonalCronScheduleLabel(job);
                          const selected = wizard.selectedCopyJobId === job.id;
                          return html`
                            <button
                              type="button"
                              class="employee-cron-wizard__copy-item ${selected ? "is-active" : ""}"
                              @click=${() => onApplyCopy(job)}
                            >
                              <span class="employee-cron-wizard__copy-item-indicator" aria-hidden="true"></span>
                              <span class="employee-cron-wizard__copy-item-main">
                                <span class="employee-cron-wizard__copy-item-name">${job.name}</span>
                                <span class="employee-cron-wizard__copy-item-meta">${schedule}</span>
                              </span>
                              <span class="employee-cron-wizard__copy-item-badge">${target.label}</span>
                            </button>
                          `;
                        })}
                      </div>
                    `
              }
            </div>
          `
        : nothing
    }
  `;
}

export function renderPersonalCronWizard(params: {
  props: CronProps;
  wizard: CronWizardState;
  isEditing: boolean;
  personalTemplates: PersonalCronTaskTemplate[];
  teamTemplates: PersonalCronTaskTemplate[];
  onWizardChange: (patch: Partial<CronWizardState>) => void;
  onMetaChange: (patch: Partial<PersonalCronTaskMeta>) => void;
  onFormPatch: (patch: Partial<CronFormState>) => void;
  onApplyTemplate: (template: PersonalCronTaskTemplate) => void;
  onApplyCopy: (job: CronJob) => void;
  onDeletePersonalTemplate: (templateId: string) => void;
  onDeleteTeamTemplate: (templateId: string) => void;
  onSmartComplete: () => void;
  onRecommendAgent: () => void;
  onPolishPrompt: () => void;
  onSaveAsTemplate: () => void;
  onMigrateLegacyBindings: () => void;
  onRepairDataBindings: () => void;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  const {
    props,
    wizard,
    isEditing,
    personalTemplates,
    teamTemplates,
    onWizardChange,
    onMetaChange,
    onFormPatch,
    onApplyTemplate,
    onApplyCopy,
    onDeletePersonalTemplate,
    onDeleteTeamTemplate,
    onSmartComplete,
    onRecommendAgent,
    onPolishPrompt,
    onSaveAsTemplate,
    onMigrateLegacyBindings,
    onRepairDataBindings,
    onBack,
    onNext,
    onSubmit,
  } = params;
  const form = props.form;
  const meta = wizard.meta;
  const executionAgents = (props.executionAgents ?? []).filter((entry) => entry.source === "owned");
  const executionGroups = props.executionGroups ?? [];
  const agentOptions =
    executionAgents.length > 0
      ? executionAgents
      : props.agentSuggestions.map((label) => ({
          id: label,
          label,
          emoji: null,
          source: "owned" as const,
        }));
  const dataBindingItems = buildDataBindingPickerItems({
    dataCapabilities: props.dataCapabilities ?? [],
    personalKnowledge: props.personalKnowledgeSources ?? [],
    enterpriseKnowledge: props.enterpriseKnowledgeSources ?? [],
    enterpriseRestrictedKnowledge: props.enterpriseRestrictedKnowledgeSources ?? [],
  });
  const activeBindings = listActiveDataBindings(meta.dataBindings);
  const bindingDiagnostics = diagnoseWizardDataBindings({
    intentText: wizard.userIntent,
    dataBindings: meta.dataBindings,
    dataCapabilities: props.dataCapabilities ?? [],
    personalKnowledge: props.personalKnowledgeSources ?? [],
    enterpriseKnowledge: props.enterpriseKnowledgeSources ?? [],
  });
  const bindingIntegrity = scoreWizardDataBindings({
    intentText: wizard.userIntent,
    dataBindings: meta.dataBindings,
    dataCapabilities: props.dataCapabilities ?? [],
    personalKnowledge: props.personalKnowledgeSources ?? [],
    enterpriseKnowledge: props.enterpriseKnowledgeSources ?? [],
  });
  const canRepairBindings = canAutoRepairWizardDataBindings({
    intentText: wizard.userIntent,
    dataBindings: meta.dataBindings,
    dataCapabilities: props.dataCapabilities ?? [],
    personalKnowledge: props.personalKnowledgeSources ?? [],
    enterpriseKnowledge: props.enterpriseKnowledgeSources ?? [],
  });
  const legacyTokens = listLegacyPromptTokens(wizard.userIntent);
  const grantedCapabilityCount = (props.dataCapabilities ?? []).filter(
    (item) => item.accessState === "granted",
  ).length;
  const dataBindingsPanelOpen =
    wizard.dataBindingsPanelOpen ||
    activeBindings.length > 0 ||
    bindingDiagnostics.length > 0 ||
    (legacyTokens.length > 0 && wizard.legacyMigrationAttempted);
  const step = wizard.step;
  const isLast = step === WIZARD_STEP_COUNT;
  const taskName = resolveWizardTaskName(wizard, form);
  const compiledPreview = compileTaskPrompt({
    intentText: wizard.userIntent,
    meta: { ...meta, intentText: wizard.userIntent.trim() },
    taskName,
  });
  const qualityLint = lintTaskDraft({
    intentText: wizard.userIntent,
    meta,
    taskName,
    hasSchedule:
      meta.schedulePreset === "once"
        ? Boolean(form.scheduleAt.trim())
        : meta.schedulePreset === "custom"
          ? Boolean(form.cronExpr.trim())
          : true,
  });
  const blockingLint = qualityLint.filter((item) => item.level === "error");
  const stepBlockers =
    wizard.submitAttempted && step < WIZARD_STEP_COUNT
      ? resolveWizardStepBlockers(step, form, wizard)
      : wizard.submitAttempted && step === WIZARD_STEP_COUNT
        ? blockingLint
        : [];

  const stepBody = (() => {
    switch (step) {
      case 0:
        return renderStep0({
          wizard,
          jobs: props.jobs,
          personalTemplates,
          teamTemplates,
          teamTemplateSyncAvailable: props.teamTemplateSyncAvailable ?? false,
          executionAgents: agentOptions.map(({ id, label }) => ({ id, label })),
          executionGroups: executionGroups.map(({ sessionKey, label }) => ({ sessionKey, label })),
          dataCapabilities: props.dataCapabilities ?? [],
          personalKnowledge: props.personalKnowledgeSources ?? [],
          enterpriseKnowledge: props.enterpriseKnowledgeSources ?? [],
          onWizardChange,
          onApplyTemplate,
          onApplyCopy,
          onDeletePersonalTemplate,
          onDeleteTeamTemplate,
        });
      case 1:
        return html`
          ${renderField(
            "任务名称",
            html`
              <input
                class="employee-cron-wizard__input ${stepBlockers.length > 0 ? "is-invalid" : ""}"
                .value=${taskName}
                placeholder="例如：每日销售日报"
                @input=${(e: Event) => {
                  const name = (e.target as HTMLInputElement).value;
                  onWizardChange({ taskName: name });
                  onFormPatch({ name });
                }}
              />
              ${
                stepBlockers.length > 0
                  ? html`<span class="employee-cron-wizard__field-error">${stepBlockers[0]?.message ?? "请填写任务名称"}</span>`
                  : nothing
              }
            `,
          )}
          ${renderField(
            "任务分类",
            html`
              <select
                class="employee-cron-wizard__input"
                .value=${meta.category}
                @change=${(e: Event) =>
                  onMetaChange({
                    category: (e.target as HTMLSelectElement)
                      .value as PersonalCronTaskMeta["category"],
                  })}
              >
                ${PERSONAL_CRON_CATEGORY_OPTIONS.map(
                  (item) => html`<option value=${item.value}>${item.label}</option>`,
                )}
              </select>
            `,
            "用于模板推荐与验收规则生成",
          )}
          ${renderField(
            "优先级",
            html`
              <div class="employee-cron-wizard__segmented">
                ${(["low", "normal", "high"] as const).map(
                  (value) => html`
                    <button
                      type="button"
                      class="employee-cron-wizard__segment ${meta.priority === value ? "is-active" : ""}"
                      @click=${() => onMetaChange({ priority: value })}
                    >
                      ${priorityLabel(value)}
                    </button>
                  `,
                )}
              </div>
            `,
          )}
        `;
      case 2:
        return html`
          ${renderField(
            "触发方式",
            html`
              <div class="employee-cron-wizard__cards">
                ${(
                  [
                    ["once", "一次执行"],
                    ["daily", "每天"],
                    ["weekly", "每周"],
                    ["monthly", "每月"],
                    ["custom", "Cron 表达式"],
                  ] as const
                ).map(
                  ([value, label]) => html`
                    <button
                      type="button"
                      class="employee-cron-wizard__card ${
                        meta.schedulePreset === value ? "is-active" : ""
                      }"
                      @click=${() => {
                        onMetaChange({ schedulePreset: value });
                        if (value === "once") {
                          onFormPatch({ scheduleKind: "at" });
                        } else if (value === "custom") {
                          onFormPatch({ scheduleKind: "cron" });
                          onWizardChange({ showAdvancedCron: true });
                        } else {
                          onFormPatch({ scheduleKind: "cron" });
                        }
                      }}
                    >
                      ${label}
                    </button>
                  `,
                )}
              </div>
            `,
          )}
          ${
            meta.schedulePreset === "once"
              ? renderField(
                  "执行时间",
                  html`
                    <input
                      type="datetime-local"
                      class="employee-cron-wizard__input ${stepBlockers.length > 0 ? "is-invalid" : ""}"
                      .value=${form.scheduleAt}
                      @input=${(e: Event) =>
                        onFormPatch({ scheduleAt: (e.target as HTMLInputElement).value })}
                    />
                    ${
                      stepBlockers.length > 0
                        ? html`<span class="employee-cron-wizard__field-error">${stepBlockers[0]?.message ?? "请设置执行时间"}</span>`
                        : nothing
                    }
                  `,
                )
              : meta.schedulePreset === "custom"
                ? renderField(
                    "Cron 表达式",
                    html`
                      <input
                        class="employee-cron-wizard__input mono ${stepBlockers.length > 0 ? "is-invalid" : ""}"
                        .value=${form.cronExpr}
                        placeholder="0 9 * * *"
                        @input=${(e: Event) =>
                          onFormPatch({ cronExpr: (e.target as HTMLInputElement).value })}
                      />
                      ${
                        stepBlockers.length > 0
                          ? html`<span class="employee-cron-wizard__field-error">${stepBlockers[0]?.message ?? "请填写 Cron 表达式"}</span>`
                          : nothing
                      }
                    `,
                    "高级模式：五段式 Cron",
                  )
                : html`
                    ${renderField(
                      "执行时刻",
                      html`
                        <input
                          type="time"
                          class="employee-cron-wizard__input"
                          .value=${meta.dailyTime}
                          @input=${(e: Event) =>
                            onMetaChange({ dailyTime: (e.target as HTMLInputElement).value })}
                        />
                      `,
                    )}
                    ${
                      meta.schedulePreset === "weekly"
                        ? renderField(
                            "星期",
                            html`
                              <select
                                class="employee-cron-wizard__input"
                                .value=${meta.weeklyDay}
                                @change=${(e: Event) =>
                                  onMetaChange({
                                    weeklyDay: (e.target as HTMLSelectElement).value,
                                  })}
                              >
                                <option value="1">周一</option>
                                <option value="2">周二</option>
                                <option value="3">周三</option>
                                <option value="4">周四</option>
                                <option value="5">周五</option>
                                <option value="6">周六</option>
                                <option value="0">周日</option>
                              </select>
                            `,
                          )
                        : nothing
                    }
                    ${
                      meta.schedulePreset === "monthly"
                        ? renderField(
                            "每月日期",
                            html`
                              <input
                                type="number"
                                min="1"
                                max="28"
                                class="employee-cron-wizard__input"
                                .value=${meta.monthlyDay}
                                @input=${(e: Event) =>
                                  onMetaChange({
                                    monthlyDay: (e.target as HTMLInputElement).value,
                                  })}
                              />
                            `,
                          )
                        : nothing
                    }
                  `
          }
        `;
      case 3:
        return html`
          ${renderField(
            "你想让机器人做什么？",
            html`
              <textarea
                class="employee-cron-wizard__textarea employee-cron-wizard__textarea--prompt ${stepBlockers.length > 0 ? "is-invalid" : ""}"
                rows="6"
                .value=${wizard.userIntent}
                placeholder="用自然语言描述即可，例如：每天收集竞争对手官网价格变化，整理成分析报告。"
                @input=${(e: Event) => {
                  const value = (e.target as HTMLTextAreaElement).value;
                  onWizardChange({
                    userIntent: value,
                    visibleDescription: inferDescriptionFromIntent(value),
                    recommendSummary: null,
                  });
                }}
              ></textarea>
              ${
                stepBlockers.length > 0
                  ? html`<span class="employee-cron-wizard__field-error">${stepBlockers[0]?.message ?? "请描述任务意图"}</span>`
                  : nothing
              }
            `,
          )}
          ${
            legacyTokens.length > 0
              ? html`
                  <div class="callout callout--warning employee-cron-wizard__legacy-migration">
                    <div>
                      ${
                        wizard.legacyMigrationAttempted
                          ? html`
                              未能自动解析：${legacyTokens.join("、")}。
                              ${
                                grantedCapabilityCount === 0
                                  ? "当前没有已授权的企业数据能力，请先在知识宇宙申请「销售/订单」类数据能力。"
                                  : "未找到与占位符匹配的数据能力，请展开下方「插入数据源」手动选择，或修改任务描述。"
                              }
                            `
                          : html`
                              检测到旧版占位符：${legacyTokens.join("、")}。建议迁移为结构化数据源绑定，以便 Cron 运行时自动解析。
                              ${
                                grantedCapabilityCount === 0
                                  ? html`
                                      <span class="employee-cron-wizard__hint"> （当前无已授权数据能力，迁移可能无法完成） </span>
                                    `
                                  : nothing
                              }
                            `
                      }
                    </div>
                    <div class="employee-cron-wizard__legacy-migration-actions">
                      ${
                        props.onOpenKnowledgeUniverse && grantedCapabilityCount === 0
                          ? html`
                              <button
                                type="button"
                                class="btn btn--sm employee-cron-wizard__legacy-migrate-btn"
                                @click=${() =>
                                  void props.onOpenKnowledgeUniverse?.({
                                    kind: "capability",
                                    resourceId: "",
                                    label: "销售",
                                  })}
                              >
                                前往知识宇宙
                              </button>
                            `
                          : nothing
                      }
                      <button
                        type="button"
                        class="btn btn--sm btn--primary employee-cron-wizard__legacy-migrate-btn"
                        @click=${() => onMigrateLegacyBindings()}
                      >
                        ${wizard.legacyMigrationAttempted ? "重试迁移" : "一键迁移"}
                      </button>
                    </div>
                  </div>
                `
              : nothing
          }
          <details
            class="employee-cron-wizard__variable-panel"
            .open=${dataBindingsPanelOpen}
            @toggle=${(e: Event) =>
              onWizardChange({ dataBindingsPanelOpen: (e.target as HTMLDetailsElement).open })}
          >
            <summary class="employee-cron-wizard__variable-summary">
              插入数据源（可选）
              <span class="employee-cron-wizard__hint employee-cron-wizard__hint--inline">
                点击展开，将已授权的数据能力/知识源插入任务描述
              </span>
            </summary>
            ${
              bindingIntegrity.bindingCount > 0
                ? html`
                    <div
                      class="employee-cron-wizard__binding-integrity employee-cron-wizard__binding-integrity--${bindingIntegrity.grade.toLowerCase()}"
                    >
                      <div class="employee-cron-wizard__binding-integrity-head">
                        <span class="employee-cron-wizard__binding-integrity-grade">${bindingIntegrity.grade}</span>
                        <span class="employee-cron-wizard__binding-integrity-score">${bindingIntegrity.score} 分</span>
                        <span class="employee-cron-wizard__binding-integrity-summary">${bindingIntegrity.summary}</span>
                      </div>
                      <div class="employee-cron-wizard__binding-integrity-bar">
                        <div
                          class="employee-cron-wizard__binding-integrity-fill"
                          style="width: ${bindingIntegrity.score}%"
                        ></div>
                      </div>
                    </div>
                  `
                : nothing
            }
            ${
              canRepairBindings
                ? html`
                    <div class="employee-cron-wizard__binding-repair">
                      <span class="employee-cron-wizard__hint">检测到可自动修复的数据源问题</span>
                      <button
                        type="button"
                        class="btn btn--sm btn--primary employee-cron-wizard__repair-btn"
                        @click=${() => onRepairDataBindings()}
                      >
                        一键修复
                      </button>
                    </div>
                  `
                : nothing
            }
            ${
              dataBindingItems.length <= 1 &&
              (props.dataCapabilities ?? []).length === 0 &&
              (props.personalKnowledgeSources ?? []).length === 0 &&
              (props.enterpriseKnowledgeSources ?? []).length === 0
                ? html`
                    <div class="employee-cron-wizard__hint">
                      暂无已授权的企业数据能力或知识源；可先插入「今天日期」，或在知识宇宙中配置数据源后重试。
                    </div>
                  `
                : html`
                    <div class="employee-cron-wizard__chips">
                      ${dataBindingItems.map(
                        (item) => html`
                          <button
                            type="button"
                            class="employee-cron-wizard__chip employee-cron-wizard__chip--binding ${item.disabled ? "is-disabled" : ""}"
                            title="${item.disabled ? (item.disabledReason ?? "不可用") : item.subtitle}"
                            ?disabled=${item.disabled}
                            @click=${() => {
                              if (item.disabled) {
                                return;
                              }
                              const binding = createDataBindingFromPickerItem(item);
                              const nextBindings = upsertDataBinding(meta.dataBindings, binding);
                              const nextIntent = insertDataBindingIntoIntent({
                                intentText: wizard.userIntent,
                                binding,
                              });
                              onMetaChange({ dataBindings: nextBindings });
                              onWizardChange({
                                userIntent: nextIntent,
                                recommendSummary: null,
                                noticeMessage: formatDataBindingInsertNotice(binding),
                              });
                            }}
                          >
                            <span class="employee-cron-wizard__chip-label">${item.label}</span>
                            ${
                              item.kind === "capability"
                                ? html`<span class="employee-cron-wizard__chip-badge">${item.accessState === "granted" ? "已授权" : "待授权"}</span>`
                                : item.kind === "knowledge"
                                  ? html`<span class="employee-cron-wizard__chip-badge">${item.knowledgeScope === "enterprise" ? "企业" : "个人"}</span>`
                                  : html`
                                      <span class="employee-cron-wizard__chip-badge">内置</span>
                                    `
                            }
                          </button>
                        `,
                      )}
                    </div>
                  `
            }
            ${
              activeBindings.length > 0
                ? html`
                    <div class="employee-cron-wizard__binding-list">
                      <div class="employee-cron-wizard__label">已绑定 ${activeBindings.length} 项</div>
                      ${activeBindings.map(
                        (binding) => html`
                          <span class="employee-cron-wizard__binding-tag">${binding.label}</span>
                        `,
                      )}
                    </div>
                  `
                : nothing
            }
            ${
              bindingDiagnostics.length > 0
                ? html`
                    <div class="employee-cron-wizard__binding-diagnostics">
                      ${bindingDiagnostics.map((issue) => {
                        const navTarget = issueSupportsKnowledgeNavigation(issue)
                          ? resolveIssueKnowledgeNavigation({
                              issue,
                              bindings: meta.dataBindings,
                              dataCapabilities: props.dataCapabilities ?? [],
                              enterpriseRestrictedKnowledge:
                                props.enterpriseRestrictedKnowledgeSources ?? [],
                            })
                          : null;
                        const navLabel =
                          navTarget?.action === "request_access" ? "申请权限" : "前往知识宇宙";
                        return html`
                          <div
                            class="callout ${
                              issue.level === "error" ? "callout--danger" : "callout--warning"
                            } employee-cron-wizard__binding-issue"
                          >
                            <span class="employee-cron-wizard__binding-issue-text">${issue.message}</span>
                            ${
                              navTarget && props.onOpenKnowledgeUniverse
                                ? html`
                                    <button
                                      type="button"
                                      class="btn btn--sm employee-cron-wizard__binding-issue-action"
                                      @click=${() =>
                                        void props.onOpenKnowledgeUniverse?.({
                                          kind: navTarget.kind,
                                          resourceId: navTarget.resourceId,
                                          label: navTarget.label,
                                          action: navTarget.action,
                                          projectionId: navTarget.projectionId,
                                        })}
                                    >
                                      ${navLabel}
                                    </button>
                                  `
                                : nothing
                            }
                          </div>
                        `;
                      })}
                    </div>
                  `
                : nothing
            }
          </details>
          ${
            wizard.noticeMessage
              ? html`
                  <div
                    class="callout ${
                      wizard.noticeMessage.includes("需手动")
                        ? "callout--warning"
                        : "callout--success"
                    } employee-cron-wizard__lint-ok"
                  >
                    ${wizard.noticeMessage}
                  </div>
                `
              : nothing
          }
          ${renderField(
            "执行对象",
            html`
              ${
                wizard.recommendSummary
                  ? html`<div class="callout callout--success employee-cron-wizard__lint-ok">${wizard.recommendSummary}</div>`
                  : nothing
              }
              <div class="employee-cron-wizard__execution-targets">
                ${
                  agentOptions.length === 0 && executionGroups.length === 0
                    ? html`
                        <div class="employee-cron-wizard__hint">暂无可用机器人或协作小组。</div>
                      `
                    : html`
                        ${
                          agentOptions.length > 0
                            ? html`
                                <div class="employee-cron-wizard__target-group">
                                  <div class="employee-cron-wizard__label">我的机器人</div>
                                  <div class="employee-cron-wizard__checks">
                                    ${agentOptions.map(
                                      (agent) => html`
                                        <label class="employee-cron-wizard__check">
                                          <input
                                            type="radio"
                                            name="cron-execution-target"
                                            .checked=${meta.selectedAgents.includes(agent.id)}
                                            @change=${(e: Event) => {
                                              const checked = (e.target as HTMLInputElement)
                                                .checked;
                                              if (!checked) {
                                                return;
                                              }
                                              onWizardChange({ recommendSummary: null });
                                              onMetaChange({
                                                selectedAgents: [agent.id],
                                                selectedGroups: [],
                                                executionMode: "single",
                                              });
                                              onFormPatch({
                                                agentId: agent.id,
                                                sessionKey: "",
                                              });
                                            }}
                                          />
                                          <span>${agent.emoji ? `${agent.emoji} ` : ""}${agent.label}</span>
                                        </label>
                                      `,
                                    )}
                                  </div>
                                </div>
                              `
                            : html`
                                <div class="employee-cron-wizard__hint">暂无可用机器人，请先在「我的机器人」中创建。</div>
                              `
                        }
                        ${
                          executionGroups.length > 0
                            ? html`
                                <div class="employee-cron-wizard__target-group">
                                  <div class="employee-cron-wizard__label">协作小组</div>
                                  <div class="employee-cron-wizard__checks">
                                    ${executionGroups.map(
                                      (group) => html`
                                        <label class="employee-cron-wizard__check">
                                          <input
                                            type="radio"
                                            name="cron-execution-target"
                                            .checked=${meta.selectedGroups.includes(group.sessionKey)}
                                            @change=${(e: Event) => {
                                              const checked = (e.target as HTMLInputElement)
                                                .checked;
                                              if (!checked) {
                                                return;
                                              }
                                              onWizardChange({ recommendSummary: null });
                                              onMetaChange({
                                                selectedGroups: [group.sessionKey],
                                                selectedAgents: [],
                                                executionMode: "single",
                                              });
                                              onFormPatch({
                                                sessionKey: group.sessionKey,
                                                agentId: "",
                                              });
                                            }}
                                          />
                                          <span>${group.label}（${String(group.memberCount)} 成员）</span>
                                        </label>
                                      `,
                                    )}
                                  </div>
                                </div>
                              `
                            : html`
                                <div class="employee-cron-wizard__hint">暂无协作小组，可在「协作空间」中创建或加入。</div>
                              `
                        }
                      `
                }
              </div>
            `,
            undefined,
            "在机器人或协作小组中选择一项",
            html`
              <button
                type="button"
                class="btn btn--sm btn--primary"
                ?disabled=${wizard.aiBusy || !wizard.userIntent.trim()}
                @click=${onRecommendAgent}
              >
                ${wizard.aiBusy ? "推荐中…" : "智能推荐"}
              </button>
            `,
          )}
        `;
      case 4:
        return html`
          <div class="employee-cron-wizard__assist-row">
            <span class="employee-cron-wizard__hint">根据任务意图自动生成定时说明与验收规则</span>
            <button
              type="button"
              class="btn btn--sm btn--primary"
              ?disabled=${wizard.aiBusy || !wizard.userIntent.trim()}
              @click=${onSmartComplete}
            >
              ${wizard.aiBusy ? "补全中…" : "智能补全"}
            </button>
          </div>
          ${
            wizard.polishSummary
              ? html`<div class="callout callout--success employee-cron-wizard__lint-ok">${wizard.polishSummary}</div>`
              : nothing
          }
          ${renderField(
            "定时说明",
            html`
              <textarea
                class="employee-cron-wizard__textarea"
                rows="3"
                .value=${meta.goal}
                placeholder="生成一份运营日报并发送至管理层群"
                @input=${(e: Event) => onMetaChange({ goal: (e.target as HTMLTextAreaElement).value })}
              ></textarea>
            `,
          )}
          ${renderField(
            "验收规则",
            html`
              <div class="employee-cron-wizard__rules">
                ${meta.acceptanceRules.map(
                  (rule, index) => html`
                    <div class="employee-cron-wizard__rule-row">
                      <span class="employee-cron-wizard__rule-index">${String(index + 1)}</span>
                      <input
                        class="employee-cron-wizard__input"
                        .value=${rule}
                        placeholder="例如：必须生成 PDF 文件"
                        @input=${(e: Event) => {
                          const next = [...meta.acceptanceRules];
                          next[index] = (e.target as HTMLInputElement).value;
                          onMetaChange({ acceptanceRules: next });
                        }}
                      />
                      <button
                        type="button"
                        class="btn btn--sm"
                        @click=${() =>
                          onMetaChange({
                            acceptanceRules: meta.acceptanceRules.filter((_, i) => i !== index),
                          })}
                      >
                        删除
                      </button>
                    </div>
                  `,
                )}
                <button
                  type="button"
                  class="btn btn--sm employee-cron-wizard__add-rule"
                  @click=${() => onMetaChange({ acceptanceRules: [...meta.acceptanceRules, ""] })}
                >
                  + 添加验收规则
                </button>
              </div>
            `,
          )}
        `;
      case 5:
        return html`
          <div class="employee-cron-wizard__notify-group">
            <div class="employee-cron-wizard__label">任务完成后</div>
            <div class="employee-cron-wizard__checks">
              ${(
                [
                  ["inApp", "站内通知"],
                  ["wecom", "企业微信"],
                  ["email", "邮件"],
                  ["dingtalk", "钉钉"],
                  ["webhook", "Webhook"],
                ] as const
              ).map(
                ([key, label]) => html`
                  <label class="employee-cron-wizard__check">
                    <input
                      type="checkbox"
                      .checked=${meta.notify[key]}
                      @change=${(e: Event) =>
                        onMetaChange({
                          notify: {
                            ...meta.notify,
                            [key]: (e.target as HTMLInputElement).checked,
                          },
                        })}
                    />
                    <span>${label}</span>
                  </label>
                `,
              )}
            </div>
          </div>
          <div class="employee-cron-wizard__notify-group">
            <div class="employee-cron-wizard__label">任务失败时</div>
            <label class="employee-cron-wizard__check">
              <input
                type="checkbox"
                .checked=${meta.notify.failImmediate}
                @change=${(e: Event) =>
                  onMetaChange({
                    notify: {
                      ...meta.notify,
                      failImmediate: (e.target as HTMLInputElement).checked,
                    },
                  })}
              />
              <span>立即通知</span>
            </label>
          </div>
        `;
      case 6:
        return html`
          <div class="employee-cron-wizard__assist-row">
            <span class="employee-cron-wizard__hint">提交前可优化 Prompt 或存为模板</span>
            <div class="employee-cron-wizard__assist-actions">
              <button type="button" class="btn btn--sm" ?disabled=${wizard.aiBusy} @click=${onPolishPrompt}>
                ${wizard.aiBusy ? "优化中…" : "智能优化 Prompt"}
              </button>
              <button type="button" class="btn btn--sm" @click=${onSaveAsTemplate}>存为我的模板</button>
            </div>
          </div>
          ${
            !isEditing
              ? html`
                  <div class="employee-cron-wizard__notify-group">
                    <div class="employee-cron-wizard__label">创建后自动保存</div>
                    <div class="employee-cron-wizard__checks">
                      <label class="employee-cron-wizard__check">
                        <input
                          type="checkbox"
                          .checked=${wizard.autoSavePersonalTemplate}
                          @change=${(e: Event) =>
                            onWizardChange({
                              autoSavePersonalTemplate: (e.target as HTMLInputElement).checked,
                            })}
                        />
                        <span>存为我的模板</span>
                      </label>
                      ${
                        props.teamTemplateSyncAvailable
                          ? html`
                              <label class="employee-cron-wizard__check">
                                <input
                                  type="checkbox"
                                  .checked=${wizard.syncTeamTemplate}
                                  @change=${(e: Event) =>
                                    onWizardChange({
                                      syncTeamTemplate: (e.target as HTMLInputElement).checked,
                                    })}
                                />
                                <span>同步到团队模板库</span>
                              </label>
                            `
                          : nothing
                      }
                    </div>
                  </div>
                `
              : nothing
          }
          ${
            wizard.polishSummary
              ? html`<div class="callout callout--success employee-cron-wizard__lint-ok">${wizard.polishSummary}</div>`
              : nothing
          }
          ${
            wizard.noticeMessage
              ? html`
                  <div
                    class="callout ${
                      wizard.noticeMessage.includes("需手动")
                        ? "callout--warning"
                        : "callout--success"
                    } employee-cron-wizard__lint-ok"
                  >
                    ${wizard.noticeMessage}
                  </div>
                `
              : nothing
          }
          <div class="employee-cron-wizard__preview">
            <div class="employee-cron-wizard__preview-head">
              <span class="employee-cron-wizard__label">编译预览 · 机器人将收到以下内容</span>
            </div>
            <pre class="employee-cron-wizard__preview-body">${compiledPreview.message}</pre>
          </div>
          ${
            qualityLint.length > 0
              ? html`
                  <div class="employee-cron-wizard__lint">
                    ${qualityLint.map(
                      (item) => html`
                        <div class="employee-cron-wizard__lint-item employee-cron-wizard__lint-item--${item.level}">
                          ${item.message}
                        </div>
                      `,
                    )}
                  </div>
                `
              : html`
                  <div class="callout callout--success employee-cron-wizard__lint-ok">任务配置完整，可以创建。</div>
                `
          }
        `;
      default:
        return nothing;
    }
  })();

  const minStep = isEditing ? 1 : 0;
  const displayStep =
    step === 0 ? "选择方式" : `第 ${String(step)} / ${String(WIZARD_STEP_COUNT)} 步`;

  return html`
    <div class="employee-cron-wizard">
      ${step > 0 || !isEditing ? renderStepNav(step, isEditing) : nothing}
      ${
        props.error
          ? html`<div class="callout callout--danger employee-cron-wizard__errors">${props.error}</div>`
          : nothing
      }
      ${
        stepBlockers.length > 0
          ? html`
              <div class="callout callout--danger employee-cron-wizard__errors">
                ${stepBlockers.map((item) => item.message).join("；")}
              </div>
            `
          : nothing
      }
      <div class="employee-cron-wizard__body">${stepBody}</div>
      <footer class="employee-cron-wizard__footer">
        <button type="button" class="btn" ?disabled=${step <= minStep} @click=${onBack}>上一步</button>
        <div class="employee-cron-wizard__footer-meta">${displayStep} · ${categoryLabel(meta.category)}</div>
        ${
          isLast
            ? html`
                <button
                  type="button"
                  class="btn btn--primary"
                  ?disabled=${props.busy || blockingLint.length > 0}
                  @click=${onSubmit}
                >
                  ${props.busy ? "保存中…" : isEditing ? "保存任务" : "创建任务"}
                </button>
              `
            : html`
                <button type="button" class="btn btn--primary" @click=${onNext}>下一步</button>
              `
        }
      </footer>
    </div>
  `;
}

export { DEFAULT_PERSONAL_CRON_TASK_META, BUILTIN_PERSONAL_CRON_TEMPLATES };
