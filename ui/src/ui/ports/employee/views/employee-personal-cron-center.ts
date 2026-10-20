/**
 * 员工端「个人定时任务」——定时任务中心主页面（消费级运营视图）。
 * 复用 CronProps / cronCapability 后端能力，复杂配置在右侧抽屉表单完成。
 */

import { html, nothing } from "lit";
import { LitElement } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CronJob } from "../../../types.ts";
import type { CronProps } from "../../../views/cron.ts";
import {
  formatPersonalCronCreatedAtCompact,
  formatPersonalCronNextRunLabel,
  formatPersonalCronScheduleLabel,
  formatPersonalCronExecutionLabel,
  matchesPersonalCronCategoryFilter,
  matchesPersonalCronStatusFilter,
  matchesPersonalCronTargetFilter,
  PERSONAL_CRON_STATUS_LABELS,
  resolvePersonalCronDescription,
  resolvePersonalCronDisplayStatus,
  resolvePersonalCronExecutionTarget,
  resolvePersonalCronResultChatTargets,
  summarizePersonalCronStats,
  placeAnchoredMenuPanel,
  type PersonalCronCategoryFilter,
  type PersonalCronStatusFilter,
  type PersonalCronTargetFilter,
} from "./personal-cron-center.helpers.ts";
import {
  migrateWizardLegacyBindings,
  formatLegacyMigrationNotice,
  repairWizardDataBindings,
  formatRepairNotice,
} from "./personal-cron-data-bindings.ts";
import { renderPersonalCronDetailPanel } from "./personal-cron-detail-panel.ts";
import { renderProgressLedgerListLine } from "./personal-cron-progress.ts";
import {
  enhanceCronTaskWithRules,
  recommendExecutionTargetWithRules,
  type CronExecutionRecommendAiResult,
} from "./personal-cron-task-ai.ts";
import { inferDescriptionFromIntent } from "./personal-cron-task-compiler.ts";
import { resolvePersonalCronTaskMeta } from "./personal-cron-task-meta.ts";
import type { PersonalCronTaskTemplate } from "./personal-cron-task-templates.ts";
import {
  buildTemplateFromWizard,
  deletePersonalCronTemplate,
  loadPersonalCronTemplates,
  savePersonalCronTemplate,
} from "./personal-cron-template-store.ts";
import {
  applyCopyJobToWizardState,
  applyTemplateToWizardState,
  createWizardStateFromForm,
  renderPersonalCronWizard,
  resolveWizardStepBlockers,
  resolveWizardTaskName,
  syncWizardToForm,
  WIZARD_STEP_COUNT,
  type CronWizardState,
} from "./personal-cron-wizard.ts";

type DrawerMode = null | "detail" | "form";

