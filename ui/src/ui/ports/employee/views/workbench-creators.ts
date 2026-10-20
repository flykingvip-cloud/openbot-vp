import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { WorkspaceCloudProvider } from "../../../types.ts";
import {
  designConfirmBlockedReason,
  renderWorkbenchDesignIntent,
  renderWorkbenchDesignReview,
} from "./workbench-design-card.ts";
import { findDesignRole, resolveTagDraft } from "./workbench-design-catalog.ts";
import {
  labelForRole,
  resolveAgentCreatorRoleSource,
  resolveAgentCreatorStep,
  summarizeDesignCapabilities,
} from "./workbench-design-labels.ts";
import { normalizeTemplateOptions, renderTemplatePicker } from "./workbench-template-picker.ts";
import type {
  WorkbenchAgentCreatorState,
  WorkbenchAgentCreatorStep,
  WorkbenchDesignTagDraft,
  WorkbenchSpaceCreatorState,
} from "./workbench-types.ts";

type AgentCreatorDrawerProps = {
  state: WorkbenchAgentCreatorState;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onEmojiChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onWorkspaceKindChange: (value: "local" | "cloud") => void;
  onLocalPathChange: (value: string) => void;
  onValidateLocalWorkspace: () => Promise<void>;
  onOpenLocalBrowser: () => Promise<void>;
  onCloseLocalBrowser: () => void;
  onNavigateLocalBrowser: (path: string | null) => Promise<void>;
  onSelectLocalDirectory: (path: string) => void;
  onCloudProviderChange: (value: WorkspaceCloudProvider) => void;
  onCloudRegionChange: (value: string) => void;
  onCloudBucketChange: (value: string) => void;
  onCloudRootPrefixChange: (value: string) => void;
  onCloudEndpointChange: (value: string) => void;
  onCloudAccountNameChange: (value: string) => void;
  onCloudAccessKeyIdChange: (value: string) => void;
  onCloudSecretAccessKeyChange: (value: string) => void;
  onGenerateCloudConfig: () => Promise<void>;
  onTestCloudConnection: () => Promise<void>;
  onOpenCloudBrowser: () => Promise<void>;
  onCloseCloudBrowser: () => void;
  onNavigateCloudBrowser: (path: string | null) => Promise<void>;
  onSelectCloudDirectory: (path: string) => void;
  onSubmit: () => Promise<void>;
  onDesignIntentChange?: (value: string) => void;
  onDesignRevisionChange?: (value: string) => void;
  onDesignTagDraftChange?: (draft: WorkbenchDesignTagDraft) => void;
  onCompileDesign?: () => Promise<void>;
  onReviseDesign?: () => Promise<void>;
  onConfirmDesign?: () => Promise<void>;
  onWizardBack?: () => void;
  onUseTemplatePath?: () => void;
  onSelectStep?: (step: WorkbenchAgentCreatorStep) => void;
};

type SpaceCreatorDrawerProps = {
  state: WorkbenchSpaceCreatorState;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onAvatarChange: (value: string) => void;
  onPurposeChange: (value: string) => void;
  onCurrentMissionChange: (value: string) => void;
  onSystemInstructionsChange: (value: string) => void;
  onGroupIdChange: (value: string) => void;
  onBack: () => void;
  onToggleHumanSelection: (id: string) => void;
  onToggleBotSelection: (id: string) => void;
  onCoordinatorChange: (value: string) => void;
  onSubmit: () => Promise<void>;
};

const SPACE_AVATAR_PRESETS = [
  { value: "🛰️", label: "协同中枢" },
  { value: "🧩", label: "协作拼图" },
  { value: "🎯", label: "攻坚小队" },
  { value: "🛡️", label: "守护单元" },
  { value: "🌐", label: "联接网络" },
  { value: "🚀", label: "推进编队" },
  { value: "📡", label: "信号站" },
  { value: "🪐", label: "轨道小组" },
] as const;

