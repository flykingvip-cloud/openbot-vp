import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import { isBuiltinStewardSelection } from "../../../builtin-steward-selection.ts";
import { sessionKeysShareChatSurface } from "../../../chat-session-key-match.ts";
import { icons } from "../../../icons.ts";
import { renderRobotCapabilityTab } from "../../../views/robot-capability-tab.ts";
import { renderSaveSkillModal } from "../../../views/save-skill-modal.ts";
import { renderGroupProfileStageView } from "./group-profile-governance.ts";
import type { EmployeeWorkbenchSurfaceRuntime } from "./home-page-contracts.ts";
import { renderGrowthBadge } from "./workbench-growth-badge.ts";
import type { WorkbenchHomeModel } from "./workbench-home-model.ts";
import type { WorkbenchShellModel } from "./workbench-shell-model.ts";
import { DAIBAI_GUIDE_PROMPT, renderAssistantStagePage } from "./workbench-stage-assistant.ts";
import {
  renderCollaborationMembersManagementPage,
  renderCollaborationReasonDrawer,
  renderCollaborationRulesDrawer,
  renderCollaborationStagePage,
  renderCollaborationStatusCapsule,
  renderCollaborationStatusTools,
} from "./workbench-stage-collaboration.ts";
import {
  buildWorkbenchStageConversationContract,
  buildWorkbenchStageModuleContract,
} from "./workbench-stage-contracts.ts";
import { renderStageSubtitle } from "./workbench-stage-copy.ts";
import { renderModuleContentPage } from "./workbench-stage-module.ts";
import type { WorkbenchStageProps } from "./workbench-types.ts";

function resolveStageItemTitle(
  shellModel: WorkbenchShellModel,
  settingsView: WorkbenchStageProps["settingsView"] = "system",
  activeSessionKey = "",
) {
  if (shellModel.primaryModule === "collaboration") {
    const spaceKey = shellModel.selectedSpaceItem?.selectionKey?.trim() ?? "";
    const sessionKey = activeSessionKey.trim();
    // Title must not imply a group while the open sessionKey is still a different
    // surface (e.g. main employee 1:1). Prefer empty over a misleading TO: label.
    if (spaceKey && sessionKey && !sessionKeysShareChatSurface(spaceKey, sessionKey)) {
      return "";
    }
    if (
      spaceKey &&
      sessionKey &&
      (spaceKey.startsWith("space:") || spaceKey.includes(":space:")) &&
      !(sessionKey.startsWith("space:") || sessionKey.includes(":space:"))
    ) {
      return "";
    }
    return (
      shellModel.selectedSpaceItem?.rawTitle ??
      shellModel.selectedSpaceItem?.title ??
      t("frontstage.workbench.nav.collaborationSpaces")
    );
  }
  if (shellModel.primaryModule === "knowledge") {
    return t("frontstage.workbench.nav.knowledgeVerse");
  }
  if (shellModel.primaryModule === "tasks") {
    return t("frontstage.workbench.nav.myTasks");
  }
  if (shellModel.primaryModule === "settings") {
    return settingsView === "personal"
      ? t("frontstage.workbench.profileMenu.personalSettings")
      : t("frontstage.workbench.nav.systemSettings");
  }
  return (
    shellModel.selectedAssistantItem?.rawTitle ??
    shellModel.selectedAssistantItem?.title ??
    t("frontstage.workbench.nav.aiAssistant")
  );
}