@customElement("employee-personal-cron-center")
export class EmployeePersonalCronCenter extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) cronProps: CronProps | null = null;

  @state() private selectedIds = new Set<string>();
  @state() private page = 1;
  @state() private pageSize = 10;
  @state() private drawerMode: DrawerMode = null;
  @state() private drawerJob: CronJob | null = null;
  @state() private showRunLogsExpanded = false;
  private openMenuJobId: string | null = null;
  @state() private statusFilter: PersonalCronStatusFilter = "all";
  @state() private targetFilter: PersonalCronTargetFilter = "all";
  @state() private categoryFilter: PersonalCronCategoryFilter = "all";
  @state() private searchDraft = "";
  @state() private wizardState: CronWizardState | null = null;
  @state() private personalTemplates: PersonalCronTaskTemplate[] = [];
  @state() private teamTemplates: PersonalCronTaskTemplate[] = [];
  @state() private actionNotice: string | null = null;

  private readonly onViewportChange = () => this.closeOpenTaskMenus();

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("resize", this.onViewportChange);
    window.addEventListener("scroll", this.onViewportChange, true);
  }

  disconnectedCallback() {
    window.removeEventListener("resize", this.onViewportChange);
    window.removeEventListener("scroll", this.onViewportChange, true);
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues) {
    if (changed.has("cronProps") && this.cronProps) {
      this.searchDraft = this.cronProps.jobsQuery ?? "";
      const focusId = this.cronProps.focusJobId?.trim();
      if (focusId) {
        const job = this.cronProps.jobs.find((entry) => entry.id === focusId);
        if (job) {
          this.openDetail(job);
          this.cronProps.onFocusJobHandled?.();
        }
      }
    }
  }

  private openExecutionChat(job: CronJob, sessionKey?: string) {
    const props = this.props;
    if (!props?.onOpenExecutionChat) {
      return;
    }
    const targetKey =
      sessionKey?.trim() ||
      resolvePersonalCronResultChatTargets({
        job,
        agents: props.executionAgents,
        groups: props.executionGroups,
      })[0]?.sessionKey;
    if (!targetKey) {
      return;
    }
    this.closeOpenTaskMenus();
    props.onOpenExecutionChat({ sessionKey: targetKey, jobId: job.id });
  }

  private get props(): CronProps | null {
    return this.cronProps;
  }

  private filteredJobs(): CronJob[] {
    const props = this.props;
    if (!props) {
      return [];
    }
    return props.jobs.filter(
      (job) =>
        matchesPersonalCronStatusFilter(job, this.statusFilter) &&
        matchesPersonalCronTargetFilter(job, this.targetFilter) &&
        matchesPersonalCronCategoryFilter(job, this.categoryFilter),
    );
  }

  private paginatedJobs(): CronJob[] {
    const filtered = this.filteredJobs();
    const start = (this.page - 1) * this.pageSize;
    return filtered.slice(start, start + this.pageSize);
  }

  private totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredJobs().length / this.pageSize));
  }

  private toggleSelected(jobId: string, checked: boolean) {
    const next = new Set(this.selectedIds);
    if (checked) {
      next.add(jobId);
    } else {
      next.delete(jobId);
    }
    this.selectedIds = next;
  }

  private clearSelection() {
    this.selectedIds = new Set();
  }

  private closeOpenTaskMenus() {
    this.querySelectorAll<HTMLDetailsElement>(
      ".employee-cron-center__task-menu details[open]",
    ).forEach((details) => {
      this.clearMenuPanelPosition(details);
      details.open = false;
    });
    this.openMenuJobId = null;
  }

  private clearMenuPanelPosition(details: HTMLDetailsElement) {
    const panel = details.querySelector<HTMLElement>(".employee-cron-center__menu-panel");
    if (!panel) {
      return;
    }
    panel.style.position = "";
    panel.style.top = "";
    panel.style.left = "";
    panel.style.right = "";
    panel.style.zIndex = "";
  }

  private placeOpenTaskMenu(details: HTMLDetailsElement) {
    const panel = details.querySelector<HTMLElement>(".employee-cron-center__menu-panel");
    const trigger = details.querySelector("summary");
    if (!panel || !trigger) {
      return;
    }
    const apply = () => {
      if (!details.open) {
        return;
      }
      const triggerRect = trigger.getBoundingClientRect();
      const placed = placeAnchoredMenuPanel({
        trigger: triggerRect,
        panel: {
          width: panel.offsetWidth || 168,
          height: panel.offsetHeight || 280,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      panel.style.position = "fixed";
      panel.style.top = `${String(placed.top)}px`;
      panel.style.left = `${String(placed.left)}px`;
      panel.style.right = "auto";
      panel.style.zIndex = "80";
    };
    apply();
    requestAnimationFrame(apply);
  }

  private onTaskMenuToggle(event: Event, jobId: string) {
    const details = event.currentTarget as HTMLDetailsElement;
    if (!details.open) {
      this.clearMenuPanelPosition(details);
      if (this.openMenuJobId === jobId) {
        this.openMenuJobId = null;
      }
      return;
    }
    this.querySelectorAll<HTMLDetailsElement>(
      ".employee-cron-center__task-menu details[open]",
    ).forEach((entry) => {
      if (entry !== details) {
        this.clearMenuPanelPosition(entry);
        entry.open = false;
      }
    });
    this.openMenuJobId = jobId;
    this.placeOpenTaskMenu(details);
  }

  private async runTaskNow(job: CronJob, event: Event) {
    event.stopPropagation();
    const props = this.props;
    if (!props || props.busy) {
      return;
    }
    this.closeOpenTaskMenus();
    this.actionNotice = null;
    await props.onRun(job, "force");
    if (this.props?.error) {
      return;
    }
    this.actionNotice = `已触发「${job.name}」立即执行，状态将稍后更新。`;
  }

  private async toggleTask(job: CronJob, enabled: boolean, event: Event) {
    event.stopPropagation();
    const props = this.props;
    if (!props || props.busy) {
      return;
    }
    this.closeOpenTaskMenus();
    this.actionNotice = null;
    await props.onToggle(job, enabled);
    if (this.props?.error) {
      return;
    }
    this.actionNotice = enabled ? `已启用「${job.name}」` : `已暂停「${job.name}」`;
  }

  private async removeTask(job: CronJob, event: Event) {
    event.stopPropagation();
    const props = this.props;
    if (!props || props.busy) {
      return;
    }
    this.closeOpenTaskMenus();
    this.actionNotice = null;
    await props.onRemove(job);
    if (this.props?.error) {
      return;
    }
    this.actionNotice = `已删除「${job.name}」`;
  }

  private openDetail(job: CronJob) {
    this.drawerJob = job;
    this.drawerMode = "detail";
    this.openMenuJobId = null;
    this.showRunLogsExpanded = false;
    this.wizardState = null;
    void this.props?.onLoadRuns(job.id);
  }

  private refreshPersonalTemplates() {
    this.personalTemplates = loadPersonalCronTemplates();
  }

  private async refreshTeamTemplates() {
    const props = this.props;
    if (!props?.onLoadTeamTemplates) {
      this.teamTemplates = [];
      return;
    }
    this.teamTemplates = (await props.onLoadTeamTemplates()) as PersonalCronTaskTemplate[];
  }

  private async refreshAllTemplates() {
    this.refreshPersonalTemplates();
    await this.refreshTeamTemplates();
  }

  private openForm(job?: CronJob, options?: { startAtTemplate?: boolean }) {
    const props = this.props;
    if (!props) {
      return;
    }
    void this.refreshAllTemplates();
    this.drawerJob = job ?? null;
    this.drawerMode = "form";
    this.openMenuJobId = null;
    this.wizardState = createWizardStateFromForm(props.form, {
      isEditing: Boolean(job),
      startAtTemplate: options?.startAtTemplate,
    });
    if (job) {
      props.onEdit(job);
    } else if (props.editingJobId) {
      props.onCancelEdit();
    } else {
      this.syncWizardForm();
    }
  }

  private openFormFromClone(job: CronJob) {
    const props = this.props;
    if (!props) {
      return;
    }
    props.onClone(job);
    this.drawerJob = null;
    this.drawerMode = "form";
    this.openMenuJobId = null;
    this.wizardState = createWizardStateFromForm(props.form, { isEditing: false });
    if (this.wizardState) {
      this.wizardState = {
        ...this.wizardState,
        step: 1,
        createMode: "copy",
        selectedCopyJobId: job.id,
      };
    }
  }

  private openTemplateLibrary() {
    this.openForm(undefined, { startAtTemplate: true });
    if (this.wizardState) {
      this.wizardState = { ...this.wizardState, createMode: "template", step: 0 };
    }
  }

  private closeDrawer() {
    this.drawerMode = null;
    this.drawerJob = null;
    this.wizardState = null;
    this.props?.onCancelEdit();
  }

  private patchWizard(patch: Partial<CronWizardState>) {
    if (!this.wizardState) {
      return;
    }
    this.wizardState = { ...this.wizardState, ...patch };
  }

  private patchWizardMeta(patch: Partial<CronWizardState["meta"]>) {
    if (!this.wizardState) {
      return;
    }
    this.wizardState = {
      ...this.wizardState,
      meta: { ...this.wizardState.meta, ...patch },
    };
  }

  private syncWizardForm() {
    const props = this.props;
    if (!props || !this.wizardState) {
      return;
    }
    props.onFormChange(syncWizardToForm(this.wizardState, props.form));
  }

  private wizardBack() {
    this.syncWizardForm();
    if (this.wizardState) {
      const minStep = this.props?.editingJobId ? 1 : 0;
      this.wizardState = {
        ...this.wizardState,
        step: Math.max(minStep, this.wizardState.step - 1),
      };
    }
  }

  private wizardNext() {
    void this.wizardNextAsync();
  }

  private async wizardNextAsync() {
    this.syncWizardForm();
    if (!this.wizardState) {
      return;
    }
    const props = this.props;
    if (!props) {
      return;
    }
    const isEditing = Boolean(props?.editingJobId);
    const step = this.wizardState.step;

    if (step === 0) {
      const { createMode, selectedTemplateId, selectedCopyJobId } = this.wizardState;
      if (createMode === "template" && !selectedTemplateId) {
        return;
      }
      if (createMode === "copy" && !selectedCopyJobId) {
        return;
      }
    }

    if (step >= 1 && step < WIZARD_STEP_COUNT) {
      const mergedForm = {
        ...props.form,
        ...syncWizardToForm(this.wizardState, props.form),
      };
      const blockers = resolveWizardStepBlockers(step, mergedForm, this.wizardState);
      if (blockers.length > 0) {
        this.wizardState = { ...this.wizardState, submitAttempted: true };
        return;
      }
    }

    if (step === 3) {
      if (!this.wizardState.meta.goal.trim()) {
        void this.runSmartComplete();
      }
      await this.runRecommendAgent({ onlyIfEmpty: true });
    }

    const maxStep = WIZARD_STEP_COUNT;
    const minStep = isEditing ? 1 : 0;
    this.wizardState = {
      ...this.wizardState,
      step: Math.min(maxStep, Math.max(minStep, step + 1)),
    };
  }

  private async runSmartComplete(options?: { overwrite?: boolean }) {
    if (!this.wizardState || this.wizardState.aiBusy) {
      return;
    }
    const props = this.props;
    if (!props) {
      return;
    }
    if (!this.wizardState.userIntent.trim()) {
      this.wizardState = {
        ...this.wizardState,
        polishSummary: "请先填写任务描述，再使用智能补全。",
      };
      return;
    }
    this.wizardState = { ...this.wizardState, aiBusy: true, polishSummary: null };
    const overwrite = options?.overwrite ?? false;
    const input = {
      mode: "complete" as const,
      taskName: props.form.name,
      intentText: this.wizardState.userIntent,
      category: this.wizardState.meta.category,
      goal: this.wizardState.meta.goal,
      acceptanceRules: this.wizardState.meta.acceptanceRules,
      visibleDescription: this.wizardState.visibleDescription,
      overwrite,
    };
    const result = props.onEnhanceTaskWithAi
      ? await props.onEnhanceTaskWithAi(input)
      : enhanceCronTaskWithRules({
          mode: "complete",
          taskName: props.form.name,
          intentText: this.wizardState.userIntent,
          meta: this.wizardState.meta,
          visibleDescription: this.wizardState.visibleDescription,
          overwrite,
        });
    if (!this.wizardState) {
      return;
    }
    this.wizardState = {
      ...this.wizardState,
      aiBusy: false,
      meta: {
        ...this.wizardState.meta,
        goal: result?.goal ?? this.wizardState.meta.goal,
        acceptanceRules:
          result?.acceptanceRules && result.acceptanceRules.length > 0
            ? result.acceptanceRules
            : this.wizardState.meta.acceptanceRules,
      },
      polishSummary: result
        ? `${result.source === "llm" ? "大模型" : "规则引擎"}：${result.summary}`
        : "补全失败，请稍后重试",
    };
    this.syncWizardForm();
  }

  private async runRecommendAgent(options?: { onlyIfEmpty?: boolean }) {
    if (!this.wizardState) {
      return;
    }
    const props = this.props;
    if (!props) {
      return;
    }
    if (
      options?.onlyIfEmpty &&
      (this.wizardState.meta.selectedAgents.length > 0 ||
        this.wizardState.meta.selectedGroups.length > 0)
    ) {
      return;
    }
    if (!this.wizardState.userIntent.trim()) {
      this.wizardState = {
        ...this.wizardState,
        recommendSummary: "请先填写任务描述，再使用智能推荐。",
      };
      return;
    }

    this.wizardState = { ...this.wizardState, aiBusy: true };
    const recommendInput = {
      taskName: props.form.name,
      intentText: this.wizardState.userIntent,
      category: this.wizardState.meta.category,
      agents: props.executionAgents ?? [],
      groups: props.executionGroups ?? [],
    };
    let recommended: CronExecutionRecommendAiResult | null = null;
    try {
      recommended = props.onRecommendExecutionTargetWithAi
        ? await props.onRecommendExecutionTargetWithAi({
            taskName: recommendInput.taskName,
            intentText: recommendInput.intentText,
            category: recommendInput.category,
          })
        : recommendExecutionTargetWithRules({
            ...recommendInput,
            agents: recommendInput.agents.map(
              (entry): import("./personal-cron-execution-targets.ts").CronExecutionAgentOption => ({
                ...entry,
                source: entry.source ?? "owned",
              }),
            ),
            groups: recommendInput.groups.map(
              (entry): import("./personal-cron-execution-targets.ts").CronExecutionGroupOption => ({
                ...entry,
                memberCount: entry.memberCount ?? 0,
              }),
            ),
          });
    } finally {
      if (this.wizardState) {
        this.wizardState = { ...this.wizardState, aiBusy: false };
      }
    }
    if (!recommended || !this.wizardState) {
      return;
    }
    this.applyExecutionRecommendation(recommended, props);
  }

  private applyExecutionRecommendation(
    recommended: CronExecutionRecommendAiResult,
    props: CronProps,
  ) {
    if (!this.wizardState) {
      return;
    }
    const summaryPrefix = recommended.source === "llm" ? "大模型" : "规则引擎";
    if (recommended.kind === "agent") {
      this.wizardState = {
        ...this.wizardState,
        meta: {
          ...this.wizardState.meta,
          selectedAgents: [recommended.id],
          selectedGroups: [],
          executionMode: "single",
        },
        recommendSummary: `${summaryPrefix}：${recommended.reason}`,
      };
      props.onFormChange({ agentId: recommended.id, sessionKey: "" });
      return;
    }
    this.wizardState = {
      ...this.wizardState,
      meta: {
        ...this.wizardState.meta,
        selectedGroups: [recommended.id],
        selectedAgents: [],
        executionMode: "single",
      },
      recommendSummary: `${summaryPrefix}：${recommended.reason}`,
    };
    props.onFormChange({ sessionKey: recommended.id, agentId: "" });
  }

  private applyWizardDataBindingsMigration(noticePrefix?: string) {
    const props = this.props;
    if (!this.wizardState || !props) {
      return;
    }
    const result = migrateWizardLegacyBindings({
      intentText: this.wizardState.userIntent,
      dataBindings: this.wizardState.meta.dataBindings,
      dataCapabilities: props.dataCapabilities ?? [],
    });
    if (result.migratedTokens.length === 0 && result.unresolvedTokens.length === 0) {
      return;
    }
    const notice = formatLegacyMigrationNotice(result);
    this.wizardState = {
      ...this.wizardState,
      userIntent: result.intentText,
      meta: { ...this.wizardState.meta, dataBindings: result.dataBindings },
      legacyMigrationAttempted: true,
      dataBindingsPanelOpen:
        result.unresolvedTokens.length > 0 ? true : this.wizardState.dataBindingsPanelOpen,
      noticeMessage: notice
        ? `${noticePrefix ?? ""}${notice}`.trim()
        : this.wizardState.noticeMessage,
      recommendSummary: null,
    };
    this.syncWizardForm();
  }

  private migrateWizardLegacyBindings() {
    this.applyWizardDataBindingsMigration();
  }

  private repairWizardDataBindingsAction() {
    const props = this.props;
    if (!this.wizardState || !props) {
      return;
    }
    const result = repairWizardDataBindings({
      intentText: this.wizardState.userIntent,
      dataBindings: this.wizardState.meta.dataBindings,
      dataCapabilities: props.dataCapabilities ?? [],
      personalKnowledge: props.personalKnowledgeSources ?? [],
      enterpriseKnowledge: props.enterpriseKnowledgeSources ?? [],
    });
    const notice = formatRepairNotice(result);
    this.wizardState = {
      ...this.wizardState,
      userIntent: result.intentText,
      meta: { ...this.wizardState.meta, dataBindings: result.dataBindings },
      noticeMessage: notice ?? this.wizardState.noticeMessage,
      recommendSummary: null,
    };
    this.syncWizardForm();
  }

  private applyWizardTemplate(template: PersonalCronTaskTemplate) {
    if (!this.wizardState) {
      return;
    }
    const props = this.props;
    let wizard = applyTemplateToWizardState(this.wizardState, template);
    const currentName = props ? resolveWizardTaskName(wizard, props.form).trim() : "";
    if (!currentName && template.name.trim()) {
      wizard = { ...wizard, taskName: template.name };
      props?.onFormChange({ name: template.name });
    }
    this.wizardState = wizard;
    if (template.suggestedAgents[0]) {
      props?.onFormChange({ agentId: template.suggestedAgents[0], sessionKey: "" });
    } else if (template.suggestedGroups?.[0]) {
      props?.onFormChange({ sessionKey: template.suggestedGroups[0], agentId: "" });
    }
    this.applyWizardDataBindingsMigration();
    this.syncWizardForm();
  }

  private applyWizardCopy(job: CronJob) {
    if (!this.wizardState || !this.props) {
      return;
    }
    this.wizardState = {
      ...applyCopyJobToWizardState(this.wizardState, job),
      selectedCopyJobId: job.id,
      createMode: "copy",
      taskName: job.name,
    };
    this.props.onFormChange({ name: job.name });
    if (job.agentId) {
      this.props.onFormChange({ agentId: job.agentId });
    }
    this.applyWizardDataBindingsMigration();
    this.syncWizardForm();
  }

  private async runPolishPrompt() {
    if (!this.wizardState || this.wizardState.aiBusy) {
      return;
    }
    const props = this.props;
    if (!props) {
      return;
    }
    this.wizardState = { ...this.wizardState, aiBusy: true };
    const input = {
      mode: "polish" as const,
      taskName: props.form.name,
      intentText: this.wizardState.userIntent,
      category: this.wizardState.meta.category,
      goal: this.wizardState.meta.goal,
      acceptanceRules: this.wizardState.meta.acceptanceRules,
      visibleDescription: this.wizardState.visibleDescription,
    };
    const result = props.onEnhanceTaskWithAi
      ? await props.onEnhanceTaskWithAi(input)
      : enhanceCronTaskWithRules({
          mode: "polish",
          taskName: props.form.name,
          intentText: this.wizardState.userIntent,
          meta: this.wizardState.meta,
          visibleDescription: this.wizardState.visibleDescription,
        });
    if (!this.wizardState || !result) {
      if (this.wizardState) {
        this.wizardState = { ...this.wizardState, aiBusy: false };
      }
      return;
    }
    this.wizardState = {
      ...this.wizardState,
      aiBusy: false,
      userIntent: result.intentText,
      visibleDescription: inferDescriptionFromIntent(result.intentText),
      meta: {
        ...this.wizardState.meta,
        goal: result.goal,
        acceptanceRules: result.acceptanceRules,
      },
      polishSummary: `${result.source === "llm" ? "大模型" : "规则引擎"}：${result.summary}`,
      noticeMessage: null,
    };
    this.syncWizardForm();
  }

  private saveAsPersonalTemplate() {
    const props = this.props;
    if (!props || !this.wizardState) {
      return;
    }
    if (!this.wizardState.userIntent.trim()) {
      this.wizardState = {
        ...this.wizardState,
        noticeMessage: "请先填写任务意图，再存为模板。",
      };
      return;
    }
    const template = buildTemplateFromWizard({
      form: props.form,
      meta: this.wizardState.meta,
      userIntent: this.wizardState.userIntent,
      visibleDescription: this.wizardState.visibleDescription,
      existingId:
        this.wizardState.selectedTemplateId &&
        this.personalTemplates.some((item) => item.id === this.wizardState?.selectedTemplateId)
          ? this.wizardState.selectedTemplateId
          : undefined,
    });
    savePersonalCronTemplate(template);
    this.refreshPersonalTemplates();
    this.wizardState = {
      ...this.wizardState,
      noticeMessage: `已保存模板「${template.name}」，可在创建方式 → 任务模板中使用。`,
      polishSummary: null,
    };
  }

  private deletePersonalTemplate(templateId: string) {
    deletePersonalCronTemplate(templateId);
    this.refreshPersonalTemplates();
    if (this.wizardState?.selectedTemplateId === templateId) {
      this.wizardState = { ...this.wizardState, selectedTemplateId: null };
    }
  }

  private deleteTeamTemplate(templateId: string) {
    const props = this.props;
    if (!props?.onDeleteTeamTemplate) {
      return;
    }
    void props.onDeleteTeamTemplate(templateId).then((deleted) => {
      if (deleted) {
        void this.refreshTeamTemplates();
        if (this.wizardState?.selectedTemplateId === templateId) {
          this.wizardState = { ...this.wizardState, selectedTemplateId: null };
        }
      }
    });
  }

  private async saveTemplatesAfterCreate() {
    const props = this.props;
    if (!props || !this.wizardState || !this.wizardState.userIntent.trim()) {
      return;
    }
    const template = buildTemplateFromWizard({
      form: props.form,
      meta: this.wizardState.meta,
      userIntent: this.wizardState.userIntent,
      visibleDescription: this.wizardState.visibleDescription,
    });
    if (this.wizardState.autoSavePersonalTemplate) {
      savePersonalCronTemplate(template);
      this.refreshPersonalTemplates();
    }
    if (this.wizardState.syncTeamTemplate && props.onSaveTeamTemplate) {
      const teamTemplate = {
        ...template,
        id: `team-${Date.now()}`,
        scope: "team" as const,
      };
      await props.onSaveTeamTemplate(teamTemplate);
      await this.refreshTeamTemplates();
    }
  }

  private async waitUntilCronIdle() {
    for (let attempt = 0; attempt < 120; attempt++) {
      await this.updateComplete;
      if (!this.props?.busy) {
        return;
      }
    }
  }

  private async wizardSubmit() {
    this.syncWizardForm();
    const props = this.props;
    if (!props || props.busy || !this.wizardState) {
      return;
    }
    if (!resolveWizardTaskName(this.wizardState, props.form).trim()) {
      this.wizardState = { ...this.wizardState, step: 1, submitAttempted: true };
      return;
    }
    this.wizardState = { ...this.wizardState, submitAttempted: true };
    const editingId = props.editingJobId;
    const jobsBefore = props.jobs.length;
    await Promise.resolve(props.onAdd());
    await this.waitUntilCronIdle();
    await this.updateComplete;
    const next = this.props;
    if (!next || next.error) {
      return;
    }
    const saved =
      (editingId != null && next.editingJobId == null) ||
      (editingId == null && next.jobs.length > jobsBefore);
    if (saved) {
      if (!editingId) {
        await this.saveTemplatesAfterCreate();
      }
      this.closeDrawer();
      return;
    }
    const hasFieldErrors =
      next.fieldErrors.name || next.fieldErrors.payloadText || next.fieldErrors.cronExpr;
    if (hasFieldErrors && this.wizardState) {
      const jumpStep = next.fieldErrors.name
        ? 1
        : next.fieldErrors.cronExpr
          ? 2
          : next.fieldErrors.payloadText
            ? 3
            : this.wizardState.step;
      this.wizardState = { ...this.wizardState, step: jumpStep, submitAttempted: true };
    }
  }

  private async applySearch(value: string) {
    const props = this.props;
    if (!props) {
      return;
    }
    this.page = 1;
    await props.onJobsFiltersChange({ cronJobsQuery: value });
  }

  private async applySort(dir: "asc" | "desc") {
    const props = this.props;
    if (!props) {
      return;
    }
    this.page = 1;
    await props.onJobsFiltersChange({
      cronJobsSortBy: "updatedAtMs",
      cronJobsSortDir: dir,
    });
  }

  private setStatusFilter(filter: PersonalCronStatusFilter) {
    this.statusFilter = filter;
    this.page = 1;
  }

  private async batchToggle(enabled: boolean) {
    const props = this.props;
    if (!props) {
      return;
    }
    for (const job of props.jobs) {
      if (this.selectedIds.has(job.id) && job.enabled !== enabled) {
        void props.onToggle(job, enabled);
      }
    }
    this.clearSelection();
  }

  private async batchRemove() {
    const props = this.props;
    if (!props) {
      return;
    }
    for (const job of props.jobs) {
      if (this.selectedIds.has(job.id)) {
        void props.onRemove(job);
      }
    }
    this.clearSelection();
  }

  private async batchRun() {
    const props = this.props;
    if (!props) {
      return;
    }
    for (const job of props.jobs) {
      if (this.selectedIds.has(job.id)) {
        void props.onRun(job, "force");
      }
    }
    this.clearSelection();
  }

  private renderStatusBadge(job: CronJob) {
    const status = resolvePersonalCronDisplayStatus(job);
    return html`
      <span class="employee-cron-center__status employee-cron-center__status--${status}">
        <span class="employee-cron-center__status-dot" aria-hidden="true"></span>
        ${PERSONAL_CRON_STATUS_LABELS[status]}
      </span>
    `;
  }

  private renderStatCard(
    label: string,
    value: number,
    tone: "total" | "pending" | "running" | "completed" | "failed",
    filter?: PersonalCronStatusFilter,
  ) {
    return html`
      <button
        type="button"
        class="employee-cron-center__stat-card employee-cron-center__stat-card--${tone}"
        ?disabled=${!filter}
        @click=${() => {
          if (filter) {
            this.setStatusFilter(filter);
          }
        }}
      >
        <span class="employee-cron-center__stat-label">${label}</span>
        <span class="employee-cron-center__stat-value">${String(value)}</span>
      </button>
    `;
  }

  private renderTaskCard(job: CronJob) {
    const props = this.props;
    if (!props) {
      return nothing;
    }
    const target = resolvePersonalCronExecutionTarget(job, {
      agents: props.executionAgents,
      groups: props.executionGroups,
    });
    const executionLabel = formatPersonalCronExecutionLabel({
      job,
      meta: resolvePersonalCronTaskMeta(job),
      agents: props.executionAgents,
      groups: props.executionGroups,
    });
    const description = resolvePersonalCronDescription(job);
    const schedule = formatPersonalCronScheduleLabel(job);
    const nextRun = formatPersonalCronNextRunLabel(job.state?.nextRunAtMs);
    const createdAt = formatPersonalCronCreatedAtCompact(job.createdAtMs);

    return html`
      <article
        class="employee-cron-center__task-card"
        @click=${() => this.openDetail(job)}
      >
        <label class="employee-cron-center__task-check" @click=${(e: Event) => e.stopPropagation()}>
          <input
            type="checkbox"
            .checked=${this.selectedIds.has(job.id)}
            @change=${(e: Event) =>
              this.toggleSelected(job.id, (e.target as HTMLInputElement).checked)}
          />
        </label>
        <div class="employee-cron-center__task-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <rect x="4" y="5" width="16" height="15" rx="2"></rect>
            <path d="M8 3v3"></path>
            <path d="M16 3v3"></path>
            <path d="M4 10h16"></path>
          </svg>
        </div>
        <div class="employee-cron-center__task-main">
          <div class="employee-cron-center__task-name">${job.name}</div>
          <div class="employee-cron-center__task-desc">${description || "暂无任务简介"}</div>
          ${renderProgressLedgerListLine(job)}
        </div>
        <div class="employee-cron-center__task-target">
          <span class="employee-cron-center__target-icon employee-cron-center__target-icon--${target.kind}">
            ${
              target.kind === "group"
                ? html`
                    <svg viewBox="0 0 24 24">
                      <circle cx="9" cy="8" r="2.5"></circle>
                      <circle cx="15" cy="8" r="2.5"></circle>
                      <path d="M4 19c0-2.2 2.2-4 5-4s5 1.8 5 4"></path>
                      <path d="M14 15c2.4 0 4.5 1.4 4.5 3.5"></path>
                    </svg>
                  `
                : html`
                    <svg viewBox="0 0 24 24">
                      <rect x="5" y="7" width="14" height="11" rx="2"></rect>
                      <circle cx="9" cy="12" r="1"></circle>
                      <circle cx="15" cy="12" r="1"></circle>
                      <path d="M9 15h6"></path>
                      <path d="M12 7V4"></path>
                    </svg>
                  `
            }
          </span>
          <span>${executionLabel}</span>
        </div>
        <div class="employee-cron-center__task-schedule">
          <div>${schedule}</div>
          <div class="employee-cron-center__task-next">${nextRun}</div>
        </div>
        <div class="employee-cron-center__task-status">${this.renderStatusBadge(job)}</div>
        <div class="employee-cron-center__task-created">
          <div>${createdAt}</div>
          <div class="employee-cron-center__task-created-label">创建</div>
        </div>
        <div class="employee-cron-center__task-menu" @click=${(e: Event) => e.stopPropagation()}>
          <details @toggle=${(event: Event) => this.onTaskMenuToggle(event, job.id)}>
            <summary aria-label="更多操作">⋮</summary>
            <div class="employee-cron-center__menu-panel">
              <button
                type="button"
                @click=${() => {
                  this.closeOpenTaskMenus();
                  this.openDetail(job);
                }}
              >
                查看详情
              </button>
              ${
                props.onOpenExecutionChat &&
                resolvePersonalCronResultChatTargets({
                  job,
                  agents: props.executionAgents,
                  groups: props.executionGroups,
                }).length > 0
                  ? html`
                      <button
                        type="button"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this.openExecutionChat(job);
                        }}
                      >
                        在对话中查看
                      </button>
                    `
                  : nothing
              }
              <button
                type="button"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.closeOpenTaskMenus();
                  this.openForm(job);
                }}
              >
                编辑任务
              </button>
              <button
                type="button"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.closeOpenTaskMenus();
                  this.openFormFromClone(job);
                }}
              >
                复制为新任务
              </button>
              <button
                type="button"
                ?disabled=${props.busy}
                @click=${(e: Event) => void this.runTaskNow(job, e)}
              >
                立即执行
              </button>
              <button
                type="button"
                ?disabled=${props.busy}
                @click=${(e: Event) => void this.toggleTask(job, !job.enabled, e)}
              >
                ${job.enabled ? "暂停任务" : "启用任务"}
              </button>
              <button
                type="button"
                class="is-danger"
                ?disabled=${props.busy}
                @click=${(e: Event) => void this.removeTask(job, e)}
              >
                删除任务
              </button>
            </div>
          </details>
        </div>
      </article>
    `;
  }

  private renderPanel() {
    const props = this.props;
    if (!props || !this.drawerMode) {
      return nothing;
    }
    const job = this.drawerJob;
    const isForm = this.drawerMode === "form";
    return html`
      <section
        class="employee-cron-center__panel ${isForm ? "employee-cron-center__panel--wide" : ""}"
      >
        <header class="employee-cron-center__panel-head">
          <button
            type="button"
            class="employee-cron-center__panel-back"
            @click=${() => this.closeDrawer()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7"></path>
            </svg>
            返回任务列表
          </button>
          <div class="employee-cron-center__panel-title">
            ${isForm ? (props.editingJobId ? "编辑任务" : "新建任务") : "任务详情"}
          </div>
        </header>
        <div class="employee-cron-center__panel-body">
          ${
            !isForm && job
              ? renderPersonalCronDetailPanel({
                  job,
                  props,
                  statusBadge: (entry) => this.renderStatusBadge(entry),
                  onEdit: () => this.openForm(job),
                  onRun: () => props.onRun(job, "force"),
                  onToggle: () => props.onToggle(job, !job.enabled),
                  onViewLogs: async () => {
                    if (this.showRunLogsExpanded && props.runsJobId === job.id) {
                      this.showRunLogsExpanded = false;
                      this.openMenuJobId = null;
                      return;
                    }
                    props.onLoadRuns(job.id);
                    this.showRunLogsExpanded = true;
                    this.openMenuJobId = null;
                  },
                  showRunLogs: this.showRunLogsExpanded,
                  onOpenExecutionChat: props.onOpenExecutionChat
                    ? (sessionKey) => this.openExecutionChat(job, sessionKey)
                    : undefined,
                })
              : this.wizardState
                ? renderPersonalCronWizard({
                    props,
                    wizard: this.wizardState,
                    isEditing: Boolean(props.editingJobId),
                    personalTemplates: this.personalTemplates,
                    teamTemplates: this.teamTemplates,
                    onWizardChange: (patch) => this.patchWizard(patch),
                    onMetaChange: (patch) => this.patchWizardMeta(patch),
                    onFormPatch: (patch) => props.onFormChange(patch),
                    onApplyTemplate: (template) => this.applyWizardTemplate(template),
                    onApplyCopy: (job) => this.applyWizardCopy(job),
                    onDeletePersonalTemplate: (id) => this.deletePersonalTemplate(id),
                    onDeleteTeamTemplate: (id) => this.deleteTeamTemplate(id),
                    onSmartComplete: () => void this.runSmartComplete({ overwrite: true }),
                    onRecommendAgent: () => void this.runRecommendAgent(),
                    onPolishPrompt: () => void this.runPolishPrompt(),
                    onSaveAsTemplate: () => this.saveAsPersonalTemplate(),
                    onMigrateLegacyBindings: () => this.migrateWizardLegacyBindings(),
                    onRepairDataBindings: () => this.repairWizardDataBindingsAction(),
                    onBack: () => this.wizardBack(),
                    onNext: () => this.wizardNext(),
                    onSubmit: () => void this.wizardSubmit(),
                  })
                : html`
                    <div class="employee-cron-center__empty">加载中…</div>
                  `
          }
        </div>
      </section>
    `;
  }

  render() {
    const props = this.props;
    if (!props) {
      return html`
        <div class="employee-cron-center employee-cron-center--empty">
          <div class="employee-cron-center__empty">个人定时任务视图不可用。</div>
        </div>
      `;
    }

    if (this.drawerMode) {
      return html`<div class="employee-cron-center employee-cron-center--panel">
        ${this.renderPanel()}
      </div>`;
    }

    const stats = summarizePersonalCronStats(props.jobs);
    const totalDisplay = props.jobsTotal > 0 ? props.jobsTotal : stats.total;
    const filtered = this.filteredJobs();
    const pageJobs = this.paginatedJobs();
    const totalPages = this.totalPages();
    const hasSelection = this.selectedIds.size > 0;

    return html`
      <div class="employee-cron-center">
        <div class="employee-cron-center__stats">
          ${this.renderStatCard("总任务", totalDisplay, "total")}
          ${this.renderStatCard("待执行", stats.pending, "pending", "pending")}
          ${this.renderStatCard("执行中", stats.running, "running", "running")}
          ${this.renderStatCard("已完成", stats.completed, "completed", "completed")}
          ${this.renderStatCard("异常", stats.failed, "failed", "failed")}
        </div>

        <header class="employee-cron-center__toolbar">
          <div class="employee-cron-center__header-actions">
            <button type="button" class="btn" @click=${() => this.openTemplateLibrary()}>任务模板</button>
            <details class="employee-cron-center__batch-menu">
              <summary class="btn" ?aria-disabled=${!hasSelection}>批量操作</summary>
              <div class="employee-cron-center__menu-panel">
                <button type="button" ?disabled=${!hasSelection} @click=${() => void this.batchToggle(true)}>
                  批量启用
                </button>
                <button type="button" ?disabled=${!hasSelection} @click=${() => void this.batchToggle(false)}>
                  批量暂停
                </button>
                <button type="button" ?disabled=${!hasSelection} @click=${() => void this.batchRun()}>
                  批量执行
                </button>
                <button
                  type="button"
                  class="is-danger"
                  ?disabled=${!hasSelection}
                  @click=${() => void this.batchRemove()}
                >
                  批量删除
                </button>
              </div>
            </details>
            <button type="button" class="btn btn--primary" @click=${() => this.openForm()}>
              + 新建任务
            </button>
          </div>
        </header>

        ${
          props.error
            ? html`<div class="callout callout--danger employee-cron-center__error">${props.error}</div>`
            : nothing
        }
        ${
          this.actionNotice
            ? html`<div class="callout callout--success employee-cron-center__notice">${this.actionNotice}</div>`
            : nothing
        }
        ${
          props.busy
            ? html`
                <div class="callout callout--info employee-cron-center__notice">任务操作中…</div>
              `
            : nothing
        }

        <div class="employee-cron-center__filters">
          <label class="employee-cron-center__search">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6"></circle>
              <path d="M16 16l4 4"></path>
            </svg>
            <input
              type="search"
              placeholder="搜索任务名称或执行对象"
              .value=${this.searchDraft}
              @input=${(e: Event) => {
                this.searchDraft = (e.target as HTMLInputElement).value;
              }}
              @change=${() => void this.applySearch(this.searchDraft.trim())}
            />
          </label>
          <select
            class="employee-cron-center__filter-select"
            .value=${this.statusFilter}
            @change=${(e: Event) =>
              this.setStatusFilter(
                (e.target as HTMLSelectElement).value as PersonalCronStatusFilter,
              )}
          >
            <option value="all">状态</option>
            <option value="pending">待执行</option>
            <option value="running">执行中</option>
            <option value="completed">已完成</option>
            <option value="paused">已暂停</option>
            <option value="failed">执行失败</option>
          </select>
          <select
            class="employee-cron-center__filter-select"
            .value=${this.targetFilter}
            @change=${(e: Event) => {
              this.targetFilter = (e.target as HTMLSelectElement).value as PersonalCronTargetFilter;
              this.page = 1;
            }}
          >
            <option value="all">执行对象</option>
            <option value="agent">Agent</option>
            <option value="group">协作组</option>
          </select>
          <select
            class="employee-cron-center__filter-select"
            .value=${this.categoryFilter}
            @change=${(e: Event) => {
              this.categoryFilter = (e.target as HTMLSelectElement)
                .value as PersonalCronCategoryFilter;
              this.page = 1;
            }}
          >
            <option value="all">任务分类</option>
            <option value="ops">运营</option>
            <option value="sales">销售</option>
            <option value="support">客服</option>
            <option value="dev">研发</option>
            <option value="analytics">数据分析</option>
            <option value="content">内容生产</option>
            <option value="patrol">巡检</option>
            <option value="other">其他</option>
            <option value="custom">未分类</option>
          </select>
          <select
            class="employee-cron-center__filter-select"
            .value=${props.jobsSortDir === "asc" ? "asc" : "desc"}
            @change=${(e: Event) =>
              void this.applySort((e.target as HTMLSelectElement).value as "asc" | "desc")}
          >
            <option value="desc">创建时间 ↓</option>
            <option value="asc">创建时间 ↑</option>
          </select>
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${props.loading}
            @click=${() => props.onRefresh()}
          >
            ${props.loading ? "刷新中…" : "刷新"}
          </button>
        </div>

        <div class="employee-cron-center__list">
          ${
            pageJobs.length === 0
              ? html`
                  <div class="employee-cron-center__empty">暂无匹配的定时任务</div>
                `
              : pageJobs.map((job) => this.renderTaskCard(job))
          }
        </div>

        <footer class="employee-cron-center__pagination">
          <span>共 ${String(filtered.length)} 条</span>
          <div class="employee-cron-center__pagination-controls">
            <button
              type="button"
              class="btn btn--sm"
              ?disabled=${this.page <= 1}
              @click=${() => {
                this.page = Math.max(1, this.page - 1);
              }}
            >
              上一页
            </button>
            <span>${String(this.page)} / ${String(totalPages)}</span>
            <button
              type="button"
              class="btn btn--sm"
              ?disabled=${this.page >= totalPages}
              @click=${() => {
                this.page = Math.min(totalPages, this.page + 1);
              }}
            >
              下一页
            </button>
          </div>
          <select
            class="employee-cron-center__filter-select employee-cron-center__page-size"
            .value=${String(this.pageSize)}
            @change=${(e: Event) => {
              this.pageSize = Number((e.target as HTMLSelectElement).value);
              this.page = 1;
            }}
          >
            <option value="10">10 条/页</option>
            <option value="20">20 条/页</option>
            <option value="50">50 条/页</option>
          </select>
        </footer>

        ${
          props.jobsHasMore
            ? html`
                <div class="employee-cron-center__load-more">
                  <button
                    type="button"
                    class="btn"
                    ?disabled=${props.jobsLoadingMore}
                    @click=${() => props.onLoadMoreJobs()}
                  >
                    ${props.jobsLoadingMore ? "加载中…" : "加载更多任务"}
                  </button>
                </div>
              `
            : nothing
        }

      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "employee-personal-cron-center": EmployeePersonalCronCenter;
  }
}

export function renderPersonalCronCenter(props: CronProps) {
  return html`<employee-personal-cron-center .cronProps=${props}></employee-personal-cron-center>`;
}