function renderCreatorShell(
  kicker: string,
  title: string,
  subtitle: string,
  error: string | null,
  body: ReturnType<typeof html>,
  onClose: () => void,
  backLabel: string,
  wide = false,
) {
  const backAria = backLabel.trim() || "返回";
  return html`
    <section
      class="employee-workbench__creator-panel employee-workbench__creator-panel--flat ${wide ? "employee-workbench__creator-panel--wide" : ""}"
    >
      <header class="employee-workbench__creator-panel-head">
        <button
          type="button"
          class="employee-workbench__creator-panel-back ${backLabel.trim() ? "" : "employee-workbench__creator-panel-back--icon"}"
          aria-label=${backAria}
          title=${backAria}
          @click=${onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7"></path>
          </svg>
          ${backLabel.trim() ? backLabel : nothing}
        </button>
        <div class="employee-workbench__creator-panel-copy">
          ${
            kicker.trim()
              ? html`<div class="employee-workbench__creator-panel-kicker">${kicker}</div>`
              : nothing
          }
          ${title ? html`<div class="employee-workbench__creator-panel-title">${title}</div>` : nothing}
          ${
            subtitle
              ? html`<div class="employee-workbench__creator-panel-sub">${subtitle}</div>`
              : nothing
          }
        </div>
      </header>
      ${error ? html`<div class="employee-workbench__creator-panel-error">${error}</div>` : nothing}
      ${body}
    </section>
  `;
}

function submitCreatorForm(event: Event, onSubmit: () => Promise<void>) {
  event.preventDefault();
  void onSubmit();
}

function renderFieldLabel(title: string, meta?: string) {
  return html`
    <span class="employee-workbench__creator-label-row">
      <span class="employee-workbench__creator-label-title">${title}</span>
      ${meta ? html`<span class="employee-workbench__creator-label-meta">${meta}</span>` : nothing}
    </span>
  `;
}

function renderCreatorStepPill(label: string, active: boolean) {
  return html`
    <span class="employee-workbench__creator-step-pill ${active ? "is-active" : ""}">
      ${label}
    </span>
  `;
}

function renderSpaceAvatarPicker(props: { value: string; onChange: (value: string) => void }) {
  return html`
    <div class="employee-workbench__space-avatar-picker">
      <div class="employee-workbench__space-avatar-grid">
        ${SPACE_AVATAR_PRESETS.map(
          (entry) => html`
            <button
              type="button"
              class="employee-workbench__space-avatar-option ${
                entry.value === props.value ? "is-active" : ""
              }"
              aria-label=${entry.label}
              title=${entry.label}
              @click=${() => props.onChange(entry.value)}
            >
              <span class="employee-workbench__space-avatar-option-glyph">${entry.value}</span>
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

function renderSelectionSection(props: {
  title: string;
  entries: WorkbenchSpaceCreatorState["candidateHumans"];
  selectedIds: Set<string>;
  emptyLabel: string;
  compact?: boolean;
  onToggle: (id: string) => void;
}) {
  const groups = new Map<string, WorkbenchSpaceCreatorState["candidateHumans"]>();
  for (const entry of props.entries) {
    const key = entry.group?.trim() || "默认";
    const current = groups.get(key) ?? [];
    current.push(entry);
    groups.set(key, current);
  }
  return html`
    <section class="employee-workbench__creator-member-column">
      <div class="employee-workbench__creator-member-heading">
        <span>${props.title}</span>
        <span class="employee-workbench__creator-member-count">${props.entries.length}</span>
      </div>
      <div class="employee-workbench__member-governance-candidate-pane">
        ${
          props.entries.length > 0
            ? [...groups.entries()].map(
                ([groupLabel, groupEntries]) => html`
                  <div class="employee-workbench__member-governance-candidate-group">
                    ${
                      groupLabel !== "默认"
                        ? html`
                          <div class="employee-workbench__member-governance-candidate-group-title">
                            ${groupLabel}
                          </div>
                        `
                        : nothing
                    }
                    ${groupEntries.map(
                      (entry) => html`
                        <label
                          class="employee-workbench__member-governance-candidate ${
                            props.compact
                              ? "employee-workbench__member-governance-candidate--compact"
                              : ""
                          }"
                        >
                          <input
                            type="checkbox"
                            .checked=${props.selectedIds.has(entry.id)}
                            @change=${() => props.onToggle(entry.id)}
                          />
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
                        </label>
                      `,
                    )}
                  </div>
                `,
              )
            : html`
                <div class="employee-workbench__creator-browser-empty">${props.emptyLabel}</div>
              `
        }
      </div>
    </section>
  `;
}