export function sanitizeWorkbenchPeerTitle(title: string): string {
  return title
    .replace(/管家家+$/u, "管家")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveStageDisplayTitle(
  primaryModule: WorkbenchShellModel["primaryModule"],
  itemTitle: string,
) {
  const normalized = sanitizeWorkbenchPeerTitle(itemTitle);
  if (!normalized) {
    return "";
  }
  if (primaryModule === "collaboration" || primaryModule === "assistant") {
    return `TO: ${normalized}`;
  }
  return normalized;
}

function renderComputerExitFullscreen(onExit: (() => void) | null | undefined) {
  if (!onExit) {
    return nothing;
  }
  const label = t("chat.computerExitFullscreen");
  return html`
    <button
      type="button"
      class="btn btn--sm employee-workbench__stage-collaboration-tool employee-workbench__stage-collaboration-tool--icon"
      data-testid="computer-exit-fullscreen"
      aria-label=${label}
      title=${label}
      @click=${() => onExit()}
    >
      ${icons.x}
    </button>
  `;
}

function renderStagePreviewTool(onOpenFilePreview: (() => void) | null | undefined) {
  if (!onOpenFilePreview) {
    return null;
  }
  return html`
    <button
      type="button"
      class="btn btn--sm employee-workbench__stage-collaboration-tool employee-workbench__stage-collaboration-tool--icon"
      aria-label=${t("chat.openArtifact")}
      title=${t("chat.openArtifact")}
      @click=${() => onOpenFilePreview()}
    >
      ${icons.fileText}
    </button>
  `;
}

function renderInlineSkillSaveDrawer(props: WorkbenchStageProps) {
  if (!props.skillSaveModalInline || !props.skillSaveModalOpen || !props.skillSaveModalFormData) {
    return nothing;
  }
  return html`
    <div class="employee-workbench__skill-save-drawer" role="presentation">
      ${renderSaveSkillModal({
        open: true,
        busy: props.skillSaveModalBusy ?? false,
        error: props.skillSaveModalError ?? null,
        formData: props.skillSaveModalFormData,
        extractedPreview: props.skillExtractedPreview ?? null,
        availableGroups: props.skillAvailableGroups ?? [],
        preferEnterpriseSubmitAction: props.skillSaveModalPreferEnterpriseSubmit ?? false,
        showEnterpriseSubmitAction: props.skillSaveModalShowEnterpriseSubmitAction ?? false,
        inlineMode: true,
        assetIncubationLevel: props.assetIncubationLevel ?? null,
        autofillHint: props.skillAutofillHint ?? null,
        onFormChange: (patch) => props.onSkillSaveFormChange?.(patch),
        onSave: () => void props.onSubmitSkillSave?.(),
        onSaveAndSubmit: () => void props.onSubmitSkillSaveAndContinue?.(),
        onClose: () => props.onCloseSkillSave?.(),
      })}
    </div>
  `;
}

function renderDaibaiGuideTool(daibaiStage: {
  onAskDaibai?: ((message?: string) => Promise<void>) | null;
  daibaiLoading?: boolean;
}) {
  if (!daibaiStage.onAskDaibai) {
    return null;
  }
  return html`
    <button
      type="button"
      class="btn btn--sm employee-workbench__stage-collaboration-tool"
      ?disabled=${daibaiStage.daibaiLoading}
      @click=${() => daibaiStage.onAskDaibai?.(DAIBAI_GUIDE_PROMPT)}
    >
      ${daibaiStage.daibaiLoading ? "引导中…" : "问大白"}
    </button>
  `;
}

function renderDaibaiHelpTool(
  moduleLabel: string,
  daibaiStage: {
    onOpenDaibaiHelp?: ((params: { moduleLabel: string }) => Promise<void>) | null;
    daibaiLoading?: boolean;
  },
) {
  if (!daibaiStage.onOpenDaibaiHelp) {
    return null;
  }
  return html`
    <button
      type="button"
      class="btn btn--sm employee-workbench__stage-collaboration-tool"
      ?disabled=${daibaiStage.daibaiLoading}
      @click=${() => daibaiStage.onOpenDaibaiHelp?.({ moduleLabel })}
    >
      问大白
    </button>
  `;
}

export function renderWorkbenchStage(
  props: WorkbenchStageProps,
  shellModel: WorkbenchShellModel,
  model: WorkbenchHomeModel,
  showConversationShell: boolean,
  surfaceRuntime?: EmployeeWorkbenchSurfaceRuntime,
) {
  const itemTitle = resolveStageItemTitle(shellModel, props.settingsView, props.activeSessionKey);
  const stageDisplayTitle = resolveStageDisplayTitle(shellModel.primaryModule, itemTitle);
  const conversationContract = buildWorkbenchStageConversationContract(props);
  const moduleContract = buildWorkbenchStageModuleContract(props, model, {
    collaboration: surfaceRuntime?.proactive.collaboration,
    daibai: surfaceRuntime?.view.daibaiStage,
    knowledge: surfaceRuntime?.future.knowledge,
  });
  const groupProfileView = props.groupProfileView ?? "chat";
  const isCollaborationMode = shellModel.primaryModule === "collaboration";
  const isAssistantMode = shellModel.primaryModule === "assistant";
  const isMembersManagementView = isCollaborationMode && groupProfileView === "members";
  const isConversationMode =
    (shellModel.primaryModule === "assistant" || shellModel.primaryModule === "collaboration") &&
    !isMembersManagementView;
  const showAuthOnlyStage = isConversationMode && Boolean(conversationContract.authPanel);
  const isHeadlessModule =
    shellModel.primaryModule === "knowledge" ||
    shellModel.primaryModule === "tasks" ||
    shellModel.primaryModule === "settings";
  const showStageHead = !showAuthOnlyStage && !isHeadlessModule;
  const showGroupProfileView =
    isCollaborationMode && groupProfileView !== "chat" && groupProfileView !== "members";
  const isDaibaiAssistant =
    !isCollaborationMode &&
    isBuiltinStewardSelection({
      sessionKey: props.activeSessionKey,
      workbenchTeamSelectedKey: shellModel.selectedAssistantItem?.selectionKey,
      sessionDefaults: props.sessionDefaults,
    });
  const showModuleDaibaiHelpTool =
    (shellModel.primaryModule === "knowledge" || shellModel.primaryModule === "settings") &&
    Boolean(moduleContract.daibai.onOpenDaibaiHelp);
  // Stage 顶栏不再承载资产整理入口；预览区为唯一治理入口（保存 + L2–L4 提醒）。
  const showAssistantPreviewTool =
    shellModel.primaryModule === "assistant" && Boolean(props.onOpenFilePreview);
  const showAssistantStageActions = showAssistantPreviewTool;
  const showDaibaiGuideTool =
    isDaibaiAssistant &&
    Boolean(moduleContract.daibai.onAskDaibai) &&
    Boolean(props.daibaiGuideAcknowledged);
  const showComputerExit =
    props.computerFullscreen === true && Boolean(props.onExitComputerFullscreen);
  const computerExit = showComputerExit
    ? renderComputerExitFullscreen(props.onExitComputerFullscreen)
    : nothing;
  const showAssistantHeadActions =
    showAssistantStageActions ||
    showDaibaiGuideTool ||
    showModuleDaibaiHelpTool ||
    showComputerExit;
  const stageHeadClass = [
    "employee-workbench__stage-head",
    "employee-workbench__stage-head--flat",
    isCollaborationMode ? "employee-workbench__stage-head--collaboration" : "",
    isAssistantMode ? "employee-workbench__stage-head--assistant" : "",
    !isCollaborationMode && !isAssistantMode && showAssistantHeadActions
      ? "employee-workbench__stage-head--with-actions"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const stageBody =
    shellModel.primaryModule === "assistant"
      ? props.robotWorkbenchTab === "skills" && props.robotCapabilityTabProps
        ? renderRobotCapabilityTab(props.robotCapabilityTabProps)
        : renderAssistantStagePage(conversationContract, shellModel, moduleContract.daibai, props)
      : shellModel.primaryModule === "collaboration"
        ? isMembersManagementView
          ? renderCollaborationMembersManagementPage(moduleContract.collaboration)
          : showGroupProfileView
            ? renderGroupProfileStageView({
                itemTitle,
                view: groupProfileView,
                snapshot: props.collaborationGovernanceSnapshot ?? null,
                onGroupProfileViewChange: props.onGroupProfileViewChange ?? null,
                onOpenGovernanceObjectDetail: props.onOpenGovernanceObjectDetail ?? null,
                onDecisionOptionDraftChange: props.onDecisionOptionDraftChange ?? null,
                onDecisionRationaleDraftChange: props.onDecisionRationaleDraftChange ?? null,
                onSaveDecisionDraft: props.onSaveDecisionDraft ?? null,
                onTransitionGovernanceObject: props.onTransitionGovernanceObject ?? null,
              })
            : renderCollaborationStagePage(
                conversationContract,
                shellModel,
                model,
                moduleContract.collaboration,
                props.collaborationSpacesSnapshot,
              )
        : renderModuleContentPage(
            moduleContract,
            shellModel,
            itemTitle,
            renderStageSubtitle(
              shellModel.primaryModule,
              itemTitle,
              shellModel.panelSubtitle,
              props.settingsView,
            ),
          );

  const stageHeading = html`
    <div class="employee-workbench__stage-heading">
      <div class="employee-workbench__stage-title employee-workbench__panel-title">
        <span class="employee-workbench__stage-title-text">${stageDisplayTitle}</span>
        ${isConversationMode ? renderGrowthBadge(props.activeGrowthStatus ?? null) : nothing}
      </div>
      <div class="employee-workbench__stage-subtitle">
        ${renderStageSubtitle(
          shellModel.primaryModule,
          itemTitle,
          shellModel.panelSubtitle,
          props.settingsView,
        )}
      </div>
    </div>
  `;

  return html`
    <section
      class="employee-workbench__stage-shell employee-workbench__stage-shell--flat ${
        isHeadlessModule ? "employee-workbench__stage-shell--headless" : ""
      }"
    >
      ${
        showStageHead
          ? html`
              <div class=${stageHeadClass}>
                ${
                  isCollaborationMode
                    ? html`
                      <div class="employee-workbench__stage-head-align">
                        ${stageHeading}
                        <div class="employee-workbench__stage-head-capsule">
                          ${renderCollaborationStatusCapsule(
                            shellModel,
                            model,
                            props.collaborationSpacesSnapshot,
                            moduleContract.collaboration,
                          )}
                        </div>
                        <div class="employee-workbench__stage-head-actions">
                          ${computerExit}
                          ${renderCollaborationStatusTools(
                            shellModel,
                            model,
                            props.collaborationSpacesSnapshot,
                            moduleContract.collaboration,
                          )}
                        </div>
                      </div>
                    `
                    : isAssistantMode
                      ? html`
                        <div class="employee-workbench__stage-head-align">
                          ${stageHeading}
                          ${
                            showAssistantHeadActions
                              ? html`
                                <div class="employee-workbench__stage-head-actions">
                                  ${computerExit}
                                  ${showDaibaiGuideTool ? renderDaibaiGuideTool(moduleContract.daibai) : null}
                                  ${
                                    showModuleDaibaiHelpTool
                                      ? renderDaibaiHelpTool(itemTitle, moduleContract.daibai)
                                      : null
                                  }
                                  ${renderStagePreviewTool(props.onOpenFilePreview)}
                                </div>
                              `
                              : nothing
                          }
                        </div>
                      `
                      : html`
                      ${stageHeading}
                      <div class="employee-workbench__stage-head-line" aria-hidden="true"></div>
                      ${
                        showAssistantHeadActions
                          ? html`
                            <div class="employee-workbench__stage-head-actions">
                              ${showDaibaiGuideTool ? renderDaibaiGuideTool(moduleContract.daibai) : null}
                              ${
                                showModuleDaibaiHelpTool
                                  ? renderDaibaiHelpTool(itemTitle, moduleContract.daibai)
                                  : null
                              }
                              ${isAssistantMode ? renderStagePreviewTool(props.onOpenFilePreview) : null}
                            </div>
                          `
                          : null
                      }
                    `
                }
              </div>
            `
          : null
      }
      <div
        class="employee-workbench__stage-body ${
          isConversationMode ? "" : "employee-workbench__stage-body--module"
        }"
      >
        <div
          class="employee-workbench__stage-main ${
            isConversationMode ? "employee-workbench__stage-main--conversation" : ""
          }"
        >
          ${stageBody}
        </div>
      </div>
      ${renderInlineSkillSaveDrawer(props)}
      ${
        isCollaborationMode
          ? html`
            ${renderCollaborationReasonDrawer(moduleContract.collaboration)}
            ${renderCollaborationRulesDrawer(moduleContract.collaboration)}
          `
          : nothing
      }
    </section>
  `;
}
