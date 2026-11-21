import { type TemplateResult } from "lit";
import { buildKnowledgePublishIntent } from "../../../../../src/gateway/knowledge/publish-intent.js";
import { parseAgentSessionKey } from "../../../../../src/sessions/session-key-utils.ts";
import { isSupportedLocale, type Locale } from "../../../i18n/index.ts";
import type { AppPortState } from "../../app-port-state.ts";
import { resolveBundledBrandWordmarkSrc, resolveCustomBrandLogoSrc } from "../../brand-assets.ts";
import {
  BUILTIN_STEWARD_NAME,
  isBuiltinStewardAgent,
  resolveBuiltinStewardSessionKey,
  resolveStewardSessionDefaultsFromHello,
} from "../../builtin-steward-selection.ts";
import { cronCapability } from "../../capability/cron/index.ts";
import type {
  CapabilitySummary,
  CapabilityUsageBrief,
  EnterpriseAssetPackageDraft,
} from "../../capability/employee-capability/types.ts";
import { nodesCapability } from "../../capability/nodes/index.ts";
import { adaptNodesLoadCapabilityState } from "../../capability/view-state.ts";
import {
  isDeliverableResultArtifact,
  resolvePreviewArtifactRecord,
} from "../../chat/generated-preview-artifact.ts";
import { extractTextCached } from "../../chat/message-extract.ts";
import {
  buildCollaborationRulesSummary,
  resolveActiveCollaborationRulesSections,
  resolveActiveCollaborationRulesSummary,
} from "../../collaboration/collaboration-rules-summary.ts";
import { isGroupScopedSessionKey } from "../../collaboration/resolve-group-scope.ts";
import { normalizeGrowthStatus, type GrowthStatusView } from "../../controllers/agent-growth.ts";
import {
  loadAgentRuntimeHealth,
  type WorkbenchRobotHealth,
} from "../../controllers/agent-runtime-health.ts";
import {
  recordLocalAdoption,
  syncContextCapabilityLink,
  syncUserInitiatedSave,
} from "../../controllers/asset-incubation/adoption-sync.ts";
import {
  ackWeeklyDigest,
  scheduleDigestWithSync,
  shouldShowWeeklyDigest,
  type WeeklyDigestView,
} from "../../controllers/asset-incubation/digest-engine.ts";
import {
  scheduleReviewWithSync,
  syncEditPatternToGateway,
  type ReviewSuggestionView,
} from "../../controllers/asset-incubation/evidence-sync.ts";
import {
  applyAutofillSuggestionToCapabilityPatch,
  buildAutofillHintText,
  runIncubationAutofill,
} from "../../controllers/asset-incubation/incubation-autofill.ts";
import {
  dismissReviewSuggestion,
  scheduleReview,
} from "../../controllers/asset-incubation/review-engine.ts";
import { selectVisibleAssetReviewSuggestions } from "../../controllers/asset-incubation/review-suggestion-scope.ts";
import { deriveIncubationDecision } from "../../controllers/asset-incubation/scorer.ts";
import { dismissAssetSuggestion } from "../../controllers/asset-incubation/suggestion-dismiss.ts";
import type { SkillSaveIncubationContext } from "../../controllers/asset-incubation/types.ts";
import {
  decideAssetSuggestionFromManualIteration,
  ensureAssetSuggestionPatternRuntime,
} from "../../controllers/asset-suggestion-trigger.ts";
import { requestCapabilityInstallPreflight } from "../../controllers/capability-install-preflight.ts";
import { advanceCollaborationGroupMission } from "../../controllers/collaboration-mission-advance.ts";
import {
  dismissCollaborationOptionalSuggestion,
  resolveActiveCollaborationOptionalSuggestions,
} from "../../controllers/collaboration-optional-suggestions.ts";
import { resolveActiveCollaborationRoundPlan } from "../../controllers/collaboration-round-plan.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  removeDevice,
  removeDevices,
} from "../../controllers/devices.ts";
import { runKnowledgeActionSuggestion } from "../../controllers/knowledge-universe-action-runner.ts";
import {
  bindKnowledgeUniverseConnectorSource,
  ensureKnowledgeUniverseConnectorPackageForImport,
  resolveKnowledgeUniverseEnterpriseTenantId,
  setKnowledgeUniverseLibraryWorkspaceConnectorBindDraft,
  setKnowledgeUniverseLibraryWorkspaceConnectorCredentialSelect,
  setKnowledgeUniverseLibraryWorkspaceHttpRestExpanded,
  simulateCompleteKnowledgeUniverseConnectorOAuth,
  startKnowledgeUniverseConnectorOAuth,
  testKnowledgeUniverseConnectorConnectionForImport,
} from "../../controllers/knowledge-universe-connector-bind.ts";
import {
  downloadKnowledgeUniverseDatasetImportTemplate,
  importKnowledgeUniverseDatasetToSpace,
  pickKnowledgeUniverseDatasetImportFile,
  setKnowledgeUniverseDatasetImportTab,
  setKnowledgeUniverseDatasetManualText,
} from "../../controllers/knowledge-universe-dataset-import.ts";
import {
  runDeliverableGovernanceAction,
  setKnowledgeUniverseDeliverableDetailFocus,
} from "../../controllers/knowledge-universe-deliverable-actions.ts";
import {
  deleteKnowledgeUniverseDocumentReader,
  saveKnowledgeUniverseDocumentReader,
  setKnowledgeUniverseDocumentReaderDraft,
  setKnowledgeUniverseDocumentReaderEditing,
  setKnowledgeUniverseHomeCockpitTab,
} from "../../controllers/knowledge-universe-document-reader.ts";
import {
  importFilesToKnowledgeSpace,
  pickKnowledgeUniverseFileImportFiles,
  removeKnowledgeUniverseFileImportItem,
  setKnowledgeUniverseLibraryWorkspaceFileChunkingStrategy,
  setKnowledgeUniverseLibraryWorkspaceFileImportAdvancedOpen,
  setKnowledgeUniverseLibraryWorkspaceFileOcrEnabled,
} from "../../controllers/knowledge-universe-file-import.ts";
import {
  bindKnowledgeUniverseLocalFolder,
  loadKnowledgeUniverseLocalFolderStatus,
  openKnowledgeUniverseOriginalDocument,
  pickKnowledgeUniverseLocalFolderPath,
  scanKnowledgeUniverseLocalFolderNow,
  setKnowledgeUniverseLocalFolderDeletePolicy,
  setKnowledgeUniverseLocalFolderLabel,
  setKnowledgeUniverseLocalFolderMode,
  setKnowledgeUniverseLocalFolderPath,
  setKnowledgeUniverseLocalFolderWatcherEnabled,
} from "../../controllers/knowledge-universe-local-folder.ts";
import {
  addKnowledgeUniverseLibraryWorkspaceNoteTag,
  commitKnowledgeUniverseLibraryWorkspaceNoteTagDraft,
  ensureKnowledgeUniverseNoteImportReady,
  generateKnowledgeUniverseNoteMetadataFromContent,
  importNoteToKnowledgeSpace,
  removeKnowledgeUniverseLibraryWorkspaceNoteTag,
  setKnowledgeUniverseLibraryWorkspaceNoteTagDraft,
  setKnowledgeUniverseLibraryWorkspaceNoteTagSuggestionsOpen,
} from "../../controllers/knowledge-universe-note-import.ts";
import { previewKnowledgeUniverseOriginalDocument } from "../../controllers/knowledge-universe-original-preview.ts";
import { ensurePersonalKnowledgeBase } from "../../controllers/knowledge-universe-personal-space.ts";
import {
  importWebUrlsToKnowledgeSpace,
  setKnowledgeUniverseLibraryWorkspaceUrlImportAdvancedOpen,
  setKnowledgeUniverseLibraryWorkspaceUrlImportMode,
  setKnowledgeUniverseLibraryWorkspaceUrlImportText,
  setKnowledgeUniverseLibraryWorkspaceUrlMainContentOnly,
  setKnowledgeUniverseLibraryWorkspaceUrlStripNavAds,
  setKnowledgeUniverseLibraryWorkspaceUrlSyncSchedule,
} from "../../controllers/knowledge-universe-url-import.ts";
import {
  archiveKnowledgeUniverseDeliverable,
  createKnowledgeUniverseKnowledgeBase,
  deleteKnowledgeUniverseDeliverable,
  loadKnowledgeUniverseDeliverableTrace,
  searchKnowledgeUniverseKnowledgeBase,
  setKnowledgeUniverseDeliverableStatusFilter,
  setKnowledgeUniverseKbSearchQuery,
  setKnowledgeUniverseOpenDeliverableMoreMenu,
  setKnowledgeUniverseNewKnowledgeBaseTitle,
  setKnowledgeUniverseNewKnowledgeBaseDescription,
  setKnowledgeUniverseNewKnowledgeBaseVisibility,
  setKnowledgeUniverseSelectedKnowledgeBase,
  setKnowledgeUniverseLibraryWorkspaceContentTab,
  setKnowledgeUniverseLibraryWorkspaceMaterialsKindFilter,
  setKnowledgeUniverseLibraryWorkspaceSourcesPlaneFilter,
  notifyLibraryWorkspaceInvite,
  notifyLibraryWorkspaceTabActionUnavailable,
  notifyLibraryWorkspaceImportReadOnly,
  cancelLibraryWorkspaceInlineRename,
  deleteLibraryWorkspace,
  startLibraryWorkspaceInlineRename,
  setKnowledgeUniverseLibraryWorkspaceInviteDrawerOpen,
  setKnowledgeUniverseLibraryWorkspaceImportOpen,
  setKnowledgeUniverseLibraryWorkspaceImportKind,
  setKnowledgeUniverseLibraryWorkspaceBindSourceDraft,
  setKnowledgeUniverseLibraryWorkspaceInviteEmail,
  setKnowledgeUniverseLibraryWorkspaceInviteRole,
  setKnowledgeUniverseLibraryWorkspaceSettingsTitle,
  submitLibraryWorkspaceInvite,
  submitLibraryWorkspaceRename,
  deleteLibraryWorkspaceDocument,
  deleteSelectedLibraryWorkspaceDocuments,
  setLibraryWorkspaceDocumentSelectionAll,
  toggleLibraryWorkspaceDocumentSelection,
  unbindLibraryWorkspaceSource,
  ingestLibraryWorkspaceSource,
  detachLibraryWorkspaceDocument,
  restoreLibraryWorkspaceDocument,
  setLibraryWebRefreshPolicy,
  generateLibraryAgentKnowledge,
  toggleKnowledgeUniverseFavoriteKnowledgeBase,
  toggleKnowledgeUniversePinnedKnowledgeBase,
  toggleKnowledgeUniverseTreeExpanded,
  createKnowledgeUniverseFolderInSection,
} from "../../controllers/knowledge-universe-workspace.ts";
import {
  adjustKnowledgeUniverseZoom,
  bindKnowledgeUniverseSource,
  collectWebKnowledgeUniversePersonal,
  quickCreateKnowledgeUniverseKnowledgeBase,
  compareKnowledgeUniversePersonalVersions,
  openKnowledgeUniversePersonalManage,
  panKnowledgeUniverseGraph,
  pickKnowledgeUniversePersonalUploadFile,
  refreshKnowledgeUniverseHome,
  previewKnowledgeUniverseCapability,
  invokeKnowledgeUniverseCapability,
  requestKnowledgeUniverseDataAccess,
  requestKnowledgeUniverseEnterpriseAccess,
  resetKnowledgeUniverseGraphView,
  saveKnowledgeUniversePersonalTags,
  selectKnowledgeUniverseNode,
  selectKnowledgeUniverseObject,
  selectKnowledgeUniverseWorkspaceSearchHit,
  setKnowledgeUniverseHoveredNode,
  setKnowledgeUniverseHomeFocus,
  setKnowledgeUniversePersonalCollectDraft,
  setKnowledgeUniversePersonalManageTags,
  setKnowledgeUniversePersonalVersionCompareFrom,
  setKnowledgeUniversePersonalVersionCompareTo,
  setKnowledgeUniverseQuery,
  setKnowledgeUniversePageTab,
  setKnowledgeUniverseBrowseSubTab,
  setKnowledgeUniverseKbSearchHighlightKey,
  setKnowledgeUniversePersonalCollectDrawerOpen,
  setKnowledgeUniverseRelationsInsightExpanded,
  setKnowledgeUniverseSearchScope,
  setKnowledgeUniverseSearchPanelOpen,
  setKnowledgeUniverseSupplySectionExpanded,
  setKnowledgeUniverseWorkspaceDeliverablesExpanded,
  submitKnowledgeUniverseSearch,
  dismissKnowledgeUniverseHomeInsightsNotice,
  readHomeInsightsNoticeDismissed,
  loadKnowledgeUniverseGovernance,
  resetKnowledgeUniverseGovernanceTaskGraphView,
  selectKnowledgeUniverseGovernanceTask,
  setKnowledgeUniverseGovernanceTaskGraphHoveredNode,
  setKnowledgeUniverseGovernanceTaskGraphPan,
  setKnowledgeUniverseGovernanceTaskGraphSelectedNode,
  setKnowledgeUniverseGovernanceTaskGraphZoom,
  updateKnowledgeUniverseGovernanceTask,
  uploadKnowledgeUniversePersonal,
  importDatasetKnowledgeUniversePersonal,
  getKnowledgeUniverseRuntime,
} from "../../controllers/knowledge-universe.ts";
import type {
  MyAccumulationSegment,
  MyCapabilityListItem,
} from "../../controllers/my-accumulation.ts";
import { dismissHint } from "../../controllers/pattern-detection.ts";
import {
  type ExtractedSkillPreview,
  extractSkillContent,
  closeSaveModal,
  saveSkill,
  type QuickSaveSkillFormData,
  type SkillLifecycleState,
} from "../../controllers/skill-lifecycle.ts";
import { handoffUserOperationalIdentityTask } from "../../controllers/user-operational-identity.ts";
import {
  buildContactCards,
  buildGroupCards,
  deriveSessionCards,
} from "../../data/frontstage-session-cards.ts";
import { normalizeBasePath } from "../../navigation.ts";
import { openExternalUrlSafe } from "../../open-external-url.ts";
import { resolveSessionSeenAliasOptionsFromTrustedSession } from "../../session-seen-at.ts";
import { isDaibaiGuideAcknowledgedForUser } from "../../storage.ts";
import { canCreateSupervisorTask } from "../../supervisor/supervisor-types.ts";
import type {
  ConfigSnapshot,
  GatewayAgentRow,
  GatewaySessionRow,
  SessionsListResult,
  WorkspaceLocalBrowseResult,
  WorkspaceLocalChooseResult,
} from "../../types.ts";
import type { StandardAssetDetailTabId } from "../../views/asset-detail-tabs.ts";
import type { CronProps } from "../../views/cron.ts";
import { resolveSelectedKnowledgeSpaceCanWrite } from "../../views/knowledge-universe-space-import.ts";
import { resolvePersonalEmailBrowserGuide } from "../../wiring/personal-email-browser-guide.ts";
import { applyPersonalEmailPresetToEditor } from "../../wiring/personal-email-presets.ts";
import { isPlatformAdminSessionKind } from "../platform/platform-auth-session.ts";
import {
  buildEmployeeDirectoryBotCandidates,
  isCollaborationOrgBotOwnedByActor,
  loadCollaborationOrgBotDirectory,
  type CollaborationOrgBotDirectoryEntry,
} from "./collaboration-org-bot-directory.ts";
import {
  closeCollaborationArtifactPreview,
  isCollaborationArtifactPreviewOpen,
} from "./collaboration-stage-panel-coordination.ts";
import {
  buildWorkbenchCollaborationReadModel,
  isGeneratedSpaceTitle,
} from "./controllers/workbench-collaboration-read-model.ts";
import {
  buildWorkbenchCollaborationSpacesSnapshot,
  isArchivedWorkbenchCollaborationSpace,
} from "./controllers/workbench-collaboration-spaces-snapshot.ts";
import { resolveWorkbenchDataSpaceSettings } from "./data-space.ts";
import { filterAgentsListForEmployeeWorkbench } from "./employee-workbench-agent-scope.ts";
import {
  filterCollaborationSpacesSnapshotForEmployeeWorkbench,
  filterSessionsListForEmployeeWorkbench,
} from "./employee-workbench-collaboration-scope.ts";
import { resolveEmployeeWorkbenchNavQuota } from "./employee-workbench-nav-quota.ts";
import {
  applyProposalToSettingsDraft,
  buildGroupConfigProposalPrompt,
  mapProposalRosterToGovernanceState,
  proposalMatchesSourceSession,
  summarizeGroupConfigProposal,
} from "./group-config-proposal.ts";
import { resolveGrowthEntityFromSessionKey } from "./growth-session-sync.ts";
import { openPersonalOperationalIdentitySection } from "./operational-identity-navigation.ts";
import {
  packSkillReviewSubmitParams,
  readPackSkillReviewInstallBlock,
} from "./pack-skill-review-install.ts";
import {
  resolveWorkspacePrimaryModuleForSelection,
  switchEmployeeWorkbenchSession,
  openEmployeeCronTaskDetail,
} from "./render-actions.ts";
import {
  leaveEmployeeWorkbenchSpace,
  reloadEmployeeWorkbenchAgents,
  resetEmployeeWorkbenchSpace,
  dissolveEmployeeWorkbenchSpace,
  transferEmployeeWorkbenchSpaceOwnership,
  updateEmployeeWorkbenchSpaceMembers,
} from "./render-model-actions.ts";
import {
  buildWorkbenchDataDirectoryActionHandlers,
  buildWorkbenchDataDirectoryPanelState,
  loadWorkbenchDataDirectoryPanel,
} from "./render-model-data-directory.ts";
import { buildEmployeeWorkbenchGovernanceInteractionProps } from "./render-model-governance-actions.ts";
import { buildEmployeeWorkbenchShellActionProps } from "./render-model-shell-actions.ts";
import { loadWorkbenchSpaces } from "./render-model-spaces.ts";
import {
  generateAgentCreatorCloudConfig,
  testAgentCreatorCloudConnection,
} from "./render-model-workbench-actions.ts";
import { buildEmployeeWorkbenchInteractionProps } from "./render-model-workbench-actions.ts";
import { resolveWorkbenchHumanProfileName } from "./resolve-human-profile-name.ts";
import { resolveRobotRosterStatus } from "./robot-roster-status.ts";
import type { MyBotProjection } from "./semantic/my-bot-read-model.ts";
import { macPrivacySettingsUrl } from "./system-authorization.ts";
import { resolveCollaborationGroupSnapshot } from "./views/collaboration-group-snapshot.ts";
import { resolveCollaborationSpeakingAgentId } from "./views/collaboration-speaking-agent.ts";
import type { WorkbenchKnowledgeSurface } from "./views/home-page-contracts.ts";
import {
  ensureRobotCapabilityAtlas,
  peekRobotCapabilityAtlas,
} from "./views/my-bot-capability-atlas.ts";
import {
  ensureRobotDataSurface,
  openRobotDataItem,
  peekRobotDataSurface,
} from "./views/my-bot-data-surface.ts";
import {
  buildCronExecutionAgents,
  buildCronExecutionGroups,
} from "./views/personal-cron-execution-targets.ts";
import {
  enhanceCronTaskWithAi,
  recommendExecutionTargetWithAi,
} from "./views/personal-cron-task-ai.ts";
import {
  DEFAULT_PERSONAL_CRON_TASK_META,
  type PersonalCronTaskMeta,
} from "./views/personal-cron-task-meta.ts";
import {
  deleteTeamCronTemplate,
  loadTeamCronTemplates,
  saveTeamCronTemplate,
} from "./views/personal-cron-team-template-sync.ts";
import { buildWorkbenchHomeModelFromState } from "./views/workbench-home-model.ts";
import {
  buildWorkbenchSeatOfferDisplayLabels,
  formatWorkbenchSeatStatus,
} from "./views/workbench-seat-offer-labels.ts";
import type {
  WorkbenchCollaborationMemberGovernanceCandidate,
  WorkbenchCollaborationMemberGovernanceRosterEntry,
  WorkbenchCollaborationMemberGovernanceState,
  WorkbenchCollaborationPendingBotInvite,
  WorkbenchCollaborationPendingHumanInvite,
  WorkbenchCreatorSelectionEntry,
  WorkbenchCollaborationGovernanceSnapshot,
  WorkbenchCollaborationSpaceSnapshot,
  WorkbenchRobotWorkbenchTaskEntry,
  WorkbenchSettingsGroupEntry,
  WorkbenchSettingsGroupDraft,
  WorkbenchSettingsRobotEntry,
  WorkbenchSystemAuthorizationKey,
  WorkbenchWorkspaceSelectorMode,
  WorkbenchWorkspaceSelectorHostContext,
  WorkbenchProps,
  WorkbenchSharedAgentEntry,
  WorkbenchShellReadModel,
} from "./views/workbench-types.ts";
import { DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB } from "./views/workbench-types.ts";
import { resetWorkbenchMemberGovernanceState } from "./workbench-member-governance-state.ts";
import {
  isLocalComputerGateway,
  resolveDefaultWorkspaceBrowsePath,
  resolveWorkspaceBrowseRoots,
} from "./workspace-browse-roots.ts";

const EMPLOYEE_ASSET_STATUS_CHANGED_EVENT = "openbot:employee-asset-status-changed";

function inferEnterpriseAssetPackageType(
  capability: WorkbenchMyAccumulationDetail | WorkbenchMyAccumulationListItem,
  extraText = "",
): EnterpriseAssetPackageDraft["assetPackageType"] {
  if (
    shouldRecommendEnterpriseSubmissionFromAsset(capability) ||
    scoreEnterpriseSubmissionSignals({
      assetType: capability.assetType,
      text: [buildEnterpriseSignalText(capability), extraText].filter(Boolean).join(" "),
    }) >= 3
  ) {
    return "composite_pack";
  }
  const assetType = capability.assetType;
  switch (assetType) {
    case "template":
      return "template_pack";
    case "workflow":
      return "workflow_pack";
    case "knowledge":
      return "knowledge_pack";
    case "agent":
      return "automation_pack";
    default:
      return "single_capability";
  }
}

function buildEnterpriseSignalText(
  capability:
    | WorkbenchMyAccumulationDetail
    | WorkbenchMyAccumulationListItem
    | QuickSaveSkillFormData
    | ExtractedSkillPreview
    | null,
): string {
  if (!capability) {
    return "";
  }
  if ("suggestedName" in capability) {
    return [capability.suggestedName, capability.suggestedSummary].join(" ").toLowerCase();
  }
  if (
    "assetType" in capability &&
    "summary" in capability &&
    !("applicationSummary" in capability)
  ) {
    return [capability.name, capability.summary].join(" ").toLowerCase();
  }
  return [
    capability.name,
    capability.summary,
    "applicationSummary" in capability ? (capability.applicationSummary ?? "") : "",
    "feedbackSummary" in capability ? (capability.feedbackSummary ?? "") : "",
    "sourceContextLabel" in capability ? (capability.sourceContextLabel ?? "") : "",
    "inputDescription" in capability ? capability.inputDescription : "",
    "outputDescription" in capability ? capability.outputDescription : "",
  ]
    .join(" ")
    .toLowerCase();
}

function scoreEnterpriseSubmissionSignals(params: {
  assetType: WorkbenchMyAccumulationDetail["assetType"] | QuickSaveSkillFormData["assetType"];
  text: string;
}): number {
  let score = 0;
  if (params.assetType === "workflow" || params.assetType === "agent") {
    score += 2;
  } else if (params.assetType === "knowledge" || params.assetType === "template") {
    score += 1;
  }
  if (/(公众号|发布|公开|外部|草稿箱|群发|material|media_id)/i.test(params.text)) {
    score += 2;
  }
  if (/(脚本|workflow|流程|接口|integration|api|上传|素材|自动执行|html)/i.test(params.text)) {
    score += 1;
  }
  if (/(配置|密钥|token|凭证|api key|access token|appsecret|appid)/i.test(params.text)) {
    score += 1;
  }
  if (/(审核|审批|人工确认|复核|预览)/i.test(params.text)) {
    score += 1;
  }
  if (/(资产包|bundle|套件)/i.test(params.text)) {
    score += 1;
  }
  return score;
}

function shouldRecommendEnterpriseSubmissionFromAsset(
  capability: WorkbenchMyAccumulationDetail | WorkbenchMyAccumulationListItem,
): boolean {
  return (
    scoreEnterpriseSubmissionSignals({
      assetType: capability.assetType,
      text: buildEnterpriseSignalText(capability),
    }) >= 3
  );
}

function shouldRecommendEnterpriseSubmissionFromDraft(params: {
  formData: QuickSaveSkillFormData | null;
  extractedPreview: ExtractedSkillPreview | null;
}): boolean {
  if (!params.formData) {
    return false;
  }
  const text = [
    buildEnterpriseSignalText(params.formData),
    buildEnterpriseSignalText(params.extractedPreview),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    scoreEnterpriseSubmissionSignals({
      assetType: params.formData.assetType,
      text,
    }) >= 3
  );
}

function shouldRecommendEnterpriseSubmissionFromSuggestion(params: {
  source: "assistant-task-complete" | "group-task-complete" | "manual-iteration" | null | undefined;
  label: string | null | undefined;
  hint: string | null | undefined;
}): boolean {
  const text = [params.label ?? "", params.hint ?? ""].join(" ").toLowerCase();
  let score = 0;
  if (params.source === "manual-iteration") {
    score += 1;
  }
  if (/(公众号|发布|公开|外部|草稿箱|群发|material|media_id)/i.test(text)) {
    score += 2;
  }
  if (/(脚本|流程|接口|api|上传|素材|工作流|资产包|凭证|密钥|审核|预览)/i.test(text)) {
    score += 2;
  }
  return score >= 3;
}

function uniqNonEmpty(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function extractScriptReferencesFromText(text: string): string[] {
  const matches = [...text.matchAll(/\b([A-Za-z0-9_./-]+\.(?:js|ts|py|sh|md))\b/gim)];
  return uniqNonEmpty(matches.map((match) => match[1] ?? null));
}

function extractConversationContext(state: AppPortState): {
  text: string;
  dependencies: string[];
} {
  const recentMessages = (state.chatMessages ?? []).slice(-12);
  const textParts: string[] = [];
  const dependencies: string[] = [];
  for (const message of recentMessages) {
    const text = extractTextCached(message);
    if (text?.trim()) {
      textParts.push(text.trim());
      dependencies.push(...extractScriptReferencesFromText(text));
    }
    const artifact = resolvePreviewArtifactRecord(message);
    const artifactText =
      typeof artifact?.sourceMessage === "string" ? artifact.sourceMessage.trim() : "";
    if (artifactText) {
      textParts.push(artifactText);
      dependencies.push(...extractScriptReferencesFromText(artifactText));
    }
  }
  return {
    text: textParts.join("\n"),
    dependencies: uniqNonEmpty(dependencies),
  };
}

function appendInferredArtifactsFromText(
  current: string[],
  params: {
    text: string;
    kind: "input" | "output";
  },
): string[] {
  const additions: string[] = [];
  const isInput = params.kind === "input";
  if (/(标题)/i.test(params.text)) {
    additions.push("文章标题");
  }
  if (/(摘要|digest)/i.test(params.text)) {
    additions.push("摘要");
  }
  if (/(markdown)/i.test(params.text)) {
    additions.push("正文 Markdown");
  }
  if (/(html)/i.test(params.text)) {
    additions.push(isInput ? "正文 HTML" : "可发布 HTML 正文");
  }
  if (/(封面)/i.test(params.text)) {
    additions.push(isInput ? "封面图" : "thumb_media_id");
  }
  if (/(配图|图片|插图|illus)/i.test(params.text)) {
    additions.push(isInput ? "正文配图" : "正文图片 URL");
  }
  if (/(凭证|token|appid|appsecret|密钥)/i.test(params.text) && isInput) {
    additions.push("微信凭证");
  }
  if (/(草稿|draft|media_id)/i.test(params.text) && !isInput) {
    additions.push("微信公众号草稿 media_id");
  }
  if (/(预览|群发)/i.test(params.text) && !isInput) {
    additions.push("可预览草稿");
  }
  return uniqNonEmpty([...current, ...additions]);
}

function inferTargetTeamsFromText(text: string, tags: string[] = []): string[] {
  const teams = [...tags];
  if (/(市场)/i.test(text)) {
    teams.push("市场");
  }
  if (/(新媒体)/i.test(text)) {
    teams.push("新媒体");
  }
  if (/(内容运营|运营)/i.test(text)) {
    teams.push("内容运营");
  }
  if (/(研究|技术解读|论文解读)/i.test(text)) {
    teams.push("AI研究");
  }
  return uniqNonEmpty(teams).slice(0, 4);
}

function inferBusinessScenarioFromText(fallback: string, text: string): string {
  if (/(公众号文章编辑与发布|公众号发布|微信草稿箱发布)/i.test(text)) {
    return "公众号文章编辑与发布";
  }
  if (/(文章编辑与发布)/i.test(text)) {
    return "文章编辑与发布";
  }
  return fallback;
}

function inferPackageTitleFromText(fallback: string, text: string): string {
  if (/(公众号文章编辑与发布)/i.test(text)) {
    return "公众号文章编辑与发布";
  }
  return fallback;
}

function buildEnterprisePackageSummary(params: {
  fallback: string;
  businessScenario: string;
  executionMode: EnterpriseAssetPackageDraft["executionMode"];
  dependencies: string[];
  riskTags: EnterpriseAssetPackageDraft["riskTags"];
}): string {
  if (params.businessScenario === "公众号文章编辑与发布") {
    return "用于整理、生成并发布公众号文章的复合资产包，覆盖封面生成、配图上传、永久素材校验与草稿创建。";
  }
  const fragments = [params.fallback];
  if (params.executionMode !== "assistive") {
    fragments.push("包含稳定执行流程");
  }
  if (params.dependencies.length > 1) {
    fragments.push("依赖多脚本或配置资源");
  }
  if (params.riskTags.length > 0) {
    fragments.push(`涉及${params.riskTags.join("、")}`);
  }
  return uniqNonEmpty(fragments).join("，");
}

function buildEnterpriseSubmissionReasonLines(params: {
  draft: EnterpriseAssetPackageDraft;
  text: string;
  dependencies: string[];
}): string[] {
  const reasons: string[] = [];
  if (
    params.draft.assetPackageType === "composite_pack" &&
    (params.dependencies.length > 1 || /(脚本|流程|接口|api|上传|素材|工作流)/i.test(params.text))
  ) {
    reasons.push("识别到多脚本依赖或固定执行流程，因此按复合资产包处理。");
  }
  if (
    params.draft.executionMode === "semi_automatic" &&
    /(发布|预览|人工确认|审核|群发)/i.test(params.text)
  ) {
    reasons.push("识别到对外发布和人工预览边界，因此建议采用半自动执行。");
  }
  if (
    params.draft.needsEnterpriseSecrets ||
    params.draft.riskTags.includes("credential_required")
  ) {
    reasons.push("识别到凭证或 Token 依赖，因此建议由企业统一托管密钥。");
  }
  if (params.draft.riskTags.includes("external_publish")) {
    reasons.push("识别到外部发布场景，需由企业审核发布边界和品牌风险。");
  }
  if (params.draft.riskTags.includes("manual_review_required")) {
    reasons.push("识别到需要人工预览或复核的环节，因此保留人工确认节点。");
  }
  if (params.draft.targetTeams.length > 0) {
    reasons.push(`从当前对话上下文中推断出适用团队：${params.draft.targetTeams.join("、")}。`);
  }
  if (params.draft.verifiedInProduction) {
    reasons.push("该资产已带有真实使用痕迹，因此优先按可提交资产处理。");
  }
  return uniqNonEmpty(reasons).slice(0, 5);
}

function inferEnterpriseExecutionMode(
  capability: WorkbenchMyAccumulationDetail | WorkbenchMyAccumulationListItem,
  extraText = "",
): EnterpriseAssetPackageDraft["executionMode"] {
  const text = [
    capability.name,
    capability.summary,
    capability.applicationSummary ?? "",
    capability.feedbackSummary ?? "",
    extraText,
  ]
    .join(" ")
    .toLowerCase();
  if (/(发布|自动执行|脚本|workflow|流程|接口|integration|api)/i.test(text)) {
    return "semi_automatic";
  }
  return "assistive";
}

function inferEnterpriseRiskTags(
  capability: WorkbenchMyAccumulationDetail | WorkbenchMyAccumulationListItem,
  extraText = "",
): EnterpriseAssetPackageDraft["riskTags"] {
  const text = [
    capability.name,
    capability.summary,
    capability.applicationSummary ?? "",
    capability.feedbackSummary ?? "",
    extraText,
  ]
    .join(" ")
    .toLowerCase();
  const tags: EnterpriseAssetPackageDraft["riskTags"] = [];
  if (/(公众号|发布|公开|外部)/i.test(text)) {
    tags.push("external_publish", "brand_risk");
  }
  if (/(配置|密钥|token|凭证|api key|access token)/i.test(text)) {
    tags.push("credential_required");
  }
  if (/(审核|审批|人工确认|复核)/i.test(text)) {
    tags.push("manual_review_required");
  }
  return [...new Set(tags)];
}

function buildEnterpriseAssetPackageDraft(
  capability: WorkbenchMyAccumulationDetail | WorkbenchMyAccumulationListItem,
  params: {
    conversationText?: string;
    conversationDependencies?: string[];
  } = {},
): EnterpriseAssetPackageDraft {
  const sourceRobotName =
    "attribution" in capability
      ? capability.attribution.sourceRobot.name
      : (capability.sourceRobotName ?? "");
  const fallbackScenario =
    "attribution" in capability
      ? capability.attribution.firstFormedScenario || capability.attribution.sourceTaskSummary
      : (capability.sourceContextLabel ?? capability.summary);
  const conversationText = params.conversationText ?? "";
  const text = [buildEnterpriseSignalText(capability), conversationText].filter(Boolean).join(" ");
  const executionMode = inferEnterpriseExecutionMode(capability, text);
  const riskTags = inferEnterpriseRiskTags(capability, text);
  const packageTitle = inferPackageTitleFromText(capability.name, text);
  const businessScenario = inferBusinessScenarioFromText(
    fallbackScenario || capability.summary,
    text,
  );
  const inputArtifacts =
    "inputDescription" in capability && capability.inputDescription
      ? [capability.inputDescription]
      : ["业务输入内容"];
  const outputArtifacts =
    "outputDescription" in capability && capability.outputDescription
      ? [capability.outputDescription]
      : ["结构化输出结果"];
  const dependencies = uniqNonEmpty([
    ...(params.conversationDependencies ?? []).slice(0, 6),
    sourceRobotName,
  ]);
  const targetTeams = inferTargetTeamsFromText(text, "tags" in capability ? capability.tags : []);
  const enrichedInputArtifacts = appendInferredArtifactsFromText(inputArtifacts, {
    text,
    kind: "input",
  });
  const enrichedOutputArtifacts = appendInferredArtifactsFromText(outputArtifacts, {
    text,
    kind: "output",
  });
  const needsEnterpriseSecrets =
    riskTags.includes("credential_required") || /(凭证|密钥|token|appid|appsecret)/i.test(text);
  const promotionIntent =
    shouldRecommendEnterpriseSubmissionFromAsset(capability) || executionMode !== "assistive"
      ? "enterprise_standard"
      : "internal_reuse";
  const notes = uniqNonEmpty([
    capability.applicationSummary ?? capability.feedbackSummary ?? "",
    businessScenario === "公众号文章编辑与发布"
      ? "默认保留人工预览后群发，不建议全自动外部发布。"
      : "",
  ]).join(" ");

  return {
    packageTitle,
    packageSummary: buildEnterprisePackageSummary({
      fallback: capability.summary,
      businessScenario,
      executionMode,
      dependencies,
      riskTags,
    }),
    assetPackageType: inferEnterpriseAssetPackageType(capability, text),
    businessScenario,
    inputArtifacts: enrichedInputArtifacts,
    outputArtifacts: enrichedOutputArtifacts,
    dependencies,
    executionMode,
    riskTags,
    targetTeams,
    verifiedInProduction:
      "usage" in capability
        ? capability.usage.totalUsageCount > 0
        : capability.usageBrief.robotCount > 0,
    promotionIntent,
    needsEnterpriseSecrets,
    notes,
  };
}

function normalizeValue(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toBooleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function resolveConnectedNodePermissions(state: AppPortState) {
  const connectedNode = (state.nodes ?? []).find((entry) => toRecord(entry)?.connected === true);
  return toRecord(toRecord(connectedNode)?.permissions);
}

function resolveConnectedNodeId(state: AppPortState) {
  const connectedNode = (state.nodes ?? []).find((entry) => toRecord(entry)?.connected === true);
  const record = toRecord(connectedNode);
  return normalizeValue(typeof record?.nodeId === "string" ? record.nodeId : null);
}

// Keep the login-device list fresh while the user stays on the devices tab.
// The interval clears itself once the user navigates away, so no teardown
// wiring is needed from the (stateless) render-model layer.
const devicesAutoRefreshTimers = new WeakMap<object, ReturnType<typeof setInterval>>();
const DEVICES_AUTO_REFRESH_INTERVAL_MS = 30_000;

function ensureDevicesAutoRefresh(state: AppPortState) {
  if (devicesAutoRefreshTimers.has(state)) {
    return;
  }
  const timer = setInterval(() => {
    const active =
      state.connected &&
      state.workbenchPrimaryModule === "settings" &&
      state.workbenchSettingsView === "system" &&
      state.workbenchSystemSettingsTab === "devices";
    if (!active) {
      clearInterval(timer);
      devicesAutoRefreshTimers.delete(state);
      return;
    }
    void loadDevices(state, { quiet: true }).then(() => requestWorkbenchRender(state));
  }, DEVICES_AUTO_REFRESH_INTERVAL_MS);
  devicesAutoRefreshTimers.set(state, timer);
}

function isSystemDevicesTabActive(state: AppPortState) {
  return (
    state.workbenchPrimaryModule === "settings" &&
    state.workbenchSettingsView === "system" &&
    state.workbenchSystemSettingsTab === "devices"
  );
}

/** Load device.pair.list when the devices tab is visible and still empty. */
function ensureDevicesLoaded(state: AppPortState) {
  if (!isSystemDevicesTabActive(state)) {
    return;
  }
  if (!state.client || !state.connected) {
    return;
  }
  if (state.devicesLoading) {
    ensureDevicesAutoRefresh(state);
    return;
  }
  if (state.devicesList == null) {
    void loadDevices(state).then(() => requestWorkbenchRender(state));
  }
  ensureDevicesAutoRefresh(state);
}

function openSystemAuthorizationSettings(key: WorkbenchSystemAuthorizationKey) {
  openExternalUrlSafe(macPrivacySettingsUrl(key));
}

async function requestSystemAuthorization(
  state: AppPortState,
  key: WorkbenchSystemAuthorizationKey,
) {
  if (key === "fullDiskAccess") {
    openSystemAuthorizationSettings(key);
    return;
  }
  const nodeId = resolveConnectedNodeId(state);
  if (!state.client || !state.connected || !nodeId) {
    openSystemAuthorizationSettings(key);
    return;
  }
  const capability =
    key === "accessibility"
      ? "accessibility"
      : key === "automation"
        ? "appleScript"
        : "notifications";
  try {
    const result = await state.client.request("node.invoke", {
      nodeId,
      command: "device.permissions.request",
      params: {
        capability,
        interactive: true,
      },
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
    await nodesCapability.load(adaptNodesLoadCapabilityState(state), { quiet: true });
    state.workbenchDefaultWorkspaceRootNotice =
      result && typeof result === "object" ? "系统授权状态已刷新。" : "已发起系统授权请求。";
    requestWorkbenchRender(state);
  } catch {
    openSystemAuthorizationSettings(key);
  }
}

function resolveDefaultAgentWorkspace(state: AppPortState, snapshot?: ConfigSnapshot | null) {
  const config =
    toRecord(state.configForm) ??
    toRecord(state.configSnapshot?.config) ??
    toRecord(snapshot?.config) ??
    null;
  const agents = toRecord(config?.agents);
  const defaults = toRecord(agents?.defaults);
  return normalizeValue(typeof defaults?.workspace === "string" ? defaults.workspace : null) ?? "";
}

function clonePlainObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {})) as T;
}

function sanitizeSettingsDraftText(value: string | null | undefined) {
  return (value ?? "").replace(/\r\n/g, "\n");
}

function stringifySettingsDraftLines(values: string[] | null | undefined) {
  return (values ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n");
}

function parseSettingsDraftLines(value: string | null | undefined) {
  return sanitizeSettingsDraftText(value)
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildSystemSettingsGroupDraft(
  entry:
    | {
        sessionKey?: string;
        groupId: string | null;
        title: string;
        avatar?: string | null;
        visibilityScope?: string | null;
        purpose?: string | null;
        currentMission?: string | null;
        coordinatorBotId?: string | null;
        collaborationMode?: string | null;
        confidentialityTier?: string | null;
        successCriteria?: string[];
        systemInstructions?: string[];
        rulesSummary?: string[];
        workspacePath?: string | null;
        policyOpenDiscussion?: boolean | null;
        policyMaxVisibleBotRepliesPerRound?: number | null;
        finalDecisionPolicy?: {
          mode?: string | null;
          defaultFinalDeciderRole?: string | null;
          allowAgentPublishProposal?: boolean | null;
        } | null;
      }
    | null
    | undefined,
): WorkbenchSettingsGroupDraft | null {
  if (!entry) {
    return null;
  }
  const groupId = normalizeValue(entry.groupId) ?? normalizeValue(entry.sessionKey);
  if (!groupId) {
    return null;
  }
  const maxVisible =
    typeof entry.policyMaxVisibleBotRepliesPerRound === "number" &&
    Number.isFinite(entry.policyMaxVisibleBotRepliesPerRound)
      ? Math.max(1, Math.min(50, Math.round(entry.policyMaxVisibleBotRepliesPerRound)))
      : 5;
  return {
    groupId,
    title: entry.title,
    avatar: normalizeValue(entry.avatar) ?? "",
    visibilityScope: normalizeValue(entry.visibilityScope) ?? "group_only",
    purpose: normalizeValue(entry.purpose) ?? "",
    currentMission: normalizeValue(entry.currentMission) ?? "",
    coordinatorBotId: normalizeValue(entry.coordinatorBotId) ?? "",
    collaborationMode: normalizeValue(entry.collaborationMode) ?? "discussion_driven",
    confidentialityTier: normalizeValue(entry.confidentialityTier) ?? "internal",
    successCriteriaText: stringifySettingsDraftLines(entry.successCriteria),
    rulesSummaryText: stringifySettingsDraftLines(entry.systemInstructions ?? entry.rulesSummary),
    finalDecisionMode: normalizeValue(entry.finalDecisionPolicy?.mode) ?? "human_required",
    finalDecisionRole:
      normalizeValue(entry.finalDecisionPolicy?.defaultFinalDeciderRole) ?? "owner",
    allowAgentPublishProposal: entry.finalDecisionPolicy?.allowAgentPublishProposal !== false,
    openDiscussionWithoutMention: entry.policyOpenDiscussion !== false,
    maxVisibleBotRepliesPerRound: maxVisible,
    workspacePath: normalizeValue(entry.workspacePath) ?? "",
  };
}

/** 两个协作小组草稿的「可编辑字段」是否存在差异（未保存修改检测）。 */
function systemSettingsGroupDraftDiffers(
  a: WorkbenchSettingsGroupDraft,
  b: WorkbenchSettingsGroupDraft,
) {
  return (
    a.title !== b.title ||
    a.avatar !== b.avatar ||
    a.visibilityScope !== b.visibilityScope ||
    a.purpose !== b.purpose ||
    a.currentMission !== b.currentMission ||
    a.coordinatorBotId !== b.coordinatorBotId ||
    a.collaborationMode !== b.collaborationMode ||
    a.confidentialityTier !== b.confidentialityTier ||
    a.successCriteriaText !== b.successCriteriaText ||
    a.rulesSummaryText !== b.rulesSummaryText ||
    a.finalDecisionMode !== b.finalDecisionMode ||
    a.finalDecisionRole !== b.finalDecisionRole ||
    a.allowAgentPublishProposal !== b.allowAgentPublishProposal ||
    a.openDiscussionWithoutMention !== b.openDiscussionWithoutMention ||
    a.maxVisibleBotRepliesPerRound !== b.maxVisibleBotRepliesPerRound
  );
}

function resolveSystemSettingsGroupKey(
  entry: { groupId?: string | null; sessionKey?: string | null } | null | undefined,
) {
  return normalizeValue(entry?.groupId) ?? normalizeValue(entry?.sessionKey);
}

function matchesSystemSettingsGroupKey(
  entry: { groupId?: string | null; sessionKey?: string | null },
  key: string | null | undefined,
) {
  const normalizedKey = normalizeValue(key);
  if (!normalizedKey) {
    return false;
  }
  return (
    normalizeValue(entry.groupId) === normalizedKey ||
    normalizeValue(entry.sessionKey) === normalizedKey
  );
}

function buildSystemSettingsGroupDedupKeys(entry: {
  groupId?: string | null;
  sessionKey?: string | null;
  title?: string | null;
}) {
  return [
    normalizeValue(entry.groupId) ? `group:${normalizeValue(entry.groupId)}` : null,
    normalizeValue(entry.sessionKey) ? `session:${normalizeValue(entry.sessionKey)}` : null,
    normalizeValue(entry.title)
      ? `title:${normalizeValue(entry.title)?.toLocaleLowerCase("zh-Hans-CN")}`
      : null,
  ].filter((key): key is string => Boolean(key));
}

function scoreSystemSettingsGroupEntry(entry: {
  role?: string;
  memberCount?: number;
  lifecycleStatus?: string | null;
  currentMission?: string | null;
  purpose?: string | null;
}) {
  return (
    (entry.role === "owner" ? 10_000 : 0) +
    (entry.memberCount ?? 0) * 100 +
    (normalizeValue(entry.lifecycleStatus) === "active" ? 20 : 0) +
    (normalizeValue(entry.currentMission) ? 10 : 0) +
    (normalizeValue(entry.purpose) ? 5 : 0)
  );
}

function dedupeSystemSettingsGroupEntries<
  T extends {
    groupId?: string | null;
    sessionKey?: string | null;
    title?: string | null;
    role?: string;
    memberCount?: number;
    lifecycleStatus?: string | null;
    currentMission?: string | null;
    purpose?: string | null;
  },
>(entries: T[]) {
  const deduped: T[] = [];
  const indexByKey = new Map<string, number>();

  for (const entry of entries) {
    const keys = buildSystemSettingsGroupDedupKeys(entry);
    const existingIndex = keys
      .map((key) => indexByKey.get(key))
      .find((index): index is number => typeof index === "number");
    if (existingIndex == null) {
      const nextIndex = deduped.length;
      deduped.push(entry);
      for (const key of keys) {
        indexByKey.set(key, nextIndex);
      }
      continue;
    }
    const current = deduped[existingIndex];
    if (scoreSystemSettingsGroupEntry(entry) > scoreSystemSettingsGroupEntry(current)) {
      deduped[existingIndex] = entry;
    }
    for (const key of keys) {
      indexByKey.set(key, existingIndex);
    }
    for (const key of buildSystemSettingsGroupDedupKeys(deduped[existingIndex])) {
      indexByKey.set(key, existingIndex);
    }
  }

  return deduped;
}

function resolveBootstrapArtifactsReady(
  operatingState:
    | NonNullable<
        ReturnType<typeof buildWorkbenchCollaborationSpacesSnapshot>
      >["spaces"][number]["operatingState"]
    | undefined,
): boolean {
  if (operatingState?.bootstrapStatus?.initialized === true) {
    return true;
  }
  return operatingState?.onboardingStatus?.initialized === true;
}

function requestWorkbenchRender(state: unknown) {
  const requestUpdate = (state as { requestUpdate?: () => void }).requestUpdate;
  if (typeof requestUpdate === "function") {
    requestUpdate.call(state);
  }
}

const skillSaveExtractSeqByOwner = new WeakMap<object, number>();
/** Monotonic token so overlapping robot.workspace.get calls cannot clobber newer selection. */
let myBotDetailLoadGeneration = 0;

function nextSkillSaveExtractSeq(owner: object): number {
  const next = (skillSaveExtractSeqByOwner.get(owner) ?? 0) + 1;
  skillSaveExtractSeqByOwner.set(owner, next);
  return next;
}

function currentSkillSaveExtractSeq(owner: object): number {
  return skillSaveExtractSeqByOwner.get(owner) ?? 0;
}

function maybeOpenAssetSuggestion(params: {
  state: AppPortState;
  source: "assistant-task-complete" | "group-task-complete" | "manual-iteration";
  label: string;
  agentId?: string | null;
  contextId?: string | null;
}) {
  const contextId = normalizeValue(params.contextId);
  if (!contextId) {
    return;
  }
  params.state.workbenchAssetSuggestionVisible = true;
  params.state.workbenchAssetSuggestionSource = params.source;
  params.state.workbenchAssetSuggestionLabel = params.label;
  params.state.workbenchSkillSourceContextId = contextId;
  if (params.agentId?.trim()) {
    params.state.workbenchSkillSourceAgentId = params.agentId.trim();
  }
}

function createSkillLifecycleDraftState(state: AppPortState): SkillLifecycleState {
  return {
    client: state.client,
    connected: state.connected,
    saveModalOpen: state.workbenchSkillSaveModalOpen ?? false,
    saveModalBusy: state.workbenchSkillSaveModalBusy ?? false,
    saveModalError: state.workbenchSkillSaveModalError ?? null,
    saveModalFormData: state.workbenchSkillSaveModalFormData ?? null,
    extractedPreview: state.workbenchSkillExtractedPreview ?? null,
    sourceAgentId: state.workbenchSkillSourceAgentId ?? null,
    sourceContextId: state.workbenchSkillSourceContextId ?? null,
  };
}

function syncSkillLifecycleDraftState(
  state: AppPortState,
  draft: ReturnType<typeof createSkillLifecycleDraftState>,
) {
  state.workbenchSkillSaveModalOpen = draft.saveModalOpen;
  state.workbenchSkillSaveModalBusy = draft.saveModalBusy;
  state.workbenchSkillSaveModalError = draft.saveModalError;
  state.workbenchSkillSaveModalFormData = draft.saveModalFormData;
  state.workbenchSkillExtractedPreview = draft.extractedPreview;
  state.workbenchSkillSourceAgentId = draft.sourceAgentId;
  state.workbenchSkillSourceContextId = draft.sourceContextId;
}

type MyAccumulationCapabilityShareVisibility =
  | "私有"
  | "已共享到协作小组"
  | "审核中"
  | "需要修改后再次提交"
  | "已进入企业资产库"
  | "即将下线"
  | "已下线";

type WorkbenchMyAccumulationListItem = MyCapabilityListItem;

type WorkbenchMyAccumulationDetail = CapabilitySummary;

type WorkbenchMyAccumulationUsageBrief = CapabilityUsageBrief;

type WorkbenchMyAccumulationState = {
  loading: boolean;
  error: string | null;
  items: WorkbenchMyAccumulationListItem[];
  availableTags: string[];
  availableCategories: string[];
  availableSources: string[];
  selectedCapability: WorkbenchMyAccumulationDetail | null;
  selectedLoading: boolean;
  detailTab: StandardAssetDetailTabId;
  pendingUsageBrief: WorkbenchMyAccumulationUsageBrief | null;
  activeSegment: MyAccumulationSegment;
  searchQuery: string;
  filterTag: string | null;
  filterCategory: string | null;
  filterSource: string | null;
  filterShareVisibility: MyAccumulationCapabilityShareVisibility | null;
  definitionDirty: boolean;
  definitionSaving: boolean;
  definitionSaveNotice: string | null;
  autofillBusy: boolean;
  autofillError: string | null;
  autofillNotice: string | null;
  /** Snapshot taken before the latest autofill apply; enables undo. */
  autofillSnapshot: {
    name: string;
    summary: string;
    usageExamples: string[];
    inputDescription: string;
    outputDescription: string;
    tags: string[];
    category: string;
  } | null;
  enterpriseSubmission: {
    open: boolean;
    capabilityId: string | null;
    formData: EnterpriseAssetPackageDraft | null;
    autoReasonLines: string[];
    expanded: boolean;
    submitting: boolean;
    error: string | null;
  };
};

type WorkbenchMyAccumulationRuntime = {
  state: WorkbenchMyAccumulationState;
  hasLoaded: boolean;
  pendingIntent: "edit" | "delete";
  pendingCapabilityId: string | null;
  emptyRefreshAttempted: boolean;
  externalRefreshListenerBound: boolean;
  assetReviewSuggestions: ReviewSuggestionView[];
  assetReviewLoaded: boolean;
  assetReviewLoading: boolean;
  assetWeeklyDigest: WeeklyDigestView | null;
  assetWeeklyDigestLoaded: boolean;
  assetWeeklyDigestLoading: boolean;
  ownedInstallBusy: boolean;
  ownedInstallNotice: string | null;
};

const workbenchMyAccumulationRuntimes = new WeakMap<AppPortState, WorkbenchMyAccumulationRuntime>();
const workbenchIncubationAutofillHints = new WeakMap<AppPortState, string | null>();

type WorkbenchAgentHealthCache = {
  loaded: boolean;
  loading: boolean;
  lastLoadedAt: number;
  byAgentId: Map<string, WorkbenchRobotHealth>;
};
const workbenchAgentHealthCaches = new WeakMap<AppPortState, WorkbenchAgentHealthCache>();
const WORKBENCH_AGENT_HEALTH_TTL_MS = 30_000;
function bindWorkbenchAgentHealthCache(state: AppPortState): WorkbenchAgentHealthCache {
  let cache = workbenchAgentHealthCaches.get(state);
  if (!cache) {
    cache = { loaded: false, loading: false, lastLoadedAt: 0, byAgentId: new Map() };
    workbenchAgentHealthCaches.set(state, cache);
  }
  return cache;
}
/**
 * Lazily load per-agent runtime health (readiness + channel connectivity) via
 * agents.runtime-health, with a short TTL so the badge stays reasonably fresh
 * without hammering the gateway. Returns the cached map immediately.
 */
function ensureWorkbenchAgentRuntimeHealthLoaded(
  state: AppPortState,
): ReadonlyMap<string, WorkbenchRobotHealth> {
  const cache = bindWorkbenchAgentHealthCache(state);
  const client = state.client;
  if (cache.loading || !client || !state.connected) {
    return cache.byAgentId;
  }
  if (cache.loaded && Date.now() - cache.lastLoadedAt < WORKBENCH_AGENT_HEALTH_TTL_MS) {
    return cache.byAgentId;
  }
  cache.loading = true;
  void loadAgentRuntimeHealth(client).then(
    (byAgentId) => {
      cache.byAgentId = byAgentId;
      cache.loaded = true;
      cache.lastLoadedAt = Date.now();
      cache.loading = false;
      requestWorkbenchRender(state);
    },
    () => {
      cache.loading = false;
      requestWorkbenchRender(state);
    },
  );
  return cache.byAgentId;
}

function getWorkbenchIncubationAutofillHint(state: AppPortState): string | null {
  return workbenchIncubationAutofillHints.get(state) ?? null;
}

function setWorkbenchIncubationAutofillHint(state: AppPortState, hint: string | null): void {
  if (hint?.trim()) {
    workbenchIncubationAutofillHints.set(state, hint.trim());
  } else {
    workbenchIncubationAutofillHints.delete(state);
  }
}

const MY_ACCUMULATION_SHARE_VISIBILITIES: readonly MyAccumulationCapabilityShareVisibility[] = [
  "私有",
  "已共享到协作小组",
  "审核中",
  "需要修改后再次提交",
  "已进入企业资产库",
  "即将下线",
  "已下线",
] as const;

function createInitialWorkbenchMyAccumulationState(): WorkbenchMyAccumulationState {
  return {
    loading: false,
    error: null,
    items: [],
    availableTags: [],
    availableCategories: [],
    availableSources: [],
    selectedCapability: null,
    selectedLoading: false,
    detailTab: "overview",
    pendingUsageBrief: null,
    activeSegment: "all",
    searchQuery: "",
    filterTag: null,
    filterCategory: null,
    filterSource: null,
    filterShareVisibility: null,
    definitionDirty: false,
    definitionSaving: false,
    definitionSaveNotice: null,
    autofillBusy: false,
    autofillError: null,
    autofillNotice: null,
    autofillSnapshot: null,
    enterpriseSubmission: {
      open: false,
      capabilityId: null,
      formData: null,
      autoReasonLines: [],
      expanded: false,
      submitting: false,
      error: null,
    },
  };
}

function currentMyAccumulationFilters(state: WorkbenchMyAccumulationState) {
  return {
    searchQuery: state.searchQuery,
    filterTag: state.filterTag,
    filterCategory: state.filterCategory,
    filterSource: state.filterSource,
    filterShareVisibility: state.filterShareVisibility,
  };
}

async function loadWorkbenchMyAccumulation(
  state: WorkbenchMyAccumulationState,
  appState: AppPortState,
): Promise<void> {
  if (!appState.client || !appState.connected) {
    state.error = "暂时无法加载我的能力积累，请稍后再试";
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const response = await appState.client.request<{
      items?: WorkbenchMyAccumulationListItem[];
      availableTags?: string[];
      availableCategories?: string[];
      availableSources?: string[];
    }>("employee-capability.my-accumulation", currentMyAccumulationFilters(state));
    state.items = Array.isArray(response?.items) ? response.items : [];
    state.availableTags = Array.isArray(response?.availableTags) ? response.availableTags : [];
    state.availableCategories = Array.isArray(response?.availableCategories)
      ? response.availableCategories
      : [];
    state.availableSources = Array.isArray(response?.availableSources)
      ? response.availableSources
      : [];

    const selectedStillVisible =
      state.selectedCapability &&
      state.items.some((item) => item.id === state.selectedCapability?.id);
    if (selectedStillVisible && state.selectedCapability) {
      await loadWorkbenchMyAccumulationDetail(state, appState, state.selectedCapability.id);
    } else {
      state.selectedCapability = null;
      state.selectedLoading = false;
      state.detailTab = "overview";
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.items = [];
    state.availableTags = [];
    state.availableCategories = [];
    state.availableSources = [];
    state.selectedCapability = null;
    state.detailTab = "overview";
  } finally {
    state.loading = false;
  }
}

async function loadWorkbenchMyAccumulationDetail(
  state: WorkbenchMyAccumulationState,
  appState: AppPortState,
  capabilityId: string,
): Promise<void> {
  if (!appState.client || !appState.connected) {
    state.error = "暂时无法加载能力详情，请稍后再试";
    return;
  }
  state.selectedLoading = true;
  state.error = null;
  try {
    const response = await appState.client.request<{
      capability?: WorkbenchMyAccumulationDetail | null;
    }>("employee-capability.detail", {
      capabilityId,
    });
    state.selectedCapability = response?.capability ?? null;
    if (!state.selectedCapability) {
      state.detailTab = "overview";
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.selectedCapability = null;
    state.detailTab = "overview";
  } finally {
    state.selectedLoading = false;
  }
}

async function loadWorkbenchMyAccumulationUsageBrief(
  state: WorkbenchMyAccumulationState,
  appState: AppPortState,
  capabilityId: string,
): Promise<boolean> {
  if (!appState.client || !appState.connected) {
    state.error = "暂时无法加载使用简述，请稍后再试";
    return false;
  }
  try {
    const response = await appState.client.request<{
      usage?: WorkbenchMyAccumulationUsageBrief | null;
    }>("employee-capability.usage-brief", {
      capabilityId,
    });
    state.pendingUsageBrief = response?.usage ?? null;
    return (response?.usage?.robots?.length ?? 0) > 0;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    state.pendingUsageBrief = null;
    return false;
  }
}

async function saveWorkbenchMyAccumulationEdit(
  runtime: WorkbenchMyAccumulationRuntime,
  appState: AppPortState,
  capabilityId: string,
): Promise<void> {
  if (!appState.client || !appState.connected || !runtime.state.selectedCapability) {
    return;
  }
  runtime.state.definitionSaving = true;
  runtime.state.definitionSaveNotice = null;
  runtime.state.autofillError = null;
  try {
    const selected = runtime.state.selectedCapability;
    await appState.client.request("employee-capability.edit", {
      capabilityId,
      changes: {
        name: selected.name,
        summary: selected.summary,
        usageExamples: selected.usageExamples,
        inputDescription: selected.inputDescription,
        outputDescription: selected.outputDescription,
        tags: selected.tags,
        category: selected.category,
      },
    });
    const decision = decideAssetSuggestionFromManualIteration({
      capabilityId,
      capabilityName: selected.name,
    });
    if (decision.shouldSuggest) {
      maybeOpenAssetSuggestion({
        state: appState,
        source: decision.source,
        label: decision.label,
        agentId: selected.attribution.sourceRobot.id,
        contextId: decision.contextId,
      });
    }
    await loadWorkbenchMyAccumulation(runtime.state, appState);
    await loadWorkbenchMyAccumulationDetail(runtime.state, appState, capabilityId);
    runtime.state.pendingUsageBrief = null;
    runtime.pendingCapabilityId = null;
    runtime.state.definitionDirty = false;
    runtime.state.definitionSaveNotice = "整理结果已保存，可继续提交企业或分享。";
    runtime.state.autofillNotice = null;
    runtime.state.autofillSnapshot = null;
  } catch (error) {
    runtime.state.error = error instanceof Error ? error.message : String(error);
    runtime.state.definitionSaveNotice = null;
  } finally {
    runtime.state.definitionSaving = false;
  }
}

function resetDefinitionWorkbenchState(state: WorkbenchMyAccumulationState) {
  state.definitionDirty = false;
  state.definitionSaving = false;
  state.definitionSaveNotice = null;
  state.autofillBusy = false;
  state.autofillError = null;
  state.autofillNotice = null;
  state.autofillSnapshot = null;
}

function captureDefinitionAutofillSnapshot(
  capability: WorkbenchMyAccumulationDetail,
): NonNullable<WorkbenchMyAccumulationState["autofillSnapshot"]> {
  return {
    name: capability.name,
    summary: capability.summary,
    usageExamples: [...capability.usageExamples],
    inputDescription: capability.inputDescription,
    outputDescription: capability.outputDescription,
    tags: [...capability.tags],
    category: capability.category,
  };
}

/** Returns false when navigation should be blocked because of unsaved definition edits. */
function allowDefinitionNavigation(
  state: WorkbenchMyAccumulationState,
  options: { force?: boolean } = {},
): boolean {
  if (options.force || !state.definitionDirty) {
    return true;
  }
  state.error = "有未保存的整理修改。请先「保存整理」，或点「放弃修改」后再离开。";
  state.detailTab = "definition";
  return false;
}

async function deleteWorkbenchMyAccumulationCapability(
  runtime: WorkbenchMyAccumulationRuntime,
  appState: AppPortState,
  capabilityId: string,
): Promise<void> {
  if (!appState.client || !appState.connected) {
    return;
  }
  await appState.client.request("employee-capability.delete", {
    capabilityId,
  });
  await loadWorkbenchMyAccumulation(runtime.state, appState);
  runtime.state.pendingUsageBrief = null;
  runtime.pendingCapabilityId = null;
  if (runtime.state.selectedCapability?.id === capabilityId) {
    runtime.state.selectedCapability = null;
    runtime.state.detailTab = "overview";
  }
}

function deriveMyAccumulationGroups(
  entries: WorkbenchSettingsGroupEntry[],
): Array<{ id: string; name: string }> {
  return entries
    .map((entry) => ({
      id: normalizeValue(entry.groupId) ?? normalizeValue(entry.sessionKey) ?? "",
      name: entry.title,
    }))
    .filter((entry) => entry.id.length > 0);
}

function getWorkbenchMyAccumulationRuntime(state: AppPortState) {
  const existing = workbenchMyAccumulationRuntimes.get(state);
  if (existing) {
    return existing;
  }
  const runtime: WorkbenchMyAccumulationRuntime = {
    state: createInitialWorkbenchMyAccumulationState(),
    hasLoaded: false,
    pendingIntent: "edit",
    pendingCapabilityId: null,
    emptyRefreshAttempted: false,
    externalRefreshListenerBound: false,
    assetReviewSuggestions: [],
    assetReviewLoaded: false,
    assetReviewLoading: false,
    assetWeeklyDigest: null,
    assetWeeklyDigestLoaded: false,
    assetWeeklyDigestLoading: false,
    ownedInstallBusy: false,
    ownedInstallNotice: null,
  };
  workbenchMyAccumulationRuntimes.set(state, runtime);
  return runtime;
}

function invalidateWorkbenchMyAccumulationRuntime(
  state: AppPortState,
  runtime: WorkbenchMyAccumulationRuntime,
) {
  runtime.hasLoaded = false;
  runtime.emptyRefreshAttempted = false;
  runtime.assetReviewLoaded = false;
  runtime.assetReviewLoading = false;
  runtime.assetWeeklyDigestLoaded = false;
  runtime.assetWeeklyDigestLoading = false;
  void loadWorkbenchMyAccumulation(runtime.state, state).then(
    () => requestWorkbenchRender(state),
    () => requestWorkbenchRender(state),
  );
  requestWorkbenchRender(state);
}

function navigateToKnowledgeAssets(state: AppPortState, runtime: WorkbenchMyAccumulationRuntime) {
  state.workbenchPrimaryModule = "knowledge";
  setKnowledgeUniversePageTab(state, "assets");
  runtime.hasLoaded = false;
  ensureWorkbenchMyAccumulationLoaded(state);
  requestWorkbenchRender(state);
}

function isKnowledgeAssetsSurfaceActive(state: AppPortState): boolean {
  return (
    state.workbenchPrimaryModule === "knowledge" && state.knowledgeUniversePageTab === "assets"
  );
}

function bindWorkbenchMyAccumulationExternalRefresh(
  state: AppPortState,
  runtime: WorkbenchMyAccumulationRuntime,
) {
  if (runtime.externalRefreshListenerBound || typeof window === "undefined") {
    return;
  }
  runtime.externalRefreshListenerBound = true;
  window.addEventListener(EMPLOYEE_ASSET_STATUS_CHANGED_EVENT, () => {
    if (!isKnowledgeAssetsSurfaceActive(state)) {
      runtime.hasLoaded = false;
      runtime.emptyRefreshAttempted = false;
      return;
    }
    invalidateWorkbenchMyAccumulationRuntime(state, runtime);
  });
}

function bindWorkbenchMyAccumulationRuntime(state: AppPortState) {
  const runtime = getWorkbenchMyAccumulationRuntime(state);
  bindWorkbenchMyAccumulationExternalRefresh(state, runtime);
  return runtime;
}

function ensureAssetDigestLoaded(state: AppPortState, runtime: WorkbenchMyAccumulationRuntime) {
  if (runtime.assetWeeklyDigestLoaded || runtime.assetWeeklyDigestLoading) {
    return;
  }
  runtime.assetWeeklyDigestLoading = true;
  void scheduleDigestWithSync({ client: state.client })
    .then((digest) => {
      runtime.assetWeeklyDigest = digest;
      runtime.assetWeeklyDigestLoaded = true;
      runtime.assetWeeklyDigestLoading = false;
      requestWorkbenchRender(state);
    })
    .catch(() => {
      runtime.assetWeeklyDigest = null;
      runtime.assetWeeklyDigestLoaded = true;
      runtime.assetWeeklyDigestLoading = false;
      requestWorkbenchRender(state);
    });
}

function ensureAssetReviewLoaded(state: AppPortState, runtime: WorkbenchMyAccumulationRuntime) {
  if (runtime.assetReviewLoaded || runtime.assetReviewLoading) {
    return;
  }
  runtime.assetReviewLoading = true;
  void scheduleReviewWithSync({ client: state.client })
    .then((suggestions) => {
      runtime.assetReviewSuggestions = selectVisibleAssetReviewSuggestions(suggestions);
      runtime.assetReviewLoaded = true;
      runtime.assetReviewLoading = false;
      requestWorkbenchRender(state);
    })
    .catch(() => {
      const local = scheduleReview();
      runtime.assetReviewSuggestions = selectVisibleAssetReviewSuggestions(
        local.suggestions.map((entry) => ({
          fingerprint: entry.cluster.fingerprint,
          label: entry.cluster.label,
          summary: entry.summary,
          recurrenceCount: entry.cluster.recurrenceCount,
          suggestedAssetType: entry.cluster.suggestedAssetType,
        })),
      );
      runtime.assetReviewLoaded = true;
      runtime.assetReviewLoading = false;
      requestWorkbenchRender(state);
    });
}

function ensureWorkbenchMyAccumulationLoaded(state: AppPortState) {
  const runtime = bindWorkbenchMyAccumulationRuntime(state);
  ensureAssetReviewLoaded(state, runtime);
  ensureAssetDigestLoaded(state, runtime);
  const shouldRetryEmpty =
    isKnowledgeAssetsSurfaceActive(state) &&
    runtime.hasLoaded &&
    !runtime.state.loading &&
    runtime.state.items.length === 0 &&
    !runtime.emptyRefreshAttempted;
  if (shouldRetryEmpty) {
    runtime.hasLoaded = false;
    runtime.emptyRefreshAttempted = true;
  }
  if (runtime.hasLoaded || runtime.state.loading || !state.connected) {
    return runtime;
  }
  runtime.hasLoaded = true;
  void loadWorkbenchMyAccumulation(runtime.state, state).then(
    () => requestWorkbenchRender(state),
    () => {
      runtime.hasLoaded = false;
      requestWorkbenchRender(state);
    },
  );
  return runtime;
}

function downloadTextFile(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveDefaultAgentWorkspaceRoot(state: AppPortState, value: string) {
  const nextValue = value.trim();
  if (!state.client || !state.connected) {
    state.workbenchDefaultWorkspaceRootError =
      "当前未连接到网关，无法保存 OpenBot 工作空间根目录。";
    state.workbenchDefaultWorkspaceRootNotice = null;
    return;
  }
  if (!nextValue) {
    state.workbenchDefaultWorkspaceRootError = "请先选择 OpenBot 工作空间根目录。";
    state.workbenchDefaultWorkspaceRootNotice = null;
    return;
  }
  state.workbenchDefaultWorkspaceRootSaving = true;
  state.workbenchDefaultWorkspaceRootError = null;
  state.workbenchDefaultWorkspaceRootNotice = null;
  try {
    const validation = await state.client.request<{
      ok?: boolean;
      message?: string | null;
    } | null>("workspaces.local.validate", { path: nextValue });
    if (!validation?.ok) {
      state.workbenchDefaultWorkspaceRootError =
        validation?.message ?? "OpenBot 工作空间根目录不可用，请检查路径或权限。";
      return;
    }
    const snapshot =
      state.configSnapshot ?? (await state.client.request<ConfigSnapshot>("config.get", {}));
    const baseHash = snapshot?.hash ?? null;
    if (!baseHash) {
      state.workbenchDefaultWorkspaceRootError = "配置版本已过期，请刷新后重试。";
      return;
    }
    const nextConfig = clonePlainObject<Record<string, unknown>>(snapshot.config ?? {});
    const agents = toRecord(nextConfig.agents) ?? {};
    nextConfig.agents = agents;
    const defaults = toRecord(agents.defaults) ?? {};
    agents.defaults = defaults;
    defaults.workspace = nextValue;
    await state.client.request("config.set", {
      raw: JSON.stringify(nextConfig, null, 2),
      baseHash,
    });
    const refreshed = await state.client.request<ConfigSnapshot>("config.get", {});
    state.configSnapshot = refreshed;
    state.workbenchDefaultWorkspaceRootDraft = nextValue;
    state.workbenchDefaultWorkspaceRootNotice = "OpenBot 工作空间根目录已更新。";
  } catch (error) {
    state.workbenchDefaultWorkspaceRootError = String(error);
  } finally {
    state.workbenchDefaultWorkspaceRootSaving = false;
  }
}

async function saveDefaultAgentWorkspaceCloudRoot(state: AppPortState) {
  if (!state.client || !state.connected) {
    state.workbenchDefaultWorkspaceRootError = "当前未连接到网关，无法保存云端工作空间。";
    state.workbenchDefaultWorkspaceRootNotice = null;
    return;
  }
  state.workbenchDefaultWorkspaceRootSaving = true;
  state.workbenchDefaultWorkspaceRootError = null;
  state.workbenchDefaultWorkspaceRootNotice = null;
  try {
    const generated =
      state.workbenchWorkspaceCloudGeneratedConfig ??
      (await generateAgentCreatorCloudConfig(state));
    if (!generated) {
      state.workbenchDefaultWorkspaceRootError = "请先完成云端工作空间配置。";
      return;
    }
    const tested = await testAgentCreatorCloudConnection(state);
    if (!tested?.ok) {
      state.workbenchDefaultWorkspaceRootError = "云端工作空间连接测试未通过。";
      return;
    }
    const snapshot =
      state.configSnapshot ?? (await state.client.request<ConfigSnapshot>("config.get", {}));
    const baseHash = snapshot?.hash ?? null;
    if (!baseHash) {
      state.workbenchDefaultWorkspaceRootError = "配置版本已过期，请刷新后重试。";
      return;
    }
    const nextConfig = clonePlainObject<Record<string, unknown>>(snapshot.config ?? {});
    const agents = toRecord(nextConfig.agents) ?? {};
    nextConfig.agents = agents;
    const defaults = toRecord(agents.defaults) ?? {};
    agents.defaults = defaults;
    defaults.workspaceCloud = {
      provider: generated.provider,
      endpoint: generated.endpoint,
      bucket: generated.bucket,
      rootPrefix: generated.rootPrefix,
      ...(generated.region ? { region: generated.region } : {}),
      ...(generated.accountName ? { accountName: generated.accountName } : {}),
    };
    await state.client.request("config.set", {
      raw: JSON.stringify(nextConfig, null, 2),
      baseHash,
    });
    const refreshed = await state.client.request<ConfigSnapshot>("config.get", {});
    state.configSnapshot = refreshed;
    state.workbenchDefaultWorkspaceRootNotice = "OpenBot 云端工作空间已更新。";
  } catch (error) {
    state.workbenchDefaultWorkspaceRootError = String(error);
  } finally {
    state.workbenchDefaultWorkspaceRootSaving = false;
  }
}

async function loadSystemWorkspaceLocalBrowser(state: AppPortState, path?: string | null) {
  if (!state.client || !state.connected) {
    state.workbenchWorkspaceSelectorLocalBrowserError = "当前未连接到网关，无法浏览目录。";
    return;
  }
  state.workbenchWorkspaceSelectorLocalBrowserBusy = true;
  state.workbenchWorkspaceSelectorLocalBrowserError = null;
  try {
    const result = await state.client.request<WorkspaceLocalBrowseResult | null>(
      "workspaces.local.browse",
      path ? { path } : {},
    );
    state.workbenchWorkspaceSelectorLocalBrowserOpen = true;
    state.workbenchWorkspaceSelectorLocalBrowserCurrentPath = result?.currentPath ?? "";
    state.workbenchWorkspaceSelectorLocalBrowserParentPath = result?.parentPath ?? null;
    state.workbenchWorkspaceSelectorLocalBrowserEntries = result?.entries ?? [];
    if (result?.currentPath) {
      state.workbenchWorkspaceSelectorSelectedPath = result.currentPath;
    }
  } catch (error) {
    state.workbenchWorkspaceSelectorLocalBrowserError = String(error);
    state.workbenchWorkspaceSelectorLocalBrowserOpen = true;
  } finally {
    state.workbenchWorkspaceSelectorLocalBrowserBusy = false;
  }
}

function resolveWorkspaceSelectorHostContext(
  state: AppPortState,
): WorkbenchWorkspaceSelectorHostContext {
  const host = state.workspaceHost;
  const platform = host?.platform?.trim() || "linux";
  const homedir = host?.homedir?.trim() || "/";
  const isLocalGateway = isLocalComputerGateway({
    gatewayUrl: state.settings.gatewayUrl,
  });
  const browseRoots = resolveWorkspaceBrowseRoots(platform, homedir);
  return {
    isLocalGateway,
    platform,
    homedir,
    supportsNativeDirectoryChooser: host?.supportsNativeDirectoryChooser === true,
    browseRoots,
  };
}

function shouldFallbackWorkspaceLocalBrowser(message: string | null | undefined) {
  if (!message?.trim()) {
    return false;
  }
  return message.includes("目录浏览") || message.includes("手动配置");
}

async function chooseSystemWorkspaceDirectory(
  state: AppPortState,
  params: { path?: string | null; title?: string | null },
) {
  if (!state.client || !state.connected) {
    state.workbenchWorkspaceSelectorLocalBrowserError = "当前未连接到网关，无法打开目录选择器。";
    return null;
  }
  state.workbenchWorkspaceSelectorLocalBrowserBusy = true;
  state.workbenchWorkspaceSelectorLocalBrowserError = null;
  try {
    const result = await state.client.request<WorkspaceLocalChooseResult | null>(
      "workspaces.local.choose",
      {
        ...(normalizeValue(params.path) ? { path: normalizeValue(params.path) } : {}),
        ...(normalizeValue(params.title) ? { title: normalizeValue(params.title) } : {}),
      },
    );
    if (result?.cancelled) {
      const message = result.message ?? null;
      if (shouldFallbackWorkspaceLocalBrowser(message)) {
        state.workbenchWorkspaceSelectorLocalBrowserError = null;
        await loadSystemWorkspaceLocalBrowser(state, params.path);
      } else {
        state.workbenchWorkspaceSelectorLocalBrowserError = message;
      }
      return null;
    }
    const selectedPath = normalizeValue(result?.path);
    if (!selectedPath) {
      return null;
    }
    state.workbenchWorkspaceSelectorSelectedPath = selectedPath;
    return selectedPath;
  } catch (error) {
    state.workbenchWorkspaceSelectorLocalBrowserError = String(error);
    return null;
  } finally {
    state.workbenchWorkspaceSelectorLocalBrowserBusy = false;
  }
}

function workbenchGroupActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("CROSS_OPERATOR_STATE_DENIED")) {
    return "协作小组操作没有完成。请再试一次。";
  }
  return message;
}

async function saveSystemSettingsGroup(
  state: AppPortState,
  entry: WorkbenchSettingsGroupEntry | null,
  draft: WorkbenchSettingsGroupDraft | null | undefined,
) {
  const groupId = normalizeValue(entry?.groupId);
  if (!groupId || !draft) {
    state.workbenchSystemSettingsGroupError = "当前未选中协作小组。";
    state.workbenchSystemSettingsGroupNotice = null;
    return;
  }
  if (!state.client || !state.connected) {
    state.workbenchSystemSettingsGroupError = "未连接 Gateway，无法保存协作小组设置。";
    state.workbenchSystemSettingsGroupNotice = null;
    return;
  }
  const client = state.client;
  state.workbenchSystemSettingsGroupSaving = true;
  state.workbenchSystemSettingsGroupError = null;
  state.workbenchSystemSettingsGroupNotice = null;
  try {
    const workspacePath =
      normalizeValue(draft.workspacePath) ?? normalizeValue(entry?.workspacePath);
    // Phase 3 optional: settings save goes through collaboration.space.update* facades
    // (member invite/remove still uses spaces.members.update via workbench actions).
    await client.request("collaboration.space.updateBasic", {
      groupId,
      title: draft.title.trim() || entry?.title || groupId,
      ...(draft.avatar.trim() ? { avatar: draft.avatar.trim() } : {}),
      ...(draft.visibilityScope.trim() ? { visibilityScope: draft.visibilityScope.trim() } : {}),
      coordinatorBotId: draft.coordinatorBotId.trim(),
      ...(workspacePath ? { workspacePath } : {}),
    });
    await client.request("collaboration.space.updateMission", {
      groupId,
      ...(draft.purpose.trim() ? { purpose: draft.purpose.trim() } : {}),
      ...(draft.currentMission.trim() ? { currentMission: draft.currentMission.trim() } : {}),
      ...(parseSettingsDraftLines(draft.successCriteriaText).length > 0
        ? { successCriteria: parseSettingsDraftLines(draft.successCriteriaText) }
        : {}),
    });
    await client.request("collaboration.space.updateRules", {
      groupId,
      ...(draft.collaborationMode.trim()
        ? { collaborationMode: draft.collaborationMode.trim() }
        : {}),
      ...(draft.confidentialityTier.trim()
        ? { confidentialityTier: draft.confidentialityTier.trim() }
        : {}),
      ...(parseSettingsDraftLines(draft.rulesSummaryText).length > 0
        ? { systemInstructions: parseSettingsDraftLines(draft.rulesSummaryText) }
        : {}),
      finalDecisionPolicy: {
        mode: draft.finalDecisionMode.trim() || "human_required",
        defaultFinalDeciderRole: draft.finalDecisionRole.trim() || "owner",
        allowAgentPublishProposal: draft.allowAgentPublishProposal,
      },
      openDiscussionWithoutMention: draft.openDiscussionWithoutMention,
      maxVisibleBotRepliesPerRound: Math.max(
        1,
        Math.min(50, Math.round(draft.maxVisibleBotRepliesPerRound) || 5),
      ),
    });
    await loadWorkbenchSpaces(state);
    // Force draft rebuild from refreshed entry so dirty/baseline stay aligned.
    state.workbenchSystemSettingsGroupDraft = null;
    state.workbenchSystemSettingsGroupNotice = "协作小组设置已更新。";
  } catch (error) {
    state.workbenchSystemSettingsGroupError = String(error);
  } finally {
    state.workbenchSystemSettingsGroupSaving = false;
  }
}

async function applyWorkspaceSelectorPath(
  state: AppPortState,
  params: {
    mode: WorkbenchWorkspaceSelectorMode;
    selectedPath: string;
    settingsGroupEntries: WorkbenchSettingsGroupEntry[];
    selectedSystemSettingsGroupEntry: WorkbenchSettingsGroupEntry | null;
  },
) {
  const selectedPath = normalizeValue(params.selectedPath);
  if (!selectedPath) {
    state.workbenchWorkspaceSelectorLocalBrowserError = "请先选择工作区目录。";
    return;
  }
  if (params.mode === "default-local") {
    state.workbenchDefaultWorkspaceRootDraft = selectedPath;
    await saveDefaultAgentWorkspaceRoot(state, selectedPath);
    if (state.workbenchDefaultWorkspaceRootError) {
      return;
    }
  } else if (params.mode === "robot-local") {
    const agentId = normalizeValue(state.workbenchWorkspaceSelectorTargetId);
    if (!agentId) {
      state.workbenchWorkspaceSelectorLocalBrowserError = "当前未选中机器人。";
      return;
    }
    if (!state.client || !state.connected) {
      state.workbenchWorkspaceSelectorLocalBrowserError =
        "当前未连接到网关，无法保存机器人工作区。";
      return;
    }
    try {
      await state.client.request("agents.update", {
        agentId,
        workspace: selectedPath,
      });
      await reloadEmployeeWorkbenchAgents(state);
    } catch (error) {
      state.workbenchWorkspaceSelectorLocalBrowserError = String(error);
      return;
    }
  }
  state.workbenchWorkspaceSelectorOpen = false;
  state.workbenchWorkspaceSelectorLocalBrowserOpen = false;
  state.workbenchWorkspaceSelectorTargetId = null;
  state.workbenchWorkspaceSelectorTargetLabel = null;
}

function buildSystemSettingsGroupSummaryMarkdown(entry: {
  title: string;
  groupId: string | null;
  groupType?: string | null;
  lifecycleStatus?: string | null;
  visibilityScope?: string | null;
  ownerLabel?: string | null;
  coordinatorBotLabel?: string | null;
  purpose?: string | null;
  currentMission?: string | null;
  collaborationMode?: string | null;
  confidentialityTier?: string | null;
  successCriteria?: string[];
  rulesSummary?: string[];
  activeHumanCount?: number;
  activeBotCount?: number;
  pendingHumanInviteCount?: number;
  pendingBotInviteCount?: number;
}) {
  const lines = [
    `# ${entry.title}`,
    "",
    `- groupId: ${entry.groupId ?? "N/A"}`,
    `- 类型: ${entry.groupType ?? "N/A"}`,
    `- 状态: ${entry.lifecycleStatus ?? "N/A"}`,
    `- 可见范围: ${entry.visibilityScope ?? "N/A"}`,
    `- 群主: ${entry.ownerLabel ?? "N/A"}`,
    `- 主负责人: ${entry.coordinatorBotLabel ?? "N/A"}`,
    `- 协作模式: ${entry.collaborationMode ?? "N/A"}`,
    `- 保密等级: ${entry.confidentialityTier ?? "N/A"}`,
    `- 成员: 人类 ${entry.activeHumanCount ?? 0} / 机器人 ${entry.activeBotCount ?? 0}`,
    `- 待审批: 人类 ${entry.pendingHumanInviteCount ?? 0} / 机器人 ${entry.pendingBotInviteCount ?? 0}`,
    "",
    "## 小组定位",
    entry.purpose?.trim() || "N/A",
    "",
    "## 当前使命",
    entry.currentMission?.trim() || "N/A",
    "",
    "## 成功标准",
    ...(entry.successCriteria?.length
      ? entry.successCriteria.map((value) => `- ${value}`)
      : ["- N/A"]),
    "",
    "## 协作规则摘要",
    ...(entry.rulesSummary?.length ? entry.rulesSummary.map((value) => `- ${value}`) : ["- N/A"]),
    "",
  ];
  return lines.join("\n");
}

function deriveWorkspaceGroupId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "";
}

function currentSessionUpdatedAt(sessionsResult: SessionsListResult | null, sessionKey: string) {
  return sessionsResult?.sessions.find((entry) => entry.key === sessionKey)?.updatedAt ?? null;
}

function buildFrozenWorkbenchTeamState() {
  return {
    teamObjects: {},
    teamOrder: [],
  };
}

function resolveEmployeeWorkbenchAgentScopeParams(state: AppPortState) {
  const trustedProxySession =
    (state.hello?.auth?.provider === "trusted-proxy" && state.hello.auth.user
      ? state.hello.auth
      : null) ??
    state.platformAuthState?.session ??
    state.bootstrapAuthSession;
  const sessionUser =
    normalizeValue(trustedProxySession?.user) ??
    normalizeValue(state.platformAuthState?.session?.user) ??
    null;
  const sessionEmail =
    normalizeValue(
      trustedProxySession && "email" in trustedProxySession
        ? (trustedProxySession.email as string | null | undefined)
        : null,
    ) ??
    normalizeValue(state.platformAuthState?.session?.email) ??
    // Some auth payloads put the email in `user` (login identity).
    (sessionUser?.includes("@") ? sessionUser : null);
  const employeeUserId = normalizeValue(state.platformAuthState?.employeeAccess?.employeeUserId);
  return {
    userId: employeeUserId ?? sessionUser,
    userEmail: sessionEmail ?? (sessionUser?.includes("@") ? sessionUser : null),
  };
}

function resolveEmployeeWorkbenchCollaborationScopeParams(state: AppPortState) {
  const agentScope = resolveEmployeeWorkbenchAgentScopeParams(state);
  const employeeAccess = state.platformAuthState?.employeeAccess;
  const seatSpaceIds = employeeAccess?.defaultSpaceIds ?? null;
  return {
    userId: agentScope.userId,
    userEmail: agentScope.userEmail,
    seatSpaceIds,
    grantsHydrated: employeeAccess != null,
  };
}

function expandVisibleCollaborationSpaceIds(
  spaces: WorkbenchCollaborationSpaceSnapshot[],
): string[] {
  const ids = new Set<string>();
  for (const space of spaces) {
    for (const raw of [space.id, space.groupId]) {
      const normalized = normalizeValue(raw);
      if (!normalized) {
        continue;
      }
      ids.add(normalized);
      if (normalized.startsWith("space:")) {
        ids.add(normalized.slice("space:".length));
      }
    }
  }
  return [...ids];
}

function scopedCollaborationSpacesSnapshotForEmployeeWorkbench(state: AppPortState) {
  return filterCollaborationSpacesSnapshotForEmployeeWorkbench(
    buildWorkbenchCollaborationSpacesSnapshot(state.collaborationSpacesResult),
    resolveEmployeeWorkbenchCollaborationScopeParams(state),
  );
}

function scopedSessionsResultForEmployeeWorkbench(
  state: AppPortState,
  visibleSpaceIds: readonly string[] = [],
) {
  const collaborationScope = resolveEmployeeWorkbenchCollaborationScopeParams(state);
  const agentScope = resolveEmployeeWorkbenchAgentScopeParams(state);
  const visibleAgentIds =
    scopedAgentsListForEmployeeWorkbench(state)?.agents.map((agent) => agent.id) ?? [];
  return filterSessionsListForEmployeeWorkbench(state.sessionsResult, {
    userId: agentScope.userId,
    userEmail: agentScope.userEmail,
    seatSpaceIds: collaborationScope.seatSpaceIds,
    visibleAgentIds,
    visibleSpaceIds,
  });
}

/** Strip a leading `human:` so memberRoleMap / governance ids align with bare userIds. */
function stripWorkbenchHumanActorPrefix(value: string | null | undefined): string | null {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase().startsWith("human:")) {
    const bare = normalized.slice("human:".length).trim();
    return bare || normalized;
  }
  return normalized;
}

/**
 * Expand actor userId/email into matchable identities.
 * Digital-human team OS rows often store owners as `human:<uuid>` while the
 * signed-in actor only has the bare uuid / email — keep both forms.
 */
function addWorkbenchActorIdentityValue(
  identities: Set<string>,
  value: string | null | undefined,
): void {
  const normalized = normalizeValue(value)?.toLowerCase();
  if (!normalized) {
    return;
  }
  identities.add(normalized);
  if (normalized.startsWith("human:")) {
    const bare = normalized.slice("human:".length).trim();
    if (bare) {
      identities.add(bare);
    }
  } else if (!normalized.includes("@")) {
    identities.add(`human:${normalized}`);
  }
}

function buildWorkbenchActorIdentities(
  userId: string | null | undefined,
  userEmail: string | null | undefined,
): Set<string> {
  const identities = new Set<string>();
  addWorkbenchActorIdentityValue(identities, userId);
  addWorkbenchActorIdentityValue(identities, userEmail);
  return identities;
}

/** Prefer a real email over uuid/session handles for OS rows keyed by mailbox. */
function resolveWorkbenchActorEmail(params: {
  candidates: Array<string | null | undefined>;
}): string | null {
  for (const candidate of params.candidates) {
    const normalized = normalizeValue(candidate);
    if (normalized?.includes("@")) {
      return normalized;
    }
  }
  return null;
}

/** Exact match, plus `human:<id>` ↔ bare `<id>` (case-insensitive). */
function matchesWorkbenchActorIdentity(
  subjectId: string | null | undefined,
  actorIdentities: ReadonlySet<string>,
): boolean {
  const normalized = normalizeValue(subjectId)?.toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }
  if (actorIdentities.has(normalized)) {
    return true;
  }
  if (normalized.startsWith("human:")) {
    const bare = normalized.slice("human:".length).trim();
    return Boolean(bare && actorIdentities.has(bare));
  }
  if (!normalized.includes("@") && actorIdentities.has(`human:${normalized}`)) {
    return true;
  }
  return false;
}

function resolveWorkbenchCollaborationSpaceOwnerUserId(space: {
  ownerUserId?: string | null;
  operatingState?: {
    governance?: { ownerUserId?: string | null } | null;
    memberRoleMap?: Array<{
      memberId: string;
      memberKind?: string | null;
      governanceRole?: string | null;
    }> | null;
  } | null;
}): string | null {
  const raw =
    normalizeValue(space.operatingState?.governance?.ownerUserId) ??
    normalizeValue(space.ownerUserId) ??
    normalizeValue(
      space.operatingState?.memberRoleMap?.find(
        (entry) =>
          normalizeValue(entry.memberKind) !== "bot" &&
          normalizeValue(entry.governanceRole) === "owner",
      )?.memberId,
    );
  // memberRoleMap owners are often `human:<uuid>`; strip so roster ids / actor match.
  return stripWorkbenchHumanActorPrefix(raw);
}

function resolveWorkbenchActorGovernanceRole(params: {
  ownerUserId: string | null;
  actorIdentities: ReadonlySet<string>;
  memberRoleMap?: Array<{
    memberId: string;
    memberKind?: string | null;
    governanceRole?: string | null;
  }> | null;
  adminUserIds?: ReadonlyArray<string | null | undefined> | null;
}): "owner" | "admin" | "member" {
  // Prefer explicit roster / memberRoleMap governanceRole for the signed-in actor.
  for (const entry of params.memberRoleMap ?? []) {
    if (normalizeValue(entry.memberKind) === "bot") {
      continue;
    }
    if (!matchesWorkbenchActorIdentity(entry.memberId, params.actorIdentities)) {
      continue;
    }
    const role = normalizeValue(entry.governanceRole)?.toLowerCase();
    if (role === "owner") {
      return "owner";
    }
    if (role === "admin") {
      return "admin";
    }
  }
  if (matchesWorkbenchActorIdentity(params.ownerUserId, params.actorIdentities)) {
    return "owner";
  }
  for (const adminId of params.adminUserIds ?? []) {
    if (matchesWorkbenchActorIdentity(adminId, params.actorIdentities)) {
      return "admin";
    }
  }
  return "member";
}

/** @deprecated Prefer resolveWorkbenchActorGovernanceRole — kept for settings rows that only need owner|member. */
function resolveWorkbenchSettingsGroupRole(params: {
  ownerUserId: string | null;
  actorIdentities: ReadonlySet<string>;
}): "owner" | "member" {
  return matchesWorkbenchActorIdentity(params.ownerUserId, params.actorIdentities)
    ? "owner"
    : "member";
}

function governanceRoleLabel(role: string | null | undefined): string | null {
  switch (normalizeValue(role)) {
    case "owner":
      return "群主";
    case "admin":
      return "管理员";
    case "member":
      return "成员";
    case "observer":
      return "观察者";
    default:
      return normalizeValue(role);
  }
}

function collaborationRoleLabel(role: string | null | undefined): string | null {
  switch (normalizeValue(role)) {
    case "coordinator":
      return "协调";
    case "final_decider":
      return "拍板";
    case "decision_advisor":
      return "决策顾问";
    case "contributor":
      return "贡献者";
    case "reviewer":
      return "评审";
    case "observer":
      return "观察";
    default:
      return normalizeValue(role);
  }
}

function parseMemberLastActiveAtMs(value: string | null | undefined): number | null {
  const raw = normalizeValue(value);
  if (!raw) {
    return null;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Phase 3：从 space snapshot 组装成员四列（贡献度可由 collaboration.space.get 覆盖）。 */
function buildWorkbenchSettingsGroupMemberRows(space: {
  ownerUserId?: string | null;
  coordinatorBotId?: string | null;
  operatingState?: {
    governance?: {
      ownerUserId?: string | null;
      adminUserIds?: string[] | null;
      coordinatorBotId?: string | null;
    } | null;
    memberRoleMap?: Array<{
      memberId: string;
      memberKind?: string | null;
      label?: string | null;
      governanceRole?: string | null;
      collaborationRole?: string | null;
    }> | null;
  } | null;
  members?: {
    humans?: Array<{
      userId: string;
      name?: string | null;
      status?: string | null;
    }> | null;
    bots?: Array<{
      agentId: string;
      name?: string | null;
      status?: string | null;
      lastActiveAt?: string | null;
      currentTask?: string | null;
    }> | null;
  } | null;
}): import("./semantic/collaboration-group-read-model.ts").CollaborationGroupMemberProjection[] {
  const ownerUserId =
    normalizeValue(space.operatingState?.governance?.ownerUserId) ??
    normalizeValue(space.ownerUserId);
  const adminUserIds = new Set(
    (space.operatingState?.governance?.adminUserIds ?? [])
      .map((entry) => normalizeValue(entry))
      .filter((entry): entry is string => Boolean(entry)),
  );
  const coordinatorBotId =
    normalizeValue(space.operatingState?.governance?.coordinatorBotId) ??
    normalizeValue(space.coordinatorBotId);
  const roleMap = new Map(
    (space.operatingState?.memberRoleMap ?? []).map((entry) => [
      normalizeValue(entry.memberId) ?? "",
      entry,
    ]),
  );

  const humans = (space.members?.humans ?? [])
    .filter((entry) => normalizeValue(entry.status) !== "invited")
    .map((entry) => {
      const memberId = normalizeValue(entry.userId) ?? "unknown";
      const role = roleMap.get(memberId);
      const governanceRole =
        normalizeValue(role?.governanceRole) ||
        (memberId === ownerUserId ? "owner" : adminUserIds.has(memberId) ? "admin" : "member");
      return {
        memberId,
        kind: "human" as const,
        name: normalizeValue(entry.name) || memberId,
        identity: governanceRoleLabel(governanceRole),
        duty: collaborationRoleLabel(role?.collaborationRole),
        contribution: null,
        lastActiveAt: null,
      };
    });

  const bots = (space.members?.bots ?? [])
    .filter((entry) => normalizeValue(entry.status) !== "invited")
    .map((entry) => {
      const memberId = normalizeValue(entry.agentId) ?? "unknown";
      const role = roleMap.get(memberId);
      const isCoordinator = memberId === coordinatorBotId;
      return {
        memberId,
        kind: "bot" as const,
        name: normalizeValue(entry.name) || memberId,
        identity:
          governanceRoleLabel(role?.governanceRole) || (isCoordinator ? "主负责人" : "机器人成员"),
        duty:
          collaborationRoleLabel(role?.collaborationRole) ||
          (isCoordinator ? "协调" : null) ||
          normalizeValue(entry.currentTask),
        contribution: null,
        lastActiveAt: parseMemberLastActiveAtMs(entry.lastActiveAt),
      };
    });

  return [...humans, ...bots];
}

function scopedAgentsListForEmployeeWorkbench(state: AppPortState) {
  return filterAgentsListForEmployeeWorkbench(state.agentsList);
}

// Temporary bridge while the workbench chain is being recovered.
// This builds the workbench-facing snapshot directly inside the employee port,
// so the old workbench page is no longer a hidden dependency of the new entry.
function buildWorkbenchSnapshot(state: AppPortState) {
  const teamState = buildFrozenWorkbenchTeamState();
  const trustedProxySession =
    (state.hello?.auth?.provider === "trusted-proxy" && state.hello.auth.user
      ? state.hello.auth
      : null) ??
    state.platformAuthState?.session ??
    state.bootstrapAuthSession;
  const guideAcknowledged = isDaibaiGuideAcknowledgedForUser(
    state.settings,
    trustedProxySession?.user,
  );
  const collaborationSpacesSnapshot = scopedCollaborationSpacesSnapshotForEmployeeWorkbench(state);
  const visibleSpaceIds = expandVisibleCollaborationSpaceIds(collaborationSpacesSnapshot.spaces);
  const sessionsResult = scopedSessionsResultForEmployeeWorkbench(state, visibleSpaceIds);
  const ownStewardSessionKey = resolveBuiltinStewardSessionKey(
    resolveStewardSessionDefaultsFromHello(state.hello),
  );
  const seenOpts = resolveSessionSeenAliasOptionsFromTrustedSession({
    hello: state.hello,
    platformAuthState: state.platformAuthState,
    bootstrapAuthSession: state.bootstrapAuthSession,
    bootstrapDataSpace: state.bootstrapDataSpace,
    ownStewardSessionKey,
  });
  return buildWorkbenchHomeModelFromState({
    agentsList: scopedAgentsListForEmployeeWorkbench(state),
    sessionsResult,
    sessionSeenAt: state.settings.sessionSeenAt,
    activeSessionKey: state.sessionKey,
    ownStewardSessionKey,
    tenantId: seenOpts.tenantId,
    spaceMode: seenOpts.spaceMode,
    // Transitional rule: workbench state should come from runtime session and
    // collaboration data, not from deprecated local-only team ordering.
    teamObjects: teamState.teamObjects,
    teamOrder: teamState.teamOrder,
    channelsSnapshot: state.channelsSnapshot,
    presenceEntries: state.presenceEntries,
    connected: state.connected,
    cronNext: state.cronStatus?.nextWakeAtMs ?? null,
    lastError: state.lastError,
    pendingTasks: state.workbenchPendingTasks ?? null,
    notices: state.workbenchNotices ?? null,
    upcomingCollaboration: state.workbenchUpcomingCollaboration ?? null,
    stewardSuggestion: state.workbenchStewardSuggestion ?? null,
    schedule: state.workbenchSchedule ?? null,
    guideAcknowledged,
  });
}

function buildSessionBackedTeamSpaces(
  state: AppPortState,
  sessionsResult: SessionsListResult | null | undefined = scopedSessionsResultForEmployeeWorkbench(
    state,
    scopedCollaborationSpacesSnapshotForEmployeeWorkbench(state).spaces.flatMap((space) =>
      [space.id, space.groupId].filter(Boolean),
    ) as string[],
  ),
) {
  const teamState = buildFrozenWorkbenchTeamState();
  const trustedProxySession =
    (state.hello?.auth?.provider === "trusted-proxy" && state.hello.auth.user
      ? state.hello.auth
      : null) ??
    state.platformAuthState?.session ??
    state.bootstrapAuthSession;
  const ownStewardSessionKey = resolveBuiltinStewardSessionKey(
    resolveStewardSessionDefaultsFromHello(state.hello),
  );
  const seenOpts = resolveSessionSeenAliasOptionsFromTrustedSession({
    hello: state.hello,
    platformAuthState: state.platformAuthState,
    bootstrapAuthSession: state.bootstrapAuthSession,
    bootstrapDataSpace: state.bootstrapDataSpace,
    ownStewardSessionKey,
  });
  return buildWorkbenchHomeModelFromState({
    agentsList: scopedAgentsListForEmployeeWorkbench(state),
    sessionsResult,
    sessionSeenAt: state.settings.sessionSeenAt,
    activeSessionKey: state.sessionKey,
    ownStewardSessionKey,
    tenantId: seenOpts.tenantId,
    spaceMode: seenOpts.spaceMode,
    // Transitional rule: workbench spaces should be derived from runtime
    // sessions/collaboration data, not from locally saved ordering metadata.
    teamObjects: teamState.teamObjects,
    teamOrder: teamState.teamOrder,
    channelsSnapshot: state.channelsSnapshot,
    presenceEntries: state.presenceEntries,
    connected: state.connected,
    cronNext: state.cronStatus?.nextWakeAtMs ?? null,
    lastError: state.lastError,
    guideAcknowledged: isDaibaiGuideAcknowledgedForUser(state.settings, trustedProxySession?.user),
  }).teamSpaces;
}

function buildShellReadModel(
  state: AppPortState,
  workbenchModel: ReturnType<typeof buildWorkbenchSnapshot>,
): WorkbenchShellReadModel {
  return {
    agents: workbenchModel.agents,
    contacts: workbenchModel.contacts,
    groups: workbenchModel.groups,
    teamAssistants: workbenchModel.teamAssistants,
    teamMembers: workbenchModel.teamMembers,
    activeSession: workbenchModel.activeSession,
    activeSessionUpdatedAt: currentSessionUpdatedAt(state.sessionsResult, state.sessionKey),
  };
}

function resolveActiveSessionRow(state: AppPortState): GatewaySessionRow | null {
  return state.sessionsResult?.sessions.find((entry) => entry.key === state.sessionKey) ?? null;
}

function resolveActiveDecisionOptions(state: AppPortState) {
  if (state.workbenchDecisionOptionsDraft) {
    return state.workbenchDecisionOptionsDraft.map((entry) => ({ ...entry }));
  }
  const decisions = state.collaborationLearningSnapshot?.decisions ?? [];
  const current =
    decisions.find((entry) => entry.decisionId === state.workbenchDecisionDetailId) ?? null;
  return (current?.options ?? []).map((entry) => ({
    optionId: entry.optionId,
    title: entry.title,
  }));
}

function createDraftDecisionOptionId(options: Array<{ optionId: string; title: string }>) {
  let index = options.length + 1;
  let candidate = `option-${index}`;
  while (options.some((entry) => entry.optionId === candidate)) {
    index += 1;
    candidate = `option-${index}`;
  }
  return candidate;
}

function buildCollaborationGovernanceSnapshot(
  state: AppPortState,
): WorkbenchCollaborationGovernanceSnapshot | null {
  const sessionRow = resolveActiveSessionRow(state);
  if (
    !sessionRow?.collaborationGroupProfile &&
    !sessionRow?.collaborationParticipationOverlay &&
    !sessionRow?.collaborationPersonalCapabilities?.length
  ) {
    return null;
  }

  return {
    sessionKey: sessionRow.key,
    groupId: sessionRow.groupId ?? null,
    personalCapabilities: sessionRow.collaborationPersonalCapabilities ?? [],
    groupProfile: sessionRow.collaborationGroupProfile ?? null,
    participationOverlay: sessionRow.collaborationParticipationOverlay ?? null,
    learningObjects: state.collaborationLearningSnapshot ?? null,
    learningObjectsLoading: state.collaborationLearningLoading,
    learningObjectsError: state.collaborationLearningError,
    observabilityLoading: state.collaborationObservabilityLoading,
    observabilityError: state.collaborationObservabilityError,
    observabilitySnapshot: state.collaborationObservabilitySnapshot,
    onRefreshCollaborationObservability: () => {
      void state.loadCollaborationObservabilitySnapshot({ force: true });
    },
    governanceActionBusyKey: state.collaborationGovernanceActionBusyKey,
    governanceActionError: state.collaborationGovernanceActionError,
    selectedTaskId: state.workbenchTaskDetailId,
    selectedDeliverableId: state.workbenchDeliverableDetailId,
    selectedReviewId: state.workbenchReviewDetailId,
    selectedDecisionId: state.workbenchDecisionDetailId,
    selectedDecisionOptionDraft: state.workbenchDecisionSelectedOptionDraft,
    selectedDecisionRationaleDraft: state.workbenchDecisionRationaleDraft,
    selectedDecisionOptionsDraft: state.workbenchDecisionOptionsDraft,
  };
}

function dedupeById<T extends { id: string }>(entries: T[]) {
  const byId = new Map<string, T>();
  for (const entry of entries) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()];
}

function dedupeByKey<T>(entries: T[], keyOf: (entry: T) => string) {
  const byKey = new Map<string, T>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

function isSessionLikeHumanCandidateId(value: string | null | undefined) {
  const normalized = normalizeValue(value)?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === "main" || normalized.startsWith("agent:") || normalized.startsWith("space:")
  );
}

function buildEmployeeDirectoryHumanCandidates(params: {
  members?: Array<{
    user: string;
    displayName?: string;
    membershipRole: string;
    status?: string;
    seatTitle?: string;
  }> | null;
  currentUserId?: string | null;
  currentUserName?: string | null;
  /** Actor identity aliases (userId / email) that must never appear as invite targets. */
  excludeIdentities?: ReadonlySet<string>;
}) {
  const excludeIdentities = params.excludeIdentities ?? new Set<string>();
  const isExcludedIdentity = (value: string | null | undefined) => {
    const normalized = normalizeIdentity(value);
    return Boolean(normalized && excludeIdentities.has(normalized));
  };
  // Group owners are auto-added as active members on create — never list "self"
  // as an invite/select candidate (including email ↔ employeeUserId aliases).
  return dedupeById(
    (params.members ?? [])
      .filter(
        (member) =>
          normalizeValue(member.user) &&
          !isSessionLikeHumanCandidateId(member.user) &&
          !isExcludedIdentity(member.user) &&
          normalizeValue(member.status) !== "suspended",
      )
      .map<WorkbenchCreatorSelectionEntry>((member) => {
        const id = normalizeValue(member.user) as string;
        const label = normalizeValue(member.displayName) ?? normalizeValue(member.user) ?? id;
        const subtitle = [normalizeValue(member.membershipRole), normalizeValue(member.seatTitle)]
          .filter(Boolean)
          .join(" · ");
        return {
          id,
          label,
          ...(subtitle ? { subtitle } : {}),
          group: "人员名录",
        };
      }),
  );
}

function normalizeRosterLabel(value: string | null | undefined, fallback: string) {
  return normalizeValue(value) ?? fallback;
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function buildBaseMemberGovernanceEntries(
  groupSnapshot: ReturnType<typeof resolveCollaborationGroupSnapshot>,
  ownedAgents: Array<{
    id: string;
    name?: string | null;
    identity?: { name?: string | null; emoji?: string | null } | null;
  }>,
  orgDirectory: CollaborationOrgBotDirectoryEntry[],
  actor: {
    currentUserId?: string | null;
    currentUserEmail?: string | null;
    ownedAgentIds: Set<string>;
  },
) {
  const managedSpace = groupSnapshot?.managedSpace ?? null;
  const ownedAgentsById = new Map(ownedAgents.map((entry) => [entry.id, entry] as const));
  const orgBotById = new Map(orgDirectory.map((entry) => [entry.agentId, entry] as const));
  const actorIdentities = buildWorkbenchActorIdentities(
    actor.currentUserId,
    actor.currentUserEmail,
  );
  const currentHumans: WorkbenchCollaborationMemberGovernanceRosterEntry[] = (
    managedSpace?.members.humans ?? []
  )
    .filter((entry) => {
      const status = normalizeIdentity(entry.status);
      // Invited humans belong in pending invites, not the active roster.
      return status !== "removed" && status !== "invited" && status !== "pending";
    })
    .map((entry) => ({
      id: entry.userId,
      label: normalizeRosterLabel(entry.name, normalizeRosterLabel(entry.handle, entry.userId)),
      kind: "human" as const,
      presenceStatus:
        entry.presenceStatus === "online" || entry.presenceStatus === "offline"
          ? entry.presenceStatus
          : null,
    }));
  const currentBots: WorkbenchCollaborationMemberGovernanceRosterEntry[] = (
    managedSpace?.members.bots ?? []
  )
    .filter((entry) => entry.status !== "removed")
    .map((entry) => {
      const ownedAgent = ownedAgentsById.get(entry.agentId);
      const orgBot = orgBotById.get(entry.agentId);
      return {
        id: entry.agentId,
        label: normalizeRosterLabel(
          entry.name,
          normalizeRosterLabel(
            orgBot?.label,
            normalizeRosterLabel(
              ownedAgent?.name,
              normalizeRosterLabel(ownedAgent?.identity?.name, entry.agentId),
            ),
          ),
        ),
        kind: "bot",
      };
    });
  const pendingHumanInviteByUserId = new Map<string, WorkbenchCollaborationPendingHumanInvite>();
  const pushPendingHumanInvite = (entry: {
    userId?: string | null;
    name?: string | null;
    handle?: string | null;
    status?: string | null;
  }) => {
    const status = normalizeIdentity(entry.status);
    if (status === "removed") {
      return;
    }
    const userId = normalizeValue(entry.userId);
    if (!userId || pendingHumanInviteByUserId.has(userId)) {
      return;
    }
    pendingHumanInviteByUserId.set(userId, {
      intentId: `invite:${userId}`,
      label: normalizeRosterLabel(entry.name, normalizeRosterLabel(entry.handle, userId)),
      message: entry.handle ?? undefined,
    });
  };
  for (const entry of managedSpace?.invites.humans ?? []) {
    const status = normalizeIdentity(entry.status);
    // Invites roster should only contribute pending rows; skip active/paused noise.
    if (!status || status === "invited" || status === "pending") {
      pushPendingHumanInvite(entry);
    }
  }
  // Some stores keep pending humans only under members.status=invited.
  for (const entry of managedSpace?.members.humans ?? []) {
    const status = normalizeIdentity(entry.status);
    if (status === "invited" || status === "pending") {
      pushPendingHumanInvite(entry);
    }
  }
  const pendingHumanInvites: WorkbenchCollaborationPendingHumanInvite[] = [
    ...pendingHumanInviteByUserId.values(),
  ];
  const pendingBotInvites: WorkbenchCollaborationPendingBotInvite[] = (
    managedSpace?.invites.bots ?? []
  )
    .filter((entry) => entry.status !== "removed")
    .map((entry) => {
      const ownedAgent = ownedAgentsById.get(entry.agentId);
      const orgBot = orgBotById.get(entry.agentId);
      const ownerUserId = orgBot?.ownerUserId ?? null;
      const ownerName = orgBot?.ownerLabel ?? undefined;
      return {
        agentId: entry.agentId,
        label: normalizeRosterLabel(
          entry.name,
          normalizeRosterLabel(
            orgBot?.label,
            normalizeRosterLabel(
              ownedAgent?.name,
              normalizeRosterLabel(ownedAgent?.identity?.name, entry.agentId),
            ),
          ),
        ),
        ownerId: normalizeValue(ownerUserId) ?? undefined,
        ownerName: normalizeValue(ownerName) ?? undefined,
        canApprove: isCollaborationOrgBotOwnedByActor(
          { agentId: entry.agentId, ownerUserId },
          actorIdentities,
          actor.ownedAgentIds,
        ),
      };
    });
  return {
    currentHumans: dedupeById(currentHumans),
    currentBots: dedupeById(currentBots),
    pendingHumanInvites: dedupeByKey(pendingHumanInvites, (entry) => entry.intentId),
    pendingBotInvites: dedupeByKey(pendingBotInvites, (entry) => entry.agentId),
  };
}

function buildMemberGovernanceCandidates(params: {
  workbenchSnapshot: ReturnType<typeof buildWorkbenchSnapshot>;
  directoryMembers?: Array<{
    user: string;
    displayName?: string;
    membershipRole: string;
    status?: string;
    seatTitle?: string;
  }> | null;
  currentUserId?: string | null;
  currentUserName?: string | null;
  ownedAgents: Array<{
    id: string;
    name?: string | null;
    identity?: { name?: string | null; emoji?: string | null } | null;
  }>;
  orgDirectory: CollaborationOrgBotDirectoryEntry[];
  /** Authoritative owned agent ids (employeeAccess + org-directory ownership). */
  ownedAgentIds?: ReadonlySet<string>;
  currentUserEmail?: string | null;
  currentHumans: WorkbenchCollaborationMemberGovernanceRosterEntry[];
  currentBots: WorkbenchCollaborationMemberGovernanceRosterEntry[];
  pendingHumanInvites: WorkbenchCollaborationPendingHumanInvite[];
  pendingBotInvites: WorkbenchCollaborationPendingBotInvite[];
}) {
  const currentHumanIds = new Set(params.currentHumans.map((entry) => entry.id));
  const currentBotIds = new Set(params.currentBots.map((entry) => entry.id));
  const pendingHumanIds = new Set(
    params.pendingHumanInvites.map((entry) => entry.intentId.replace(/^invite:|^draft:/, "")),
  );
  const pendingBotIds = new Set(params.pendingBotInvites.map((entry) => entry.agentId));
  const ownedAgentIds =
    params.ownedAgentIds ?? new Set(params.ownedAgents.map((entry) => entry.id));
  const actorIdentities = buildWorkbenchActorIdentities(
    params.currentUserId,
    params.currentUserEmail,
  );
  const directoryHumans = buildEmployeeDirectoryHumanCandidates({
    members: params.directoryMembers,
    currentUserId: params.currentUserId,
    currentUserName: params.currentUserName,
    excludeIdentities: actorIdentities,
  });
  const pendingBotEntries =
    params.pendingBotInvites.map<WorkbenchCollaborationMemberGovernanceCandidate>((entry) => ({
      id: entry.agentId,
      label: entry.label,
      subtitle: entry.canApprove
        ? "待你确认"
        : entry.ownerName
          ? `待 ${entry.ownerName} 确认`
          : "待对方加入",
      kind: "bot",
      actionMode: "invite",
      orgSegments: [entry.ownerName ? `${entry.ownerName} 的机器人` : "待确认机器人"],
      disabled: true,
    }));
  const candidateHumans = dedupeById([
    ...params.currentHumans.map<WorkbenchCollaborationMemberGovernanceCandidate>((entry) => ({
      ...entry,
      actionMode: "add",
      disabled: true,
    })),
    ...params.pendingHumanInvites.map<WorkbenchCollaborationMemberGovernanceCandidate>((entry) => ({
      id: entry.intentId.replace(/^invite:|^draft:/, ""),
      label: entry.label,
      subtitle: entry.message,
      kind: "human",
      actionMode: "invite",
      disabled: true,
    })),
    ...directoryHumans.map<WorkbenchCollaborationMemberGovernanceCandidate>((entry) => {
      const id = entry.id;
      return {
        id,
        label: entry.label,
        subtitle: entry.subtitle,
        kind: "human",
        actionMode: "invite",
        orgSegments: [entry.group, entry.subtitle].filter((value): value is string =>
          Boolean(value),
        ),
        disabled:
          currentHumanIds.has(id) ||
          pendingHumanIds.has(id) ||
          matchesWorkbenchActorIdentity(id, actorIdentities),
      };
    }),
  ]);
  const candidateBots = dedupeById([
    ...params.currentBots.map<WorkbenchCollaborationMemberGovernanceCandidate>((entry) => ({
      ...entry,
      actionMode: "add",
      disabled: true,
    })),
    ...pendingBotEntries,
    ...buildEmployeeDirectoryBotCandidates({
      orgDirectory: params.orgDirectory,
      directoryMembers: params.directoryMembers,
      currentUserId: params.currentUserId,
      currentUserEmail: params.currentUserEmail,
      ownedAgentIds,
      currentBotIds,
      pendingBotIds,
    }),
  ]);
  return { candidateHumans, candidateBots };
}

function countPendingOwnedBotInvites(
  invites: { agentId: string; status?: string | null }[] | null | undefined,
  ownedAgentIds: Set<string>,
) {
  return (invites ?? []).filter((entry) => {
    if (entry.status === "removed") {
      return false;
    }
    const agentId = entry.agentId?.trim();
    if (!agentId || isBuiltinStewardAgent(agentId)) {
      // Builtin steward is universal — never badge as a personal pending approval.
      return false;
    }
    return ownedAgentIds.has(agentId);
  }).length;
}

function buildPendingBotApprovalCounts(params: {
  spacesSnapshot: ReturnType<typeof buildWorkbenchCollaborationSpacesSnapshot> | undefined;
  teamSpaces: Array<{ key: string; selectionKey?: string | null }>;
  ownedAgents: Array<{ id: string }>;
  activeSelectionKey: string;
  sessionsResult: SessionsListResult | null;
}) {
  const spacesResult = params.spacesSnapshot ?? { spaces: [] };
  const ownedAgentIds = new Set(params.ownedAgents.map((entry) => entry.id));
  const countsBySelectionKey: Record<string, number> = {};

  for (const teamSpace of params.teamSpaces) {
    const snapshot = resolveCollaborationGroupSnapshot({
      selectionKey: teamSpace.key,
      activeSessionKey: teamSpace.key,
      spacesResult,
      teamSpaces: params.teamSpaces,
      sessionsResult: params.sessionsResult,
    });
    const count = countPendingOwnedBotInvites(snapshot?.managedSpace?.invites.bots, ownedAgentIds);
    if (count <= 0) {
      continue;
    }
    const aliasKeys = [
      teamSpace.key,
      teamSpace.selectionKey,
      snapshot?.selectionKey,
      snapshot?.managedSpace?.id,
      snapshot?.managedSpace?.groupId,
    ]
      .map((value) => normalizeValue(value))
      .filter(Boolean) as string[];
    for (const aliasKey of aliasKeys) {
      countsBySelectionKey[aliasKey] = count;
    }
  }

  const activeSnapshot = resolveCollaborationGroupSnapshot({
    selectionKey: params.activeSelectionKey,
    activeSessionKey: params.activeSelectionKey,
    spacesResult,
    teamSpaces: params.teamSpaces,
    sessionsResult: params.sessionsResult,
  });

  return {
    countsBySelectionKey,
    activeCount: countPendingOwnedBotInvites(
      activeSnapshot?.managedSpace?.invites.bots,
      ownedAgentIds,
    ),
  };
}

/** Collaboration roster statuses that must not appear in My Robots. */
const NON_LISTABLE_COLLAB_BOT_STATUSES = new Set([
  "removed",
  "revoked",
  "invited",
  "left",
  "deleted",
  "archived",
]);

export function isWorkbenchListableCollaborationBotStatus(
  status: string | null | undefined,
): boolean {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return !NON_LISTABLE_COLLAB_BOT_STATUSES.has(normalized);
}

function humanMatchesWorkbenchActorIdentities(
  human: {
    userId?: string | null;
    email?: string | null;
    handle?: string | null;
  },
  actorIdentities: ReadonlySet<string>,
): boolean {
  return [human.userId, human.email, human.handle].some((value) =>
    matchesWorkbenchActorIdentity(value, actorIdentities),
  );
}

function collectSettingsGroupTitleIdentities(space: {
  id?: string | null;
  groupId?: string | null;
}): string[] {
  return [space.id, space.groupId]
    .map((value) => normalizeValue(value)?.replace(/^space:/, "") ?? "")
    .filter(Boolean);
}

/**
 * Settings "我的协作小组" listability. Nav visibility can still pass
 * grants-hydrated payloads through; this is the settings-tab SoT.
 */
export function isWorkbenchSettingsListableCollaborationSpace(
  space: {
    id?: string | null;
    groupId?: string | null;
    title?: string | null;
    ownerUserId?: string | null;
    operatingState?: WorkbenchCollaborationSpaceSnapshot["operatingState"];
    members?: WorkbenchCollaborationSpaceSnapshot["members"] | null;
    invites?: WorkbenchCollaborationSpaceSnapshot["invites"] | null;
  },
  actorIdentities: ReadonlySet<string>,
): boolean {
  if (isArchivedWorkbenchCollaborationSpace(space)) {
    return false;
  }
  const humans = space.members?.humans ?? [];
  const bots = space.members?.bots ?? [];
  const actorHumans = humans.filter((human) =>
    humanMatchesWorkbenchActorIdentities(human, actorIdentities),
  );
  if (
    actorHumans.length > 0 &&
    actorHumans.every((human) => !isWorkbenchListableCollaborationBotStatus(human.status))
  ) {
    return false;
  }
  const listableHumans = humans.filter((human) =>
    isWorkbenchListableCollaborationBotStatus(human.status),
  );
  const listableBots = bots.filter((bot) => isWorkbenchListableCollaborationBotStatus(bot.status));
  if (listableHumans.length === 0 && listableBots.length === 0) {
    return false;
  }
  const title = normalizeValue(space.title) ?? normalizeValue(space.groupId) ?? space.id ?? "";
  if (isGeneratedSpaceTitle(title, collectSettingsGroupTitleIdentities(space))) {
    return false;
  }
  return true;
}

function buildWorkbenchSettingsRobotEntries(params: {
  ownedAgents: Array<{
    id: string;
    name?: string | null;
    identity?: { name?: string | null; emoji?: string | null } | null;
    scope?: string | null;
    shareStatus?: string | null;
    workspace?: string | null;
  }>;
  sessionsResult: SessionsListResult | null;
  dataSpaceConfigured: boolean;
  activeRobotGrowth?: { agentId: string; status: GrowthStatusView } | null;
  healthByAgentId?: ReadonlyMap<string, WorkbenchRobotHealth>;
}): WorkbenchSettingsRobotEntry[] {
  const agentSessions = deriveSessionCards(params.sessionsResult, ["direct", "group", "channel"]);
  const recentAgentIds = new Set(agentSessions.map((entry) => entry.agentId));
  const latestSessionByAgentId = new Map<string, (typeof agentSessions)[number]>();
  for (const entry of agentSessions) {
    if (isGroupScopedSessionKey(entry.key)) {
      continue;
    }
    if (!latestSessionByAgentId.has(entry.agentId)) {
      latestSessionByAgentId.set(entry.agentId, entry);
    }
  }
  const defaultWorkspaceConfigured = params.dataSpaceConfigured;
  const entries = new Map<string, WorkbenchSettingsRobotEntry>();

  for (const entry of params.ownedAgents) {
    const latestSession = latestSessionByAgentId.get(entry.id);
    const workspacePath = normalizeValue(entry.workspace);
    const configScope = normalizeValue(entry.scope)?.toLowerCase() ?? "";
    const operationalAgentScope =
      configScope === "shared" || configScope === "team" ? ("shared" as const) : ("owned" as const);
    entries.set(entry.id, {
      id: entry.id,
      sessionKey: latestSession?.key ?? `agent:${entry.id}:main`,
      name:
        normalizeRosterLabel(entry.name, normalizeRosterLabel(entry.identity?.name, entry.id)) ??
        entry.id,
      emoji: normalizeValue(entry.identity?.emoji),
      source: "owned",
      operationalAgentScope,
      status: recentAgentIds.has(entry.id) ? "running" : "paused",
      health: params.healthByAgentId?.get(entry.id),
      shareStatus: normalizeValue(entry.shareStatus),
      workspaceState: workspacePath || defaultWorkspaceConfigured ? "configured" : "unconfigured",
      workspacePath,
      lastActiveAt: latestSession?.updatedAt ?? null,
      growthStatus:
        params.activeRobotGrowth?.agentId === entry.id ? params.activeRobotGrowth.status : null,
    });
  }

  return Array.from(entries.values()).toSorted((left, right) =>
    left.name.localeCompare(right.name, "zh-Hans-CN"),
  );
}

function mapWorkbenchSettingsGroupEntry(
  space: WorkbenchCollaborationSpaceSnapshot,
  actorIdentities: ReadonlySet<string>,
): WorkbenchSettingsGroupEntry {
  const ownerUserId = resolveWorkbenchCollaborationSpaceOwnerUserId(space);
  const humans = space.members.humans ?? [];
  const bots = space.members.bots ?? [];
  const humanMembers = humans.filter((entry) => normalizeValue(entry.status) !== "invited");
  const botMembers = bots.filter((entry) => normalizeValue(entry.status) !== "invited");
  const ownerLabel =
    humans.find((entry) => normalizeValue(entry.userId) === ownerUserId)?.name ??
    space.operatingState?.memberRoleMap?.find(
      (entry) =>
        normalizeValue(entry.governanceRole) === "owner" &&
        normalizeValue(entry.memberKind) !== "bot",
    )?.label ??
    ownerUserId;
  const coordinatorBotId =
    normalizeValue(space.operatingState?.governance?.coordinatorBotId) ??
    normalizeValue(space.coordinatorBotId);
  const coordinatorBotLabel =
    bots.find((entry) => normalizeValue(entry.agentId) === coordinatorBotId)?.name ??
    coordinatorBotId;
  const systemInstructions = (space.systemInstructions ?? [])
    .map((entry) => entry.trim())
    .filter(Boolean);
  return {
    sessionKey: space.id,
    title: normalizeValue(space.title) ?? normalizeValue(space.groupId) ?? space.id,
    avatar: normalizeValue(space.avatar) ?? null,
    groupId: normalizeValue(space.groupId) ?? space.id,
    visibilityScope:
      normalizeValue(space.operatingState?.groupProfile?.visibilityScope) ??
      normalizeValue(space.visibilityScope) ??
      null,
    groupType: normalizeValue(space.operatingState?.groupProfile?.groupType) ?? null,
    lifecycleStatus: normalizeValue(space.operatingState?.groupProfile?.lifecycleStatus) ?? null,
    memberCount: humanMembers.length + botMembers.length,
    activeHumanCount: humanMembers.length,
    activeBotCount: botMembers.length,
    pendingHumanInviteCount: space.invites.humans?.length ?? 0,
    pendingBotInviteCount: space.invites.bots?.length ?? 0,
    role: resolveWorkbenchSettingsGroupRole({ ownerUserId, actorIdentities }),
    ownerUserId,
    ownerLabel: normalizeValue(ownerLabel) ?? null,
    adminUserIds:
      space.operatingState?.governance?.adminUserIds
        ?.map((entry) => entry.trim())
        .filter(Boolean) ?? [],
    coordinatorBotId,
    coordinatorBotLabel: normalizeValue(coordinatorBotLabel) ?? null,
    purpose:
      normalizeValue(space.operatingState?.groupProfile?.purpose) ?? normalizeValue(space.purpose),
    currentMission:
      normalizeValue(space.operatingState?.activeContext?.currentMission) ??
      normalizeValue(space.operatingState?.groupProfile?.currentMission) ??
      normalizeValue(space.currentMission),
    collaborationMode:
      normalizeValue(space.operatingState?.groupProfile?.collaborationMode) ??
      normalizeValue(space.collaborationMode),
    successCriteria:
      space.operatingState?.groupProfile?.successCriteria
        ?.map((entry) => entry.trim())
        .filter(Boolean) ?? [],
    systemInstructions,
    confidentialityTier: normalizeValue(space.confidentialityTier) ?? null,
    finalDecisionPolicy:
      space.finalDecisionPolicy ?? space.operatingState?.governance?.finalDecisionPolicy ?? null,
    // P1-A5 ⑤ (BP-20): render the server-compiled EffectivePolicy; no client-side compile.
    rulesSummary: buildCollaborationRulesSummary({
      effectivePolicy: space.effectivePolicy ?? null,
      systemInstructions,
    }),
    currentOperatingPhase:
      normalizeValue(space.operatingState?.activeContext?.currentOperatingPhase) ?? null,
    bootstrapArtifactsReady: resolveBootstrapArtifactsReady(space.operatingState),
    onboardingInitialized: resolveBootstrapArtifactsReady(space.operatingState),
    growthStatus: normalizeGrowthStatus(space.operatingState?.growthStatus),
    policyMaxVisibleBotRepliesPerRound:
      typeof space.operatingState?.collaborationPolicy?.maxVisibleBotRepliesPerRound === "number"
        ? space.operatingState.collaborationPolicy.maxVisibleBotRepliesPerRound
        : null,
    policyOpenDiscussion:
      typeof space.operatingState?.collaborationPolicy?.openDiscussionWithoutMention === "boolean"
        ? space.operatingState.collaborationPolicy.openDiscussionWithoutMention
        : null,
    workspacePath: normalizeValue(space.workspacePath) ?? null,
    members: space.members,
    invites: space.invites,
    memberRows: buildWorkbenchSettingsGroupMemberRows(space),
  };
}

function resolveWorkbenchSettingsGroupEntryByKey(
  spaces: WorkbenchCollaborationSpaceSnapshot[],
  actorIdentities: ReadonlySet<string>,
  groupId: string,
): WorkbenchSettingsGroupEntry | null {
  for (const space of spaces) {
    const mapped = mapWorkbenchSettingsGroupEntry(space, actorIdentities);
    if (matchesSystemSettingsGroupKey(mapped, groupId)) {
      return mapped;
    }
  }
  return null;
}

function buildWorkbenchSettingsGroupEntries(params: {
  spacesSnapshot: ReturnType<typeof buildWorkbenchCollaborationSpacesSnapshot> | undefined;
  currentUserId?: string | null;
  currentUserEmail?: string | null;
}): WorkbenchSettingsGroupEntry[] {
  const actorIdentities = buildWorkbenchActorIdentities(
    params.currentUserId,
    params.currentUserEmail,
  );
  const entries = (params.spacesSnapshot?.spaces ?? [])
    .filter((space) => isWorkbenchSettingsListableCollaborationSpace(space, actorIdentities))
    .map((space) => mapWorkbenchSettingsGroupEntry(space, actorIdentities));
  return dedupeSystemSettingsGroupEntries(entries).toSorted((left, right) =>
    left.title.localeCompare(right.title, "zh-Hans-CN"),
  );
}

function resolveCurrentAssistantId(selectionKey: string, activeSessionKey: string) {
  const normalizedSelection = normalizeValue(selectionKey);
  if (normalizedSelection === "main") {
    return "main";
  }
  const parsedSelection = normalizedSelection ? parseAgentSessionKey(normalizedSelection) : null;
  if (parsedSelection?.agentId) {
    return parsedSelection.agentId;
  }
  const parsedActive = parseAgentSessionKey(activeSessionKey);
  return parsedActive?.agentId ?? "main";
}

function buildRobotWorkbenchTaskEntries(params: {
  sessionsResult: SessionsListResult | null;
  agentId: string;
  activeSessionKey: string;
}): WorkbenchRobotWorkbenchTaskEntry[] {
  return deriveSessionCards(params.sessionsResult, ["direct", "group", "channel"])
    .filter((entry) => entry.agentId === params.agentId)
    .slice(0, 4)
    .map((entry) => ({
      id: entry.key,
      title: entry.title,
      updatedAt: entry.updatedAt,
      status: entry.key === params.activeSessionKey ? "running" : "done",
    }));
}

function buildRobotWorkbenchOutputEntries(messages: unknown[]) {
  const entries: Array<{
    id: string;
    title: string;
    type: "doc" | "ppt" | "sheet" | "report" | "other";
    createdAt: number | null;
  }> = [];

  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as Record<string, unknown>;
    const artifact =
      "artifact" in record && record.artifact && typeof record.artifact === "object"
        ? (record.artifact as Record<string, unknown>)
        : null;
    if (!artifact) {
      continue;
    }
    const artifactId =
      typeof artifact.artifactId === "string" ? artifact.artifactId.trim() : undefined;
    if (!artifactId) {
      continue;
    }
    const title =
      (typeof artifact.title === "string" && artifact.title.trim()) ||
      (typeof artifactId === "string" ? artifactId : "artifact");
    const normalizedTitle = title.toLowerCase();
    const type = normalizedTitle.includes("ppt")
      ? "ppt"
      : normalizedTitle.includes("sheet") || normalizedTitle.includes("table")
        ? "sheet"
        : normalizedTitle.includes("report")
          ? "report"
          : normalizedTitle.includes("doc")
            ? "doc"
            : "other";
    entries.push({
      id: artifactId,
      title,
      type,
      createdAt: typeof record.createdAt === "number" ? record.createdAt : null,
    });
  }

  return dedupeByKey(entries, (entry) => entry.id).slice(0, 5);
}

function buildSpaceCreatorCandidates(params: {
  workbenchSnapshot: ReturnType<typeof buildWorkbenchSnapshot>;
  directoryMembers?: Array<{
    user: string;
    displayName?: string;
    membershipRole: string;
    status?: string;
    seatTitle?: string;
  }> | null;
  currentUserId?: string | null;
  currentUserName?: string | null;
  ownedAgents: Array<{
    id: string;
    name?: string | null;
    identity?: { name?: string | null; emoji?: string | null } | null;
    ownerId?: string | null;
    ownerName?: string | null;
    scope?: string | null;
    shareStatus?: string | null;
  }>;
  orgDirectory: CollaborationOrgBotDirectoryEntry[];
  currentUserEmail?: string | null;
  ownedAgentIds?: ReadonlySet<string>;
}) {
  const actorIdentities = buildWorkbenchActorIdentities(
    params.currentUserId,
    params.currentUserEmail,
  );
  const candidateHumans = buildEmployeeDirectoryHumanCandidates({
    members: params.directoryMembers,
    currentUserId: params.currentUserId,
    currentUserName: params.currentUserName,
    excludeIdentities: actorIdentities,
  });
  const ownedAgentIds = new Set(params.ownedAgents.map((entry) => entry.id));
  // Prefer authoritative ownership when callers pass an expanded set.
  const effectiveOwnedAgentIds = params.ownedAgentIds ?? ownedAgentIds;
  const candidateBots = dedupeById(
    buildEmployeeDirectoryBotCandidates({
      orgDirectory: params.orgDirectory,
      directoryMembers: params.directoryMembers,
      currentUserId: params.currentUserId,
      currentUserEmail: params.currentUserEmail,
      ownedAgentIds: effectiveOwnedAgentIds,
      currentBotIds: new Set(),
      pendingBotIds: new Set(),
    })
      .filter((entry) => !isBuiltinStewardAgent(entry.id))
      .map<WorkbenchCreatorSelectionEntry>((entry) => {
        const ownerName = entry.orgSegments?.[0]?.endsWith(" 的机器人")
          ? entry.orgSegments[0].replace(/ 的机器人$/, "")
          : undefined;
        const directoryEntry = params.orgDirectory.find((bot) => bot.agentId === entry.id);
        return {
          id: entry.id,
          label: entry.label,
          subtitle: entry.subtitle,
          group: entry.orgSegments?.[0] ?? "机器人",
          ownerId: directoryEntry?.ownerUserId ?? undefined,
          ownerName,
          actionMode: entry.actionMode,
        };
      }),
  );
  return { candidateHumans, candidateBots };
}

function buildMemberGovernanceDraftPrompt(title: string, state: AppPortState) {
  const humans = (state.workbenchMemberGovernanceCurrentHumans ?? []).map((entry) => entry.label);
  const bots = (state.workbenchMemberGovernanceCurrentBots ?? []).map((entry) => entry.label);
  const humanInvites = (state.workbenchMemberGovernancePendingInvites ?? []).map(
    (entry) => entry.label,
  );
  const botInvites = (state.workbenchMemberGovernancePendingBotInvites ?? []).map(
    (entry) => entry.label,
  );
  const instruction =
    normalizeValue(state.workbenchMemberGovernancePrompt) ??
    "请结合当前成员配置，继续优化真人与机器人分工。";
  const selectionKey =
    normalizeValue(state.workbenchMemberGovernanceGroupKey) ??
    normalizeValue(state.workbenchTeamSelectedKey) ??
    normalizeValue(state.sessionKey);
  const groupSnapshot = resolveCollaborationGroupSnapshot({
    selectionKey,
    activeSessionKey: state.sessionKey,
    spacesResult: buildWorkbenchCollaborationSpacesSnapshot(state.collaborationSpacesResult),
    teamSpaces: [],
    sessionsResult: state.sessionsResult,
  });
  const managedSpace = groupSnapshot?.managedSpace;
  const groupId =
    normalizeValue(groupSnapshot?.groupId) ??
    normalizeValue(managedSpace?.groupId) ??
    normalizeValue(managedSpace?.id) ??
    selectionKey ??
    "unknown-group";
  return buildGroupConfigProposalPrompt({
    groupId,
    title,
    purpose: managedSpace?.purpose ?? null,
    currentMission: managedSpace?.currentMission ?? null,
    coordinatorBotId: managedSpace?.coordinatorBotId ?? null,
    collaborationMode: managedSpace?.collaborationMode ?? null,
    confidentialityTier: managedSpace?.confidentialityTier ?? null,
    systemInstructions: managedSpace?.systemInstructions ?? null,
    humans,
    bots,
    humanInvites,
    botInvites,
    instruction,
  });
}

function buildWorkbenchSpaceMemberUpdatePayload(params: {
  state: AppPortState;
  groupSnapshot: ReturnType<typeof resolveCollaborationGroupSnapshot>;
  currentHumans: WorkbenchCollaborationMemberGovernanceRosterEntry[];
  currentBots: WorkbenchCollaborationMemberGovernanceRosterEntry[];
  pendingHumanInvites: WorkbenchCollaborationPendingHumanInvite[];
  pendingBotInvites: WorkbenchCollaborationPendingBotInvite[];
}) {
  const groupId =
    normalizeValue(params.groupSnapshot?.groupId) ?? normalizeValue(params.groupSnapshot?.spaceId);
  if (!groupId) {
    return null;
  }
  const employeeAccess = params.state.platformAuthState?.employeeAccess;
  const platformSession =
    params.state.platformAuthState?.session ?? params.state.bootstrapAuthSession;
  const helloAuth =
    params.state.hello?.auth?.provider === "trusted-proxy" ? params.state.hello.auth : null;
  const tenantId =
    normalizeValue(platformSession?.tenantId) ?? normalizeValue(helloAuth?.tenantId) ?? undefined;
  const actorEmployeeUserId = normalizeValue(employeeAccess?.employeeUserId) ?? undefined;
  const ownerUserLabel =
    normalizeValue(platformSession?.displayName) ??
    normalizeValue(helloAuth?.displayName) ??
    undefined;
  // Enterprise spaces require a position seat owner — same fields as onCreateSpace.
  const ownerPositionId = normalizeValue(employeeAccess?.currentSeat?.seatId) ?? undefined;
  const ownerPositionLabel = normalizeValue(employeeAccess?.currentSeat?.title) ?? undefined;
  return {
    groupId,
    title: normalizeValue(params.state.workbenchMemberGovernanceTitle) ?? undefined,
    ...(tenantId ? { tenantId } : {}),
    ...(actorEmployeeUserId ? { actorEmployeeUserId } : {}),
    ...(ownerUserLabel ? { ownerUserLabel } : {}),
    ...(ownerPositionId ? { ownerPositionId } : {}),
    ...(ownerPositionLabel ? { ownerPositionLabel } : {}),
    members: {
      humans: params.currentHumans.map((entry) => ({
        userId: entry.id,
        name: entry.label,
      })),
      bots: params.currentBots.map((entry) => ({
        agentId: entry.id,
        name: entry.label,
      })),
    },
    invites: {
      humans: params.pendingHumanInvites.map((entry) => ({
        userId: entry.intentId.replace(/^invite:|^draft:/, ""),
        name: entry.label,
        ...(normalizeValue(entry.message)
          ? { handle: normalizeValue(entry.message) as string }
          : {}),
      })),
      bots: params.pendingBotInvites.map((entry) => ({
        agentId: entry.agentId,
        ...(normalizeValue(entry.label) ? { name: normalizeValue(entry.label) as string } : {}),
      })),
    },
  };
}

function findLatestArtifactId(messages: unknown[]) {
  for (const message of [...messages].toReversed()) {
    const artifact = resolvePreviewArtifactRecord(message);
    const artifactId =
      artifact && typeof artifact.artifactId === "string" ? artifact.artifactId.trim() : "";
    if (artifactId && isDeliverableResultArtifact(artifact)) {
      return artifactId;
    }
  }
  return null;
}

export function buildEmployeeWorkbenchProps(input: {
  state: AppPortState;
  chatContent: TemplateResult;
  chatComposer?: TemplateResult | null;
  authPanel?: TemplateResult | null;
}): WorkbenchProps {
  const { state } = input;
  const workbenchNavCollapsed = state.settings.navCollapsed;
  const workbenchSnapshot = buildWorkbenchSnapshot(state);
  const sessionBackedTeamSpaces = buildSessionBackedTeamSpaces(state);
  const helloTrustedProxySession =
    state.hello?.auth?.provider === "trusted-proxy" && state.hello.auth.user
      ? {
          user: state.hello.auth.user,
          displayName: state.hello.auth.displayName,
          tenantId: state.hello.auth.tenantId,
        }
      : null;
  const trustedProxySession =
    helloTrustedProxySession ?? state.platformAuthState?.session ?? state.bootstrapAuthSession;
  const employeeAccess = state.platformAuthState?.employeeAccess ?? null;
  const currentHumanUserId =
    normalizeValue(employeeAccess?.employeeUserId) ??
    normalizeValue(helloTrustedProxySession?.user) ??
    normalizeValue(state.platformAuthState?.session?.user) ??
    normalizeValue(state.bootstrapAuthSession?.user) ??
    null;
  // Scope the home collaboration list to the signed-in user so their own spaces
  // sort first instead of leaving ordering user-agnostic.
  const currentUserId = currentHumanUserId ?? trustedProxySession?.user ?? null;
  const collaborationSpacesSnapshot = scopedCollaborationSpacesSnapshotForEmployeeWorkbench(state);
  const visibleSpaceIds = expandVisibleCollaborationSpaceIds(collaborationSpacesSnapshot.spaces);
  const sessionsResult = scopedSessionsResultForEmployeeWorkbench(state, visibleSpaceIds);
  const collaborationReadModel = buildWorkbenchCollaborationReadModel({
    spacesResult: collaborationSpacesSnapshot,
    teamSpaces: sessionBackedTeamSpaces,
    sessionsResult,
    currentUserId,
    currentUserEmail: trustedProxySession?.user ?? null,
    seatSpaceIds: employeeAccess?.defaultSpaceIds ?? null,
  });
  const collaborationTeamSpaces = collaborationReadModel.teamSpaces ?? [];
  const collaborationSelectionKeys = collaborationTeamSpaces.map((entry) => entry.key);
  // Derive the collaboration override from the *explicitly selected* nav key
  // only — never fall back to `state.sessionKey`. The active chat session can
  // still point at a space (e.g. a steward whose session is also bound to a
  // group) even after the user clicks an assistant in the sidebar; falling
  // back to it would flip the module to "collaboration" and mislabel the
  // stage header (e.g. selecting 大白管家 but showing "TO: 市场研究组").
  const derivedPrimaryModule = resolveWorkspacePrimaryModuleForSelection(
    state.workbenchTeamSelectedKey,
    collaborationSelectionKeys,
  );
  const primaryModule =
    state.workbenchPrimaryModule === "assistant" && derivedPrimaryModule === "collaboration"
      ? derivedPrimaryModule
      : state.workbenchPrimaryModule;
  const currentLocale = isSupportedLocale(state.settings.locale)
    ? state.settings.locale
    : ("zh-CN" as Locale);
  const currentTheme = state.theme ?? "system";
  // Account / header identity must be the signed-in human platform actor — never
  // the selected digital employee (大白管家) or assistantName from the session.
  const platformAuthSession = state.platformAuthState?.session ?? null;
  const resolvedHumanProfileName = resolveWorkbenchHumanProfileName({
    workbenchProfileName: state.settings.workbenchProfileName,
    platformDisplayName:
      platformAuthSession?.displayName ??
      trustedProxySession?.displayName ??
      helloTrustedProxySession?.displayName,
    platformEmail:
      platformAuthSession?.email ??
      (trustedProxySession && "email" in trustedProxySession
        ? ((trustedProxySession as { email?: string | null }).email ?? null)
        : null),
    platformUser:
      platformAuthSession?.user ?? trustedProxySession?.user ?? helloTrustedProxySession?.user,
    forbiddenAgentNames: [state.assistantName, BUILTIN_STEWARD_NAME],
  });
  const signedInPlatformActor = Boolean(
    platformAuthSession?.user ||
    platformAuthSession?.email ||
    platformAuthSession?.displayName ||
    trustedProxySession?.user ||
    helloTrustedProxySession?.user,
  );
  // Signed-in headers must never fall back to the product brand ("OpenBot" / "openbot").
  const userProfileName = resolvedHumanProfileName || (signedInPlatformActor ? "" : "OpenBot");
  const daibaiGuideAcknowledged = isDaibaiGuideAcknowledgedForUser(state.settings, currentUserId);
  const userProfileSignature = state.settings.workbenchProfileNote?.trim() ?? "";
  const tenantLabel =
    state.platformAuthState?.tenantName?.trim() ||
    state.platformAuthState?.enterprise?.name?.trim() ||
    trustedProxySession?.tenantId?.trim() ||
    "";
  // OS / memberRoleMap often keys humans by mailbox while employeeAccess and
  // hello.auth may only carry the platform uuid. Prefer any @ candidate across
  // platform session + hello + bootstrap — do not let hello.user (uuid) hide the
  // email that platformAuthState.session.user still holds.
  const platformSessionEmail =
    platformAuthSession && "email" in platformAuthSession
      ? ((platformAuthSession as { email?: string | null }).email ?? null)
      : null;
  const trustedSessionEmail =
    trustedProxySession && "email" in trustedProxySession
      ? ((trustedProxySession as { email?: string | null }).email ?? null)
      : null;
  const bootstrapSessionEmail =
    state.bootstrapAuthSession && "email" in state.bootstrapAuthSession
      ? ((state.bootstrapAuthSession as { email?: string | null }).email ?? null)
      : null;
  const currentHumanUserEmail =
    resolveWorkbenchActorEmail({
      candidates: [
        platformSessionEmail,
        trustedSessionEmail,
        bootstrapSessionEmail,
        platformAuthSession?.user,
        state.bootstrapAuthSession?.user,
        trustedProxySession?.user,
        helloTrustedProxySession?.user,
      ],
    }) ?? null;
  const orgBotDirectory = state.workbenchCollaborationOrgBotDirectory ?? [];
  const actorIdentities = buildWorkbenchActorIdentities(currentHumanUserId, currentHumanUserEmail);
  // Merge every session handle so uuid-only hello cannot drop the email identity.
  for (const extra of [
    platformAuthSession?.user,
    platformSessionEmail,
    state.bootstrapAuthSession?.user,
    bootstrapSessionEmail,
    trustedProxySession?.user,
    trustedSessionEmail,
    helloTrustedProxySession?.user,
  ]) {
    addWorkbenchActorIdentityValue(actorIdentities, extra);
  }
  const trustedProxySessionScopes =
    trustedProxySession && "scopes" in trustedProxySession
      ? (trustedProxySession.scopes ?? [])
      : [];
  const supervisorSessionScopes = [
    ...trustedProxySessionScopes,
    ...(state.hello?.auth?.scopes ?? []),
  ];
  const rawAgents = scopedAgentsListForEmployeeWorkbench(state)?.agents ?? [];
  // Same agents.list projection as the assistant rail. Steward stays in nav;
  // the robots tab lists position bots only.
  const authoritativeOwnedAgentIds = new Set(
    rawAgents.map((agent) => agent.id).filter((agentId) => !isBuiltinStewardAgent(agentId)),
  );
  const ownedAgents = rawAgents
    .filter((agent) => authoritativeOwnedAgentIds.has(agent.id))
    .map(
      (
        agent: GatewayAgentRow & {
          scope?: string | null;
          shareStatus?: string | null;
          workspace?: string | null;
        },
      ) => ({
        id: agent.id,
        name: agent.name ?? null,
        identity: agent.identity
          ? {
              name: agent.identity.name ?? null,
              emoji: agent.identity.emoji ?? null,
            }
          : null,
        scope: agent.scope ?? null,
        shareStatus: agent.shareStatus ?? null,
        workspace: agent.workspace ?? null,
      }),
    );
  const sharedAgents = rawAgents
    .filter((agent) => {
      const scope =
        "scope" in agent && typeof agent.scope === "string" ? agent.scope.trim().toLowerCase() : "";
      const isSharedScope = scope === "shared" || scope === "team";
      return isSharedScope && !authoritativeOwnedAgentIds.has(agent.id);
    })
    .map<WorkbenchSharedAgentEntry>(
      (
        agent: GatewayAgentRow & {
          scope?: string | null;
          shareStatus?: string | null;
          ownerId?: string | null;
          ownerName?: string | null;
        },
      ) => ({
        id: agent.id,
        name: agent.name ?? null,
        identity: agent.identity
          ? {
              name: agent.identity.name ?? null,
              emoji: agent.identity.emoji ?? null,
            }
          : null,
        ownerId: agent.ownerId ?? null,
        ownerName: agent.ownerName ?? null,
        scope: agent.scope ?? null,
        shareStatus: agent.shareStatus ?? null,
      }),
    );
  const ownedAgentIds = authoritativeOwnedAgentIds;
  const memberGovernanceActor = {
    currentUserId: currentHumanUserId,
    currentUserEmail: currentHumanUserEmail,
    ownedAgentIds,
  };
  const spaceCreatorCandidates = buildSpaceCreatorCandidates({
    workbenchSnapshot,
    directoryMembers: state.platformAuthState?.members ?? null,
    currentUserId: currentHumanUserId,
    currentUserName: userProfileName,
    currentUserEmail: currentHumanUserEmail,
    ownedAgents,
    ownedAgentIds,
    orgDirectory: orgBotDirectory,
  });
  const pendingBotApprovalCounts = buildPendingBotApprovalCounts({
    spacesSnapshot: collaborationSpacesSnapshot,
    teamSpaces: collaborationTeamSpaces,
    ownedAgents,
    activeSelectionKey: state.workbenchTeamSelectedKey || state.sessionKey,
    sessionsResult,
  });
  const resolveCurrentCollaborationGroup = () =>
    resolveCollaborationGroupSnapshot({
      selectionKey: state.workbenchTeamSelectedKey || state.sessionKey,
      activeSessionKey: state.sessionKey,
      spacesResult: collaborationSpacesSnapshot ?? { spaces: [] },
      teamSpaces: collaborationReadModel.teamSpaces ?? [],
      sessionsResult,
    });
  const rebuildMemberGovernanceCandidates = () => {
    const { candidateHumans, candidateBots } = buildMemberGovernanceCandidates({
      workbenchSnapshot,
      directoryMembers: state.platformAuthState?.members ?? null,
      currentUserId: currentHumanUserId,
      currentUserName: userProfileName,
      currentUserEmail: currentHumanUserEmail,
      ownedAgents,
      ownedAgentIds,
      orgDirectory: state.workbenchCollaborationOrgBotDirectory ?? [],
      currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
      currentBots: state.workbenchMemberGovernanceCurrentBots ?? [],
      pendingHumanInvites: state.workbenchMemberGovernancePendingInvites ?? [],
      pendingBotInvites: state.workbenchMemberGovernancePendingBotInvites ?? [],
    });
    state.workbenchMemberGovernanceCandidateHumans = candidateHumans;
    state.workbenchMemberGovernanceCandidateBots = candidateBots;
  };
  const refreshMemberGovernanceSnapshot = () => {
    const groupSnapshot = resolveCurrentCollaborationGroup();
    if (!groupSnapshot) {
      return;
    }
    const baseEntries = buildBaseMemberGovernanceEntries(
      groupSnapshot,
      ownedAgents,
      state.workbenchCollaborationOrgBotDirectory ?? [],
      memberGovernanceActor,
    );
    state.workbenchMemberGovernanceCurrentHumans = baseEntries.currentHumans;
    state.workbenchMemberGovernanceCurrentBots = baseEntries.currentBots;
    state.workbenchMemberGovernancePendingInvites = baseEntries.pendingHumanInvites;
    state.workbenchMemberGovernancePendingBotInvites = baseEntries.pendingBotInvites;
    rebuildMemberGovernanceCandidates();
  };
  const initializeMemberGovernance = () => {
    const groupSnapshot = resolveCurrentCollaborationGroup();
    if (!groupSnapshot) {
      resetWorkbenchMemberGovernanceState(state);
      return;
    }
    const groupKey =
      groupSnapshot.selectionKey ?? state.workbenchTeamSelectedKey ?? state.sessionKey;
    const openingFreshGroup =
      !state.workbenchMemberGovernanceGroupKey ||
      state.workbenchMemberGovernanceGroupKey !== groupKey;
    if (!openingFreshGroup) {
      // Already initialized for this group. Explicit refresh happens via action handlers
      // (open selector, persist, cancel invite) — not on every render props build.
      return;
    }
    const baseEntries = buildBaseMemberGovernanceEntries(
      groupSnapshot,
      ownedAgents,
      state.workbenchCollaborationOrgBotDirectory ?? [],
      memberGovernanceActor,
    );
    const title =
      collaborationReadModel.teamSpaces?.find((entry) => entry.selectionKey === groupKey)?.title ??
      groupSnapshot.managedSpace?.title ??
      groupKey;
    state.workbenchMemberGovernanceGroupKey = groupKey;
    state.workbenchMemberGovernanceTitle = title;
    state.workbenchMemberGovernancePrompt = `请帮我调整“${title}”的成员与机器人分工。`;
    state.workbenchMemberGovernanceBusy = false;
    state.workbenchMemberGovernanceError = null;
    state.workbenchMemberGovernanceResult = null;
    state.workbenchMemberGovernanceCurrentHumans = baseEntries.currentHumans;
    state.workbenchMemberGovernanceCurrentBots = baseEntries.currentBots;
    state.workbenchMemberGovernancePendingInvites = baseEntries.pendingHumanInvites;
    state.workbenchMemberGovernancePendingBotInvites = baseEntries.pendingBotInvites;
    state.workbenchMemberGovernanceSelectorKind = null;
    state.workbenchMemberGovernanceSearch = "";
    state.workbenchMemberGovernanceSelectedHumanIds = [];
    state.workbenchMemberGovernanceSelectedBotIds = [];
    rebuildMemberGovernanceCandidates();
    void loadCollaborationOrgBotDirectory(state).then(() => {
      if (state.workbenchMemberGovernanceGroupKey === groupKey) {
        refreshMemberGovernanceSnapshot();
      }
    });
  };
  if (state.workbenchMemberGovernanceDrawerOpen || state.workbenchGroupProfileView === "members") {
    const memberGovernanceGroupSnapshot = resolveCurrentCollaborationGroup();
    if (memberGovernanceGroupSnapshot) {
      const memberGovernanceGroupKey =
        memberGovernanceGroupSnapshot.selectionKey ??
        state.workbenchTeamSelectedKey ??
        state.sessionKey;
      if (
        !state.workbenchMemberGovernanceGroupKey ||
        state.workbenchMemberGovernanceGroupKey !== memberGovernanceGroupKey
      ) {
        initializeMemberGovernance();
      }
    }
  }
  if (
    state.workbenchSpaceCreatorOpen &&
    (state.workbenchCollaborationOrgBotDirectory?.length ?? 0) === 0
  ) {
    void loadCollaborationOrgBotDirectory(state);
  }
  const persistMemberGovernanceState = async (params: {
    currentHumans: WorkbenchCollaborationMemberGovernanceRosterEntry[];
    currentBots: WorkbenchCollaborationMemberGovernanceRosterEntry[];
    pendingHumanInvites: WorkbenchCollaborationPendingHumanInvite[];
    pendingBotInvites: WorkbenchCollaborationPendingBotInvite[];
    successMessage: string;
    keepHumanSelectorOpen?: boolean;
    keepBotSelectorOpen?: boolean;
    invitingHumanId?: string | null;
    invitingBotId?: string | null;
  }) => {
    const groupSnapshot = resolveCurrentCollaborationGroup();
    const payload = buildWorkbenchSpaceMemberUpdatePayload({
      state,
      groupSnapshot,
      currentHumans: params.currentHumans,
      currentBots: params.currentBots,
      pendingHumanInvites: params.pendingHumanInvites,
      pendingBotInvites: params.pendingBotInvites,
    });
    if (!payload) {
      state.workbenchMemberGovernanceError = "当前协作小组未绑定可保存的分组标识。";
      state.workbenchMemberGovernanceResult = null;
      return;
    }
    state.workbenchMemberGovernanceBusy = true;
    state.workbenchMemberGovernanceError = null;
    state.workbenchMemberGovernanceResult = null;
    if (params.invitingHumanId) {
      state.workbenchMemberGovernanceInvitingHumanId = params.invitingHumanId;
    }
    if (params.invitingBotId) {
      state.workbenchMemberGovernanceInvitingBotId = params.invitingBotId;
    }
    try {
      await updateEmployeeWorkbenchSpaceMembers(state, payload);
      const keepHumanSelector =
        params.keepHumanSelectorOpen === true &&
        state.workbenchMemberGovernanceSelectorKind === "human";
      const keepBotSelector =
        params.keepBotSelectorOpen === true &&
        state.workbenchMemberGovernanceSelectorKind === "bot";
      // Apply the roster we just saved. Rebuilding solely from spaces.list can leave
      // the accept/reject banner up when a concurrent list skipped the post-write refresh.
      const groupKeyAfter =
        resolveCurrentCollaborationGroup()?.selectionKey ??
        state.workbenchTeamSelectedKey ??
        state.sessionKey;
      if (groupKeyAfter) {
        state.workbenchMemberGovernanceGroupKey = groupKeyAfter;
      }
      state.workbenchMemberGovernanceCurrentHumans = params.currentHumans;
      state.workbenchMemberGovernanceCurrentBots = params.currentBots;
      state.workbenchMemberGovernancePendingInvites = params.pendingHumanInvites;
      state.workbenchMemberGovernancePendingBotInvites = params.pendingBotInvites;
      if (keepHumanSelector || keepBotSelector) {
        if (keepHumanSelector) {
          state.workbenchMemberGovernanceSelectedHumanIds = [];
        }
        if (keepBotSelector) {
          state.workbenchMemberGovernanceSelectedBotIds = [];
        }
      } else {
        state.workbenchMemberGovernanceSelectorKind = null;
        state.workbenchMemberGovernanceSearch = "";
        state.workbenchMemberGovernanceSelectedHumanIds = [];
        state.workbenchMemberGovernanceSelectedBotIds = [];
      }
      rebuildMemberGovernanceCandidates();
      state.workbenchMemberGovernanceResult = params.successMessage;
    } catch (error) {
      state.workbenchMemberGovernanceError = String(error);
      state.workbenchMemberGovernanceResult = null;
    } finally {
      state.workbenchMemberGovernanceBusy = false;
      state.workbenchMemberGovernanceInvitingHumanId = null;
      state.workbenchMemberGovernanceInvitingBotId = null;
    }
  };
  const resetMemberGovernanceState = async () => {
    const groupSnapshot = resolveCurrentCollaborationGroup();
    const groupId = normalizeValue(groupSnapshot?.managedSpace?.groupId);
    if (!groupId) {
      state.workbenchMemberGovernanceError = "当前协作小组未绑定可重置的分组标识。";
      state.workbenchMemberGovernanceResult = null;
      return;
    }
    state.workbenchMemberGovernanceBusy = true;
    state.workbenchMemberGovernanceError = null;
    state.workbenchMemberGovernanceResult = null;
    try {
      await resetEmployeeWorkbenchSpace(state, { groupId });
      state.resetCollaborationLearningSnapshot();
      state.resetCollaborationGovernanceActionState();
      state.workbenchMemberGovernanceGroupKey = null;
      state.workbenchMemberGovernanceSelectorKind = null;
      state.workbenchMemberGovernanceSearch = "";
      state.workbenchMemberGovernanceSelectedHumanIds = [];
      state.workbenchMemberGovernanceSelectedBotIds = [];
      initializeMemberGovernance();
      state.workbenchMemberGovernanceResult = "已重置协作小组数据并完成重建。";
    } catch (error) {
      state.workbenchMemberGovernanceError = String(error);
      state.workbenchMemberGovernanceResult = null;
    } finally {
      state.workbenchMemberGovernanceBusy = false;
    }
  };
  const collaborationMemberGovernance: WorkbenchCollaborationMemberGovernanceState | null =
    (state.workbenchMemberGovernanceDrawerOpen || state.workbenchGroupProfileView === "members") &&
    state.workbenchMemberGovernanceGroupKey
      ? (() => {
          const managedSpace = resolveCurrentCollaborationGroup()?.managedSpace;
          const currentOwnerUserId = managedSpace
            ? resolveWorkbenchCollaborationSpaceOwnerUserId(managedSpace)
            : null;
          const pendingHumanInvites = state.workbenchMemberGovernancePendingInvites ?? [];
          const selfPendingInvite =
            pendingHumanInvites.find((entry) =>
              matchesWorkbenchActorIdentity(
                entry.intentId.replace(/^invite:|^draft:/, ""),
                actorIdentities,
              ),
            ) ?? null;
          return {
            activeGroupKey: state.workbenchMemberGovernanceGroupKey,
            activeGroupRole: resolveWorkbenchActorGovernanceRole({
              ownerUserId: currentOwnerUserId,
              actorIdentities,
              memberRoleMap: managedSpace?.operatingState?.memberRoleMap ?? null,
              adminUserIds: managedSpace?.operatingState?.governance?.adminUserIds ?? null,
            }),
            currentOwnerUserId,
            title: state.workbenchMemberGovernanceTitle ?? "",
            prompt: state.workbenchMemberGovernancePrompt ?? "",
            busy: Boolean(state.workbenchMemberGovernanceBusy),
            invitingHumanId: state.workbenchMemberGovernanceInvitingHumanId ?? null,
            invitingBotId: state.workbenchMemberGovernanceInvitingBotId ?? null,
            error: state.workbenchMemberGovernanceError ?? null,
            result: state.workbenchMemberGovernanceResult ?? null,
            canReset: matchesWorkbenchActorIdentity(currentOwnerUserId, actorIdentities),
            selectorKind: state.workbenchMemberGovernanceSelectorKind ?? null,
            search: state.workbenchMemberGovernanceSearch ?? "",
            currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
            currentBots: state.workbenchMemberGovernanceCurrentBots ?? [],
            pendingHumanInvites,
            pendingBotInvites: state.workbenchMemberGovernancePendingBotInvites ?? [],
            selfPendingInvite,
            candidateHumans: state.workbenchMemberGovernanceCandidateHumans ?? [],
            candidateBots: state.workbenchMemberGovernanceCandidateBots ?? [],
            selectedHumanIds: state.workbenchMemberGovernanceSelectedHumanIds ?? [],
            selectedBotIds: state.workbenchMemberGovernanceSelectedBotIds ?? [],
          };
        })()
      : null;
  const closeCreator = () => {
    state.workbenchAgentCreatorOpen = false;
    state.workbenchAgentCreatorBusy = false;
    state.workbenchAgentCreatorError = null;
    state.workbenchAgentCreatorDesign = null;
    state.workbenchAgentCreatorStep = "intent";
    state.workbenchAgentCreatorRoleSource = "ai";
    state.workbenchAgentCreatorTemplateId = "";
    state.workbenchAgentCreatorTemplates = [];
    state.workbenchAgentCreatorTemplatesLoading = false;
    state.workbenchAgentCreatorWorkspaceKind = "local";
    state.workbenchAgentCreatorLocalValidationState = "idle";
    state.workbenchAgentCreatorLocalValidationMessage = null;
    state.workbenchAgentCreatorLocalResolvedPath = null;
    state.workbenchAgentCreatorLocalReadable = false;
    state.workbenchAgentCreatorLocalWritable = false;
    state.workbenchAgentCreatorLocalBrowserOpen = false;
    state.workbenchAgentCreatorLocalBrowserBusy = false;
    state.workbenchAgentCreatorLocalBrowserError = null;
    state.workbenchAgentCreatorLocalBrowserCurrentPath = "";
    state.workbenchAgentCreatorLocalBrowserParentPath = null;
    state.workbenchAgentCreatorLocalBrowserEntries = [];
    state.workbenchWorkspaceCloudGeneratedConfig = null;
    state.workbenchWorkspaceCloudConnectionState = "idle";
    state.workbenchWorkspaceCloudConnectionMessage = null;
    state.workbenchWorkspaceCloudCanRead = false;
    state.workbenchWorkspaceCloudCanWrite = false;
    state.workbenchWorkspaceCloudBrowserOpen = false;
    state.workbenchWorkspaceCloudBrowserBusy = false;
    state.workbenchWorkspaceCloudBrowserError = null;
    state.workbenchWorkspaceCloudBrowserCurrentPath = "";
    state.workbenchWorkspaceCloudBrowserParentPath = null;
    state.workbenchWorkspaceCloudBrowserEntries = [];
    state.workbenchWorkspaceCloudSelectedPath = "";
    state.workbenchSpaceCreatorOpen = false;
    state.workbenchSpaceCreatorBusy = false;
    state.workbenchSpaceCreatorError = null;
    state.workbenchSpaceCreatorTitle = "";
    state.workbenchSpaceCreatorAvatar = "🛰️";
    state.workbenchSpaceCreatorPurpose = "";
    state.workbenchSpaceCreatorCurrentMission = "";
    state.workbenchSpaceCreatorSystemInstructions = "";
    state.workbenchSpaceCreatorGroupId = "";
    state.workbenchSpaceCreatorGroupIdTouched = false;
    state.workbenchSpaceCreatorStep = "details";
    state.workbenchSpaceCreatorSelectedHumanIds = [];
    state.workbenchSpaceCreatorSelectedBotIds = [];
    state.workbenchSpaceCreatorCoordinatorBotId = "";
  };
  const workbenchInteractionProps = buildEmployeeWorkbenchInteractionProps({
    state,
    collaborationMemberGovernance,
    closeCreator,
    ownedAgents,
    resolveDefaultAgentWorkspace,
    deriveWorkspaceGroupId,
    normalizeValue,
    findLatestArtifactId,
    buildMemberGovernanceDraftPrompt,
    persistMemberGovernanceState,
    resetMemberGovernanceState,
    refreshMemberGovernanceSnapshot,
    spaceCreatorCandidates,
  });
  const platformRole = state.platformAuthState?.platformRole;
  const bypassAgentNavQuota =
    isPlatformAdminSessionKind(state.platformAuthState?.sessionKind) ||
    platformRole === "admin" ||
    platformRole === "super-admin";
  const workbenchNavQuota = resolveEmployeeWorkbenchNavQuota({
    agents: scopedAgentsListForEmployeeWorkbench(state)?.agents ?? [],
    // Create-quota counts only groups the actor owns; joined peer groups are unlimited.
    spaces: (collaborationSpacesSnapshot?.spaces ?? []).map((space) => ({
      ownerUserId: resolveWorkbenchCollaborationSpaceOwnerUserId(space),
    })),
    actorIdentities,
    bypassAgentLimit: bypassAgentNavQuota,
  });
  if (!workbenchNavQuota.canAddAgent) {
    (workbenchInteractionProps as Record<string, unknown>)["onOpenAgentCreator"] = null;
  }
  if (!workbenchNavQuota.canAddSpace) {
    (workbenchInteractionProps as Record<string, unknown>)["onOpenSpaceCreator"] = null;
  }
  const workbenchGovernanceInteractionProps = buildEmployeeWorkbenchGovernanceInteractionProps({
    state,
    initializeMemberGovernance,
    resetWorkbenchMemberGovernanceState,
    resolveActiveDecisionOptions,
    createDraftDecisionOptionId,
    requestWorkbenchRender,
  });
  const workbenchShellActionProps = buildEmployeeWorkbenchShellActionProps({
    state,
    collaborationSelectionKeys,
    resetWorkbenchMemberGovernanceState,
  });
  const defaultWorkspaceRoot = resolveDefaultAgentWorkspace(state, state.configSnapshot) || null;
  const defaultWorkspaceRootDraft =
    state.workbenchDefaultWorkspaceRootDraft ?? defaultWorkspaceRoot;
  const dataSpace = resolveWorkbenchDataSpaceSettings({
    config: state.configSnapshot?.config,
    bootstrapMode: state.bootstrapDataSpace?.mode ?? null,
    bootstrapDisplayRoot: state.bootstrapDataSpace?.displayRoot ?? null,
  });
  const dataDirectoryPanel = buildWorkbenchDataDirectoryPanelState(state);
  const dataDirectoryActions = buildWorkbenchDataDirectoryActionHandlers({
    state,
    requestRender: () => requestWorkbenchRender(state),
  });
  const deleteOwnedRobotWithDisposal = async (
    agentId: string,
    _memoryDisposal: "delete_all" | "keep_artifacts_conversations" | "soft_unbind",
  ) => {
    if (!state.client) {
      state.workbenchOwnedRobotDeleteError = "删除机器人失败：未连接 Gateway";
      requestWorkbenchRender(state);
      return;
    }
    state.workbenchOwnedRobotDeleteBusyId = agentId;
    state.workbenchOwnedRobotDeleteError = null;
    requestWorkbenchRender(state);
    try {
      await state.client.request("agents.delete", { agentId, memoryDisposal: "delete_all" });
      if (state.sessionKey.includes(`:${agentId}:`) || state.sessionKey.endsWith(`:${agentId}`)) {
        state.sessionKey = "agent:main:main";
      }
      const access = state.platformAuthState?.employeeAccess;
      if (state.platformAuthState && access) {
        const drop = (ids?: string[] | null) => (ids ?? []).filter((id) => id !== agentId);
        state.platformAuthState = {
          ...state.platformAuthState,
          employeeAccess: {
            ...access,
            agentIds: drop(access.agentIds),
            ownedAgentIds: drop(access.ownedAgentIds),
          },
        };
      }
      if (state.workbenchMyBotDetailAgentId === agentId) {
        state.workbenchMyBotDetailAgentId = null;
        state.workbenchMyBotProjection = null;
        state.workbenchMyBotIdentityDraft = null;
        state.workbenchMyBotDetailError = null;
        state.workbenchMyBotDetailLoading = false;
        state.workbenchMyBotDetailTab = "identity";
      }
      await reloadEmployeeWorkbenchAgents(state);
      state.workbenchOwnedRobotDeleteError = null;
      state.workbenchOwnedRobotDeletePrompt = null;
    } catch (error) {
      state.workbenchOwnedRobotDeleteError =
        error instanceof Error && error.message.trim() ? error.message : "删除机器人失败";
    } finally {
      state.workbenchOwnedRobotDeleteBusyId = null;
      requestWorkbenchRender(state);
    }
  };
  const currentAssistantId = resolveCurrentAssistantId(
    state.workbenchTeamSelectedKey || state.sessionKey,
    state.sessionKey,
  );
  const recentAccessEntries = deriveSessionCards(sessionsResult, ["direct", "group", "channel"])
    .slice(0, 4)
    .map((entry) => ({
      key: entry.key,
      title: entry.title,
      subtitle: entry.subtitle,
      updatedAt: entry.updatedAt,
    }));
  const cronExecutionAgents = buildCronExecutionAgents(
    ownedAgents.map((entry) => ({
      id: entry.id,
      name: entry.name,
      identity: entry.identity,
      source: "owned" as const,
    })),
  );
  const cronExecutionGroups = buildCronExecutionGroups(
    (collaborationSpacesSnapshot?.spaces ?? []).map((space) => ({
      sessionKey: space.id,
      title: normalizeValue(space.title) ?? normalizeValue(space.groupId) ?? space.id,
      memberCount: (space.members.humans?.length ?? 0) + (space.members.bots?.length ?? 0),
      purpose:
        normalizeValue(space.operatingState?.groupProfile?.purpose) ??
        normalizeValue(space.purpose),
      mission:
        normalizeValue(space.operatingState?.activeContext?.currentMission) ??
        normalizeValue(space.operatingState?.groupProfile?.currentMission) ??
        normalizeValue(space.currentMission),
    })),
  );
  const cronTeamTemplateSyncAvailable = Boolean(
    normalizeValue(trustedProxySession?.tenantId) ??
    normalizeValue(helloTrustedProxySession?.tenantId),
  );
  const cronProps: CronProps = {
    basePath: state.basePath,
    loading: state.cronLoading,
    jobsLoadingMore: state.cronJobsLoadingMore,
    status: state.cronStatus,
    jobs: state.cronJobs,
    jobsTotal: state.cronJobsTotal,
    jobsHasMore: state.cronJobsHasMore,
    jobsQuery: state.cronJobsQuery,
    jobsEnabledFilter: state.cronJobsEnabledFilter,
    jobsScheduleKindFilter: state.cronJobsScheduleKindFilter,
    jobsLastStatusFilter: state.cronJobsLastStatusFilter,
    jobsSortBy: state.cronJobsSortBy,
    jobsSortDir: state.cronJobsSortDir,
    error: state.cronError,
    busy: state.cronBusy,
    form: state.cronForm,
    fieldErrors: state.cronFieldErrors,
    canSubmit: Object.values(state.cronFieldErrors).every((value) => !value),
    canManageJobs: true,
    canRunJobs: true,
    readOnlyReason: null,
    editingJobId: state.cronEditingJobId,
    channels: state.channelsSnapshot?.channelMeta?.length
      ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
      : (state.channelsSnapshot?.channelOrder ?? []),
    channelLabels: state.channelsSnapshot?.channelLabels ?? {},
    channelMeta: state.channelsSnapshot?.channelMeta ?? [],
    runsJobId: state.cronRunsJobId,
    runs: state.cronRuns,
    runsTotal: state.cronRunsTotal,
    runsHasMore: state.cronRunsHasMore,
    runsLoadingMore: state.cronRunsLoadingMore,
    runsScope: state.cronRunsScope,
    runsStatuses: state.cronRunsStatuses,
    runsDeliveryStatuses: state.cronRunsDeliveryStatuses,
    runsStatusFilter: state.cronRunsStatusFilter,
    runsQuery: state.cronRunsQuery,
    runsSortDir: state.cronRunsSortDir,
    agentSuggestions: cronExecutionAgents.map((entry) => entry.label),
    executionAgents: cronExecutionAgents,
    executionGroups: cronExecutionGroups,
    dataCapabilities: state.knowledgeUniverseDataCapabilities,
    personalKnowledgeSources: state.knowledgeUniverseSourceBrowse.personal,
    enterpriseKnowledgeSources: state.knowledgeUniverseSourceBrowse.enterprise,
    enterpriseRestrictedKnowledgeSources: state.knowledgeUniverseSourceBrowse.enterpriseRestricted,
    teamTemplateSyncAvailable: cronTeamTemplateSyncAvailable,
    onLoadTeamTemplates: state.client
      ? async () =>
          (await loadTeamCronTemplates(state.client!)).map((template) => ({
            id: template.id,
            scope: "team" as const,
            name: template.name,
            summary: template.summary,
            category: template.category,
            intentText: template.intentText,
            goal: template.goal,
            acceptanceRules: template.acceptanceRules,
            schedulePreset: template.schedulePreset,
            dailyTime: template.dailyTime,
            weeklyDay: template.weeklyDay,
            monthlyDay: template.monthlyDay,
            suggestedAgents: template.suggestedAgents,
            suggestedGroups: template.suggestedGroups,
            priority: template.priority,
          }))
      : undefined,
    onSaveTeamTemplate: state.client
      ? async (template) =>
          saveTeamCronTemplate(state.client!, {
            ...template,
            scope: "team",
            category: template.category as PersonalCronTaskMeta["category"],
            schedulePreset: template.schedulePreset as PersonalCronTaskMeta["schedulePreset"],
            priority: template.priority as PersonalCronTaskMeta["priority"] | undefined,
          })
      : undefined,
    onDeleteTeamTemplate: state.client
      ? async (templateId) => deleteTeamCronTemplate(state.client!, templateId)
      : undefined,
    onEnhanceTaskWithAi:
      state.client && state.connected
        ? async (input) => {
            const result = await enhanceCronTaskWithAi({
              client: state.client!,
              sessionKey: state.sessionKey,
              input: {
                mode: input.mode,
                taskName: input.taskName,
                intentText: input.intentText,
                meta: {
                  ...DEFAULT_PERSONAL_CRON_TASK_META,
                  category: input.category as PersonalCronTaskMeta["category"],
                  goal: input.goal,
                  acceptanceRules: input.acceptanceRules,
                  intentText: input.intentText,
                },
                visibleDescription: input.visibleDescription,
                overwrite: input.overwrite,
              },
            });
            return result;
          }
        : undefined,
    onRecommendExecutionTargetWithAi:
      state.client && state.connected
        ? async (input) => {
            const result = await recommendExecutionTargetWithAi({
              client: state.client!,
              sessionKey: state.sessionKey,
              input: {
                taskName: input.taskName,
                intentText: input.intentText,
                category: input.category,
                agents: cronExecutionAgents,
                groups: cronExecutionGroups,
              },
            });
            return result;
          }
        : undefined,
    onOpenKnowledgeUniverse: async (params) => {
      state.workbenchPrimaryModule = "knowledge";
      await refreshKnowledgeUniverseHome(state);
      if (params.label.trim()) {
        setKnowledgeUniverseQuery(state, params.label.trim());
        await submitKnowledgeUniverseSearch(state);
      }
      if (params.kind === "knowledge" && params.resourceId) {
        await selectKnowledgeUniverseObject(state, params.resourceId);
      } else if (params.kind === "capability" && params.resourceId) {
        await selectKnowledgeUniverseObject(state, `obj:data:${params.resourceId}`);
      }
      if (params.action === "request_access") {
        if (params.kind === "capability") {
          await requestKnowledgeUniverseDataAccess(state, params.resourceId, params.label);
        } else if (params.projectionId) {
          await requestKnowledgeUniverseEnterpriseAccess(state, params.projectionId, params.label);
        }
      }
      requestWorkbenchRender(state);
    },
    modelSuggestions: state.cronModelSuggestions ?? [],
    thinkingSuggestions: ["off", "minimal", "low", "medium", "high"],
    timezoneSuggestions: ["UTC", "Asia/Shanghai", "America/Los_Angeles"],
    deliveryToSuggestions: [],
    accountSuggestions: [],
    onFormChange: (patch) => {
      state.cronForm = cronCapability.normalizeForm({
        ...state.cronForm,
        ...patch,
      });
      state.cronFieldErrors = cronCapability.validateForm(state.cronForm);
      requestWorkbenchRender(state);
    },
    onRefresh: async () => {
      await cronCapability.loadStatus(state);
      await cronCapability.loadJobs(state);
      requestWorkbenchRender(state);
    },
    onAdd: () => cronCapability.addJob(state),
    onEdit: (job) => {
      cronCapability.startEdit(state, job);
      requestWorkbenchRender(state);
    },
    onClone: (job) => {
      cronCapability.startClone(state, job);
      requestWorkbenchRender(state);
    },
    onCancelEdit: () => {
      cronCapability.cancelEdit(state);
      requestWorkbenchRender(state);
    },
    onToggle: async (job, enabled) => {
      await cronCapability.toggleJob(state, job, enabled);
      requestWorkbenchRender(state);
    },
    onRun: async (job, mode) => {
      await cronCapability.runJob(state, job, mode ?? "force");
      requestWorkbenchRender(state);
    },
    onRemove: async (job) => {
      await cronCapability.removeJob(state, job);
      requestWorkbenchRender(state);
    },
    onLoadRuns: async (jobId) => {
      cronCapability.updateRunsFilter(state, { cronRunsScope: "job" });
      await cronCapability.loadRuns(state, jobId);
      requestWorkbenchRender(state);
    },
    onLoadMoreJobs: () => cronCapability.loadMoreJobs(state),
    onJobsFiltersChange: async (patch) => {
      cronCapability.updateJobsFilter(state, patch);
      await cronCapability.reloadJobs(state);
      requestWorkbenchRender(state);
    },
    onJobsFiltersReset: async () => {
      cronCapability.updateJobsFilter(state, {
        cronJobsQuery: "",
        cronJobsEnabledFilter: "all",
        cronJobsScheduleKindFilter: "all",
        cronJobsLastStatusFilter: "all",
        cronJobsSortBy: "nextRunAtMs",
        cronJobsSortDir: "asc",
      });
      await cronCapability.reloadJobs(state);
      requestWorkbenchRender(state);
    },
    onLoadMoreRuns: () => cronCapability.loadMoreRuns(state),
    onRunsFiltersChange: async (patch) => {
      cronCapability.updateRunsFilter(state, patch);
      await cronCapability.loadRuns(state, state.cronRunsJobId);
      requestWorkbenchRender(state);
    },
    focusJobId: state.workbenchCronFocusJobId,
    onFocusJobHandled: () => {
      state.workbenchCronFocusJobId = null;
      requestWorkbenchRender(state);
    },
    onOpenExecutionChat: ({ sessionKey, jobId: _jobId }) => {
      const normalizedKey = sessionKey.trim();
      if (!normalizedKey) {
        return;
      }
      const nextPrimaryModule = resolveWorkspacePrimaryModuleForSelection(
        normalizedKey,
        collaborationSelectionKeys,
      );
      if (nextPrimaryModule === "assistant") {
        state.workbenchRobotWorkbenchTab = "overview";
      }
      state.resetCollaborationLearningSnapshot();
      state.resetCollaborationGovernanceActionState();
      resetWorkbenchMemberGovernanceState(state);
      state.workbenchTeamSelectedKey = normalizedKey;
      switchEmployeeWorkbenchSession(state, normalizedKey, nextPrimaryModule);
      requestWorkbenchRender(state);
    },
    onOpenCronTaskDetail: (jobId: string) => {
      openEmployeeCronTaskDetail(state, jobId);
      requestWorkbenchRender(state);
    },
  };
  const activeGrowthRef = resolveGrowthEntityFromSessionKey(state.sessionKey);
  const activeRobotGrowth =
    activeGrowthRef?.kind === "robot" && state.workbenchActiveGrowthStatus
      ? { agentId: activeGrowthRef.entityId, status: state.workbenchActiveGrowthStatus }
      : null;
  const settingsRobotEntries = buildWorkbenchSettingsRobotEntries({
    ownedAgents,
    sessionsResult,
    dataSpaceConfigured: dataSpace.isConfigured,
    activeRobotGrowth,
    // Fetch real runtime health only while the robots tab is open; otherwise
    // reuse whatever is already cached (badge simply omits until loaded).
    healthByAgentId:
      state.connected && state.workbenchSystemSettingsTab === "robots"
        ? ensureWorkbenchAgentRuntimeHealthLoaded(state)
        : bindWorkbenchAgentHealthCache(state).byAgentId,
  });
  // Devices tab: eager-load pairing list when the view is already active
  // (deep-link / reconnect), not only on the tab-click handler.
  ensureDevicesLoaded(state);
  const settingsGroupEntries = buildWorkbenchSettingsGroupEntries({
    spacesSnapshot: collaborationSpacesSnapshot,
    currentUserId: currentHumanUserId,
    currentUserEmail: currentHumanUserEmail,
  });
  const pendingSeatOfferDisplayLabels = employeeAccess?.pendingOffer
    ? buildWorkbenchSeatOfferDisplayLabels({
        agents: rawAgents,
        robotEntries: settingsRobotEntries,
        groupEntries: settingsGroupEntries,
        spaces: collaborationSpacesSnapshot?.spaces ?? [],
        defaultAgentId: employeeAccess.pendingOffer.defaultAgentId,
        agentIds: employeeAccess.pendingOffer.agentIds,
        defaultSpaceIds: employeeAccess.pendingOffer.defaultSpaceIds,
      })
    : null;
  const pendingSeatOfferOmittedLabels =
    employeeAccess?.pendingOffer?.omittedAgentIds &&
    employeeAccess.pendingOffer.omittedAgentIds.length > 0
      ? buildWorkbenchSeatOfferDisplayLabels({
          agents: rawAgents,
          robotEntries: settingsRobotEntries,
          groupEntries: settingsGroupEntries,
          spaces: collaborationSpacesSnapshot?.spaces ?? [],
          agentIds: employeeAccess.pendingOffer.omittedAgentIds,
          defaultSpaceIds: [],
        }).agentToolLabels
      : [];
  const accountSeatDisplayLabels = buildWorkbenchSeatOfferDisplayLabels({
    agents: rawAgents,
    robotEntries: settingsRobotEntries,
    groupEntries: settingsGroupEntries,
    spaces: collaborationSpacesSnapshot?.spaces ?? [],
    defaultAgentId: employeeAccess?.defaultAgentId,
    agentIds: employeeAccess?.agentIds,
    defaultSpaceIds: employeeAccess?.defaultSpaceIds,
  });
  const currentSeatStatusLabel = formatWorkbenchSeatStatus(
    employeeAccess?.currentSeat?.status,
    currentLocale === "en" ? "en" : "zh-CN",
  );
  const growthStatusBySelectionKey: Record<string, GrowthStatusView> = {};
  for (const entry of settingsRobotEntries) {
    if (entry.growthStatus) {
      growthStatusBySelectionKey[entry.sessionKey] = entry.growthStatus;
    }
  }
  for (const entry of settingsGroupEntries) {
    if (entry.growthStatus) {
      growthStatusBySelectionKey[entry.sessionKey] = entry.growthStatus;
    }
  }
  if (state.workbenchActiveGrowthStatus) {
    growthStatusBySelectionKey[state.sessionKey] = state.workbenchActiveGrowthStatus;
  }
  const myAccumulationRuntime = ensureWorkbenchMyAccumulationLoaded(state);
  if (
    (state.workbenchSystemSettingsTab as string) === "my-accumulation" ||
    (state.workbenchSystemSettingsTab as string) === "skills"
  ) {
    state.workbenchSystemSettingsTab = DEFAULT_WORKBENCH_SYSTEM_SETTINGS_TAB;
    if (state.workbenchPrimaryModule === "settings" && state.workbenchSettingsView === "system") {
      navigateToKnowledgeAssets(state, myAccumulationRuntime);
    }
  }
  const myAccumulationAvailableTags = myAccumulationRuntime.state.availableTags;
  const myAccumulationAvailableCategories = myAccumulationRuntime.state.availableCategories;
  const myAccumulationAvailableSources = myAccumulationRuntime.state.availableSources;
  const selectedSystemSettingsGroupEntry =
    settingsGroupEntries.find((entry) =>
      matchesSystemSettingsGroupKey(entry, state.workbenchSystemSettingsSelectedGroupId),
    ) ??
    settingsGroupEntries[0] ??
    null;
  const selectedSystemSettingsGroupDraft =
    state.workbenchSystemSettingsGroupDraft?.groupId &&
    normalizeValue(state.workbenchSystemSettingsGroupDraft.groupId) ===
      resolveSystemSettingsGroupKey(selectedSystemSettingsGroupEntry)
      ? state.workbenchSystemSettingsGroupDraft
      : buildSystemSettingsGroupDraft(selectedSystemSettingsGroupEntry);
  const loadCollaborationGroupProjection = (groupId: string | null | undefined) => {
    const id = normalizeValue(groupId);
    if (!id || !state.client || !state.connected) {
      state.workbenchCollaborationGroupProjection = null;
      state.workbenchCollaborationGroupProjectionLoading = false;
      return;
    }
    state.workbenchCollaborationGroupProjectionLoading = true;
    void (async () => {
      try {
        const rawPayload = await state.client!.request("collaboration.space.get", {
          groupId: id,
        });
        const payload = rawPayload as {
          group?: import("./semantic/collaboration-group-read-model.ts").CollaborationGroupProjection;
        };
        // Ignore stale responses after user switched groups.
        if (normalizeValue(state.workbenchSystemSettingsSelectedGroupId) !== id) {
          return;
        }
        state.workbenchCollaborationGroupProjection = payload?.group ?? null;
      } catch {
        if (normalizeValue(state.workbenchSystemSettingsSelectedGroupId) === id) {
          state.workbenchCollaborationGroupProjection = null;
        }
      } finally {
        if (normalizeValue(state.workbenchSystemSettingsSelectedGroupId) === id) {
          state.workbenchCollaborationGroupProjectionLoading = false;
          requestWorkbenchRender(state);
        }
      }
    })();
  };

  // 实际执行小组切换（重建草稿、清错误/提示、清待切换意图）；供直接切换与确认弹窗复用。
  const applySystemSettingsGroupSelection = (groupId: string) => {
    const nextEntry =
      settingsGroupEntries.find((entry) => matchesSystemSettingsGroupKey(entry, groupId)) ?? null;
    state.workbenchSystemSettingsSelectedGroupId = normalizeValue(groupId) ?? groupId;
    state.workbenchSystemSettingsGroupDraft = buildSystemSettingsGroupDraft(nextEntry);
    state.workbenchSystemSettingsGroupError = null;
    state.workbenchSystemSettingsGroupNotice = null;
    state.workbenchSystemSettingsPendingGroupId = null;
    loadCollaborationGroupProjection(
      nextEntry?.groupId ?? state.workbenchSystemSettingsSelectedGroupId,
    );
  };
  const robotWorkbenchTasks = buildRobotWorkbenchTaskEntries({
    sessionsResult,
    agentId: currentAssistantId,
    activeSessionKey: state.sessionKey,
  });
  const robotWorkbenchOutputs = buildRobotWorkbenchOutputEntries(state.chatMessages ?? []);
  const previewArtifactAvailable = Boolean(findLatestArtifactId(state.chatMessages ?? []));
  const artifactPreviewOpen = isCollaborationArtifactPreviewOpen(state);
  const skillAvailableGroups = deriveMyAccumulationGroups(settingsGroupEntries);
  const connectedNodePermissions = resolveConnectedNodePermissions(state);
  const openEnterpriseSubmissionDraft = (
    capability: WorkbenchMyAccumulationDetail | WorkbenchMyAccumulationListItem,
  ) => {
    const conversationContext = extractConversationContext(state);
    const formData = buildEnterpriseAssetPackageDraft(capability, {
      conversationText: conversationContext.text,
      conversationDependencies: conversationContext.dependencies,
    });
    state.workbenchPrimaryModule = "knowledge";
    setKnowledgeUniversePageTab(state, "assets");
    myAccumulationRuntime.state.enterpriseSubmission = {
      open: true,
      capabilityId: capability.id,
      formData,
      autoReasonLines: buildEnterpriseSubmissionReasonLines({
        draft: formData,
        text: conversationContext.text,
        dependencies: conversationContext.dependencies,
      }),
      expanded: false,
      submitting: false,
      error: null,
    };
  };
  const openSkillSaveModal = (
    preferEnterpriseSubmit: boolean,
    prefill?: Partial<import("../../controllers/skill-lifecycle.ts").QuickSaveSkillFormData>,
    incubationContext?: SkillSaveIncubationContext | null,
  ) => {
    state.workbenchAssetSuggestionVisible = false;
    const parsed = parseAgentSessionKey(state.sessionKey);
    const agentId = parsed?.agentId ?? state.assistantAgentId ?? "main";
    const contextId =
      incubationContext?.contextId?.trim() ||
      findLatestArtifactId(state.chatMessages ?? []) ||
      state.sessionKey ||
      null;
    state.workbenchSkillSourceAgentId = agentId;
    state.workbenchSkillSourceContextId = contextId;
    if (incubationContext?.incubationDecision) {
      state.workbenchAssetIncubationDecision = incubationContext.incubationDecision;
      state.workbenchAssetIncubationLevel = incubationContext.incubationDecision.level;
      state.workbenchAssetSuggestionLabel = incubationContext.incubationDecision.reason;
    }
    const level =
      incubationContext?.incubationDecision?.level ?? state.workbenchAssetIncubationLevel;
    const preferEnterprise = preferEnterpriseSubmit || level === "L4";
    void syncUserInitiatedSave(state.client, {
      contextId,
    });
    setWorkbenchIncubationAutofillHint(state, null);
    const extractSeq = nextSkillSaveExtractSeq(state);
    state.workbenchSkillSaveModalOpen = true;
    state.workbenchSkillSaveModalError = null;
    state.workbenchSkillSavePreferEnterpriseSubmit = preferEnterprise;
    state.workbenchSkillSaveModalFormData = {
      name: prefill?.name ?? "",
      summary: prefill?.summary ?? "",
    };
    requestWorkbenchRender(state);
    const draft = createSkillLifecycleDraftState(state);
    void extractSkillContent(draft, agentId, state.workbenchSkillSourceContextId ?? "").then(() => {
      // User may have dismissed ("暂不处理") while extract was in flight — never reopen.
      if (currentSkillSaveExtractSeq(state) !== extractSeq || !state.workbenchSkillSaveModalOpen) {
        return;
      }
      state.workbenchSkillExtractedPreview = draft.extractedPreview;
      state.workbenchSkillSaveModalError = draft.saveModalError;
      if (draft.saveModalFormData) {
        state.workbenchSkillSaveModalFormData = draft.saveModalFormData;
      }
      requestWorkbenchRender(state);
    });
  };
  const suggestionDirectEnterpriseSubmit = shouldRecommendEnterpriseSubmissionFromSuggestion({
    source: state.workbenchAssetSuggestionSource,
    label: state.workbenchAssetSuggestionLabel,
    hint: state.workbenchSkillSourceAgentId
      ? `可从当前工作沉淀，来源：${state.workbenchSkillSourceAgentId}`
      : "已识别当前工作上下文，可直接沉淀能力",
  });
  const assetReviewSuggestions = selectVisibleAssetReviewSuggestions(
    myAccumulationRuntime.assetReviewSuggestions.length > 0
      ? myAccumulationRuntime.assetReviewSuggestions
      : scheduleReview().suggestions.map((entry) => ({
          fingerprint: entry.cluster.fingerprint,
          label: entry.cluster.label,
          summary: entry.summary,
          recurrenceCount: entry.cluster.recurrenceCount,
          suggestedAssetType: entry.cluster.suggestedAssetType,
        })),
  );
  const findReviewSuggestion = (fingerprint: string): ReviewSuggestionView | undefined =>
    assetReviewSuggestions.find((entry) => entry.fingerprint === fingerprint);
  const assetWeeklyDigest =
    myAccumulationRuntime.assetWeeklyDigest &&
    shouldShowWeeklyDigest(myAccumulationRuntime.assetWeeklyDigest)
      ? myAccumulationRuntime.assetWeeklyDigest
      : null;

  const knowledgeRuntime = getKnowledgeUniverseRuntime(state);
  const knowledgeSurface: WorkbenchKnowledgeSurface = {
    loading: state.knowledgeUniverseLoading,
    graphLoading: knowledgeRuntime.graphLoading,
    insightsLoading: knowledgeRuntime.insightsLoading,
    error: state.knowledgeUniverseError,
    query: state.knowledgeUniverseQuery,
    searchScope: state.knowledgeUniverseSearchScope ?? "workspace",
    pageTab: state.knowledgeUniversePageTab ?? "workbench",
    browseSubTab: state.knowledgeUniverseBrowseSubTab ?? "private",
    personalCollectDrawerOpen: Boolean(state.knowledgeUniversePersonalCollectDrawerOpen),
    personalDrawerMode: state.knowledgeUniversePersonalDrawerMode ?? "collect",
    homeFocus: state.knowledgeUniverseHomeFocus ?? null,
    homeCockpitTab: knowledgeRuntime.homeCockpitTab ?? "relations",
    documentReader: {
      loading: knowledgeRuntime.documentReaderLoading,
      saving: knowledgeRuntime.documentReaderSaving,
      editing: knowledgeRuntime.documentReaderEditing,
      dirty: knowledgeRuntime.documentReaderDirty,
      error: knowledgeRuntime.documentReaderError,
      docKey: knowledgeRuntime.documentReaderDocKey,
      preview: knowledgeRuntime.documentReaderPreview,
      draftText: knowledgeRuntime.documentReaderDraft,
    },
    selectedNodeId: state.knowledgeUniverseSelectedNodeId,
    selectedObject: state.knowledgeUniverseSelectedObject,
    sourceSummary: state.knowledgeUniverseSourceSummary,
    graph: state.knowledgeUniverseGraph,
    graphViewModel: state.knowledgeUniverseGraphViewModel,
    searchResults: state.knowledgeUniverseSearchResults,
    workspaceSearchGroups: state.knowledgeUniverseWorkspaceSearchGroups,
    workspaceSearchTotalCount: state.knowledgeUniverseWorkspaceSearchTotalCount,
    workspaceSearchMode: state.knowledgeUniverseWorkspaceSearchMode,
    selectedWorkspaceSearchHitId: state.knowledgeUniverseSelectedWorkspaceSearchHitId,
    selectedWorkspaceSearchDeliverableId:
      state.knowledgeUniverseSelectedWorkspaceSearchDeliverableId,
    openDeliverableMoreMenuId: state.knowledgeUniverseOpenDeliverableMoreMenuId,
    relationsInsightExpanded: state.knowledgeUniverseRelationsInsightExpanded,
    supplySectionExpanded: state.knowledgeUniverseSupplySectionExpanded,
    selectedKbSearchHighlightKey: state.knowledgeUniverseSelectedKbSearchHighlightKey,
    workspaceDeliverablesExpanded: state.knowledgeUniverseWorkspaceDeliverablesExpanded,
    dataCapabilities: state.knowledgeUniverseDataCapabilities,
    sourceBrowse: state.knowledgeUniverseSourceBrowse,
    externalDataSources: state.knowledgeUniverseExternalDataSources,
    personalCollectTitle: state.knowledgeUniversePersonalCollectTitle,
    personalCollectSummary: state.knowledgeUniversePersonalCollectSummary,
    personalCollectTags: state.knowledgeUniversePersonalCollectTags,
    personalCollectUrl: state.knowledgeUniversePersonalCollectUrl,
    personalDatasetText: state.knowledgeUniversePersonalDatasetText,
    personalUploadAttachment: state.knowledgeUniversePersonalUploadAttachment,
    personalActionBusy: state.knowledgeUniversePersonalActionBusy,
    personalActionNotice: state.knowledgeUniversePersonalActionNotice,
    personalActionError: state.knowledgeUniversePersonalActionError,
    importProgress: knowledgeRuntime.importProgress,
    accessRequestBusyCapabilityId: state.knowledgeUniverseAccessRequestBusyCapabilityId,
    accessRequestBusyProjectionId: state.knowledgeUniverseAccessRequestBusyProjectionId,
    accessRequestNotice: state.knowledgeUniverseAccessRequestNotice,
    capabilityPreview: state.knowledgeUniverseCapabilityPreview ?? null,
    capabilityInvocation: state.knowledgeUniverseCapabilityInvocation ?? null,
    personalManageObjectId: state.knowledgeUniversePersonalManageObjectId,
    personalManageObjectTitle: state.knowledgeUniversePersonalManageObjectTitle,
    personalManageTags: state.knowledgeUniversePersonalManageTags,
    personalManageBusy: state.knowledgeUniversePersonalManageBusy,
    personalManageNotice: state.knowledgeUniversePersonalManageNotice,
    personalVersions: state.knowledgeUniversePersonalVersions,
    personalVersionCompareFrom: state.knowledgeUniversePersonalVersionCompareFrom,
    personalVersionCompareTo: state.knowledgeUniversePersonalVersionCompareTo,
    personalVersionDiff: state.knowledgeUniversePersonalVersionDiff,
    recommendations: state.knowledgeUniverseRecommendations,
    discoveryEvents: state.knowledgeUniverseDiscoveryEvents ?? [],
    actionSuggestions: state.knowledgeUniverseActionSuggestions ?? [],
    homeInsightsDegraded: state.knowledgeUniverseHomeInsightsDegraded,
    homeInsightsNoticeDismissed: readHomeInsightsNoticeDismissed(),
    recentVisits: state.knowledgeUniverseRecentVisits,
    relatedGroups: state.knowledgeUniverseRelatedGroups,
    viewerOwnerLabel: userProfileName.trim() || currentHumanUserEmail || null,
    hoveredNodeId: state.knowledgeUniverseHoveredNodeId,
    graphZoom: state.knowledgeUniverseGraphZoom,
    graphPanX: state.knowledgeUniverseGraphPanX,
    graphPanY: state.knowledgeUniverseGraphPanY,
    knowledgeBases: state.knowledgeUniverseKnowledgeBases,
    selectedKnowledgeBaseId: state.knowledgeUniverseSelectedKnowledgeBaseId,
    kbSearchQuery: state.knowledgeUniverseKbSearchQuery,
    kbSearchEvidence: state.knowledgeUniverseKbSearchEvidence,
    kbSearchMode: state.knowledgeUniverseKbSearchMode,
    kbSearchSubstringResults: state.knowledgeUniverseKbSearchSubstringResults,
    workspaceDeliverables: state.knowledgeUniverseWorkspaceDeliverables,
    workspaceDeliverableStatusFilter: state.knowledgeUniverseWorkspaceDeliverableStatusFilter,
    workspaceBusy: state.knowledgeUniverseWorkspaceBusy,
    workspaceNotice: state.knowledgeUniverseWorkspaceNotice,
    workspaceError: state.knowledgeUniverseWorkspaceError,
    workspaceHint: state.knowledgeUniverseWorkspaceHint,
    workspaceDeliverablesUnavailable: state.knowledgeUniverseWorkspaceDeliverablesUnavailable,
    newKnowledgeBaseTitle: state.knowledgeUniverseNewKnowledgeBaseTitle,
    newKnowledgeBaseDescription: state.knowledgeUniverseNewKnowledgeBaseDescription,
    newKnowledgeBaseVisibility: state.knowledgeUniverseNewKnowledgeBaseVisibility,
    workspaceDeliverableTrace: state.knowledgeUniverseWorkspaceDeliverableTrace,
    workspaceDeliverableTraceLoading: state.knowledgeUniverseWorkspaceDeliverableTraceLoading,
    deliverableDetailFocus: state.knowledgeUniverseDeliverableDetailFocus,
    pinnedKnowledgeBaseIds: state.knowledgeUniversePinnedKnowledgeBaseIds ?? [],
    favoriteKnowledgeBaseIds: state.knowledgeUniverseFavoriteKnowledgeBaseIds ?? [],
    expandedKnowledgeBaseIds: knowledgeRuntime.expandedKnowledgeBaseIds ?? [],
    treeDocumentsByKbId: knowledgeRuntime.treeDocumentsByKbId ?? {},
    treeSourcesByKbId: knowledgeRuntime.treeSourcesByKbId ?? {},
    treeDocumentsLoadingByKbId: knowledgeRuntime.treeDocumentsLoadingByKbId ?? {},
    libraryWorkspaceContentTab: state.knowledgeUniverseLibraryWorkspaceContentTab ?? "documents",
    libraryWorkspaceMaterialsKindFilter:
      state.knowledgeUniverseLibraryWorkspaceMaterialsKindFilter ?? "all",
    libraryWorkspaceDocuments: state.knowledgeUniverseLibraryWorkspaceDocuments ?? [],
    libraryWorkspaceDocumentsLoading: Boolean(
      state.knowledgeUniverseLibraryWorkspaceDocumentsLoading,
    ),
    libraryWorkspaceSources: state.knowledgeUniverseLibraryWorkspaceSources ?? [],
    libraryWorkspaceSourcesLoading: Boolean(state.knowledgeUniverseLibraryWorkspaceSourcesLoading),
    libraryWorkspaceSourcesPlaneFilter:
      state.knowledgeUniverseLibraryWorkspaceSourcesPlaneFilter ?? "all",
    libraryWorkspaceSelectedDocumentIds:
      state.knowledgeUniverseLibraryWorkspaceSelectedDocumentIds ?? [],
    libraryWorkspaceSnippets: state.knowledgeUniverseLibraryWorkspaceSnippets ?? [],
    libraryWorkspaceSnippetsLoading: Boolean(
      state.knowledgeUniverseLibraryWorkspaceSnippetsLoading,
    ),
    libraryWorkspaceRecycleDocuments: state.knowledgeUniverseLibraryWorkspaceRecycleDocuments ?? [],
    libraryWorkspaceRecycleLoading: Boolean(state.knowledgeUniverseLibraryWorkspaceRecycleLoading),
    libraryWorkspaceEvictedChunks: state.knowledgeUniverseLibraryWorkspaceEvictedChunks ?? [],
    libraryWorkspaceWebPages: state.knowledgeUniverseLibraryWorkspaceWebPages ?? [],
    libraryWorkspaceWebPagesLoading: Boolean(
      state.knowledgeUniverseLibraryWorkspaceWebPagesLoading,
    ),
    libraryWorkspaceDatasets: state.knowledgeUniverseLibraryWorkspaceDatasets ?? [],
    libraryWorkspaceDatasetsLoading: Boolean(
      state.knowledgeUniverseLibraryWorkspaceDatasetsLoading,
    ),
    libraryWorkspaceAgentKnowledge: state.knowledgeUniverseLibraryWorkspaceAgentKnowledge ?? [],
    libraryWorkspaceAgentKnowledgeLoading: Boolean(
      state.knowledgeUniverseLibraryWorkspaceAgentKnowledgeLoading,
    ),
    libraryWorkspaceMembers: state.knowledgeUniverseLibraryWorkspaceMembers ?? [],
    libraryWorkspaceMembersLoading: Boolean(state.knowledgeUniverseLibraryWorkspaceMembersLoading),
    libraryWorkspaceInviteDrawerOpen: Boolean(
      state.knowledgeUniverseLibraryWorkspaceInviteDrawerOpen,
    ),
    libraryWorkspaceInviteEmail: state.knowledgeUniverseLibraryWorkspaceInviteEmail ?? "",
    libraryWorkspaceInviteRole: state.knowledgeUniverseLibraryWorkspaceInviteRole ?? "viewer",
    libraryWorkspaceSettingsKbId: state.knowledgeUniverseLibraryWorkspaceSettingsKbId ?? null,
    libraryWorkspaceSettingsTitle: state.knowledgeUniverseLibraryWorkspaceSettingsTitle ?? "",
    libraryWorkspaceInlineRenameKbId:
      state.knowledgeUniverseLibraryWorkspaceInlineRenameKbId ?? null,
    libraryWorkspaceImportOpen: Boolean(state.knowledgeUniverseLibraryWorkspaceImportOpen),
    libraryWorkspaceImportLockSpace: state.knowledgeUniverseLibraryWorkspaceImportLockSpace,
    libraryWorkspaceImportKind: state.knowledgeUniverseLibraryWorkspaceImportKind ?? null,
    libraryWorkspaceBindSourceKind: state.knowledgeUniverseLibraryWorkspaceBindSourceKind ?? "api",
    libraryWorkspaceBindSourceTitle: state.knowledgeUniverseLibraryWorkspaceBindSourceTitle ?? "",
    libraryWorkspaceBindSourceEndpoint:
      state.knowledgeUniverseLibraryWorkspaceBindSourceEndpoint ?? "",
    libraryWorkspaceLocalFolderPath: state.knowledgeUniverseLibraryWorkspaceLocalFolderPath ?? "",
    libraryWorkspaceLocalFolderLabel: state.knowledgeUniverseLibraryWorkspaceLocalFolderLabel ?? "",
    libraryWorkspaceLocalFolderDeletePolicy:
      state.knowledgeUniverseLibraryWorkspaceLocalFolderDeletePolicy ?? "snapshot",
    libraryWorkspaceLocalFolderWatcherEnabled:
      state.knowledgeUniverseLibraryWorkspaceLocalFolderWatcherEnabled,
    libraryWorkspaceLocalFolderMode:
      state.knowledgeUniverseLibraryWorkspaceLocalFolderMode ?? "managed_push",
    libraryWorkspaceLocalFolderStatusItems:
      state.knowledgeUniverseLibraryWorkspaceLocalFolderStatusItems ?? [],
    enterpriseTenantId: resolveKnowledgeUniverseEnterpriseTenantId(state),
    libraryWorkspaceConnectorBindDraft: state.knowledgeUniverseLibraryWorkspaceConnectorBindDraft,
    libraryWorkspaceConnectorCatalog: state.knowledgeUniverseLibraryWorkspaceConnectorCatalog ?? [],
    libraryWorkspaceConnectorCatalogLoading: Boolean(
      state.knowledgeUniverseLibraryWorkspaceConnectorCatalogLoading,
    ),
    libraryWorkspaceConnectorCatalogError:
      state.knowledgeUniverseLibraryWorkspaceConnectorCatalogError ?? null,
    libraryWorkspaceConnectorCredentials:
      state.knowledgeUniverseLibraryWorkspaceConnectorCredentials ?? [],
    libraryWorkspaceConnectorCredentialsLoading: Boolean(
      state.knowledgeUniverseLibraryWorkspaceConnectorCredentialsLoading,
    ),
    libraryWorkspaceConnectorProbeOk:
      state.knowledgeUniverseLibraryWorkspaceConnectorProbeOk ?? null,
    libraryWorkspaceConnectorProbeMessage:
      state.knowledgeUniverseLibraryWorkspaceConnectorProbeMessage ?? null,
    libraryWorkspaceConnectorProbeBusy: Boolean(
      state.knowledgeUniverseLibraryWorkspaceConnectorProbeBusy,
    ),
    libraryWorkspaceConnectorOAuthBusy: Boolean(
      state.knowledgeUniverseLibraryWorkspaceConnectorOAuthBusy,
    ),
    libraryWorkspaceConnectorOAuthNotice:
      state.knowledgeUniverseLibraryWorkspaceConnectorOAuthNotice ?? null,
    libraryWorkspaceConnectorOAuthError:
      state.knowledgeUniverseLibraryWorkspaceConnectorOAuthError ?? null,
    libraryWorkspaceConnectorOAuthSessionId:
      state.knowledgeUniverseLibraryWorkspaceConnectorOAuthSessionId ?? null,
    libraryWorkspaceConnectorOAuthSimulateAllowed: Boolean(
      state.knowledgeUniverseLibraryWorkspaceConnectorOAuthSimulateAllowed,
    ),
    libraryWorkspaceHttpRestExpanded: Boolean(
      state.knowledgeUniverseLibraryWorkspaceHttpRestExpanded,
    ),
    libraryWorkspaceDatasetImportTab:
      state.knowledgeUniverseLibraryWorkspaceDatasetImportTab ?? "file",
    libraryWorkspaceDatasetFileAttachment:
      state.knowledgeUniverseLibraryWorkspaceDatasetFileAttachment ?? null,
    libraryWorkspaceDatasetPreview: state.knowledgeUniverseLibraryWorkspaceDatasetPreview ?? null,
    libraryWorkspaceDatasetPreviewError:
      state.knowledgeUniverseLibraryWorkspaceDatasetPreviewError ?? null,
    libraryWorkspaceUrlImportMode: state.knowledgeUniverseLibraryWorkspaceUrlImportMode ?? "batch",
    libraryWorkspaceUrlImportText: state.knowledgeUniverseLibraryWorkspaceUrlImportText ?? "",
    libraryWorkspaceUrlImportAdvancedOpen: Boolean(
      state.knowledgeUniverseLibraryWorkspaceUrlImportAdvancedOpen,
    ),
    libraryWorkspaceUrlSyncSchedule:
      state.knowledgeUniverseLibraryWorkspaceUrlSyncSchedule ?? "once",
    libraryWorkspaceUrlStripNavAds: state.knowledgeUniverseLibraryWorkspaceUrlStripNavAds,
    libraryWorkspaceUrlMainContentOnly: Boolean(
      state.knowledgeUniverseLibraryWorkspaceUrlMainContentOnly,
    ),
    libraryWorkspaceNoteTags: state.knowledgeUniverseLibraryWorkspaceNoteTags ?? [],
    libraryWorkspaceNoteTagDraft: state.knowledgeUniverseLibraryWorkspaceNoteTagDraft ?? "",
    libraryWorkspaceNoteTagSuggestionsOpen: Boolean(
      state.knowledgeUniverseLibraryWorkspaceNoteTagSuggestionsOpen,
    ),
    libraryWorkspaceNoteTagHistory: state.knowledgeUniverseLibraryWorkspaceNoteTagHistory ?? [],
    libraryWorkspaceNoteAiBusy: Boolean(state.knowledgeUniverseLibraryWorkspaceNoteAiBusy),
    libraryWorkspaceFileImportItems: state.knowledgeUniverseLibraryWorkspaceFileImportItems ?? [],
    libraryWorkspaceFileImportAdvancedOpen: Boolean(
      state.knowledgeUniverseLibraryWorkspaceFileImportAdvancedOpen,
    ),
    libraryWorkspaceFileChunkingStrategy:
      state.knowledgeUniverseLibraryWorkspaceFileChunkingStrategy ?? "auto",
    libraryWorkspaceFileOcrEnabled: state.knowledgeUniverseLibraryWorkspaceFileOcrEnabled,
    actorEmail: currentHumanUserEmail,
    selectedKnowledgeBaseCanWrite: resolveSelectedKnowledgeSpaceCanWrite(
      {
        selectedKnowledgeBaseId: state.knowledgeUniverseSelectedKnowledgeBaseId,
        knowledgeBases: state.knowledgeUniverseKnowledgeBases,
        libraryWorkspaceMembers: state.knowledgeUniverseLibraryWorkspaceMembers ?? [],
        libraryWorkspaceMembersLoading: Boolean(
          state.knowledgeUniverseLibraryWorkspaceMembersLoading,
        ),
      },
      currentHumanUserEmail,
    ),
    searchPanelOpen: state.knowledgeUniverseSearchPanelOpen ?? false,
    governanceSummary: state.knowledgeUniverseGovernanceSummary,
    governanceTasks: state.knowledgeUniverseGovernanceTasks,
    governanceLoading: state.knowledgeUniverseGovernanceLoading,
    governanceError: state.knowledgeUniverseGovernanceError,
    governanceNotice: getKnowledgeUniverseRuntime(state).governanceNotice,
    governanceTaskBusyId: state.knowledgeUniverseGovernanceTaskBusyId,
    governanceSelectedTaskId: state.knowledgeUniverseGovernanceSelectedTaskId,
    governanceTaskGraph: state.knowledgeUniverseGovernanceTaskGraph,
    governanceTaskGraphViewModel: state.knowledgeUniverseGovernanceTaskGraphViewModel,
    governanceTaskGraphLoading: state.knowledgeUniverseGovernanceTaskGraphLoading,
    governanceTaskGraphZoom: state.knowledgeUniverseGovernanceTaskGraphZoom,
    governanceTaskGraphPanX: state.knowledgeUniverseGovernanceTaskGraphPanX,
    governanceTaskGraphPanY: state.knowledgeUniverseGovernanceTaskGraphPanY,
    governanceTaskGraphSelectedNodeId: state.knowledgeUniverseGovernanceTaskGraphSelectedNodeId,
    governanceTaskGraphHoveredNodeId: state.knowledgeUniverseGovernanceTaskGraphHoveredNodeId,
    onQueryChange: (query) => {
      setKnowledgeUniverseQuery(state, query);
      requestWorkbenchRender(state);
    },
    onSearchScopeChange: (scope) => {
      setKnowledgeUniverseSearchScope(state, scope);
      requestWorkbenchRender(state);
    },
    onPageTabChange: (tab) => {
      setKnowledgeUniversePageTab(state, tab);
      if (tab === "assets") {
        myAccumulationRuntime.hasLoaded = false;
        ensureWorkbenchMyAccumulationLoaded(state);
      }
      if (tab === "governance") {
        void loadKnowledgeUniverseGovernance(state);
      }
      requestWorkbenchRender(state);
    },
    onBrowseSubTabChange: (tab) => {
      setKnowledgeUniverseBrowseSubTab(state, tab);
      requestWorkbenchRender(state);
    },
    onPersonalCollectDrawerOpenChange: (open, mode) => {
      if (open) {
        ensureKnowledgeUniverseNoteImportReady(state);
      }
      setKnowledgeUniversePersonalCollectDrawerOpen(
        state,
        open,
        mode ?? (open ? "collect" : undefined),
      );
      requestWorkbenchRender(state);
    },
    onSearch: async () => {
      if (state.knowledgeUniverseSearchScope === "library") {
        setKnowledgeUniverseKbSearchQuery(state, state.knowledgeUniverseQuery);
        await searchKnowledgeUniverseKnowledgeBase(state);
      } else {
        await submitKnowledgeUniverseSearch(state);
      }
      requestWorkbenchRender(state);
    },
    onSelectWorkspaceSearchHit: async (hit) => {
      await selectKnowledgeUniverseWorkspaceSearchHit(state, hit);
      requestWorkbenchRender(state);
    },
    onSelectNode: async (nodeId) => {
      await selectKnowledgeUniverseNode(state, nodeId);
      requestWorkbenchRender(state);
    },
    onHomeFocusChange: (focus) => {
      setKnowledgeUniverseHomeFocus(state, focus);
      requestWorkbenchRender(state);
    },
    onHomeCockpitTabChange: (tab) => {
      setKnowledgeUniverseHomeCockpitTab(state, tab);
      requestWorkbenchRender(state);
    },
    onDocumentReaderEdit: () => {
      setKnowledgeUniverseDocumentReaderEditing(state, true);
      requestWorkbenchRender(state);
    },
    onDocumentReaderCancel: () => {
      setKnowledgeUniverseDocumentReaderEditing(state, false);
      requestWorkbenchRender(state);
    },
    onDocumentReaderDraftChange: (value) => {
      setKnowledgeUniverseDocumentReaderDraft(state, value);
      requestWorkbenchRender(state);
    },
    onDocumentReaderSave: async () => {
      await saveKnowledgeUniverseDocumentReader(state);
      requestWorkbenchRender(state);
    },
    onDocumentReaderDelete: async () => {
      await deleteKnowledgeUniverseDocumentReader(state);
      requestWorkbenchRender(state);
    },
    onHoverNode: (nodeId) => {
      setKnowledgeUniverseHoveredNode(state, nodeId);
      requestWorkbenchRender(state);
    },
    onZoom: (delta) => {
      adjustKnowledgeUniverseZoom(state, delta);
      requestWorkbenchRender(state);
    },
    onPan: (dx, dy) => {
      panKnowledgeUniverseGraph(state, dx, dy);
      requestWorkbenchRender(state);
    },
    onResetView: () => {
      resetKnowledgeUniverseGraphView(state);
      requestWorkbenchRender(state);
    },
    onPersonalCollectDraftChange: (field, value) => {
      setKnowledgeUniversePersonalCollectDraft(state, field, value);
      requestWorkbenchRender(state);
    },
    onPersonalCollect: async () => {
      await importNoteToKnowledgeSpace(state);
      requestWorkbenchRender(state);
    },
    onPickPersonalUploadFile: async (file) => {
      await pickKnowledgeUniversePersonalUploadFile(state, file);
      requestWorkbenchRender(state);
    },
    onPersonalUpload: async () => {
      await uploadKnowledgeUniversePersonal(state);
      requestWorkbenchRender(state);
    },
    onCollectWebPersonal: async () => {
      await collectWebKnowledgeUniversePersonal(state);
      requestWorkbenchRender(state);
    },
    onImportDatasetPersonal: async () => {
      await importDatasetKnowledgeUniversePersonal(state);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceDatasetImportTabChange: (tab) => {
      setKnowledgeUniverseDatasetImportTab(state, tab);
      requestWorkbenchRender(state);
    },
    onDatasetImportManualTextChange: (value) => {
      setKnowledgeUniverseDatasetManualText(state, value);
      requestWorkbenchRender(state);
    },
    onPickDatasetImportFile: async (file) => {
      await pickKnowledgeUniverseDatasetImportFile(state, file);
      requestWorkbenchRender(state);
    },
    onDownloadDatasetImportTemplate: () => {
      downloadKnowledgeUniverseDatasetImportTemplate();
    },
    onImportDatasetToSpace: async () => {
      await importKnowledgeUniverseDatasetToSpace(state);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceUrlImportModeChange: (mode) => {
      setKnowledgeUniverseLibraryWorkspaceUrlImportMode(state, mode);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceUrlImportTextChange: (value) => {
      setKnowledgeUniverseLibraryWorkspaceUrlImportText(state, value);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceUrlImportAdvancedOpenChange: (open) => {
      setKnowledgeUniverseLibraryWorkspaceUrlImportAdvancedOpen(state, open);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceUrlSyncScheduleChange: (schedule) => {
      setKnowledgeUniverseLibraryWorkspaceUrlSyncSchedule(state, schedule);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceUrlStripNavAdsChange: (enabled) => {
      setKnowledgeUniverseLibraryWorkspaceUrlStripNavAds(state, enabled);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceUrlMainContentOnlyChange: (enabled) => {
      setKnowledgeUniverseLibraryWorkspaceUrlMainContentOnly(state, enabled);
      requestWorkbenchRender(state);
    },
    onImportWebUrlsToSpace: async () => {
      await importWebUrlsToKnowledgeSpace(state);
      requestWorkbenchRender(state);
    },
    onGenerateNoteMetadataFromContent: async () => {
      await generateKnowledgeUniverseNoteMetadataFromContent(state);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceNoteTagDraftChange: (value) => {
      setKnowledgeUniverseLibraryWorkspaceNoteTagDraft(state, value);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceNoteTagSuggestionsOpenChange: (open) => {
      setKnowledgeUniverseLibraryWorkspaceNoteTagSuggestionsOpen(state, open);
      requestWorkbenchRender(state);
    },
    onAddLibraryWorkspaceNoteTag: (tag) => {
      addKnowledgeUniverseLibraryWorkspaceNoteTag(state, tag);
      requestWorkbenchRender(state);
    },
    onRemoveLibraryWorkspaceNoteTag: (tag) => {
      removeKnowledgeUniverseLibraryWorkspaceNoteTag(state, tag);
      requestWorkbenchRender(state);
    },
    onCommitLibraryWorkspaceNoteTagDraft: () => {
      commitKnowledgeUniverseLibraryWorkspaceNoteTagDraft(state);
      requestWorkbenchRender(state);
    },
    onImportNoteToSpace: async () => {
      await importNoteToKnowledgeSpace(state);
      requestWorkbenchRender(state);
    },
    onPickFileImportFiles: async (files) => {
      await pickKnowledgeUniverseFileImportFiles(state, files);
      requestWorkbenchRender(state);
    },
    onRemoveFileImportFile: (id) => {
      removeKnowledgeUniverseFileImportItem(state, id);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceFileImportAdvancedOpenChange: (open) => {
      setKnowledgeUniverseLibraryWorkspaceFileImportAdvancedOpen(state, open);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceFileChunkingStrategyChange: (strategy) => {
      setKnowledgeUniverseLibraryWorkspaceFileChunkingStrategy(state, strategy);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceFileOcrEnabledChange: (enabled) => {
      setKnowledgeUniverseLibraryWorkspaceFileOcrEnabled(state, enabled);
      requestWorkbenchRender(state);
    },
    onImportFilesToSpace: async () => {
      await importFilesToKnowledgeSpace(state);
      requestWorkbenchRender(state);
    },
    onOpenMyAccumulation: () => {
      navigateToKnowledgeAssets(state, myAccumulationRuntime);
    },
    onSelectKnowledgeObject: async (objectId) => {
      await selectKnowledgeUniverseObject(state, objectId);
      requestWorkbenchRender(state);
    },
    onRequestDataCapabilityAccess: async (capabilityId, title) => {
      await requestKnowledgeUniverseDataAccess(state, capabilityId, title);
      requestWorkbenchRender(state);
    },
    onPreviewCapability: async (capabilityId) => {
      await previewKnowledgeUniverseCapability(state, capabilityId);
      requestWorkbenchRender(state);
    },
    onInvokeCapability: async (capabilityId) => {
      await invokeKnowledgeUniverseCapability(state, capabilityId);
      requestWorkbenchRender(state);
    },
    onRequestEnterpriseKnowledgeAccess: async (projectionId, title) => {
      await requestKnowledgeUniverseEnterpriseAccess(state, projectionId, title);
      requestWorkbenchRender(state);
    },
    onManagePersonalObject: async (objectId, title, tags) => {
      await openKnowledgeUniversePersonalManage(state, objectId, title, tags);
      requestWorkbenchRender(state);
    },
    onPersonalManageTagsChange: (value) => {
      setKnowledgeUniversePersonalManageTags(state, value);
      requestWorkbenchRender(state);
    },
    onSavePersonalTags: async () => {
      await saveKnowledgeUniversePersonalTags(state);
      requestWorkbenchRender(state);
    },
    onPersonalVersionCompareFromChange: (value) => {
      setKnowledgeUniversePersonalVersionCompareFrom(state, value);
      requestWorkbenchRender(state);
    },
    onPersonalVersionCompareToChange: (value) => {
      setKnowledgeUniversePersonalVersionCompareTo(state, value);
      requestWorkbenchRender(state);
    },
    onComparePersonalVersions: async () => {
      await compareKnowledgeUniversePersonalVersions(state);
      requestWorkbenchRender(state);
    },
    onSelectKnowledgeBase: (kbId) => {
      setKnowledgeUniverseSelectedKnowledgeBase(state, kbId);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceContentTabChange: (tab) => {
      setKnowledgeUniverseLibraryWorkspaceContentTab(state, tab);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceMaterialsKindFilterChange: (filter) => {
      setKnowledgeUniverseLibraryWorkspaceMaterialsKindFilter(state, filter);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceSourcesPlaneFilterChange: (filter) => {
      setKnowledgeUniverseLibraryWorkspaceSourcesPlaneFilter(state, filter);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceInvite: () => {
      notifyLibraryWorkspaceInvite(state);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceTabActionUnavailable: () => {
      notifyLibraryWorkspaceTabActionUnavailable(state);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceImportOpenChange: (open, options) => {
      setKnowledgeUniverseLibraryWorkspaceImportOpen(state, open, options);
      requestWorkbenchRender(state);
    },
    onEnsurePersonalSpaceForImport: async () => {
      try {
        const kbId = await ensurePersonalKnowledgeBase(state);
        setKnowledgeUniversePageTab(state, "spaceImport");
        setKnowledgeUniverseLibraryWorkspaceImportOpen(state, true, { lockSpace: true });
        setKnowledgeUniverseLibraryWorkspaceImportKind(state, "localFolder");
        const runtime = getKnowledgeUniverseRuntime(state);
        runtime.selectedKnowledgeBaseId = kbId;
        runtime.personalActionError = null;
      } catch (error) {
        const runtime = getKnowledgeUniverseRuntime(state);
        runtime.personalActionError =
          error instanceof Error ? error.message : "Unable to open personal knowledge space.";
        state.knowledgeUniversePersonalActionError = runtime.personalActionError;
      }
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceImportKindChange: (kind) => {
      setKnowledgeUniverseLibraryWorkspaceImportKind(state, kind);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceBindSourceDraftChange: (field, value) => {
      setKnowledgeUniverseLibraryWorkspaceBindSourceDraft(state, field, value);
      requestWorkbenchRender(state);
    },
    onBindKnowledgeSource: async () => {
      await bindKnowledgeUniverseSource(state);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceLocalFolderPathChange: (value) => {
      setKnowledgeUniverseLocalFolderPath(state, value);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceLocalFolderLabelChange: (value) => {
      setKnowledgeUniverseLocalFolderLabel(state, value);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceLocalFolderDeletePolicyChange: (value) => {
      setKnowledgeUniverseLocalFolderDeletePolicy(state, value);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceLocalFolderWatcherEnabledChange: (enabled) => {
      setKnowledgeUniverseLocalFolderWatcherEnabled(state, enabled);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceLocalFolderModeChange: (mode) => {
      setKnowledgeUniverseLocalFolderMode(state, mode);
      requestWorkbenchRender(state);
    },
    onPickLocalFolderPath: async () => {
      await pickKnowledgeUniverseLocalFolderPath(state);
      requestWorkbenchRender(state);
    },
    onBindLocalFolder: async () => {
      await bindKnowledgeUniverseLocalFolder(state);
      requestWorkbenchRender(state);
    },
    onLoadLocalFolderStatus: async () => {
      await loadKnowledgeUniverseLocalFolderStatus(state);
      requestWorkbenchRender(state);
    },
    onScanLocalFolderNow: async (bindingId) => {
      await scanKnowledgeUniverseLocalFolderNow(state, bindingId);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceConnectorBindDraftChange: (field, value) => {
      setKnowledgeUniverseLibraryWorkspaceConnectorBindDraft(state, field, value);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceConnectorCredentialSelect: (value) => {
      setKnowledgeUniverseLibraryWorkspaceConnectorCredentialSelect(state, value);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceHttpRestExpandedChange: (expanded) => {
      setKnowledgeUniverseLibraryWorkspaceHttpRestExpanded(state, expanded);
      requestWorkbenchRender(state);
    },
    onEnsureConnectorPackageForImport: async () => {
      await ensureKnowledgeUniverseConnectorPackageForImport(state);
      requestWorkbenchRender(state);
    },
    onTestConnectorConnectionForImport: async () => {
      await testKnowledgeUniverseConnectorConnectionForImport(state);
      requestWorkbenchRender(state);
    },
    onStartConnectorOAuthForImport: async () => {
      await startKnowledgeUniverseConnectorOAuth(state);
      requestWorkbenchRender(state);
    },
    onSimulateConnectorOAuthForImport: async () => {
      await simulateCompleteKnowledgeUniverseConnectorOAuth(state);
      requestWorkbenchRender(state);
    },
    onBindConnectorSourceToKnowledgeBase: async () => {
      await bindKnowledgeUniverseConnectorSource(state);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceImportReadOnly: () => {
      notifyLibraryWorkspaceImportReadOnly(state);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceInviteDrawerOpenChange: (open) => {
      setKnowledgeUniverseLibraryWorkspaceInviteDrawerOpen(state, open);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceInviteEmailChange: (email) => {
      setKnowledgeUniverseLibraryWorkspaceInviteEmail(state, email);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceInviteRoleChange: (role) => {
      setKnowledgeUniverseLibraryWorkspaceInviteRole(state, role);
      requestWorkbenchRender(state);
    },
    onSubmitLibraryWorkspaceInvite: async () => {
      await submitLibraryWorkspaceInvite(state);
      requestWorkbenchRender(state);
    },
    onStartLibraryWorkspaceInlineRename: (kbId) => {
      startLibraryWorkspaceInlineRename(state, kbId);
      requestWorkbenchRender(state);
    },
    onCancelLibraryWorkspaceInlineRename: () => {
      cancelLibraryWorkspaceInlineRename(state);
      requestWorkbenchRender(state);
    },
    onLibraryWorkspaceSettingsTitleChange: (title) => {
      setKnowledgeUniverseLibraryWorkspaceSettingsTitle(state, title);
      requestWorkbenchRender(state);
    },
    onSubmitLibraryWorkspaceRename: async () => {
      await submitLibraryWorkspaceRename(state);
      requestWorkbenchRender(state);
    },
    onDeleteLibraryWorkspace: async (kbId) => {
      await deleteLibraryWorkspace(state, kbId);
      requestWorkbenchRender(state);
    },
    onDeleteLibraryDocument: async (documentId) => {
      await deleteLibraryWorkspaceDocument(state, documentId);
      requestWorkbenchRender(state);
    },
    onToggleLibraryDocumentSelection: (documentId) => {
      toggleLibraryWorkspaceDocumentSelection(state, documentId);
      requestWorkbenchRender(state);
    },
    onSelectAllLibraryDocuments: (selected) => {
      setLibraryWorkspaceDocumentSelectionAll(state, selected);
      requestWorkbenchRender(state);
    },
    onDeleteSelectedLibraryDocuments: async () => {
      await deleteSelectedLibraryWorkspaceDocuments(state);
      requestWorkbenchRender(state);
    },
    onOpenLibraryOriginalDocument: async (documentId) => {
      await openKnowledgeUniverseOriginalDocument(state, documentId);
      requestWorkbenchRender(state);
    },
    onPreviewLibraryOriginalDocument: async (documentId) => {
      await previewKnowledgeUniverseOriginalDocument(state, documentId);
      requestWorkbenchRender(state);
    },
    onUnbindLibrarySource: async (item) => {
      await unbindLibraryWorkspaceSource(state, item);
      requestWorkbenchRender(state);
    },
    onIngestLibrarySource: async (item) => {
      await ingestLibraryWorkspaceSource(state, item);
      requestWorkbenchRender(state);
    },
    onDetachLibraryDocument: async (documentId) => {
      await detachLibraryWorkspaceDocument(state, documentId);
      requestWorkbenchRender(state);
    },
    onRestoreLibraryDocument: async (documentId) => {
      await restoreLibraryWorkspaceDocument(state, documentId);
      requestWorkbenchRender(state);
    },
    onSetWebRefreshPolicy: async (refreshParams) => {
      await setLibraryWebRefreshPolicy(state, refreshParams);
      requestWorkbenchRender(state);
    },
    onGenerateAgentKnowledge: async () => {
      await generateLibraryAgentKnowledge(state);
      requestWorkbenchRender(state);
    },
    onNewKnowledgeBaseTitleChange: (title) => {
      setKnowledgeUniverseNewKnowledgeBaseTitle(state, title);
      requestWorkbenchRender(state);
    },
    onNewKnowledgeBaseDescriptionChange: (description) => {
      setKnowledgeUniverseNewKnowledgeBaseDescription(state, description);
      requestWorkbenchRender(state);
    },
    onNewKnowledgeBaseVisibilityChange: (visibility) => {
      setKnowledgeUniverseNewKnowledgeBaseVisibility(state, visibility);
      requestWorkbenchRender(state);
    },
    onCreateKnowledgeBase: async () => {
      const returnToHome = state.knowledgeUniversePageTab === "libraryCreate";
      await createKnowledgeUniverseKnowledgeBase(state);
      if (returnToHome) {
        setKnowledgeUniversePageTab(state, "workbench");
      }
      requestWorkbenchRender(state);
    },
    onQuickCreateKnowledgeBase: async () => {
      await quickCreateKnowledgeUniverseKnowledgeBase(state);
      requestWorkbenchRender(state);
    },
    onCreateFolderInSection: async (visibility) => {
      await createKnowledgeUniverseFolderInSection(state, visibility);
      requestWorkbenchRender(state);
    },
    onKbSearchQueryChange: (query) => {
      setKnowledgeUniverseKbSearchQuery(state, query);
      requestWorkbenchRender(state);
    },
    onKbSearch: async () => {
      await searchKnowledgeUniverseKnowledgeBase(state);
      requestWorkbenchRender(state);
    },
    onArchiveDeliverable: async (deliverableId) => {
      await archiveKnowledgeUniverseDeliverable(state, deliverableId);
      requestWorkbenchRender(state);
    },
    onDeleteDeliverable: async (deliverableId) => {
      await deleteKnowledgeUniverseDeliverable(state, deliverableId);
      requestWorkbenchRender(state);
    },
    onViewDeliverable: (deliverableId) => {
      setKnowledgeUniverseDeliverableDetailFocus(state, null);
      state.knowledgeUniverseSelectedWorkspaceSearchDeliverableId = deliverableId;
      setKnowledgeUniversePageTab(state, "deliverableDetail");
      void loadKnowledgeUniverseDeliverableTrace(state);
      requestWorkbenchRender(state);
    },
    onDeliverableGovernanceAction: async (deliverableId, action) => {
      setKnowledgeUniverseOpenDeliverableMoreMenu(state, null);
      await runDeliverableGovernanceAction(state, deliverableId, action);
      requestWorkbenchRender(state);
    },
    onDeliverableMoreMenuChange: (deliverableId) => {
      setKnowledgeUniverseOpenDeliverableMoreMenu(state, deliverableId);
      requestWorkbenchRender(state);
    },
    onRefreshDeliverableTrace: async () => {
      await loadKnowledgeUniverseDeliverableTrace(state);
      requestWorkbenchRender(state);
    },
    onToggleKnowledgeBasePin: (kbId) => {
      toggleKnowledgeUniversePinnedKnowledgeBase(state, kbId);
      requestWorkbenchRender(state);
    },
    onToggleKnowledgeBaseFavorite: (kbId) => {
      toggleKnowledgeUniverseFavoriteKnowledgeBase(state, kbId);
      requestWorkbenchRender(state);
    },
    onToggleKnowledgeBaseExpanded: (kbId) => {
      toggleKnowledgeUniverseTreeExpanded(state, kbId);
      requestWorkbenchRender(state);
    },
    onDeliverableStatusFilterChange: (filter) => {
      setKnowledgeUniverseDeliverableStatusFilter(state, filter);
      requestWorkbenchRender(state);
    },
    onRelationsInsightExpandedChange: (open) => {
      setKnowledgeUniverseRelationsInsightExpanded(state, open);
      requestWorkbenchRender(state);
    },
    onSupplySectionExpandedChange: (open) => {
      setKnowledgeUniverseSupplySectionExpanded(state, open);
      requestWorkbenchRender(state);
    },
    onWorkspaceDeliverablesExpandedChange: (expanded) => {
      setKnowledgeUniverseWorkspaceDeliverablesExpanded(state, expanded);
      requestWorkbenchRender(state);
    },
    onRefreshHome: async () => {
      await refreshKnowledgeUniverseHome(state);
      requestWorkbenchRender(state);
    },
    onDismissHomeInsightsNotice: () => {
      dismissKnowledgeUniverseHomeInsightsNotice(state);
      requestWorkbenchRender(state);
    },
    onExecuteKnowledgeAction: async (action) => {
      await runKnowledgeActionSuggestion(state, action);
      requestWorkbenchRender(state);
    },
    onSelectDiscoveryEvent: async (event) => {
      if (event.relatedKnowledge.governanceTaskId) {
        await runKnowledgeActionSuggestion(state, {
          actionId: `discovery:${event.eventId}`,
          actionType:
            event.eventType === "new_duplicate"
              ? "merge_duplicate"
              : event.eventType === "deliverable_completed"
                ? "archive_deliverable"
                : "open_governance",
          title: event.title,
          reason: event.summary,
          score: 100,
          context: {
            governanceTaskId: event.relatedKnowledge.governanceTaskId,
            deliverableId: event.relatedKnowledge.deliverableId,
            knowledgeBaseId: event.relatedKnowledge.kbId,
          },
          executable: true,
        });
        requestWorkbenchRender(state);
        return;
      }
      if (event.relatedKnowledge.deliverableId) {
        await runKnowledgeActionSuggestion(state, {
          actionId: `discovery:${event.eventId}`,
          actionType: "archive_deliverable",
          title: event.title,
          reason: event.summary,
          score: 100,
          context: {
            deliverableId: event.relatedKnowledge.deliverableId,
            knowledgeBaseId: event.relatedKnowledge.kbId,
          },
          executable: true,
        });
        requestWorkbenchRender(state);
        return;
      }
      if (event.relatedKnowledge.kbId) {
        setKnowledgeUniverseSelectedKnowledgeBase(state, event.relatedKnowledge.kbId);
        setKnowledgeUniversePageTab(state, "governance");
        await loadKnowledgeUniverseGovernance(state);
        requestWorkbenchRender(state);
      }
    },
    onRefreshGovernance: async () => {
      await loadKnowledgeUniverseGovernance(state);
      requestWorkbenchRender(state);
    },
    onGovernanceTaskUpdate: async (taskId, status, canonicalClaimId) => {
      await updateKnowledgeUniverseGovernanceTask(state, taskId, status, canonicalClaimId);
      requestWorkbenchRender(state);
    },
    onGovernanceTaskSelect: async (taskId) => {
      await selectKnowledgeUniverseGovernanceTask(state, taskId);
      requestWorkbenchRender(state);
    },
    onGovernanceTaskGraphZoom: (delta) => {
      setKnowledgeUniverseGovernanceTaskGraphZoom(state, delta);
      requestWorkbenchRender(state);
    },
    onGovernanceTaskGraphPan: (dx, dy) => {
      setKnowledgeUniverseGovernanceTaskGraphPan(state, dx, dy);
      requestWorkbenchRender(state);
    },
    onGovernanceTaskGraphResetView: () => {
      resetKnowledgeUniverseGovernanceTaskGraphView(state);
      requestWorkbenchRender(state);
    },
    onGovernanceTaskGraphSelectNode: (nodeId) => {
      setKnowledgeUniverseGovernanceTaskGraphSelectedNode(state, nodeId);
      requestWorkbenchRender(state);
    },
    onGovernanceTaskGraphHoverNode: (nodeId) => {
      setKnowledgeUniverseGovernanceTaskGraphHoveredNode(state, nodeId);
      requestWorkbenchRender(state);
    },
    onKbSearchHighlightKeyChange: (highlightKey) => {
      setKnowledgeUniverseKbSearchHighlightKey(state, highlightKey);
      requestWorkbenchRender(state);
    },
    onSearchPanelOpenChange: (open) => {
      setKnowledgeUniverseSearchPanelOpen(state, open);
      requestWorkbenchRender(state);
    },
    onCreatePublishIntent: (params) => {
      const intent = buildKnowledgePublishIntent({
        objectId: params.objectId,
        objectTitle: params.objectTitle,
        objectSummary: params.objectSummary,
        provider: params.provider ?? "github-personal",
        suggestedAction: params.suggestedAction ?? "create_issue",
        sessionKey: state.sessionKey,
      });
      const agentId = parseAgentSessionKey(state.sessionKey)?.agentId?.trim() || "main";
      const provider = params.provider ?? "github-personal";
      const requestedAction = params.suggestedAction ?? "create_issue";
      void handoffUserOperationalIdentityTask(state, {
        agentId,
        provider,
        requestedAction,
        sessionKey: state.sessionKey,
        workbenchModule: "assistant",
        resumeMessage: intent.draftMessage,
        resumeIntentId: intent.intentId,
        executionPayload: intent.executionPayload,
        autoResume: true,
      });
      state.workbenchPrimaryModule = "assistant";
      state.chatMessage = intent.draftMessage;
      requestWorkbenchRender(state);
    },
  };

  return {
    navCollapsed: workbenchNavCollapsed,
    navGroupsCollapsed: state.settings.navGroupsCollapsed,
    brandLogoSrc: resolveCustomBrandLogoSrc(state.settings),
    bundledBrandLogoSrc: resolveBundledBrandWordmarkSrc(normalizeBasePath(state.basePath ?? "")),
    customBrandLogoEnabled: Boolean(resolveCustomBrandLogoSrc(state.settings)),
    brandLogoError: state.workbenchBrandLogoError,
    primaryModule,
    knowledgeSurface,
    teamSelectedKey: state.workbenchTeamSelectedKey || state.sessionKey,
    activeSessionKey: state.sessionKey,
    activeGrowthStatus: state.workbenchActiveGrowthStatus,
    growthStatusBySelectionKey,
    connected: state.connected,
    client: state.client,
    currentLocale,
    currentTheme,
    userProfileName,
    userProfileSignature,
    tenantLabel,
    currentSeatId: employeeAccess?.currentSeat?.seatId ?? null,
    currentSeatTitle: employeeAccess?.currentSeat?.title ?? null,
    currentSeatStatus: employeeAccess?.currentSeat?.status ?? null,
    currentSeatStatusLabel,
    pendingSeatOffer: employeeAccess?.pendingOffer
      ? {
          offerId: employeeAccess.pendingOffer.offerId,
          seatTitle: employeeAccess.pendingOffer.seatTitle,
          defaultAgentId: employeeAccess.pendingOffer.defaultAgentId ?? null,
          defaultAgentLabel: pendingSeatOfferDisplayLabels?.defaultAgentLabel ?? null,
          agentIds: employeeAccess.pendingOffer.agentIds ?? [],
          agentToolLabels: pendingSeatOfferDisplayLabels?.agentToolLabels ?? [],
          omittedAgentIds: employeeAccess.pendingOffer.omittedAgentIds ?? [],
          omittedAgentToolLabels: pendingSeatOfferOmittedLabels,
          defaultSpaceIds: employeeAccess.pendingOffer.defaultSpaceIds ?? [],
          defaultSpaceLabels: pendingSeatOfferDisplayLabels?.defaultSpaceLabels ?? [],
          reauthorizationRequired: employeeAccess.pendingOffer.reauthorizationRequired ?? false,
          offeredAt: employeeAccess.pendingOffer.offeredAt,
        }
      : null,
    settingsView: state.workbenchSettingsView,
    personalSettingsTab: state.workbenchPersonalSettingsTab,
    systemSettingsTab: state.workbenchSystemSettingsTab,
    tasksSubTab: state.workbenchTasksSubTab,
    assignedTasksProps: {
      client: state.client,
    },
    myTasksLaneCounts: state.workbenchMyTasks
      ? {
          cronCount: state.workbenchMyTasks.cronCount ?? 0,
          assignedCount: state.workbenchMyTasks.assignedCount ?? 0,
          supervisedCount: state.workbenchMyTasks.supervisedCount ?? 0,
        }
      : null,
    robotWorkbenchTab: state.workbenchRobotWorkbenchTab,
    defaultAgentId: employeeAccess?.defaultAgentId ?? null,
    defaultAgentLabel: accountSeatDisplayLabels.defaultAgentLabel,
    agentIds: employeeAccess?.agentIds ?? [],
    robotTeamLabels: accountSeatDisplayLabels.agentToolLabels,
    defaultSpaceIds: employeeAccess?.defaultSpaceIds ?? [],
    defaultSpaceLabels: accountSeatDisplayLabels.defaultSpaceLabels,
    defaultWorkspaceRoot,
    defaultWorkspaceRootDraft,
    defaultWorkspaceRootSaving: state.workbenchDefaultWorkspaceRootSaving,
    defaultWorkspaceRootError: state.workbenchDefaultWorkspaceRootError,
    defaultWorkspaceRootNotice: state.workbenchDefaultWorkspaceRootNotice,
    dataSpace,
    dataDirectoryPanel,
    authorizationFullDiskAccessGranted:
      toBooleanOrNull(connectedNodePermissions?.fullDiskAccess) ??
      toBooleanOrNull(connectedNodePermissions?.allFiles),
    authorizationAccessibilityGranted: toBooleanOrNull(connectedNodePermissions?.accessibility),
    authorizationAutomationGranted:
      toBooleanOrNull(connectedNodePermissions?.appleScript) ??
      toBooleanOrNull(connectedNodePermissions?.automation),
    authorizationNotificationsGranted: toBooleanOrNull(connectedNodePermissions?.notifications),
    devicePairingList: state.devicesList,
    devicePairingLoading: state.devicesLoading,
    devicePairingError: state.devicesError,
    devicePairingCurrentDeviceId: state.devicesCurrentDeviceId ?? null,
    devicePairingConnectedAtMs: state.gatewayConnectedAtMs ?? null,
    cronProps,
    conversationTaskProgress: state.conversationTaskProgress ?? null,
    supervisorProps: {
      client: state.client,
      tenantId: trustedProxySession?.tenantId ?? undefined,
      tenantLabel,
      userId: currentHumanUserId ?? undefined,
      seatId: employeeAccess?.currentSeat?.seatId ?? undefined,
      seatTitle: employeeAccess?.currentSeat?.title ?? undefined,
      canCreateTasks: canCreateSupervisorTask(supervisorSessionScopes),
      defaultRepoRoot: defaultWorkspaceRoot ?? undefined,
      initialTaskId: state.workbenchSupervisorInitialTaskId ?? undefined,
      pendingSeatOffer: employeeAccess?.pendingOffer
        ? {
            offerId: employeeAccess.pendingOffer.offerId,
            seatTitle: employeeAccess.pendingOffer.seatTitle,
          }
        : null,
      pendingSeatOfferBusy: state.platformAuthBusy,
      onAcceptPendingSeatOffer: async (offerId) => {
        await state.acceptPlatformSeatAssignmentOffer(offerId);
      },
      onOpenPersonalSettings: () => {
        openPersonalOperationalIdentitySection(state, { scroll: false }, requestWorkbenchRender);
      },
      onOpenDaibaiForDevTask: () => {
        void state.openDaibaiHelpFromModule({
          moduleLabel: "开发监督",
          contextMessage:
            "我想创建一个开发监督任务。请根据我的开发目标整理后，帮我发起受监督的 IDE CLI 执行。",
        });
      },
    },
    workspaceSelector: {
      open: Boolean(state.workbenchWorkspaceSelectorOpen),
      mode: state.workbenchWorkspaceSelectorMode ?? "default-local",
      title: state.workbenchWorkspaceSelectorTitle ?? "",
      description: state.workbenchWorkspaceSelectorDescription ?? "",
      selectedPath: state.workbenchWorkspaceSelectorSelectedPath ?? "",
      targetId: state.workbenchWorkspaceSelectorTargetId ?? null,
      targetLabel: state.workbenchWorkspaceSelectorTargetLabel ?? null,
      hostContext: state.workbenchWorkspaceSelectorOpen
        ? resolveWorkspaceSelectorHostContext(state)
        : null,
      cloudProvider: state.workbenchWorkspaceCloudProvider ?? "aliyun-oss",
      cloudRegion: state.workbenchWorkspaceCloudRegion ?? "",
      cloudBucket: state.workbenchWorkspaceCloudBucket ?? "",
      cloudRootPrefix: state.workbenchWorkspaceCloudRootPrefix ?? "",
      cloudEndpoint: state.workbenchWorkspaceCloudEndpoint ?? "",
      cloudAccountName: state.workbenchWorkspaceCloudAccountName ?? "",
      cloudGeneratedConfig: state.workbenchWorkspaceCloudGeneratedConfig
        ? { ...state.workbenchWorkspaceCloudGeneratedConfig }
        : null,
      cloudConnection: {
        state: state.workbenchWorkspaceCloudConnectionState ?? "idle",
        message: state.workbenchWorkspaceCloudConnectionMessage ?? null,
        canRead: Boolean(state.workbenchWorkspaceCloudCanRead),
        canWrite: Boolean(state.workbenchWorkspaceCloudCanWrite),
      },
      localDirectoryBrowser: {
        open: Boolean(state.workbenchWorkspaceSelectorLocalBrowserOpen),
        busy: Boolean(state.workbenchWorkspaceSelectorLocalBrowserBusy),
        error: state.workbenchWorkspaceSelectorLocalBrowserError ?? null,
        currentPath: state.workbenchWorkspaceSelectorLocalBrowserCurrentPath ?? "",
        parentPath: state.workbenchWorkspaceSelectorLocalBrowserParentPath ?? null,
        entries: state.workbenchWorkspaceSelectorLocalBrowserEntries ?? [],
      },
    },
    workspaceNotice: employeeAccess?.notice ?? null,
    recentAccessEntries,
    robotRosterStatus: resolveRobotRosterStatus({
      signedIn: signedInPlatformActor,
      employeeAccessPresent: employeeAccess != null,
      currentSeatId: employeeAccess?.currentSeat?.seatId ?? null,
      connected: state.connected,
      agentsListPresent: state.agentsList != null,
      agentsError: state.agentsError,
      positionBotCount: settingsRobotEntries.length,
    }),
    robotEntries: settingsRobotEntries,
    groupEntries: settingsGroupEntries,
    myBotDetail: state.workbenchMyBotDetailAgentId
      ? {
          agentId: state.workbenchMyBotDetailAgentId,
          loading: Boolean(state.workbenchMyBotDetailLoading),
          saving: Boolean(state.workbenchMyBotDetailSaving),
          error: state.workbenchMyBotDetailError ?? null,
          bot: state.workbenchMyBotProjection ?? null,
          identityDraft: state.workbenchMyBotIdentityDraft ?? null,
          detailTab: state.workbenchMyBotDetailTab ?? "identity",
          dataSurface: peekRobotDataSurface(state.workbenchMyBotDetailAgentId),
          onEnsureDataSurface: (agentId: string) => {
            void ensureRobotDataSurface(state, agentId, () => requestWorkbenchRender(state));
          },
          capabilityAtlas: peekRobotCapabilityAtlas(state.workbenchMyBotDetailAgentId),
          onEnsureCapabilityAtlas: (agentId: string) => {
            void ensureRobotCapabilityAtlas(state, agentId, () => requestWorkbenchRender(state));
          },
          onOpenDataItem: (item) => {
            void openRobotDataItem(state, item, () => requestWorkbenchRender(state));
          },
        }
      : null,
    collaborationGroupProjection: state.workbenchCollaborationGroupProjection ?? null,
    collaborationGroupProjectionLoading: Boolean(
      state.workbenchCollaborationGroupProjectionLoading,
    ),
    myAccumulationProps: {
      loading: myAccumulationRuntime.state.loading,
      error: myAccumulationRuntime.state.error,
      installTargetRobotId: state.workbenchInstallTargetRobotId ?? null,
      installTargetRobotLabel:
        settingsRobotEntries.find((entry) => entry.id === state.workbenchInstallTargetRobotId)
          ?.name ?? null,
      installRobots: settingsRobotEntries.map((entry) => ({
        id: entry.id,
        name: entry.name,
      })),
      ownedInstallBusy: Boolean(myAccumulationRuntime.ownedInstallBusy),
      ownedInstallNotice: myAccumulationRuntime.ownedInstallNotice,
      items: myAccumulationRuntime.state.items,
      selectedCapability: myAccumulationRuntime.state.selectedCapability,
      selectedLoading: myAccumulationRuntime.state.selectedLoading,
      detailTab: myAccumulationRuntime.state.detailTab,
      activeSegment: myAccumulationRuntime.state.activeSegment,
      showDraftsOnly: myAccumulationRuntime.state.activeSegment === "drafts",
      pendingUsageBrief: myAccumulationRuntime.state.pendingUsageBrief,
      pendingUsageBriefIntent: myAccumulationRuntime.pendingIntent,
      enterpriseSubmissionOpen: myAccumulationRuntime.state.enterpriseSubmission.open,
      enterpriseSubmissionDraft: myAccumulationRuntime.state.enterpriseSubmission.formData,
      enterpriseSubmissionReasonLines: [
        ...myAccumulationRuntime.state.enterpriseSubmission.autoReasonLines,
      ],
      enterpriseSubmissionExpanded: myAccumulationRuntime.state.enterpriseSubmission.expanded,
      enterpriseSubmissionBusy: myAccumulationRuntime.state.enterpriseSubmission.submitting,
      enterpriseSubmissionError: myAccumulationRuntime.state.enterpriseSubmission.error,
      definitionDirty: myAccumulationRuntime.state.definitionDirty,
      definitionSaving: myAccumulationRuntime.state.definitionSaving,
      definitionSaveNotice: myAccumulationRuntime.state.definitionSaveNotice,
      autofillBusy: myAccumulationRuntime.state.autofillBusy,
      autofillError: myAccumulationRuntime.state.autofillError,
      autofillNotice: myAccumulationRuntime.state.autofillNotice,
      autofillCanUndo: Boolean(myAccumulationRuntime.state.autofillSnapshot),
      availableTags: myAccumulationAvailableTags,
      availableCategories: myAccumulationAvailableCategories,
      availableSources: myAccumulationAvailableSources,
      availableShareVisibilities: [...MY_ACCUMULATION_SHARE_VISIBILITIES],
      availableGroups: deriveMyAccumulationGroups(settingsGroupEntries),
      assetSuggestionVisible:
        Boolean(state.workbenchAssetSuggestionVisible) &&
        (state.workbenchAssetIncubationLevel === "L3" ||
          state.workbenchAssetIncubationLevel === "L4"),
      canDepositFromContext: Boolean(
        state.workbenchSkillSourceContextId ?? findLatestArtifactId(state.chatMessages ?? []),
      ),
      depositHint:
        state.workbenchAssetIncubationDecision?.reason ??
        state.workbenchAssetSuggestionLabel ??
        (state.workbenchSkillSourceAgentId
          ? `可从当前工作沉淀，来源：${state.workbenchSkillSourceAgentId}`
          : "已识别当前工作上下文，可直接沉淀能力"),
      showEnterpriseSubmitActionFromSuggestion: suggestionDirectEnterpriseSubmit,
      assetReviewSuggestions,
      assetWeeklyDigest,
      onAcceptAssetReviewSuggestion: (fingerprint) => {
        const suggestion = findReviewSuggestion(fingerprint);
        if (!suggestion) {
          return;
        }
        const reviewContextId = `incubation:review:${fingerprint}`;
        const reviewDecision = deriveIncubationDecision({
          evidence: {
            recurrenceCount: suggestion.recurrenceCount,
            reviewEngineStableCluster: true,
          },
          source: "review-engine",
          contextId: reviewContextId,
        });
        state.workbenchPrimaryModule = "assistant";
        openSkillSaveModal(
          false,
          {
            name: suggestion.label,
            summary: suggestion.summary.slice(0, 180),
            assetType: suggestion.suggestedAssetType,
          },
          {
            source: "review-engine",
            contextId: reviewContextId,
            clusterFingerprint: fingerprint,
            incubationDecision: reviewDecision,
          },
        );
      },
      onDismissAssetReviewSuggestion: (fingerprint) => {
        dismissReviewSuggestion(fingerprint);
        myAccumulationRuntime.assetReviewSuggestions =
          myAccumulationRuntime.assetReviewSuggestions.filter(
            (entry) => entry.fingerprint !== fingerprint,
          );
        requestWorkbenchRender(state);
      },
      onDismissWeeklyDigest: () => {
        const digest = myAccumulationRuntime.assetWeeklyDigest;
        if (digest?.weekKey) {
          ackWeeklyDigest(digest.weekKey);
        }
        requestWorkbenchRender(state);
      },
      onOpenWeeklyDigestEntry: (entry) => {
        if (entry.kind === "organizational" && entry.capabilityId) {
          navigateToKnowledgeAssets(state, myAccumulationRuntime);
          void loadWorkbenchMyAccumulationDetail(
            myAccumulationRuntime.state,
            state,
            entry.capabilityId,
          ).then(() => requestWorkbenchRender(state));
          return;
        }
        if (entry.kind === "review" && entry.fingerprint) {
          const suggestion = findReviewSuggestion(entry.fingerprint);
          if (suggestion) {
            const reviewContextId = `incubation:review:${entry.fingerprint}`;
            const reviewDecision = deriveIncubationDecision({
              evidence: {
                recurrenceCount: suggestion.recurrenceCount,
                reviewEngineStableCluster: true,
              },
              source: "review-engine",
              contextId: reviewContextId,
            });
            state.workbenchPrimaryModule = "assistant";
            openSkillSaveModal(
              false,
              {
                name: suggestion.label,
                summary: suggestion.summary.slice(0, 180),
                assetType: suggestion.suggestedAssetType,
              },
              {
                source: "review-engine",
                contextId: reviewContextId,
                clusterFingerprint: entry.fingerprint,
                incubationDecision: reviewDecision,
              },
            );
          }
          return;
        }
        if (entry.capabilityId) {
          navigateToKnowledgeAssets(state, myAccumulationRuntime);
          void loadWorkbenchMyAccumulationDetail(
            myAccumulationRuntime.state,
            state,
            entry.capabilityId,
          ).then(() => requestWorkbenchRender(state));
        }
      },
      onOpenSkillSave: () => {
        openSkillSaveModal(state.workbenchAssetIncubationLevel === "L4");
      },
      onOpenSkillSaveAndContinue: suggestionDirectEnterpriseSubmit
        ? () => {
            openSkillSaveModal(true);
          }
        : undefined,
      searchQuery: myAccumulationRuntime.state.searchQuery,
      filterTag: myAccumulationRuntime.state.filterTag,
      filterCategory: myAccumulationRuntime.state.filterCategory,
      filterSource: myAccumulationRuntime.state.filterSource,
      filterShareVisibility: myAccumulationRuntime.state.filterShareVisibility,
      onSearchChange: (query) => {
        myAccumulationRuntime.state.searchQuery = query;
        myAccumulationRuntime.hasLoaded = false;
        ensureWorkbenchMyAccumulationLoaded(state);
        requestWorkbenchRender(state);
      },
      onFilterTagChange: (tag) => {
        myAccumulationRuntime.state.filterTag = tag;
        myAccumulationRuntime.hasLoaded = false;
        ensureWorkbenchMyAccumulationLoaded(state);
        requestWorkbenchRender(state);
      },
      onFilterCategoryChange: (category) => {
        myAccumulationRuntime.state.filterCategory = category;
        myAccumulationRuntime.hasLoaded = false;
        ensureWorkbenchMyAccumulationLoaded(state);
        requestWorkbenchRender(state);
      },
      onFilterSourceChange: (source) => {
        myAccumulationRuntime.state.filterSource = source;
        myAccumulationRuntime.hasLoaded = false;
        ensureWorkbenchMyAccumulationLoaded(state);
        requestWorkbenchRender(state);
      },
      onFilterShareVisibilityChange: (visibility) => {
        myAccumulationRuntime.state.filterShareVisibility = visibility;
        myAccumulationRuntime.hasLoaded = false;
        ensureWorkbenchMyAccumulationLoaded(state);
        requestWorkbenchRender(state);
      },
      onChangeSegment: (segment) => {
        myAccumulationRuntime.state.activeSegment = segment;
        if (segment === "drafts" && !myAccumulationRuntime.state.selectedCapability?.isDraft) {
          const firstDraft = myAccumulationRuntime.state.items.find((item) => item.isDraft) ?? null;
          myAccumulationRuntime.state.selectedCapability = null;
          myAccumulationRuntime.state.detailTab = "overview";
          if (firstDraft) {
            void loadWorkbenchMyAccumulationDetail(
              myAccumulationRuntime.state,
              state,
              firstDraft.id,
            ).then(() => {
              requestWorkbenchRender(state);
            });
          }
        }
        requestWorkbenchRender(state);
      },
      onShowDraftsOnly: () => {
        myAccumulationRuntime.state.activeSegment = "drafts";
        if (!myAccumulationRuntime.state.selectedCapability?.isDraft) {
          const firstDraft = myAccumulationRuntime.state.items.find((item) => item.isDraft) ?? null;
          myAccumulationRuntime.state.selectedCapability = null;
          myAccumulationRuntime.state.detailTab = "overview";
          if (firstDraft) {
            void loadWorkbenchMyAccumulationDetail(
              myAccumulationRuntime.state,
              state,
              firstDraft.id,
            ).then(() => {
              requestWorkbenchRender(state);
            });
          }
        }
        requestWorkbenchRender(state);
      },
      onShowAllCapabilities: () => {
        myAccumulationRuntime.state.activeSegment = "all";
        requestWorkbenchRender(state);
      },
      onShowContributedOnly: () => {
        myAccumulationRuntime.state.activeSegment = "contributed";
        requestWorkbenchRender(state);
      },
      onSelectCapability: (capabilityId) => {
        if (
          myAccumulationRuntime.state.selectedCapability?.id !== capabilityId &&
          !allowDefinitionNavigation(myAccumulationRuntime.state)
        ) {
          requestWorkbenchRender(state);
          return;
        }
        resetDefinitionWorkbenchState(myAccumulationRuntime.state);
        myAccumulationRuntime.state.error = null;
        myAccumulationRuntime.state.detailTab = "overview";
        void loadWorkbenchMyAccumulationDetail(
          myAccumulationRuntime.state,
          state,
          capabilityId,
        ).then(() => requestWorkbenchRender(state));
        requestWorkbenchRender(state);
      },
      onContinueOrganize: (capabilityId) => {
        if (
          myAccumulationRuntime.state.selectedCapability?.id !== capabilityId &&
          !allowDefinitionNavigation(myAccumulationRuntime.state)
        ) {
          requestWorkbenchRender(state);
          return;
        }
        if (myAccumulationRuntime.state.selectedCapability?.id !== capabilityId) {
          resetDefinitionWorkbenchState(myAccumulationRuntime.state);
        }
        myAccumulationRuntime.state.detailTab = "definition";
        myAccumulationRuntime.state.error = null;
        void loadWorkbenchMyAccumulationDetail(
          myAccumulationRuntime.state,
          state,
          capabilityId,
        ).then(() => requestWorkbenchRender(state));
        requestWorkbenchRender(state);
      },
      onChangeDetailTab: (tab) => {
        if (
          tab !== "definition" &&
          myAccumulationRuntime.state.detailTab === "definition" &&
          !allowDefinitionNavigation(myAccumulationRuntime.state)
        ) {
          requestWorkbenchRender(state);
          return;
        }
        myAccumulationRuntime.state.detailTab = tab;
        requestWorkbenchRender(state);
      },
      onShareToGroup: (capabilityId, groupId) => {
        if (!state.client || !state.connected) {
          myAccumulationRuntime.state.error = "当前未连接到网关，无法分享。请刷新后重试。";
          requestWorkbenchRender(state);
          return;
        }
        if (myAccumulationRuntime.state.definitionDirty) {
          myAccumulationRuntime.state.error = "请先保存整理后再分享到协作小组。";
          myAccumulationRuntime.state.detailTab = "definition";
          requestWorkbenchRender(state);
          return;
        }
        const selected =
          myAccumulationRuntime.state.selectedCapability?.id === capabilityId
            ? myAccumulationRuntime.state.selectedCapability
            : null;
        if (selected?.incubationReadiness && !selected.incubationReadiness.admissible) {
          myAccumulationRuntime.state.error =
            selected.incubationReadiness.reasons[0] ?? "请先在「定义」页完成规范内容填充后再分享。";
          myAccumulationRuntime.state.detailTab = "definition";
          requestWorkbenchRender(state);
          return;
        }
        void state.client
          .request("employee-capability.share-to-group", { capabilityId, groupId })
          .then(() => {
            recordLocalAdoption(capabilityId, { sharedToGroup: true });
          })
          .then(() => loadWorkbenchMyAccumulation(myAccumulationRuntime.state, state))
          .then(() =>
            myAccumulationRuntime.state.selectedCapability?.id === capabilityId
              ? loadWorkbenchMyAccumulationDetail(myAccumulationRuntime.state, state, capabilityId)
              : undefined,
          )
          .then(() => requestWorkbenchRender(state));
      },
      onEditDraftChange: (patch) => {
        if (!myAccumulationRuntime.state.selectedCapability) {
          return;
        }
        myAccumulationRuntime.state.selectedCapability = {
          ...myAccumulationRuntime.state.selectedCapability,
          ...patch,
        };
        myAccumulationRuntime.state.definitionDirty = true;
        myAccumulationRuntime.state.definitionSaveNotice = null;
        myAccumulationRuntime.state.autofillNotice = null;
        myAccumulationRuntime.state.error = null;
        requestWorkbenchRender(state);
      },
      onDiscardDefinitionChanges: () => {
        const capabilityId = myAccumulationRuntime.state.selectedCapability?.id;
        if (!capabilityId) {
          resetDefinitionWorkbenchState(myAccumulationRuntime.state);
          requestWorkbenchRender(state);
          return;
        }
        resetDefinitionWorkbenchState(myAccumulationRuntime.state);
        myAccumulationRuntime.state.error = null;
        void loadWorkbenchMyAccumulationDetail(
          myAccumulationRuntime.state,
          state,
          capabilityId,
        ).then(() => {
          myAccumulationRuntime.state.definitionSaveNotice = "已放弃未保存修改。";
          requestWorkbenchRender(state);
        });
        requestWorkbenchRender(state);
      },
      onUndoDefinitionAutofill: () => {
        const snapshot = myAccumulationRuntime.state.autofillSnapshot;
        const selected = myAccumulationRuntime.state.selectedCapability;
        if (!snapshot || !selected) {
          return;
        }
        myAccumulationRuntime.state.selectedCapability = {
          ...selected,
          ...snapshot,
        };
        myAccumulationRuntime.state.autofillSnapshot = null;
        myAccumulationRuntime.state.definitionDirty = true;
        myAccumulationRuntime.state.autofillNotice = "已撤销本次智能补齐，请确认后保存或继续编辑。";
        myAccumulationRuntime.state.autofillError = null;
        requestWorkbenchRender(state);
      },
      onRunDefinitionAutofill: (capabilityId) => {
        if (!state.client || !state.connected) {
          myAccumulationRuntime.state.autofillError =
            "当前未连接到网关，无法智能补齐。请刷新后重试。";
          requestWorkbenchRender(state);
          return;
        }
        const selected =
          myAccumulationRuntime.state.selectedCapability?.id === capabilityId
            ? myAccumulationRuntime.state.selectedCapability
            : null;
        if (!selected) {
          myAccumulationRuntime.state.autofillError = "请先选中资产后再智能补齐。";
          requestWorkbenchRender(state);
          return;
        }
        myAccumulationRuntime.state.autofillBusy = true;
        myAccumulationRuntime.state.autofillError = null;
        myAccumulationRuntime.state.autofillNotice = null;
        requestWorkbenchRender(state);
        void runIncubationAutofill({
          client: state.client,
          connected: state.connected,
          skillId: capabilityId,
        })
          .then((suggestion) => {
            if (myAccumulationRuntime.state.selectedCapability?.id !== capabilityId) {
              return;
            }
            if (!suggestion) {
              myAccumulationRuntime.state.autofillError =
                "暂时没有可用的补齐建议。请先补充名称与一句话描述后再试。";
              return;
            }
            const current = myAccumulationRuntime.state.selectedCapability;
            const patch = applyAutofillSuggestionToCapabilityPatch(current, suggestion);
            if (Object.keys(patch).length === 0) {
              myAccumulationRuntime.state.autofillNotice =
                "规范字段已较完整，未覆盖你已填写的内容。";
              return;
            }
            myAccumulationRuntime.state.autofillSnapshot =
              captureDefinitionAutofillSnapshot(current);
            myAccumulationRuntime.state.selectedCapability = {
              ...current,
              ...patch,
            };
            myAccumulationRuntime.state.definitionDirty = true;
            myAccumulationRuntime.state.definitionSaveNotice = null;
            myAccumulationRuntime.state.error = null;
            myAccumulationRuntime.state.autofillNotice =
              buildAutofillHintText(suggestion) ?? "已填入智能补齐建议，请确认后保存。";
          })
          .catch((error) => {
            myAccumulationRuntime.state.autofillError =
              error instanceof Error ? error.message : String(error);
          })
          .then(() => {
            myAccumulationRuntime.state.autofillBusy = false;
            requestWorkbenchRender(state);
          });
      },
      onPrepareEdit: (capabilityId) => {
        myAccumulationRuntime.pendingIntent = "edit";
        myAccumulationRuntime.pendingCapabilityId = capabilityId;
        void loadWorkbenchMyAccumulationUsageBrief(myAccumulationRuntime.state, state, capabilityId)
          .then((requiresConfirmation) => {
            if (!requiresConfirmation) {
              return saveWorkbenchMyAccumulationEdit(myAccumulationRuntime, state, capabilityId);
            }
            requestWorkbenchRender(state);
            return undefined;
          })
          .then(() => requestWorkbenchRender(state));
      },
      onPrepareDelete: (capabilityId) => {
        if (!allowDefinitionNavigation(myAccumulationRuntime.state)) {
          requestWorkbenchRender(state);
          return;
        }
        myAccumulationRuntime.pendingIntent = "delete";
        myAccumulationRuntime.pendingCapabilityId = capabilityId;
        void loadWorkbenchMyAccumulationUsageBrief(myAccumulationRuntime.state, state, capabilityId)
          .then((requiresConfirmation) => {
            if (!requiresConfirmation) {
              return deleteWorkbenchMyAccumulationCapability(
                myAccumulationRuntime,
                state,
                capabilityId,
              );
            }
            requestWorkbenchRender(state);
            return undefined;
          })
          .then(() => requestWorkbenchRender(state));
      },
      onConfirmUsageBrief: () => {
        if (!state.client || !state.connected) {
          return;
        }
        if (
          myAccumulationRuntime.pendingIntent === "edit" &&
          myAccumulationRuntime.pendingCapabilityId &&
          myAccumulationRuntime.state.selectedCapability
        ) {
          void saveWorkbenchMyAccumulationEdit(
            myAccumulationRuntime,
            state,
            myAccumulationRuntime.pendingCapabilityId,
          ).then(() => requestWorkbenchRender(state));
          return;
        }
        if (
          myAccumulationRuntime.pendingIntent === "delete" &&
          myAccumulationRuntime.pendingCapabilityId
        ) {
          void deleteWorkbenchMyAccumulationCapability(
            myAccumulationRuntime,
            state,
            myAccumulationRuntime.pendingCapabilityId,
          ).then(() => requestWorkbenchRender(state));
          return;
        }
        myAccumulationRuntime.state.pendingUsageBrief = null;
        myAccumulationRuntime.pendingCapabilityId = null;
        requestWorkbenchRender(state);
      },
      onCancelUsageBrief: () => {
        myAccumulationRuntime.state.pendingUsageBrief = null;
        myAccumulationRuntime.pendingCapabilityId = null;
        requestWorkbenchRender(state);
      },
      onOpenRobot: (robotId) => {
        const robotSession = settingsRobotEntries.find((entry) => entry.id === robotId)?.sessionKey;
        if (robotSession) {
          if (isBuiltinStewardAgent(robotId) && state.workbenchPrimaryModule === "collaboration") {
            state.daibaiSourceSessionKey = state.sessionKey;
          }
          state.workbenchTeamSelectedKey = robotSession;
          switchEmployeeWorkbenchSession(state, robotSession, "assistant");
        }
      },
      onOpenGroup: (groupId) => {
        const groupSession = settingsGroupEntries.find(
          (entry) =>
            normalizeValue(entry.groupId) === groupId ||
            normalizeValue(entry.sessionKey) === groupId,
        )?.sessionKey;
        if (groupSession) {
          state.workbenchTeamSelectedKey = groupSession;
          switchEmployeeWorkbenchSession(state, groupSession, "collaboration");
        }
      },
      onInstallOwnedAssetToRobot: async (capabilityId: string, agentId: string) => {
        if (!state.client || !state.connected) {
          myAccumulationRuntime.ownedInstallNotice = "未连接 Gateway，无法安装";
          requestWorkbenchRender(state);
          return;
        }
        const robotLabel =
          settingsRobotEntries.find((entry) => entry.id === agentId)?.name?.trim() || agentId;
        myAccumulationRuntime.ownedInstallBusy = true;
        myAccumulationRuntime.ownedInstallNotice = null;
        requestWorkbenchRender(state);
        try {
          const preflight = await requestCapabilityInstallPreflight(state.client, {
            agentId,
            capabilityId,
          });
          if (preflight && !preflight.canInstall) {
            myAccumulationRuntime.ownedInstallNotice = preflight.nextStep;
            return;
          }
          await state.client.request("employee-capability.install-to-robot", {
            capabilityId,
            agentId,
          });
          myAccumulationRuntime.ownedInstallNotice = `已安装到 ${robotLabel}`;
          myAccumulationRuntime.hasLoaded = false;
          ensureWorkbenchMyAccumulationLoaded(state);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          myAccumulationRuntime.ownedInstallNotice = message || "安装失败";
        } finally {
          myAccumulationRuntime.ownedInstallBusy = false;
          requestWorkbenchRender(state);
        }
      },
      onPreviewInstallRisk: async (capabilityId: string, source: string) => {
        if (!state.client || !state.connected) {
          return;
        }
        // 优先安装到用户从机器人行选中的目标；无则回退到当前活动机器人。
        const installTargetRobotId =
          state.workbenchInstallTargetRobotId ?? state.assistantAgentId ?? "main";
        try {
          const preflight = await requestCapabilityInstallPreflight(state.client, {
            agentId: installTargetRobotId,
            capabilityId,
          });
          if (preflight && !preflight.canInstall) {
            alert(preflight.nextStep);
            return;
          }
          const preview = await state.client.request<{
            riskLevel?: string;
            riskItems?: Array<{ title: string; description: string }>;
          }>("employee-install.preview-risk", {
            targetRobotId: installTargetRobotId,
            capabilityId,
            source,
          });
          const riskLevel = preview?.riskLevel ?? "low";
          const riskItems = preview?.riskItems ?? [];
          const proceed =
            riskLevel === "low" ||
            riskLevel === "medium" ||
            confirm(
              `风险等级: ${riskLevel}\n` +
                riskItems.map((item) => `${item.title}: ${item.description}`).join("\n") +
                "\n\n是否继续安装?",
            );
          if (proceed) {
            const request = await state.client.request<{
              requestId?: string;
              status?: string;
            }>("employee-install.create-request", {
              targetRobotId: installTargetRobotId,
              capabilityId,
              source,
            });
            if (request?.requestId) {
              await state.client.request("employee-install.confirm", {
                requestId: request.requestId,
              });
              alert("安装请求已提交，状态: " + (request.status ?? "unknown"));
              myAccumulationRuntime.hasLoaded = false;
              ensureWorkbenchMyAccumulationLoaded(state);
              requestWorkbenchRender(state);
            }
          }
        } catch (error) {
          const reviewBlock = readPackSkillReviewInstallBlock(error);
          if (reviewBlock?.nextStep === "submit_pack_skill_review" && state.client) {
            const submit = confirm(
              `${reviewBlock.message}\n\n是否现在提交企业技能审核？批准并开通后才能安装，不会自动安装。`,
            );
            if (submit) {
              try {
                await state.client.request(
                  "enterprise-data.governance-approvals.create",
                  packSkillReviewSubmitParams(reviewBlock),
                );
                alert("已提交企业技能审核。管理员批准并开通后，请再次确认安装。");
              } catch (submitError) {
                const message =
                  submitError instanceof Error ? submitError.message : "提交企业技能审核失败";
                alert(message);
              }
              return;
            }
          }
          const message = error instanceof Error ? error.message : "安装未完成";
          alert(message);
          console.error("install preview failed", error);
        }
      },
      onEnterpriseSubmissionChange: (patch) => {
        const current = myAccumulationRuntime.state.enterpriseSubmission.formData;
        if (!current) {
          return;
        }
        myAccumulationRuntime.state.enterpriseSubmission.formData = {
          ...current,
          ...patch,
        };
        myAccumulationRuntime.state.enterpriseSubmission.autoReasonLines =
          buildEnterpriseSubmissionReasonLines({
            draft: myAccumulationRuntime.state.enterpriseSubmission.formData,
            text: extractConversationContext(state).text,
            dependencies: extractConversationContext(state).dependencies,
          });
        requestWorkbenchRender(state);
      },
      onOpenEnterpriseSubmissionEditor: () => {
        myAccumulationRuntime.state.enterpriseSubmission.expanded = true;
        requestWorkbenchRender(state);
      },
      onCloseEnterpriseSubmissionEditor: () => {
        myAccumulationRuntime.state.enterpriseSubmission.expanded = false;
        requestWorkbenchRender(state);
      },
      onSubmitToEnterprise: (capabilityId?: string) => {
        const selectedCapability =
          capabilityId && myAccumulationRuntime.state.selectedCapability?.id === capabilityId
            ? myAccumulationRuntime.state.selectedCapability
            : capabilityId
              ? (myAccumulationRuntime.state.items.find((item) => item.id === capabilityId) ?? null)
              : myAccumulationRuntime.state.selectedCapability;
        if (!state.client || !state.connected) {
          myAccumulationRuntime.state.error =
            "当前未连接到网关，无法打开「提交企业」弹窗。请刷新页面后重试。";
          requestWorkbenchRender(state);
          return;
        }
        if (!selectedCapability) {
          myAccumulationRuntime.state.error = "未找到该资产，请刷新资产列表后重试。";
          requestWorkbenchRender(state);
          return;
        }
        if (myAccumulationRuntime.state.definitionDirty) {
          myAccumulationRuntime.state.error = "请先保存整理后再提交企业。";
          myAccumulationRuntime.state.detailTab = "definition";
          requestWorkbenchRender(state);
          return;
        }
        const readiness =
          "incubationReadiness" in selectedCapability
            ? selectedCapability.incubationReadiness
            : undefined;
        if (readiness && !readiness.admissible) {
          myAccumulationRuntime.state.error =
            readiness.reasons[0] ?? "请先在「定义」页完成规范内容填充后再提交企业。";
          myAccumulationRuntime.state.detailTab = "definition";
          requestWorkbenchRender(state);
          return;
        }
        myAccumulationRuntime.state.error = null;
        openEnterpriseSubmissionDraft(selectedCapability);
        requestWorkbenchRender(state);
      },
      onConfirmEnterpriseSubmission: () => {
        const submission = myAccumulationRuntime.state.enterpriseSubmission;
        if (!state.client || !state.connected || !submission.capabilityId || !submission.formData) {
          if (submission.open) {
            submission.error =
              !state.client || !state.connected
                ? "当前未连接到网关，无法提交企业。请刷新后重试。"
                : "提交信息不完整，请关闭后重新打开「提交企业」。";
            requestWorkbenchRender(state);
          }
          return;
        }
        submission.submitting = true;
        submission.error = null;
        requestWorkbenchRender(state);
        void state.client
          .request("employee-capability.submit-to-enterprise", {
            capabilityId: submission.capabilityId,
            scope: { kind: "enterprise" },
            packageDraft: submission.formData,
          })
          .then(() => loadWorkbenchMyAccumulation(myAccumulationRuntime.state, state))
          .then(() =>
            loadWorkbenchMyAccumulationDetail(
              myAccumulationRuntime.state,
              state,
              submission.capabilityId!,
            ),
          )
          .then(() => {
            myAccumulationRuntime.state.enterpriseSubmission = {
              open: false,
              capabilityId: null,
              formData: null,
              autoReasonLines: [],
              expanded: false,
              submitting: false,
              error: null,
            };
          })
          .catch((error) => {
            myAccumulationRuntime.state.enterpriseSubmission = {
              ...submission,
              submitting: false,
              error: error instanceof Error ? error.message : String(error),
            };
          })
          .then(() => requestWorkbenchRender(state));
      },
      onCancelEnterpriseSubmission: () => {
        myAccumulationRuntime.state.enterpriseSubmission = {
          open: false,
          capabilityId: null,
          formData: null,
          autoReasonLines: [],
          expanded: false,
          submitting: false,
          error: null,
        };
        requestWorkbenchRender(state);
      },
    },
    selectedGroupKey: state.workbenchSystemSettingsSelectedGroupId,
    selectedGroupEntry: selectedSystemSettingsGroupEntry,
    selectedGroupDraft: selectedSystemSettingsGroupDraft,
    systemGroupSaving: state.workbenchSystemSettingsGroupSaving,
    systemGroupError: state.workbenchSystemSettingsGroupError,
    systemGroupNotice: state.workbenchSystemSettingsGroupNotice,
    systemSettingsPendingGroupId: state.workbenchSystemSettingsPendingGroupId ?? null,
    robotWorkbenchTasks,
    robotWorkbenchOutputs,
    chatFocusMode: state.settings.chatFocusMode,
    chatShowThinking: state.settings.chatShowThinking,
    platformAuthEnabled: Boolean(state.platformAuthState?.enabled),
    passwordChangeBusy: state.platformAuthBusy,
    passwordChangeError: state.platformAuthError,
    passwordChangeNotice: state.platformAuthNotice,
    pendingSeatOfferBusy: state.platformAuthBusy,
    pendingSeatOfferError: state.platformAuthError,
    pendingSeatOfferNotice: state.platformAuthNotice,
    ownedRobotDeleteBusyId: state.workbenchOwnedRobotDeleteBusyId,
    ownedRobotDeleteError: state.workbenchOwnedRobotDeleteError,
    ownedRobotDeletePrompt: state.workbenchOwnedRobotDeletePrompt,
    ownedRobotDeleteDisposition: state.workbenchOwnedRobotDeleteDisposition,
    passwordCurrentValue: state.platformAuthCurrentPassword,
    passwordNewValue: state.platformAuthNewPassword,
    userOperationalIdentitySnapshot: state.userOperationalIdentities,
    userOperationalIdentityBusy: state.userOperationalIdentityBusy,
    userOperationalIdentityError: state.userOperationalIdentityError,
    userOperationalIdentityNotice: state.userOperationalIdentityNotice,
    userOperationalIdentityNav: state.userOperationalIdentityNav,
    userOperationalIdentityUsageRange: state.userOperationalIdentityUsageRange ?? "30d",
    userOperationalIdentityUsageEventId: state.userOperationalIdentityUsageEventId ?? null,
    userOperationalIdentityEditorOpen: state.userOperationalIdentityEditorOpen,
    userOperationalIdentityEditorProvider: state.userOperationalIdentityEditorProvider,
    userOperationalIdentityEditorDisplayName: state.userOperationalIdentityEditorDisplayName,
    userOperationalIdentityEditorCredentialHandleId:
      state.userOperationalIdentityEditorCredentialHandleId,
    userOperationalIdentityEditorAppId: state.userOperationalIdentityEditorAppId,
    userOperationalIdentityEditorAppSecret: state.userOperationalIdentityEditorAppSecret,
    userOperationalIdentityEditorSmtpHost: state.userOperationalIdentityEditorSmtpHost,
    userOperationalIdentityEditorSmtpPort: state.userOperationalIdentityEditorSmtpPort,
    userOperationalIdentityEditorSmtpUser: state.userOperationalIdentityEditorSmtpUser,
    userOperationalIdentityEditorImapHost: state.userOperationalIdentityEditorImapHost,
    userOperationalIdentityEditorImapPort: state.userOperationalIdentityEditorImapPort,
    userOperationalIdentityEditorImapUser: state.userOperationalIdentityEditorImapUser,
    userOperationalIdentityEditorPersonalEmailPresetNote:
      state.userOperationalIdentityEditorPersonalEmailPresetNote,
    userOperationalIdentityEditorUsePlatformSmtp:
      state.userOperationalIdentityEditorUsePlatformSmtp,
    userOperationalIdentityEditorIdentityId: state.userOperationalIdentityEditorIdentityId,
    wechatPersonalQrWorkerOnline: state.wechatPersonalQrWorkerOnline,
    wechatPersonalQrStatus: state.wechatPersonalQrStatus,
    wechatPersonalQrDataUrl: state.wechatPersonalQrDataUrl,
    wechatPersonalQrMessage: state.wechatPersonalQrMessage,
    wechatPersonalQrWxid: state.wechatPersonalQrWxid,
    userOperationalIdentityEditorGrantAgentId: state.userOperationalIdentityEditorGrantAgentId,
    userOperationalIdentityReturnSessionKey: state.userOperationalIdentityReturnSessionKey,
    robotIdentityGrantFocusAgentId: state.workbenchRobotIdentityGrantFocusAgentId,
    userOperationalIdentityContinuationNotice: state.userOperationalIdentityContinuationNotice,
    frontstageModel: {
      recentSessions: deriveSessionCards(sessionsResult, ["direct", "group", "channel"]).slice(
        0,
        6,
      ),
      contactCards: buildContactCards(sessionsResult).slice(0, 6),
      groupCards: buildGroupCards(sessionsResult).slice(0, 6),
      accounts: workbenchSnapshot.accounts,
      onlineInstances: workbenchSnapshot.onlineInstances,
      sessionCount: workbenchSnapshot.sessionCount,
    },
    shellReadModel: buildShellReadModel(state, workbenchSnapshot),
    collaborationReadModel,
    collaborationSpacesSnapshot,
    collaborationGovernanceSnapshot: buildCollaborationGovernanceSnapshot(state),
    collaborationRoundPlan: resolveActiveCollaborationRoundPlan(state),
    collaborationSpeakingAgentId: resolveCollaborationSpeakingAgentId({
      sessionKey: state.sessionKey,
      chatRunId: state.chatRunId,
      chatStream: state.chatStream,
      chatStreamSessionKey: state.chatStreamSessionKey,
      sending: state.chatSending,
      collaborationRoundPlan: resolveActiveCollaborationRoundPlan(state),
    }),
    collaborationRoundSummaries: state.collaborationRoundSummaries ?? {},
    collaborationRulesSummary: resolveActiveCollaborationRulesSummary({
      activeSessionKey: state.sessionKey,
      spaces: collaborationSpacesSnapshot?.spaces ?? [],
    }),
    collaborationRulesSections: resolveActiveCollaborationRulesSections({
      activeSessionKey: state.sessionKey,
      spaces: collaborationSpacesSnapshot?.spaces ?? [],
    }),
    collaborationReasonDrawerOpen: Boolean(state.workbenchCollaborationReasonDrawerOpen),
    collaborationRulesDrawerOpen: Boolean(state.workbenchCollaborationRulesDrawerOpen),
    onOpenCollaborationReasonDrawer: () => {
      state.workbenchCollaborationReasonDrawerOpen = true;
    },
    onCloseCollaborationReasonDrawer: () => {
      state.workbenchCollaborationReasonDrawerOpen = false;
    },
    onOpenCollaborationRulesDrawer: () => {
      state.workbenchCollaborationRulesDrawerOpen = true;
    },
    onCloseCollaborationRulesDrawer: () => {
      state.workbenchCollaborationRulesDrawerOpen = false;
    },
    memberGovernanceDrawerOpen: Boolean(state.workbenchMemberGovernanceDrawerOpen),
    artifactPreviewOpen,
    onOpenCollaborationMemberGovernance: () => {
      if (state.workbenchMemberGovernanceDrawerOpen) {
        state.workbenchGroupProfileView = "chat";
        resetWorkbenchMemberGovernanceState(state);
        requestWorkbenchRender(state);
        return;
      }
      closeCollaborationArtifactPreview(state);
      state.workbenchPrimaryModule = "collaboration";
      initializeMemberGovernance();
      state.workbenchGroupProfileView = "chat";
      state.workbenchMemberGovernanceDrawerOpen = true;
      requestWorkbenchRender(state);
    },
    onCloseCollaborationMemberGovernance: () => {
      state.workbenchGroupProfileView = "chat";
      resetWorkbenchMemberGovernanceState(state);
      requestWorkbenchRender(state);
    },
    collaborationOptionalSuggestions: resolveActiveCollaborationOptionalSuggestions(state),
    collaborationMissionAdvanceBusy: state.collaborationMissionAdvanceBusy,
    collaborationMissionAdvanceNotice: state.collaborationMissionAdvanceNotice,
    collaborationMissionAdvanceError: state.collaborationMissionAdvanceError,
    onAdvanceCollaborationMission: async () => {
      const groupSnapshot = resolveCollaborationGroupSnapshot({
        selectionKey: state.workbenchTeamSelectedKey || state.sessionKey,
        activeSessionKey: state.sessionKey,
        spacesResult: collaborationSpacesSnapshot ?? { spaces: [] },
        teamSpaces: collaborationReadModel.teamSpaces ?? [],
        sessionsResult,
      });
      const groupId = normalizeValue(groupSnapshot?.groupId);
      if (!groupId) {
        state.collaborationMissionAdvanceError = "当前协作小组未绑定可升级的分组标识。";
        state.collaborationMissionAdvanceNotice = null;
        return;
      }
      state.collaborationMissionAdvanceBusy = true;
      state.collaborationMissionAdvanceError = null;
      state.collaborationMissionAdvanceNotice = null;
      try {
        const result = await advanceCollaborationGroupMission({
          client: state.client,
          connected: state.connected,
          groupId,
        });
        if (result.advanced) {
          state.collaborationMissionAdvanceNotice = `群使命已升级：${result.currentMission ?? ""}`;
          await loadWorkbenchSpaces(state);
        } else {
          state.collaborationMissionAdvanceNotice = "当前使命已不是介绍阶段，无需升级。";
        }
      } catch (error) {
        state.collaborationMissionAdvanceError = String(error);
      } finally {
        state.collaborationMissionAdvanceBusy = false;
      }
    },
    onDismissCollaborationOptionalSuggestion: (id: string) => {
      dismissCollaborationOptionalSuggestion(state, id);
    },
    daibaiLoading: state.daibaiLoading,
    daibaiError: state.daibaiError,
    daibaiLastMessage: state.daibaiLastMessage,
    daibaiAskResult: state.daibaiAskResult,
    daibaiExecuteResult: state.daibaiExecuteResult,
    daibaiActionLoading: state.daibaiActionLoading,
    daibaiActionPendingId: state.daibaiActionPendingId,
    daibaiActionError: state.daibaiActionError,
    daibaiPendingConfirmation: state.daibaiPendingConfirmation,
    meetingPendingConfirmation: state.meetingPendingConfirmation,
    meetingConfirmationLoading: state.meetingConfirmationLoading,
    meetingConfirmationError: state.meetingConfirmationError,
    meetingConfirmationOldCardInvalid: state.meetingConfirmationOldCardInvalid,
    meetingConfirmRelease: state.meetingConfirmRelease,
    onConfirmMeetingPendingApproval: () => state.confirmMeetingPendingApproval(),
    onCancelMeetingPendingConfirmation: () => state.cancelMeetingPendingConfirmation(),
    onDismissMeetingConfirmRelease: () => state.dismissMeetingConfirmRelease(),
    groupConfigProposal: state.workbenchPendingGroupConfigProposal
      ? {
          groupId: state.workbenchPendingGroupConfigProposal.groupId,
          summaryLines: (() => {
            const pending = state.workbenchPendingGroupConfigProposal;
            const entry = resolveWorkbenchSettingsGroupEntryByKey(
              collaborationSpacesSnapshot.spaces,
              actorIdentities,
              pending.groupId,
            );
            const baseline = buildSystemSettingsGroupDraft(entry);
            return summarizeGroupConfigProposal(pending.proposal, baseline);
          })(),
          busy: Boolean(state.workbenchGroupConfigProposalBusy),
          error: state.workbenchGroupConfigProposalError ?? null,
          notice: state.workbenchGroupConfigProposalNotice ?? null,
        }
      : null,
    onApplyGroupConfigProposal: async () => {
      const pending = state.workbenchPendingGroupConfigProposal;
      if (!pending) {
        return;
      }
      const proposal = pending.proposal;
      if (!proposalMatchesSourceSession(proposal, state.daibaiSourceSessionKey)) {
        state.workbenchGroupConfigProposalError = "提案 groupId 与来源协作小组不一致，已拒绝应用。";
        return;
      }
      const entry = resolveWorkbenchSettingsGroupEntryByKey(
        collaborationSpacesSnapshot.spaces,
        actorIdentities,
        proposal.groupId,
      );
      if (!entry?.groupId) {
        state.workbenchGroupConfigProposalError = "找不到对应的协作小组，无法应用建议。";
        return;
      }
      state.workbenchGroupConfigProposalBusy = true;
      state.workbenchGroupConfigProposalError = null;
      state.workbenchGroupConfigProposalNotice = null;
      try {
        if (proposal.settings) {
          const baseline = buildSystemSettingsGroupDraft(entry);
          if (!baseline) {
            throw new Error("无法构建协作小组设置草稿。");
          }
          const draft = applyProposalToSettingsDraft(baseline, proposal);
          state.workbenchSystemSettingsSelectedGroupId = entry.groupId;
          state.workbenchSystemSettingsGroupDraft = draft;
          await saveSystemSettingsGroup(state, entry, draft);
          if (state.workbenchSystemSettingsGroupError) {
            throw new Error(state.workbenchSystemSettingsGroupError);
          }
        }
        if (proposal.roster) {
          const mapped = mapProposalRosterToGovernanceState(proposal.roster);
          const currentHumans =
            proposal.roster.humans != null
              ? mapped.humans
              : (entry.members?.humans ?? []).map((human) => ({
                  id: human.userId,
                  label: human.name?.trim() || human.userId,
                  kind: "human" as const,
                }));
          const currentBots =
            proposal.roster.bots != null
              ? mapped.bots
              : (entry.members?.bots ?? []).map((bot) => ({
                  id: bot.agentId,
                  label: bot.name?.trim() || bot.agentId,
                  kind: "bot" as const,
                }));
          const pendingHumanInvites =
            proposal.roster.invites?.humans != null
              ? mapped.pendingHumanInvites
              : (entry.invites?.humans ?? []).map((human) => ({
                  intentId: `invite:${human.userId}`,
                  label: human.name?.trim() || human.userId,
                  ...(human.handle?.trim() ? { message: human.handle.trim() } : {}),
                }));
          const pendingBotInvites =
            proposal.roster.invites?.bots != null
              ? mapped.pendingBotInvites
              : (entry.invites?.bots ?? []).map((bot) => ({
                  agentId: bot.agentId,
                  label: bot.name?.trim() || bot.agentId,
                }));
          const groupSnapshot = resolveCollaborationGroupSnapshot({
            selectionKey: entry.sessionKey || `space:${entry.groupId}`,
            activeSessionKey: entry.sessionKey,
            spacesResult: collaborationSpacesSnapshot ?? { spaces: [] },
            teamSpaces: collaborationReadModel.teamSpaces ?? [],
            sessionsResult,
          });
          const payload = buildWorkbenchSpaceMemberUpdatePayload({
            state,
            groupSnapshot,
            currentHumans,
            currentBots,
            pendingHumanInvites,
            pendingBotInvites,
          });
          if (!payload) {
            throw new Error("当前协作小组未绑定可保存的分组标识。");
          }
          await updateEmployeeWorkbenchSpaceMembers(state, payload);
        }
        state.workbenchPendingGroupConfigProposal = null;
        state.workbenchGroupConfigProposalDismissedFingerprint = pending.fingerprint;
        state.workbenchGroupConfigProposalNotice = "已应用大白建议";
        state.workbenchMemberGovernanceResult = "已应用大白建议";
        const targetSession =
          normalizeValue(entry.sessionKey) ?? (entry.groupId ? `space:${entry.groupId}` : null);
        if (targetSession) {
          switchEmployeeWorkbenchSession(state, targetSession, "collaboration");
          state.workbenchGroupProfileView = proposal.roster ? "members" : "overview";
          state.workbenchMemberGovernanceGroupKey = targetSession;
          state.workbenchMemberGovernanceTitle = entry.title || proposal.groupId;
        }
      } catch (error) {
        state.workbenchGroupConfigProposalError = String(error);
      } finally {
        state.workbenchGroupConfigProposalBusy = false;
      }
    },
    onDismissGroupConfigProposal: () => {
      const pending = state.workbenchPendingGroupConfigProposal;
      if (pending) {
        state.workbenchGroupConfigProposalDismissedFingerprint = pending.fingerprint;
      }
      state.workbenchPendingGroupConfigProposal = null;
      state.workbenchGroupConfigProposalError = null;
      state.workbenchGroupConfigProposalNotice = null;
    },
    daibaiGuideAcknowledged,
    showSystemAssetSuggestCta:
      Boolean(state.workbenchAssetSuggestionVisible) &&
      (state.workbenchAssetIncubationLevel === "L3" ||
        state.workbenchAssetIncubationLevel === "L4"),
    showWeakAssetHint:
      Boolean(state.workbenchAssetWeakHintVisible) &&
      !state.workbenchAssetSuggestionVisible &&
      state.workbenchAssetIncubationLevel === "L2",
    canOrganizeCurrentCapability: Boolean(
      state.sessionKey &&
      ((Array.isArray(state.chatMessages) && state.chatMessages.length > 0) ||
        findLatestArtifactId(state.chatMessages ?? [])),
    ),
    assetIncubationLevel: state.workbenchAssetIncubationLevel ?? null,
    skillSaveModalInline:
      Boolean(state.workbenchSkillSaveModalOpen) &&
      (state.workbenchPrimaryModule === "assistant" || isKnowledgeAssetsSurfaceActive(state)),
    sessionDefaults: resolveStewardSessionDefaultsFromHello(state.hello),
    policyEnvelope: null,
    cronNext: state.cronStatus?.nextWakeAtMs ?? null,
    lastError: state.lastError,
    groupProfileView: state.workbenchGroupProfileView,
    authPanel: input.authPanel ?? null,
    chatContent: input.chatContent,
    chatComposer: input.chatComposer ?? null,
    sidebarOpen: state.sidebarOpen,
    sidebarContent: state.sidebarContent,
    previewArtifactAvailable,
    skillSaveModalOpen: Boolean(state.workbenchSkillSaveModalOpen),
    skillSaveModalBusy: Boolean(state.workbenchSkillSaveModalBusy),
    skillSaveModalError: state.workbenchSkillSaveModalError ?? null,
    skillSaveModalFormData: state.workbenchSkillSaveModalFormData ?? null,
    skillSaveModalPreferEnterpriseSubmit: Boolean(state.workbenchSkillSavePreferEnterpriseSubmit),
    skillExtractedPreview: state.workbenchSkillExtractedPreview ?? null,
    skillSaveModalShowEnterpriseSubmitAction:
      Boolean(state.workbenchSkillSavePreferEnterpriseSubmit) ||
      state.workbenchAssetIncubationLevel === "L4" ||
      shouldRecommendEnterpriseSubmissionFromDraft({
        formData: state.workbenchSkillSaveModalFormData ?? null,
        extractedPreview: state.workbenchSkillExtractedPreview ?? null,
      }),
    skillAutofillHint: getWorkbenchIncubationAutofillHint(state),
    skillAvailableGroups,
    groupMembers: [],
    sharedAgents,
    ownedAgents,
    pendingBotApprovalCount: pendingBotApprovalCounts.activeCount,
    pendingBotApprovalCountsBySelectionKey: pendingBotApprovalCounts.countsBySelectionKey,
    sharedAgentDraftId: "",
    sharedAgentDraftName: "",
    sharedAgentDraftOwnerId: "",
    sharedAgentDraftOwnerName: "",
    sharedAgentDraftEmoji: "",
    sharedAgentBusy: false,
    sharedAgentError: null,
    ...workbenchShellActionProps,
    scheduleItems: state.workbenchSchedule?.items ?? [],
    pendingTasks: state.workbenchPendingTasks ?? null,
    notices: state.workbenchNotices ?? null,
    upcomingCollaboration: state.workbenchUpcomingCollaboration ?? null,
    stewardSuggestion: state.workbenchStewardSuggestion ?? null,
    schedule: state.workbenchSchedule ?? null,
    onUserProfileNameChange: (value) => {
      state.applySettings({
        ...state.settings,
        workbenchProfileName: value,
      });
    },
    onUserProfileSignatureChange: (value) => {
      state.applySettings({
        ...state.settings,
        workbenchProfileNote: value,
      });
    },
    onOpenInstallCapability: (robotId: string) => {
      // 记录安装目标机器人，使资产页的安装流程装到用户实际选中的机器人，而非当前活动机器人。
      state.workbenchInstallTargetRobotId = robotId?.trim() || null;
      navigateToKnowledgeAssets(state, myAccumulationRuntime);
      myAccumulationRuntime.pendingCapabilityId = null;
    },
    onOpenMyAssets: () => {
      // 「查看相关能力」是通用视图，不携带具体安装目标，清空以免误装到上次选中的机器人。
      state.workbenchInstallTargetRobotId = null;
      navigateToKnowledgeAssets(state, myAccumulationRuntime);
    },
    onOpenMyBotDetail: (agentId: string) => {
      const id = agentId?.trim();
      if (!id) {
        return;
      }
      const switching = state.workbenchMyBotDetailAgentId !== id;
      state.workbenchMyBotDetailAgentId = id;
      if (switching) {
        state.workbenchMyBotDetailTab = "identity";
        if (state.workbenchOwnedRobotDeletePrompt?.agentId !== id) {
          state.workbenchOwnedRobotDeletePrompt = null;
        }
      }
      state.workbenchMyBotDetailLoading = true;
      state.workbenchMyBotDetailError = null;
      state.workbenchMyBotProjection = null;
      state.workbenchMyBotIdentityDraft = null;
      // Ignore stale robot.workspace.get responses when the user switches rows quickly
      // (e.g. ghost "高级秘书"/bot error must not overwrite 熊猫学习).
      const loadGeneration = ++myBotDetailLoadGeneration;
      requestWorkbenchRender(state);
      void (async () => {
        try {
          if (!state.client || !state.connected) {
            throw new Error("未连接 Gateway，无法加载机器人详情");
          }
          const rawPayload = await state.client.request("robot.workspace.get", {
            agentId: id,
          });
          const payload = rawPayload as { bot?: MyBotProjection };
          if (
            loadGeneration !== myBotDetailLoadGeneration ||
            state.workbenchMyBotDetailAgentId !== id
          ) {
            return;
          }
          const bot = payload?.bot ?? null;
          if (!bot) {
            throw new Error("未返回机器人投影");
          }
          state.workbenchMyBotProjection = bot;
          state.workbenchMyBotIdentityDraft = {
            name: bot.identity.name ?? "",
            positioning: bot.identity.positioning ?? "",
            role: bot.identity.role ?? "",
            personaTraits: bot.identity.personaTraits ?? "",
            model: bot.identity.model ?? "",
          };
          state.workbenchMyBotDetailError = null;
        } catch (error) {
          if (
            loadGeneration !== myBotDetailLoadGeneration ||
            state.workbenchMyBotDetailAgentId !== id
          ) {
            return;
          }
          state.workbenchMyBotDetailError = error instanceof Error ? error.message : String(error);
          state.workbenchMyBotProjection = null;
        } finally {
          if (
            loadGeneration === myBotDetailLoadGeneration &&
            state.workbenchMyBotDetailAgentId === id
          ) {
            state.workbenchMyBotDetailLoading = false;
            requestWorkbenchRender(state);
          }
        }
      })();
    },
    onCloseMyBotDetail: () => {
      state.workbenchMyBotDetailAgentId = null;
      state.workbenchMyBotProjection = null;
      state.workbenchMyBotIdentityDraft = null;
      state.workbenchMyBotDetailError = null;
      state.workbenchMyBotDetailLoading = false;
      state.workbenchMyBotDetailSaving = false;
      state.workbenchMyBotDetailTab = "identity";
      requestWorkbenchRender(state);
    },
    onMyBotDetailTabChange: (tab) => {
      state.workbenchMyBotDetailTab = tab;
      if (tab === "danger") {
        const agentId = state.workbenchMyBotDetailAgentId?.trim();
        if (agentId) {
          const name = settingsRobotEntries.find((item) => item.id === agentId)?.name ?? agentId;
          state.workbenchOwnedRobotDeletePrompt = { agentId, name };
          state.workbenchOwnedRobotDeleteError = null;
        }
      }
      requestWorkbenchRender(state);
    },
    onMyBotIdentityDraftChange: (patch) => {
      const current = state.workbenchMyBotIdentityDraft ?? {
        name: "",
        positioning: "",
        role: "",
        personaTraits: "",
        model: "",
      };
      state.workbenchMyBotIdentityDraft = { ...current, ...patch };
      requestWorkbenchRender(state);
    },
    onSaveMyBotIdentity: async () => {
      const agentId = state.workbenchMyBotDetailAgentId?.trim();
      const draft = state.workbenchMyBotIdentityDraft;
      if (!agentId || !draft || !state.client || !state.connected) {
        return;
      }
      state.workbenchMyBotDetailSaving = true;
      state.workbenchMyBotDetailError = null;
      requestWorkbenchRender(state);
      try {
        const rawPayload = await state.client.request("robot.workspace.updateIdentity", {
          agentId,
          name: draft.name.trim() || undefined,
          positioning: draft.positioning.trim() || undefined,
          role: draft.role.trim() || undefined,
          personaTraits: draft.personaTraits.trim() || undefined,
          model: draft.model.trim() || undefined,
        });
        const payload = rawPayload as { bot?: MyBotProjection };
        if (payload?.bot) {
          state.workbenchMyBotProjection = payload.bot;
          state.workbenchMyBotIdentityDraft = {
            name: payload.bot.identity.name ?? "",
            positioning: payload.bot.identity.positioning ?? "",
            role: payload.bot.identity.role ?? "",
            personaTraits: payload.bot.identity.personaTraits ?? "",
            model: payload.bot.identity.model ?? "",
          };
        }
      } catch (error) {
        state.workbenchMyBotDetailError = error instanceof Error ? error.message : String(error);
      } finally {
        state.workbenchMyBotDetailSaving = false;
        requestWorkbenchRender(state);
      }
    },
    onMyBotOpenGroup: (groupId: string) => {
      const id = groupId?.trim();
      if (!id) {
        return;
      }
      state.workbenchMyBotDetailAgentId = null;
      state.workbenchMyBotProjection = null;
      state.workbenchMyBotIdentityDraft = null;
      state.workbenchSettingsView = "system";
      state.workbenchSystemSettingsTab = "groups";
      state.workbenchPrimaryModule = "settings";
      applySystemSettingsGroupSelection(id);
      requestWorkbenchRender(state);
    },
    onDeleteOwnedRobot: async (
      agentId: string,
      _displayName: string,
      memoryDisposal?: "delete_all" | "keep_artifacts_conversations" | "soft_unbind",
    ) => {
      await deleteOwnedRobotWithDisposal(
        agentId,
        memoryDisposal ?? state.workbenchOwnedRobotDeleteDisposition ?? "delete_all",
      );
    },
    onOpenOwnedRobotDeletePrompt: (agentId: string, name: string) => {
      state.workbenchOwnedRobotDeletePrompt = { agentId, name };
      state.workbenchOwnedRobotDeleteDisposition = "delete_all";
      state.workbenchOwnedRobotDeleteError = null;
      requestWorkbenchRender(state);
    },
    onOwnedRobotDeleteDispositionChange: (
      value: "delete_all" | "keep_artifacts_conversations" | "soft_unbind",
    ) => {
      state.workbenchOwnedRobotDeleteDisposition = value;
      requestWorkbenchRender(state);
    },
    onCancelOwnedRobotDelete: () => {
      state.workbenchOwnedRobotDeletePrompt = null;
      requestWorkbenchRender(state);
    },
    onConfirmOwnedRobotDelete: async () => {
      const prompt = state.workbenchOwnedRobotDeletePrompt;
      const agentId = prompt?.agentId ?? state.workbenchMyBotDetailAgentId?.trim() ?? null;
      if (!agentId) {
        return;
      }
      if (!prompt || prompt.agentId !== agentId) {
        const name = settingsRobotEntries.find((item) => item.id === agentId)?.name ?? agentId;
        state.workbenchOwnedRobotDeletePrompt = { agentId, name };
      }
      await deleteOwnedRobotWithDisposal(
        agentId,
        state.workbenchOwnedRobotDeleteDisposition ?? "delete_all",
      );
    },
    onSystemSettingsTabChange: (tab) => {
      if ((tab as string) === "my-accumulation" || (tab as string) === "skills") {
        navigateToKnowledgeAssets(state, myAccumulationRuntime);
        return;
      }
      // 旧深链：个人定时任务 / 开发监督已迁出系统设置，进入「我的任务」模块对应子段。
      if (
        (tab as string) === "jobs" ||
        (tab as string) === "supervisor" ||
        (tab as string) === "assigned"
      ) {
        const subTab =
          (tab as string) === "supervisor"
            ? "supervisor"
            : (tab as string) === "assigned"
              ? "assigned"
              : "cron";
        state.workbenchPrimaryModule = "tasks";
        state.workbenchTasksSubTab = subTab;
        if (subTab === "cron") {
          cronCapability.setPersonalScopeOnly(state, true);
          void cronCapability.loadStatus(state).then(async () => {
            await cronCapability.loadJobs(state);
            requestWorkbenchRender(state);
          });
        }
        requestWorkbenchRender(state);
        return;
      }
      state.workbenchSystemSettingsTab = tab;
      if (state.workbenchSystemSettingsTab === "devices") {
        void loadDevices(state).then(() => requestWorkbenchRender(state));
        ensureDevicesAutoRefresh(state);
      }
      if (state.workbenchSystemSettingsTab === "robots") {
        // system settings: switch 到 robots 时，确保至少有一台机器人详情可用。
        // 触发条件：
        // 1) 当前未选中机器人：选第一台并加载；
        // 2) 已选中但投影未加载（workbenchMyBotProjection 缺失）：补一次加载，避免 tab 切回后仍是空壳。
        const targetRobotId =
          state.workbenchMyBotDetailAgentId?.trim() || settingsRobotEntries[0]?.id || null;
        const shouldLoadDetail =
          Boolean(targetRobotId) &&
          (state.workbenchMyBotDetailAgentId !== targetRobotId ||
            (state.workbenchMyBotProjection == null && !state.workbenchMyBotDetailLoading));

        if (targetRobotId && shouldLoadDetail) {
          const switching = state.workbenchMyBotDetailAgentId !== targetRobotId;
          state.workbenchMyBotDetailAgentId = targetRobotId;
          if (switching) {
            state.workbenchMyBotDetailTab = "identity";
            if (state.workbenchOwnedRobotDeletePrompt?.agentId !== targetRobotId) {
              state.workbenchOwnedRobotDeletePrompt = null;
            }
          }

          state.workbenchMyBotDetailLoading = true;
          state.workbenchMyBotDetailError = null;
          state.workbenchMyBotProjection = null;
          state.workbenchMyBotIdentityDraft = null;

          const loadGeneration = ++myBotDetailLoadGeneration;
          requestWorkbenchRender(state);
          void (async () => {
            try {
              if (!state.client || !state.connected) {
                throw new Error("未连接 Gateway，无法加载机器人详情");
              }
              const rawPayload = await state.client.request("robot.workspace.get", {
                agentId: targetRobotId,
              });
              const payload = rawPayload as { bot?: MyBotProjection };
              if (
                loadGeneration !== myBotDetailLoadGeneration ||
                state.workbenchMyBotDetailAgentId !== targetRobotId
              ) {
                return;
              }
              const bot = payload?.bot ?? null;
              if (!bot) {
                throw new Error("未返回机器人投影");
              }
              state.workbenchMyBotProjection = bot;
              state.workbenchMyBotIdentityDraft = {
                name: bot.identity.name ?? "",
                positioning: bot.identity.positioning ?? "",
                role: bot.identity.role ?? "",
                personaTraits: bot.identity.personaTraits ?? "",
                model: bot.identity.model ?? "",
              };
              state.workbenchMyBotDetailError = null;
            } catch (error) {
              if (
                loadGeneration !== myBotDetailLoadGeneration ||
                state.workbenchMyBotDetailAgentId !== targetRobotId
              ) {
                return;
              }
              state.workbenchMyBotDetailError =
                error instanceof Error ? error.message : String(error);
              state.workbenchMyBotProjection = null;
            } finally {
              if (
                loadGeneration === myBotDetailLoadGeneration &&
                state.workbenchMyBotDetailAgentId === targetRobotId
              ) {
                state.workbenchMyBotDetailLoading = false;
                requestWorkbenchRender(state);
              }
            }
          })();
        }
      }
      if (state.workbenchSystemSettingsTab === "groups") {
        loadCollaborationGroupProjection(
          selectedSystemSettingsGroupEntry?.groupId ?? state.workbenchSystemSettingsSelectedGroupId,
        );
      }
      requestWorkbenchRender(state);
    },
    onPersonalSettingsTabChange: (tab) => {
      state.workbenchPersonalSettingsTab = tab;
      if (tab === "data") {
        void loadWorkbenchDataDirectoryPanel(state, () => requestWorkbenchRender(state));
      }
      requestWorkbenchRender(state);
    },
    onRevealDataDirectoryInFinder: dataDirectoryActions.onRevealDataDirectoryInFinder,
    onOpenDataMigrationWizard: dataDirectoryActions.onOpenDataMigrationWizard,
    onCloseDataMigrationWizard: dataDirectoryActions.onCloseDataMigrationWizard,
    onDataMigrationTargetDraftChange: dataDirectoryActions.onDataMigrationTargetDraftChange,
    onStartDataMigration: dataDirectoryActions.onStartDataMigration,
    onExportOpenBotData: dataDirectoryActions.onExportOpenBotData,
    onForgetMemoryAgentIdChange: dataDirectoryActions.onForgetMemoryAgentIdChange,
    onForgetMemoryKeyChange: dataDirectoryActions.onForgetMemoryKeyChange,
    onForgetMemoryEntry: dataDirectoryActions.onForgetMemoryEntry,
    onRevokeAccessGrant: dataDirectoryActions.onRevokeAccessGrant,
    onSystemSettingsGroupSelect: (groupId) => {
      const normalizedTarget = normalizeValue(groupId) ?? groupId;
      // 群主在当前小组有未保存修改且要切到其它小组时，先弹自绘确认，避免静默丢弃草稿。
      const currentDraft = state.workbenchSystemSettingsGroupDraft;
      const baseline = buildSystemSettingsGroupDraft(selectedSystemSettingsGroupEntry);
      const switchingAway =
        !!selectedSystemSettingsGroupEntry &&
        !matchesSystemSettingsGroupKey(selectedSystemSettingsGroupEntry, normalizedTarget);
      if (
        selectedSystemSettingsGroupEntry?.role === "owner" &&
        switchingAway &&
        currentDraft &&
        baseline &&
        systemSettingsGroupDraftDiffers(currentDraft, baseline)
      ) {
        state.workbenchSystemSettingsPendingGroupId = normalizedTarget;
        requestWorkbenchRender(state);
        return;
      }
      applySystemSettingsGroupSelection(groupId);
      requestWorkbenchRender(state);
    },
    onResolveSystemSettingsGroupSwitch: async (action) => {
      const pendingGroupId = normalizeValue(state.workbenchSystemSettingsPendingGroupId);
      if (!pendingGroupId) {
        return;
      }
      if (action === "cancel") {
        state.workbenchSystemSettingsPendingGroupId = null;
        requestWorkbenchRender(state);
        return;
      }
      if (action === "save") {
        // 先保存当前小组，成功后再切换；保存失败则保留在当前小组并展示错误。
        await saveSystemSettingsGroup(
          state,
          selectedSystemSettingsGroupEntry,
          state.workbenchSystemSettingsGroupDraft ?? selectedSystemSettingsGroupDraft,
        );
        if (state.workbenchSystemSettingsGroupError) {
          state.workbenchSystemSettingsPendingGroupId = null;
          requestWorkbenchRender(state);
          return;
        }
      }
      // action === "discard" 或保存成功：切换到目标小组（草稿按目标重建）。
      applySystemSettingsGroupSelection(pendingGroupId);
      requestWorkbenchRender(state);
    },
    onSystemSettingsGroupDraftChange: (patch) => {
      const baseDraft =
        selectedSystemSettingsGroupDraft ??
        buildSystemSettingsGroupDraft(selectedSystemSettingsGroupEntry);
      if (!baseDraft) {
        return;
      }
      state.workbenchSystemSettingsGroupDraft = {
        ...baseDraft,
        ...patch,
      };
      state.workbenchSystemSettingsGroupError = null;
      state.workbenchSystemSettingsGroupNotice = null;
    },
    onOpenSkillSave: () => {
      openSkillSaveModal(state.workbenchAssetIncubationLevel === "L4");
    },
    onOpenSkillOrganizeManual: () => {
      openSkillSaveModal(false);
    },
    onOpenSkillSaveAndContinue: () => {
      openSkillSaveModal(true);
    },
    onSkillSaveFormChange: (patch) => {
      const next = {
        ...(state.workbenchSkillSaveModalFormData ?? {
          name: "",
          summary: "",
        }),
        ...patch,
      };
      state.workbenchSkillSaveModalFormData = {
        name: next.name,
        summary: next.summary,
      };
      state.workbenchSkillSaveModalError = null;
      requestWorkbenchRender(state);
    },
    onSubmitSkillSave: async () => {
      if (!state.client || !state.connected || !state.workbenchSkillSourceAgentId) {
        return;
      }
      state.workbenchSkillSaveModalBusy = true;
      state.workbenchSkillSaveModalError = null;
      requestWorkbenchRender(state);
      try {
        const preview = state.workbenchSkillExtractedPreview;
        const formData = state.workbenchSkillSaveModalFormData ?? {
          name: "",
          summary: "",
        };
        if (preview) {
          void syncEditPatternToGateway(
            state.client,
            `${preview.suggestedName}\n${preview.suggestedSummary}`,
            `${formData.name}\n${formData.summary}`,
          );
        }
        const draft = createSkillLifecycleDraftState(state);
        const result = await saveSkill(draft, formData, state.workbenchSkillSourceAgentId);
        syncSkillLifecycleDraftState(state, draft);
        state.workbenchSkillSaveModalBusy = false;
        if (result) {
          const contextId = state.workbenchSkillSourceContextId;
          if (contextId) {
            void syncContextCapabilityLink(state.client, contextId, result.skillId);
          }
          if (
            state.workbenchAssetIncubationLevel === "L3" ||
            state.workbenchAssetIncubationLevel === "L4"
          ) {
            const suggestion = await runIncubationAutofill({
              client: state.client,
              connected: state.connected,
              skillId: result.skillId,
            });
            setWorkbenchIncubationAutofillHint(state, buildAutofillHintText(suggestion));
          }
          const decision = decideAssetSuggestionFromManualIteration({
            capabilityId: result.skillId,
            capabilityName: "资产草稿",
          });
          if (decision.shouldSuggest) {
            maybeOpenAssetSuggestion({
              state,
              source: decision.source,
              label: "资产草稿已纳入列表，可继续完善或提交企业",
              agentId: state.workbenchSkillSourceAgentId,
              contextId: decision.contextId,
            });
          }
          state.workbenchSkillSaveModalOpen = false;
          state.workbenchSkillSaveModalFormData = null;
          state.workbenchSkillSavePreferEnterpriseSubmit = false;
          state.workbenchSkillExtractedPreview = null;
          myAccumulationRuntime.hasLoaded = false;
          ensureWorkbenchMyAccumulationLoaded(state);
        }
      } catch (error) {
        state.workbenchSkillSaveModalBusy = false;
        state.workbenchSkillSaveModalError = error instanceof Error ? error.message : String(error);
      }
      requestWorkbenchRender(state);
    },
    onSubmitSkillSaveAndContinue: async () => {
      if (!state.client || !state.connected || !state.workbenchSkillSourceAgentId) {
        return;
      }
      state.workbenchSkillSaveModalBusy = true;
      state.workbenchSkillSaveModalError = null;
      requestWorkbenchRender(state);
      try {
        const preview = state.workbenchSkillExtractedPreview;
        const formData = state.workbenchSkillSaveModalFormData ?? {
          name: "",
          summary: "",
        };
        if (preview) {
          void syncEditPatternToGateway(
            state.client,
            `${preview.suggestedName}\n${preview.suggestedSummary}`,
            `${formData.name}\n${formData.summary}`,
          );
        }
        const draft = createSkillLifecycleDraftState(state);
        const result = await saveSkill(draft, formData, state.workbenchSkillSourceAgentId);
        syncSkillLifecycleDraftState(state, draft);
        state.workbenchSkillSaveModalBusy = false;
        if (result) {
          const contextId = state.workbenchSkillSourceContextId;
          if (contextId) {
            void syncContextCapabilityLink(state.client, contextId, result.skillId);
          }
          void runIncubationAutofill({
            client: state.client,
            connected: state.connected,
            skillId: result.skillId,
          }).then((suggestion) => {
            setWorkbenchIncubationAutofillHint(state, buildAutofillHintText(suggestion));
          });
          await loadWorkbenchMyAccumulation(myAccumulationRuntime.state, state);
          await loadWorkbenchMyAccumulationDetail(
            myAccumulationRuntime.state,
            state,
            result.skillId,
          );
          const capability =
            myAccumulationRuntime.state.selectedCapability ??
            myAccumulationRuntime.state.items.find((item) => item.id === result.skillId) ??
            null;
          if (capability) {
            openEnterpriseSubmissionDraft(capability);
          }
          state.workbenchSkillSaveModalOpen = false;
          state.workbenchSkillSaveModalFormData = null;
          state.workbenchSkillSavePreferEnterpriseSubmit = false;
          state.workbenchSkillExtractedPreview = null;
          myAccumulationRuntime.hasLoaded = true;
        }
      } catch (error) {
        state.workbenchSkillSaveModalBusy = false;
        state.workbenchSkillSaveModalError = error instanceof Error ? error.message : String(error);
      }
      requestWorkbenchRender(state);
    },
    onCloseSkillSave: () => {
      nextSkillSaveExtractSeq(state);
      const contextId = state.workbenchSkillSourceContextId ?? null;
      const sessionKey = state.sessionKey ?? null;
      dismissAssetSuggestion({ contextId, sessionKey });
      if (contextId) {
        const runtime = ensureAssetSuggestionPatternRuntime(
          state,
          state.client ?? null,
          Boolean(state.connected),
        );
        dismissHint(runtime.state, contextId);
      }
      const draft = createSkillLifecycleDraftState(state);
      closeSaveModal(draft);
      draft.saveModalFormData = null;
      draft.extractedPreview = null;
      syncSkillLifecycleDraftState(state, draft);
      state.workbenchSkillSavePreferEnterpriseSubmit = false;
      state.workbenchAssetSuggestionVisible = false;
      state.workbenchAssetWeakHintVisible = false;
      requestWorkbenchRender(state);
    },
    onSaveSystemSettingsGroup: async () => {
      await saveSystemSettingsGroup(
        state,
        selectedSystemSettingsGroupEntry,
        state.workbenchSystemSettingsGroupDraft ?? selectedSystemSettingsGroupDraft,
      );
    },
    onResetSystemSettingsGroup: async () => {
      const groupId = normalizeValue(selectedSystemSettingsGroupEntry?.groupId);
      if (!groupId) {
        state.workbenchSystemSettingsGroupError = "当前未选中协作小组。";
        state.workbenchSystemSettingsGroupNotice = null;
        return;
      }
      state.workbenchSystemSettingsGroupSaving = true;
      state.workbenchSystemSettingsGroupError = null;
      state.workbenchSystemSettingsGroupNotice = null;
      try {
        await resetEmployeeWorkbenchSpace(state, { groupId });
        state.workbenchSystemSettingsGroupNotice =
          "协作小组已重置。聊天记录已清空，小组设置保持不变。";
      } catch (error) {
        state.workbenchSystemSettingsGroupError = workbenchGroupActionError(error);
      } finally {
        state.workbenchSystemSettingsGroupSaving = false;
      }
    },
    onDissolveSystemSettingsGroup: async () => {
      const groupId = normalizeValue(selectedSystemSettingsGroupEntry?.groupId);
      const groupTitle = selectedSystemSettingsGroupEntry?.title?.trim() || groupId;
      if (!groupId) {
        state.workbenchSystemSettingsGroupError = "当前未选中协作小组。";
        state.workbenchSystemSettingsGroupNotice = null;
        return;
      }
      const confirmMessage = `确定解散协作小组「${groupTitle}」？\n\n解散后所有成员将收到通知，小组将从导航中移除，此操作不可撤销。`;
      if (!window.confirm(confirmMessage)) {
        return;
      }
      state.workbenchSystemSettingsGroupSaving = true;
      state.workbenchSystemSettingsGroupError = null;
      state.workbenchSystemSettingsGroupNotice = null;
      try {
        const result = (await dissolveEmployeeWorkbenchSpace(state, { groupId })) as
          | { notificationMessage?: string; notifiedUserIds?: string[] }
          | null
          | undefined;
        const notifiedCount = result?.notifiedUserIds?.length ?? 0;
        state.workbenchSystemSettingsGroupNotice =
          result?.notificationMessage ??
          (notifiedCount > 0
            ? `协作小组已解散，已通知 ${notifiedCount} 位成员。`
            : "协作小组已解散。");
        state.workbenchSystemSettingsSelectedGroupId = null;
        state.workbenchSystemSettingsGroupDraft = null;
      } catch (error) {
        state.workbenchSystemSettingsGroupError = workbenchGroupActionError(error);
      } finally {
        state.workbenchSystemSettingsGroupSaving = false;
      }
    },
    onLeaveSystemSettingsGroup: async () => {
      const groupSnapshot = resolveCurrentCollaborationGroup();
      const groupId =
        normalizeValue(groupSnapshot?.groupId) ??
        normalizeValue(groupSnapshot?.spaceId) ??
        normalizeValue(selectedSystemSettingsGroupEntry?.groupId);
      const groupTitle =
        normalizeValue(groupSnapshot?.managedSpace?.title) ??
        normalizeValue(state.workbenchMemberGovernanceTitle) ??
        normalizeValue(selectedSystemSettingsGroupEntry?.title) ??
        groupId;
      if (!groupId) {
        state.workbenchMemberGovernanceError = "当前未选中协作小组。";
        state.workbenchMemberGovernanceResult = null;
        state.workbenchSystemSettingsGroupError = "当前未选中协作小组。";
        state.workbenchSystemSettingsGroupNotice = null;
        return;
      }
      if (!window.confirm(`确定退出协作小组「${groupTitle}」？`)) {
        return;
      }
      state.workbenchMemberGovernanceBusy = true;
      state.workbenchMemberGovernanceError = null;
      state.workbenchMemberGovernanceResult = null;
      state.workbenchSystemSettingsGroupSaving = true;
      state.workbenchSystemSettingsGroupError = null;
      state.workbenchSystemSettingsGroupNotice = null;
      try {
        await leaveEmployeeWorkbenchSpace(state, { groupId });
        state.workbenchSystemSettingsGroupNotice = "已退出协作小组。";
        state.workbenchSystemSettingsSelectedGroupId = null;
        state.workbenchSystemSettingsGroupDraft = null;
        state.workbenchMemberGovernanceDrawerOpen = false;
        state.workbenchMemberGovernanceGroupKey = null;
        state.workbenchGroupProfileView = "chat";
        resetWorkbenchMemberGovernanceState(state);
      } catch (error) {
        const message = String(error);
        state.workbenchMemberGovernanceError = message;
        state.workbenchSystemSettingsGroupError = message;
      } finally {
        state.workbenchMemberGovernanceBusy = false;
        state.workbenchSystemSettingsGroupSaving = false;
      }
    },
    onTransferSystemSettingsGroupOwnership: async (userId) => {
      const nextOwnerUserId = normalizeValue(userId);
      const groupSnapshot = resolveCurrentCollaborationGroup();
      const groupId =
        normalizeValue(groupSnapshot?.groupId) ??
        normalizeValue(groupSnapshot?.spaceId) ??
        normalizeValue(selectedSystemSettingsGroupEntry?.groupId);
      const groupTitle =
        normalizeValue(groupSnapshot?.managedSpace?.title) ??
        normalizeValue(state.workbenchMemberGovernanceTitle) ??
        normalizeValue(selectedSystemSettingsGroupEntry?.title) ??
        groupId;
      if (!groupId || !nextOwnerUserId) {
        state.workbenchMemberGovernanceError = "无法移交：缺少协作小组或目标成员。";
        state.workbenchMemberGovernanceResult = null;
        return;
      }
      const nextOwnerLabel =
        (state.workbenchMemberGovernanceCurrentHumans ?? []).find(
          (entry) => entry.id === nextOwnerUserId,
        )?.label ??
        selectedSystemSettingsGroupEntry?.memberRows?.find(
          (row) => row.kind === "human" && normalizeValue(row.memberId) === nextOwnerUserId,
        )?.name ??
        nextOwnerUserId;
      if (
        !window.confirm(
          `确定将「${groupTitle}」的管理权移交给 ${nextOwnerLabel}？\n\n移交后你将变为普通成员。`,
        )
      ) {
        return;
      }
      state.workbenchMemberGovernanceBusy = true;
      state.workbenchMemberGovernanceError = null;
      state.workbenchMemberGovernanceResult = null;
      state.workbenchSystemSettingsGroupSaving = true;
      state.workbenchSystemSettingsGroupError = null;
      state.workbenchSystemSettingsGroupNotice = null;
      try {
        await transferEmployeeWorkbenchSpaceOwnership(state, {
          groupId,
          newOwnerUserId: nextOwnerUserId,
          newOwnerLabel: nextOwnerLabel,
        });
        state.workbenchMemberGovernanceResult = `已将管理权移交给 ${nextOwnerLabel}。`;
        state.workbenchSystemSettingsGroupNotice = `已将管理权移交给 ${nextOwnerLabel}。`;
        refreshMemberGovernanceSnapshot();
        initializeMemberGovernance();
      } catch (error) {
        const message = String(error);
        state.workbenchMemberGovernanceError = message;
        state.workbenchSystemSettingsGroupError = message;
      } finally {
        state.workbenchMemberGovernanceBusy = false;
        state.workbenchSystemSettingsGroupSaving = false;
      }
    },
    onOpenSystemSettingsGroupMembers: () => {
      if (!selectedSystemSettingsGroupEntry) {
        return;
      }
      // Open the full-stage member management page (not collaboration chat +
      // a docked drawer that can be clipped / mistaken for a conversation jump).
      const groupId =
        normalizeValue(selectedSystemSettingsGroupEntry.groupId) ??
        normalizeValue(selectedSystemSettingsGroupEntry.sessionKey);
      if (!groupId) {
        return;
      }
      let sessionKey: string | null = null;
      for (const session of state.sessionsResult?.sessions ?? []) {
        const key = normalizeValue(session.key);
        if (!key) {
          continue;
        }
        const sessionGroupId =
          normalizeValue(session.groupId) ??
          normalizeValue(session.collaborationGroupProfile?.groupId) ??
          normalizeValue(session.collaborationParticipationOverlay?.groupId);
        if (
          sessionGroupId === groupId ||
          key === `space:${groupId}` ||
          key.endsWith(`:space:${groupId}`)
        ) {
          sessionKey = key;
          break;
        }
        const spaceAlias: string | null = key.startsWith("space:")
          ? key.slice("space:".length).trim()
          : null;
        if (spaceAlias === groupId) {
          sessionKey = key;
          break;
        }
      }
      sessionKey =
        sessionKey ??
        normalizeValue(selectedSystemSettingsGroupEntry.sessionKey) ??
        `space:${groupId}`;
      closeCollaborationArtifactPreview(state);
      resetWorkbenchMemberGovernanceState(state);
      state.workbenchTeamSelectedKey = sessionKey;
      switchEmployeeWorkbenchSession(state, sessionKey, "collaboration");
      // switchEmployeeWorkbenchSession forces profile view back to "chat".
      state.workbenchTeamSelectedKey = sessionKey;
      state.workbenchPrimaryModule = "collaboration";
      state.workbenchGroupProfileView = "members";
      state.workbenchMemberGovernanceDrawerOpen = true;
      requestWorkbenchRender(state);
    },
    onExportSystemSettingsGroupSummary: () => {
      if (!selectedSystemSettingsGroupEntry) {
        return;
      }
      const fileSafeTitle =
        selectedSystemSettingsGroupEntry.title.trim().replace(/[\\/:*?"<>|]+/g, "-") || "group";
      downloadTextFile(
        `${fileSafeTitle}-summary.md`,
        buildSystemSettingsGroupSummaryMarkdown(selectedSystemSettingsGroupEntry),
        "text/markdown",
      );
    },
    onRobotWorkbenchTabChange: (tab) => {
      state.workbenchRobotWorkbenchTab = tab;
    },
    onDefaultWorkspaceRootDraftChange: (value) => {
      state.workbenchDefaultWorkspaceRootDraft = value;
      state.workbenchDefaultWorkspaceRootError = null;
      state.workbenchDefaultWorkspaceRootNotice = null;
    },
    onSaveDefaultWorkspaceRoot: async () => {
      await saveDefaultAgentWorkspaceRoot(
        state,
        state.workbenchDefaultWorkspaceRootDraft ??
          resolveDefaultAgentWorkspace(state, state.configSnapshot),
      );
    },
    onOpenWorkspaceSelector: async (mode, target) => {
      if (mode === "default-local" || mode === "default-cloud") {
        return;
      }
      const currentPath = normalizeValue(target?.path) ?? "";
      const selectorTitle =
        mode === "robot-local"
          ? `选择 ${target?.label ?? "机器人"} 工作区`
          : "选择 OpenBot 工作空间根目录";
      state.workbenchWorkspaceSelectorOpen = true;
      state.workbenchWorkspaceSelectorMode = mode;
      state.workbenchWorkspaceSelectorTitle = selectorTitle;
      state.workbenchWorkspaceSelectorDescription =
        mode === "robot-local"
          ? "该目录会作为此机器人后续运行和文件沉淀的工作区。"
          : "作为 OpenBot 统一工作空间根目录，机器人、协作小组与知识空间会自动在其下生成结构化子目录。";
      state.workbenchWorkspaceSelectorSelectedPath = currentPath.trim();
      state.workbenchWorkspaceSelectorTargetId = target?.id?.trim() || null;
      state.workbenchWorkspaceSelectorTargetLabel = target?.label?.trim() || null;
      state.workbenchWorkspaceSelectorLocalBrowserOpen = false;
      requestWorkbenchRender(state);
      const hostContext = resolveWorkspaceSelectorHostContext(state);
      const browsePath = resolveDefaultWorkspaceBrowsePath({
        platform: hostContext.platform,
        homedir: hostContext.homedir,
        isLocalGateway: hostContext.isLocalGateway,
        browseRoots: hostContext.browseRoots,
        preferredPath: currentPath.trim() || null,
      });
      await loadSystemWorkspaceLocalBrowser(state, browsePath);
      requestWorkbenchRender(state);
    },
    onCloseWorkspaceSelector: () => {
      state.workbenchWorkspaceSelectorOpen = false;
      state.workbenchWorkspaceSelectorLocalBrowserOpen = false;
      state.workbenchWorkspaceSelectorLocalBrowserError = null;
      state.workbenchWorkspaceSelectorTargetId = null;
      state.workbenchWorkspaceSelectorTargetLabel = null;
      requestWorkbenchRender(state);
    },
    onChooseWorkspaceSelector: async () => {
      const selectedPath = await chooseSystemWorkspaceDirectory(state, {
        path: state.workbenchWorkspaceSelectorSelectedPath || null,
        title: state.workbenchWorkspaceSelectorTitle || "选择工作区目录",
      });
      if (selectedPath) {
        state.workbenchWorkspaceSelectorSelectedPath = selectedPath;
      }
      requestWorkbenchRender(state);
    },
    onBrowseWorkspaceSelector: async () => {
      await loadSystemWorkspaceLocalBrowser(
        state,
        state.workbenchWorkspaceSelectorSelectedPath || null,
      );
      requestWorkbenchRender(state);
    },
    onWorkspaceSelectorPathDraftChange: (value) => {
      state.workbenchWorkspaceSelectorSelectedPath = value;
      if ((state.workbenchWorkspaceSelectorMode ?? "default-local") === "default-local") {
        state.workbenchDefaultWorkspaceRootDraft = value;
        state.workbenchDefaultWorkspaceRootError = null;
        state.workbenchDefaultWorkspaceRootNotice = null;
      }
      state.workbenchWorkspaceSelectorLocalBrowserError = null;
      requestWorkbenchRender(state);
    },
    onUseCurrentWorkspaceSelectorDirectory: () => {
      const currentPath = normalizeValue(state.workbenchWorkspaceSelectorLocalBrowserCurrentPath);
      if (!currentPath) {
        state.workbenchWorkspaceSelectorLocalBrowserError = "请先浏览并定位到目标目录。";
        requestWorkbenchRender(state);
        return;
      }
      state.workbenchWorkspaceSelectorSelectedPath = currentPath;
      if ((state.workbenchWorkspaceSelectorMode ?? "default-local") === "default-local") {
        state.workbenchDefaultWorkspaceRootDraft = currentPath;
        state.workbenchDefaultWorkspaceRootError = null;
        state.workbenchDefaultWorkspaceRootNotice = null;
      }
      state.workbenchWorkspaceSelectorLocalBrowserError = null;
      requestWorkbenchRender(state);
    },
    onNavigateWorkspaceSelector: async (path) => {
      await loadSystemWorkspaceLocalBrowser(state, path);
      requestWorkbenchRender(state);
    },
    onSelectWorkspaceSelectorPath: (path) => {
      state.workbenchWorkspaceSelectorSelectedPath = path;
      if ((state.workbenchWorkspaceSelectorMode ?? "default-local") === "default-local") {
        state.workbenchDefaultWorkspaceRootDraft = path;
        state.workbenchDefaultWorkspaceRootError = null;
        state.workbenchDefaultWorkspaceRootNotice = null;
      }
      state.workbenchWorkspaceSelectorOpen = false;
      state.workbenchWorkspaceSelectorTargetId = null;
      state.workbenchWorkspaceSelectorTargetLabel = null;
      requestWorkbenchRender(state);
    },
    onApplyWorkspaceSelector: async () => {
      const mode = state.workbenchWorkspaceSelectorMode ?? "default-local";
      if (mode === "default-cloud") {
        await saveDefaultAgentWorkspaceCloudRoot(state);
        requestWorkbenchRender(state);
        return;
      }
      const selectedPath = state.workbenchWorkspaceSelectorSelectedPath ?? "";
      await applyWorkspaceSelectorPath(state, {
        mode,
        selectedPath,
        settingsGroupEntries,
        selectedSystemSettingsGroupEntry,
      });
      requestWorkbenchRender(state);
    },
    onOpenSystemAuthorization: async (key) => {
      await requestSystemAuthorization(state, key);
    },
    onRefreshMyDevices: async () => {
      await loadDevices(state);
      requestWorkbenchRender(state);
    },
    onRemoveMyDevice: async (deviceId) => {
      await removeDevice(state, deviceId);
      requestWorkbenchRender(state);
    },
    onApproveMyDevicePairing: async (requestId) => {
      await approveDevicePairing(state, requestId);
      requestWorkbenchRender(state);
    },
    onRejectMyDevicePairing: async (requestId) => {
      await rejectDevicePairing(state, requestId);
      requestWorkbenchRender(state);
    },
    onRemoveMyDevices: async (deviceIds) => {
      await removeDevices(state, deviceIds);
      requestWorkbenchRender(state);
    },
    onWorkspaceSelectorCloudProviderChange: (value) => {
      state.workbenchWorkspaceCloudProvider = value;
      requestWorkbenchRender(state);
    },
    onWorkspaceSelectorCloudRegionChange: (value) => {
      state.workbenchWorkspaceCloudRegion = value;
      requestWorkbenchRender(state);
    },
    onWorkspaceSelectorCloudBucketChange: (value) => {
      state.workbenchWorkspaceCloudBucket = value;
      requestWorkbenchRender(state);
    },
    onWorkspaceSelectorCloudRootPrefixChange: (value) => {
      state.workbenchWorkspaceCloudRootPrefix = value;
      requestWorkbenchRender(state);
    },
    onWorkspaceSelectorCloudEndpointChange: (value) => {
      state.workbenchWorkspaceCloudEndpoint = value;
      requestWorkbenchRender(state);
    },
    onWorkspaceSelectorCloudAccountNameChange: (value) => {
      state.workbenchWorkspaceCloudAccountName = value;
      requestWorkbenchRender(state);
    },
    onGenerateWorkspaceSelectorCloudConfig: async () => {
      await generateAgentCreatorCloudConfig(state);
      requestWorkbenchRender(state);
    },
    onTestWorkspaceSelectorCloudConnection: async () => {
      await testAgentCreatorCloudConnection(state);
      requestWorkbenchRender(state);
    },
    onPasswordCurrentChange: (value) => {
      state.platformAuthCurrentPassword = value;
      state.platformAuthNotice = null;
    },
    onPasswordNewChange: (value) => {
      state.platformAuthNewPassword = value;
      state.platformAuthNotice = null;
    },
    onChangePassword: async () => {
      await state.changePlatformAuthPassword();
    },
    onOpenForgotPassword: async () => {
      await state.openPlatformAuthForgotPassword();
    },
    onRefreshUserOperationalIdentities: async () => {
      await state.loadUserOperationalIdentities();
    },
    onOpenUserOperationalIdentityEditor: (provider?: string) => {
      state.openUserOperationalIdentityEditor(provider);
    },
    onUserOperationalIdentityNavChange: (nav) => {
      state.setUserOperationalIdentityNav(nav);
    },
    onUserOperationalIdentityUsageRangeChange: (range) => {
      state.userOperationalIdentityUsageRange = range;
      state.userOperationalIdentityUsageEventId = null;
      requestWorkbenchRender(state);
    },
    onSelectUserOperationalIdentityUsageEvent: (eventId) => {
      state.userOperationalIdentityUsageEventId = eventId;
      requestWorkbenchRender(state);
    },
    onVerifyUserOperationalIdentityCredentials: async (identityId: string) => {
      await state.verifyUserOperationalIdentityCredentials(identityId);
    },
    onOpenPersonalOperationalIdentity: (options) => {
      openPersonalOperationalIdentitySection(state, options, requestWorkbenchRender);
    },
    onRobotIdentityGrantFocusHandled: () => {
      state.workbenchRobotIdentityGrantFocusAgentId = null;
      requestWorkbenchRender(state);
    },
    onCloseUserOperationalIdentityEditor: () => {
      state.closeUserOperationalIdentityEditor();
    },
    onSubmitUserOperationalIdentityEditor: async () => {
      await state.submitUserOperationalIdentityEditor();
    },
    onStartWechatPersonalQr: async () => {
      await state.startWechatPersonalQr();
    },
    onRecheckWechatPersonalChannel: async () => {
      await state.recheckWechatPersonalChannel();
    },
    onUserOperationalIdentityEditorGrantAgentIdChange: (value: string) => {
      state.userOperationalIdentityEditorGrantAgentId = value;
    },
    onCompleteUserOperationalIdentityOAuthForContinuation: async (input: {
      continuationToken: string;
      provider: string;
      displayName?: string;
    }) => {
      await state.completeUserOperationalIdentityOAuthForContinuation(input);
    },
    onUserOperationalIdentityEditorProviderChange: (value: string) => {
      state.userOperationalIdentityEditorProvider = value;
      const catalog = state.userOperationalIdentities?.providerCatalog ?? [];
      const entry = catalog.find((item) => item.provider === value);
      const manualKind =
        entry?.manualKind ??
        (value === "wechat-official" ? "wechat_oa" : value === "personal-email" ? "smtp" : null);
      if (manualKind !== "wechat_oa") {
        state.userOperationalIdentityEditorAppId = "";
      }
      if (manualKind !== "wechat_oa" && manualKind !== "social_account" && manualKind !== "smtp") {
        state.userOperationalIdentityEditorAppSecret = "";
      }
      if (
        value !== "github-personal" &&
        value !== "personal-email" &&
        manualKind !== "social_account"
      ) {
        state.userOperationalIdentityEditorCredentialHandleId = "";
      }
      if (manualKind === "smtp") {
        state.userOperationalIdentityEditorSmtpHost = "";
        state.userOperationalIdentityEditorSmtpPort = "587";
        state.userOperationalIdentityEditorSmtpUser = "";
        state.userOperationalIdentityEditorImapHost = "";
        state.userOperationalIdentityEditorImapPort = "993";
        state.userOperationalIdentityEditorImapUser = "";
        state.userOperationalIdentityEditorPersonalEmailPresetNote = null;
        state.userOperationalIdentityEditorUsePlatformSmtp = Boolean(
          state.userOperationalIdentities?.platformSmtpConfigured,
        );
      } else {
        state.userOperationalIdentityEditorSmtpHost = "";
        state.userOperationalIdentityEditorSmtpPort = "587";
        state.userOperationalIdentityEditorSmtpUser = "";
        state.userOperationalIdentityEditorImapHost = "";
        state.userOperationalIdentityEditorImapPort = "993";
        state.userOperationalIdentityEditorImapUser = "";
        state.userOperationalIdentityEditorPersonalEmailPresetNote = null;
        state.userOperationalIdentityEditorUsePlatformSmtp = false;
      }
    },
    onUserOperationalIdentityEditorDisplayNameChange: (value: string) => {
      state.userOperationalIdentityEditorDisplayName = value;
    },
    onUserOperationalIdentityEditorCredentialHandleIdChange: (value: string) => {
      state.userOperationalIdentityEditorCredentialHandleId = value;
      if (state.userOperationalIdentityEditorProvider === "personal-email") {
        state.userOperationalIdentityEditorPersonalEmailPresetNote =
          applyPersonalEmailPresetToEditor(state) ?? null;
      }
    },
    onUserOperationalIdentityEditorAppIdChange: (value: string) => {
      state.userOperationalIdentityEditorAppId = value;
    },
    onUserOperationalIdentityEditorAppSecretChange: (value: string) => {
      state.userOperationalIdentityEditorAppSecret = value;
    },
    onUserOperationalIdentityEditorSmtpHostChange: (value: string) => {
      state.userOperationalIdentityEditorSmtpHost = value;
    },
    onUserOperationalIdentityEditorSmtpPortChange: (value: string) => {
      state.userOperationalIdentityEditorSmtpPort = value;
    },
    onUserOperationalIdentityEditorSmtpUserChange: (value: string) => {
      state.userOperationalIdentityEditorSmtpUser = value;
    },
    onUserOperationalIdentityEditorImapHostChange: (value: string) => {
      state.userOperationalIdentityEditorImapHost = value;
    },
    onUserOperationalIdentityEditorImapPortChange: (value: string) => {
      state.userOperationalIdentityEditorImapPort = value;
    },
    onUserOperationalIdentityEditorImapUserChange: (value: string) => {
      state.userOperationalIdentityEditorImapUser = value;
    },
    onUserOperationalIdentityEditorUsePlatformSmtpChange: (value: boolean) => {
      state.userOperationalIdentityEditorUsePlatformSmtp = value;
    },
    onOpenPersonalEmailWebmail: () => {
      const email = state.userOperationalIdentityEditorCredentialHandleId.trim();
      const guide = resolvePersonalEmailBrowserGuide(email);
      if (!guide) {
        state.userOperationalIdentityNotice =
          "请先填写发件邮箱（如 name@126.com），再打开邮箱网页获取授权码。";
        requestWorkbenchRender(state);
        return;
      }
      openExternalUrlSafe(guide.webmailLoginUrl);
    },
    onOpenPersonalEmailAuthCodeSettings: () => {
      const email = state.userOperationalIdentityEditorCredentialHandleId.trim();
      const guide = resolvePersonalEmailBrowserGuide(email);
      if (!guide?.settingsUrl) {
        state.userOperationalIdentityNotice = "当前邮箱类型请先在邮箱网页设置里生成授权码。";
        requestWorkbenchRender(state);
        return;
      }
      openExternalUrlSafe(guide.settingsUrl);
    },
    onOpenPersonalEmailBrowserGuideFromChat: () => {
      const pendingRequest = state.userOperationalIdentities?.pendingBindingRequests?.find(
        (entry) => entry.provider === "personal-email" && entry.status === "pending",
      );
      const pendingContinuation = state.userOperationalIdentities?.pendingContinuations?.find(
        (entry) =>
          entry.provider === "personal-email" &&
          (entry.status === "pending_binding" || entry.status === "pending_oauth"),
      );
      if (pendingRequest || pendingContinuation) {
        state.openUserOperationalIdentityBindingFlow({
          sessionKey:
            pendingRequest?.sessionKey ?? pendingContinuation?.sessionKey ?? state.sessionKey,
          module: state.workbenchPrimaryModule,
          agentId: pendingRequest?.agentId ?? pendingContinuation?.agentId,
          provider: "personal-email",
          requestedAction:
            pendingRequest?.requestedAction ?? pendingContinuation?.requestedAction ?? "sync_inbox",
          resumeMessage:
            pendingContinuation?.resumeMessage?.trim() || state.chatMessage.trim() || undefined,
          resumeIntentId: pendingContinuation?.resumeIntentId,
          autoResume: pendingContinuation?.autoResume ?? true,
        });
        requestWorkbenchRender(state);
        return;
      }
      state.userOperationalIdentityNotice =
        "请先在绑定表单填写发件邮箱，再点「打开邮箱网页」；或让大白用 Path C 浏览器协驾。";
      requestWorkbenchRender(state);
    },
    onRevokeUserOperationalIdentity: async (identityId: string) => {
      await state.revokeUserOperationalIdentity(identityId);
    },
    onReauthorizeUserOperationalIdentity: async (identityId: string) => {
      await state.reauthorizeUserOperationalIdentity(identityId);
    },
    onCompleteUserOperationalIdentityBindingRequest: async (requestId: string) => {
      await state.completeUserOperationalIdentityBindingRequest(requestId);
    },
    onConfirmUserOperationalIdentityGrant: async (input: {
      identityId: string;
      agentId: string;
      agentScope: "owned" | "shared" | "group";
      allowedActions: string[];
      tenantId?: string;
      seatId?: string;
      sessionKey?: string | null;
    }) => {
      await state.confirmUserOperationalIdentityGrant(input);
    },
    onRevokeUserOperationalIdentityGrant: async (grantId: string) => {
      await state.revokeUserOperationalIdentityGrant(grantId);
    },
    onLoadRobotEnterpriseIdentities: (agentId: string) => {
      void state.loadRobotEnterpriseIdentities(agentId);
    },
    onApplyRobotIdentityGrants: async (input: {
      agentId: string;
      agentScope: "owned" | "shared" | "group";
      desired: Array<{ identityId: string; allowedActions: string[] }>;
    }) => {
      await state.applyRobotOperationalIdentityGrants(input);
      if (state.client?.connected) {
        for (const grant of input.desired) {
          try {
            await state.client.request("data.accessGrants.record", {
              agentId: input.agentId,
              resourceType: "path",
              resourcePath: `identity/${grant.identityId}`,
              reason: "robot_identity_grant",
            });
          } catch {
            // best-effort audit trail for local data space
          }
        }
      }
    },
    onApplyIdentityRobotGrants: async (input: {
      identityId: string;
      desiredAgentIds: string[];
      agentScopesById?: Record<string, "owned" | "shared" | "group">;
    }) => {
      await state.applyIdentityOperationalRobotGrants(input);
      if (state.client?.connected) {
        for (const agentId of input.desiredAgentIds) {
          try {
            await state.client.request("data.accessGrants.record", {
              agentId,
              resourceType: "path",
              resourcePath: `identity/${input.identityId}`,
              reason: "identity_robot_grant",
            });
          } catch {
            // best-effort audit trail for local data space
          }
        }
      }
    },
    onApplyRobotEnterpriseIdentities: async (input: {
      agentId: string;
      desiredIdentityIds: string[];
    }) => {
      await state.applyRobotEnterpriseIdentityEnrollments(input);
    },
    onOpenUserOperationalIdentityBindingFlow: () => {
      const pendingRequest = state.userOperationalIdentities?.pendingBindingRequests?.[0];
      const pendingContinuation = state.userOperationalIdentities?.pendingContinuations?.find(
        (entry) => entry.status === "pending_binding" || entry.status === "pending_oauth",
      );
      state.openUserOperationalIdentityBindingFlow({
        sessionKey:
          pendingRequest?.sessionKey ?? pendingContinuation?.sessionKey ?? state.sessionKey,
        module: state.workbenchPrimaryModule,
        agentId: pendingRequest?.agentId ?? pendingContinuation?.agentId,
        provider: pendingRequest?.provider ?? pendingContinuation?.provider,
        requestedAction: pendingRequest?.requestedAction ?? pendingContinuation?.requestedAction,
        resumeMessage:
          pendingContinuation?.resumeMessage?.trim() || state.chatMessage.trim() || undefined,
        resumeIntentId: pendingContinuation?.resumeIntentId,
        autoResume: pendingContinuation?.autoResume ?? true,
      });
    },
    onResumeUserOperationalIdentityContinuation: async (continuationToken?: string) => {
      const ready = state.userOperationalIdentities?.pendingContinuations?.find(
        (entry) => entry.status === "ready_to_resume",
      );
      await state.resumeUserOperationalIdentityContinuationNow(
        continuationToken?.trim() || ready?.continuationToken,
      );
      requestWorkbenchRender(state);
    },
    onAcceptPendingSeatOffer: async (offerId) => {
      await state.acceptPlatformSeatAssignmentOffer(offerId);
      requestWorkbenchRender(state);
    },
    onDeclinePendingSeatOffer: async (offerId) => {
      await state.declinePlatformSeatAssignmentOffer(offerId);
      requestWorkbenchRender(state);
    },
    onSharedAgentDraftIdChange: () => undefined,
    onSharedAgentDraftNameChange: () => undefined,
    onSharedAgentDraftOwnerIdChange: () => undefined,
    onSharedAgentDraftOwnerNameChange: () => undefined,
    onSharedAgentDraftEmojiChange: () => undefined,
    onUpsertSharedAgent: async () => undefined,
    onImportOwnedAgents: async () => undefined,
    onRemoveSharedAgent: async () => undefined,
    ...workbenchInteractionProps,
    ...workbenchGovernanceInteractionProps,
  };
}