function renderActionButtons(actions: Array<ReturnType<typeof html>>) {
  return html`<div class="employee-workbench__creator-action-buttons">${actions}</div>`;
}

function renderStatusBanner(kind: "success" | "error" | "info", text: string | null) {
  if (!text) {
    return nothing;
  }
  return html`
    <div class="employee-workbench__creator-status employee-workbench__creator-status--${kind}">
      ${text}
    </div>
  `;
}

function filterBotCandidatesBySelectedHumans(state: WorkbenchSpaceCreatorState) {
  if (state.selectedHumanIds.length === 0) {
    return state.candidateBots;
  }
  const selectedHumanIds = new Set(state.selectedHumanIds);
  const selectedHumanLabels = new Set(
    state.candidateHumans
      .filter((entry) => selectedHumanIds.has(entry.id))
      .map((entry) => entry.label.trim())
      .filter(Boolean),
  );
  return state.candidateBots.filter((entry) => {
    const ownerId = entry.ownerId?.trim();
    const ownerName = entry.ownerName?.trim();
    const group = entry.group?.trim();
    const isOwnedByMe = group === "我的机器人" || (!ownerId && !ownerName);
    if (isOwnedByMe) {
      return true;
    }
    if (ownerId && selectedHumanIds.has(ownerId)) {
      return true;
    }
    if (ownerName && selectedHumanLabels.has(ownerName)) {
      return true;
    }
    return false;
  });
}

function renderAgentCreatorTemplatePicker(props: AgentCreatorDrawerProps) {
  if (props.state.templatesLoading) {
    return renderStatusBanner("info", t("frontstage.workbench.growth.creator.templateLoading"));
  }
  const options = normalizeTemplateOptions({ templates: props.state.templates });
  if (options.length === 0) {
    return renderStatusBanner("info", t("frontstage.workbench.growth.creator.templateEmpty"));
  }
  return renderTemplatePicker({
    options,
    selectedTemplateId: props.state.templateId || "generic_worker",
    onSelect: props.onTemplateChange,
  });
}

function renderAgentCreatorWorkspaceSummary(props: AgentCreatorDrawerProps) {
  if (props.state.managedWorkspace) {
    return html`
      <div class="employee-workbench__creator-field employee-workbench__creator-field--wide">
        ${renderFieldLabel("默认空间")}
        <div class="employee-workbench__creator-kv">
          <div class="employee-workbench__creator-kv-row">
            <div class="employee-workbench__creator-kv-label">存储方式</div>
            <div class="employee-workbench__creator-kv-value">由 OpenBot 自动管理</div>
          </div>
        </div>
      </div>
    `;
  }
  const rootPath = props.state.localValidation.resolvedPath ?? props.state.localPath;
  const statusBanner =
    props.state.localValidation.state === "invalid"
      ? renderStatusBanner("error", props.state.localValidation.message)
      : props.state.localValidation.state === "valid"
        ? nothing
        : renderStatusBanner("info", "请先在个人设置中配置 OpenBot 工作空间根目录，再创建机器人。");
  return html`
    <div class="employee-workbench__creator-field employee-workbench__creator-field--wide">
      ${renderFieldLabel("默认空间")}
      <div class="employee-workbench__creator-kv">
        <div class="employee-workbench__creator-kv-row">
          <div class="employee-workbench__creator-kv-label">工作目录</div>
          <div class="employee-workbench__creator-kv-value">
            <div class="mono">${rootPath.trim() || "请先在个人设置中完成配置"}</div>
          </div>
        </div>
      </div>
      ${statusBanner}
    </div>
  `;
}

function renderAgentCreatorStepPills(params: {
  step: WorkbenchAgentCreatorStep;
  canReview: boolean;
  canIdentity: boolean;
  onSelect?: (step: WorkbenchAgentCreatorStep) => void;
}) {
  const items: Array<{ id: WorkbenchAgentCreatorStep; label: string; enabled: boolean }> = [
    { id: "intent", label: "1. 描述需求", enabled: true },
    { id: "review", label: "2. 校对设计", enabled: params.canReview },
    { id: "identity", label: "3. 命名并创建", enabled: params.canIdentity },
  ];
  return html`
    <div class="employee-workbench__creator-steps" aria-label="创建步骤">
      ${items.map((item) => {
        const active = item.id === params.step;
        return html`
          <button
            type="button"
            class="employee-workbench__creator-step-pill ${active ? "is-active" : ""}"
            ?disabled=${!item.enabled}
            aria-current=${active ? "step" : undefined}
            @click=${() => {
              if (item.enabled && !active) {
                params.onSelect?.(item.id);
              }
            }}
          >
            ${item.label}
          </button>
        `;
      })}
    </div>
  `;
}

function renderAgentCreatorIdentityForm(props: AgentCreatorDrawerProps, showTemplates: boolean) {
  const mapping = props.state.design.mapping;
  const draft = resolveTagDraft(props.state.design);
  const roleLabel =
    findDesignRole(draft.roleId)?.label ??
    (mapping ? labelForRole(mapping.role.display || mapping.role.blueprintId) : "");
  const capabilityLabel = mapping ? summarizeDesignCapabilities(mapping, props.state.design) : "";
  return html`
    <section class="employee-workbench__creator-form employee-workbench__creator-form--agent">
      ${
        mapping
          ? html`
              <details class="employee-workbench__creator-design-summary">
                <summary class="employee-workbench__creator-design-summary-toggle">
                  <span class="employee-workbench__creator-design-summary-copy">
                    <span class="employee-workbench__creator-design-summary-title">${roleLabel}</span>
                    <span class="employee-workbench__creator-design-summary-meta">${capabilityLabel}</span>
                  </span>
                  <span class="employee-workbench__creator-design-summary-action">查看设计</span>
                </summary>
                ${renderWorkbenchDesignReview({
                  design: { ...props.state.design, confirmed: true },
                })}
              </details>
            `
          : nothing
      }
      <label class="employee-workbench__creator-field employee-workbench__creator-field--wide">
        ${renderFieldLabel("机器人名称")}
        <input
          type="text"
          .value=${props.state.name}
          placeholder="例如：市场分析助手"
          @input=${(event: Event) =>
            props.onNameChange((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      <label class="employee-workbench__creator-field employee-workbench__creator-field--wide">
        ${renderFieldLabel("头像设置", "可选")}
        <input
          type="text"
          .value=${props.state.emoji}
          placeholder="🤖"
          maxlength="8"
          @input=${(event: Event) =>
            props.onEmojiChange((event.currentTarget as HTMLInputElement).value)}
        />
      </label>
      ${
        showTemplates
          ? html`
              <div class="employee-workbench__creator-field employee-workbench__creator-field--wide">
                ${renderFieldLabel(
                  t("frontstage.workbench.growth.creator.templateTitle"),
                  t("frontstage.workbench.growth.creator.templateHint"),
                )}
                ${renderAgentCreatorTemplatePicker(props)}
              </div>
            `
          : nothing
      }
      ${renderAgentCreatorWorkspaceSummary(props)}
    </section>
  `;
}

export function renderWorkbenchAgentCreatorDrawer(props: AgentCreatorDrawerProps) {
  if (!props.state.open) {
    return nothing;
  }
  const workspaceReady =
    props.state.managedWorkspace ||
    (Boolean((props.state.localValidation.resolvedPath ?? props.state.localPath).trim()) &&
      props.state.localValidation.state === "valid");
  const roleSource = resolveAgentCreatorRoleSource(props.state);
  const step = resolveAgentCreatorStep(props.state);
  const hasMapping = Boolean(props.state.design.mapping);
  const canReview = roleSource === "ai" && hasMapping;
  const canIdentity = roleSource === "template" || props.state.design.confirmed;
  const confirmBlocked = designConfirmBlockedReason(props.state.design);
  const compileDisabled =
    props.state.design.busy || !props.state.design.intentText.trim() || !props.onCompileDesign;
  const submitDisabled =
    props.state.busy || !props.state.name.trim() || !workspaceReady || !canIdentity;
  const primaryBusy = props.state.busy || props.state.design.busy;

  const secondaryButtons: Array<ReturnType<typeof html>> = [];
  if (step === "intent") {
    secondaryButtons.push(
      html`<button type="button" class="btn btn--sm" @click=${props.onClose}>
        ${t("common.cancel")}
      </button>`,
      html`<button type="button" class="btn btn--sm" @click=${() => props.onUseTemplatePath?.()}>
        从模板开始
      </button>`,
    );
  } else {
    secondaryButtons.push(
      html`<button type="button" class="btn btn--sm" @click=${() => props.onWizardBack?.()}>
        上一步
      </button>`,
    );
  }

  const primaryButton =
    step === "intent"
      ? html`<button
          type="button"
          class="btn btn--sm primary"
          data-creator-primary="compile"
          ?disabled=${compileDisabled}
          title=${compileDisabled && !props.state.design.intentText.trim() ? "请先描述你想要的数字员工" : ""}
          @click=${() => void props.onCompileDesign?.()}
        >
          ${props.state.design.busy ? "理解中…" : hasMapping ? "重新生成设计" : "生成设计"}
        </button>`
      : step === "review"
        ? html`<button
            type="button"
            class="btn btn--sm primary"
            data-creator-primary="confirm"
            ?disabled=${primaryBusy || Boolean(confirmBlocked)}
            title=${confirmBlocked ?? ""}
            @click=${() => void props.onConfirmDesign?.()}
          >
            ${props.state.design.busy ? "确认中…" : "确认并继续"}
          </button>`
        : html`<button
            type="submit"
            class="btn btn--sm primary"
            data-creator-primary="create"
            ?disabled=${submitDisabled}
            title=${
              !props.state.name.trim()
                ? "请先填写机器人名称"
                : !workspaceReady
                  ? "请先完成工作空间配置"
                  : ""
            }
          >
            ${props.state.busy ? t("common.loading") : "创建机器人"}
          </button>`;

  const stepBody =
    step === "intent"
      ? renderWorkbenchDesignIntent({
          design: props.state.design,
          onIntentChange: (value) => props.onDesignIntentChange?.(value),
        })
      : step === "review"
        ? renderWorkbenchDesignReview({
            design: props.state.design,
            onTagDraftChange: (draft) => props.onDesignTagDraftChange?.(draft),
            onUseTemplatePath: () => props.onUseTemplatePath?.(),
          })
        : renderAgentCreatorIdentityForm(props, roleSource === "template");

  return renderCreatorShell(
    "",
    "新建数字员工",
    "",
    props.state.error,
    html`
      <form
        class="employee-workbench__creator-body employee-workbench__creator-body--wizard"
        @submit=${(event: Event) => submitCreatorForm(event, props.onSubmit)}
      >
        ${renderAgentCreatorStepPills({
          step,
          canReview,
          canIdentity,
          onSelect: props.onSelectStep,
        })}
        <div class="employee-workbench__creator-wizard-main">${stepBody}</div>
        <div class="employee-workbench__creator-actions employee-workbench__creator-actions--sticky">
          ${renderActionButtons([...secondaryButtons, primaryButton])}
        </div>
      </form>
    `,
    props.onClose,
    "",
  );
}

export function renderWorkbenchSpaceCreatorDrawer(props: SpaceCreatorDrawerProps) {
  if (!props.state.open) {
    return nothing;
  }
  const selectedHumanIds = new Set(props.state.selectedHumanIds);
  const selectedBotIds = new Set(props.state.selectedBotIds);
  const filteredBotCandidates = filterBotCandidatesBySelectedHumans(props.state);
  const isMembersStep = props.state.step === "members";
  return renderCreatorShell(
    "",
    "新建协作空间",
    "",
    props.state.error,
    html`
      <form
        class="employee-workbench__creator-body"
        @submit=${(event: Event) => submitCreatorForm(event, props.onSubmit)}
      >
        <div class="employee-workbench__creator-steps" aria-label="创建步骤">
          ${renderCreatorStepPill("1. 基本信息", props.state.step === "details")}
          ${renderCreatorStepPill("2. 选择成员与机器人", isMembersStep)}
        </div>

        ${
          props.state.step === "details"
            ? html`
                <section class="employee-workbench__creator-form employee-workbench__creator-form--space">
                  <label class="employee-workbench__creator-field">
                    ${renderFieldLabel("小组名称")}
                    <input
                      type="text"
                      .value=${props.state.title}
                      placeholder="例如：产品研发小组"
                      @input=${(event: Event) =>
                        props.onTitleChange((event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <label class="employee-workbench__creator-field employee-workbench__creator-field--wide">
                    ${renderFieldLabel("小组标识")}
                    ${renderSpaceAvatarPicker({
                      value: props.state.avatar,
                      onChange: props.onAvatarChange,
                    })}
                  </label>
                  <label class="employee-workbench__creator-field employee-workbench__creator-field--wide">
                    ${renderFieldLabel("小组定位", "建议一句话说清这个群负责什么")}
                    <textarea
                      rows="3"
                      .value=${props.state.purpose}
                      placeholder="例如：负责战略研究与咨询，为后续项目提供方向判断与分析支持"
                      @input=${(event: Event) =>
                        props.onPurposeChange((event.currentTarget as HTMLTextAreaElement).value)}
                    ></textarea>
                  </label>
                  <label class="employee-workbench__creator-field employee-workbench__creator-field--wide">
                    ${renderFieldLabel("当前使命", "说明这个阶段群里正在推进什么")}
                    <textarea
                      rows="3"
                      .value=${props.state.currentMission}
                      placeholder="例如：明确未来三个月的研究方向、优先级和输出节奏"
                      @input=${(event: Event) =>
                        props.onCurrentMissionChange(
                          (event.currentTarget as HTMLTextAreaElement).value,
                        )}
                    ></textarea>
                  </label>
                  <label class="employee-workbench__creator-field employee-workbench__creator-field--wide">
                    ${renderFieldLabel("协作规则", "每行一条，后续会写入群初始化记忆")}
                    <textarea
                      rows="5"
                      .value=${props.state.systemInstructions}
                      placeholder=${["新成员进入后先自我介绍", "重要结论要沉淀为群记忆", "未获人类推进时机器人不无限自推进"].join("\n")}
                      @input=${(event: Event) =>
                        props.onSystemInstructionsChange(
                          (event.currentTarget as HTMLTextAreaElement).value,
                        )}
                    ></textarea>
                  </label>
                </section>
              `
            : html`
                <section class="employee-workbench__creator-member-grid">
                  ${renderSelectionSection({
                    title: "选择成员",
                    entries: props.state.candidateHumans,
                    selectedIds: selectedHumanIds,
                    emptyLabel: "当前没有可加入的其他小组成员。",
                    onToggle: props.onToggleHumanSelection,
                  })}
                  ${renderSelectionSection({
                    title: "选择机器人",
                    entries: filteredBotCandidates,
                    selectedIds: selectedBotIds,
                    compact: true,
                    emptyLabel:
                      props.state.selectedHumanIds.length > 0
                        ? "当前已选成员下没有可加入的共享机器人。"
                        : "当前没有可加入的小组机器人。",
                    onToggle: props.onToggleBotSelection,
                  })}
                  <label class="employee-workbench__creator-field employee-workbench__creator-field--wide">
                    ${renderFieldLabel("主负责人（协调机器人）", "从已选机器人指定。不选则没有常设主负责，系统只按轮提名主答，不会自动把大白设为主负责")}
                    <select
                      .value=${props.state.coordinatorBotId}
                      @change=${(event: Event) =>
                        props.onCoordinatorChange((event.currentTarget as HTMLSelectElement).value)}
                    >
                      <option value="">无主负责人</option>
                      ${filteredBotCandidates
                        .filter((entry) => selectedBotIds.has(entry.id))
                        .map(
                          (entry) => html`
                            <option value=${entry.id}>${entry.label}</option>
                          `,
                        )}
                    </select>
                  </label>
                </section>
              `
        }

        <div class="employee-workbench__creator-actions">
          ${
            props.state.step === "details"
              ? renderActionButtons([
                  html`<button type="button" class="btn btn--sm" @click=${props.onClose}>
                    ${t("common.cancel")}
                  </button>`,
                  html`<button type="submit" class="btn btn--sm primary" ?disabled=${props.state.busy}>
                    下一步
                  </button>`,
                ])
              : renderActionButtons([
                  html`<button type="button" class="btn btn--sm" @click=${props.onClose}>
                    ${t("common.cancel")}
                  </button>`,
                  html`<button type="button" class="btn btn--sm" @click=${props.onBack}>
                    上一步
                  </button>`,
                  html`<button type="submit" class="btn btn--sm primary" ?disabled=${props.state.busy}>
                    ${props.state.busy ? t("common.loading") : "创建小组"}
                  </button>`,
                ])
          }
        </div>
      </form>
    `,
    props.onClose,
    "",
    true,
  );
}
