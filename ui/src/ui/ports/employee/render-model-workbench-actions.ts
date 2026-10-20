import type { AppPortState } from "../../app-port-state.ts";
import {
  AGENT_CREATE_SUPPORTS_TEMPLATE_ID,
  listAgentTemplates,
} from "../../controllers/agent-growth.ts";
import type {
  CollaborationSpaceSnapshotTransport,
  ConfigSnapshot,
  GatewayAgentRow,
  WorkspaceCloudProvider,
  WorkspaceCloudBrowseResult,
  WorkspaceCloudConnectionResult,
  WorkspaceCloudGeneratedConfig,
  WorkspaceLocalBrowseResult,
  WorkspaceLocalValidateResult,
  WorkspacesCreateResult,
} from "../../types.ts";
import { isPlatformAdminSessionKind } from "../platform/platform-auth-session.ts";
import { formatEmployeeAgentCreateError } from "./agent-create-error.ts";
import {
  isCollaborationOrgBotOwnedByActor,
  loadCollaborationOrgBotDirectory,
} from "./collaboration-org-bot-directory.ts";
import {
  closeCollaborationMemberGovernanceDrawer,
  isCollaborationArtifactPreviewOpen,
} from "./collaboration-stage-panel-coordination.ts";
import {
  countEmployeeWorkbenchNavAgents,
  countEmployeeWorkbenchOwnedSpaces,
  EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT,
  EMPLOYEE_WORKBENCH_COLLABORATION_SPACE_NAV_LIMIT,
} from "./employee-workbench-nav-quota.ts";
import { switchEmployeeWorkbenchSession } from "./render-actions.ts";
import {
  reloadEmployeeWorkbenchAgents,
  updateEmployeeWorkbenchSpaceMembers,
} from "./render-model-actions.ts";
import { emptyWorkbenchAgentDesignState } from "./views/workbench-design-card.ts";
import {
  buildRevisionFromTagDraft,
  findDesignRole,
  tagDraftFromMapping,
} from "./views/workbench-design-catalog.ts";
import {
  suggestAgentEmojiFromDesign,
  suggestAgentNameFromDesign,
} from "./views/workbench-design-labels.ts";
import type {
  WorkbenchAgentCreatorStep,
  WorkbenchAgentDesignState,
  WorkbenchCollaborationMemberGovernanceRosterEntry,
  WorkbenchCollaborationPendingBotInvite,
  WorkbenchCollaborationPendingHumanInvite,
  WorkbenchCreatorSelectionEntry,
  WorkbenchDesignTagDraft,
  WorkbenchProps,
} from "./views/workbench-types.ts";

type DesignGatewaySnapshot = {
  session: { id: string; status: string };
  mapping: WorkbenchAgentDesignState["mapping"];
  canConfirm: boolean;
  draft?: { validation?: { status?: string } };
  createRequest?: WorkbenchAgentDesignState["createRequest"];
};

function applyDesignGatewaySnapshot(
  state: AppPortState,
  previous: WorkbenchAgentDesignState,
  snapshot: DesignGatewaySnapshot | null,
  options?: { preserveTagDraft?: boolean },
): void {
  if (!snapshot) {
    state.workbenchAgentCreatorDesign = { ...previous, busy: false };
    state.requestUpdate?.();
    return;
  }
  const nextMapping = snapshot.mapping ?? previous.mapping;
  const nextTagDraft = options?.preserveTagDraft
    ? (previous.tagDraft ?? (nextMapping ? tagDraftFromMapping(nextMapping) : null))
    : nextMapping
      ? tagDraftFromMapping(nextMapping)
      : null;
  state.workbenchAgentCreatorDesign = {
    ...previous,
    busy: false,
    sessionId: snapshot.session.id,
    sessionStatus: snapshot.session.status,
    mapping: nextMapping,
    tagDraft: nextTagDraft,
    canConfirm: snapshot.canConfirm,
    confirmed: snapshot.session.status === "CONFIRMED",
    validationStatus: snapshot.draft?.validation?.status ?? previous.validationStatus,
    createRequest: snapshot.createRequest ?? null,
  };
  state.workbenchAgentCreatorRoleSource = "ai";
  if (snapshot.session.status === "CONFIRMED") {
    state.workbenchAgentCreatorStep = "identity";
    const mapping = snapshot.mapping ?? previous.mapping;
    if (!normalizeCreatorText(state.workbenchAgentCreatorName)) {
      const taggedRole = previous.tagDraft ? findDesignRole(previous.tagDraft.roleId) : undefined;
      const suggested =
        taggedRole?.label ??
        suggestAgentNameFromDesign(
          mapping,
          previous.intentText,
          state.workbenchAgentCreatorTemplates ?? [],
        );
      if (suggested) {
        state.workbenchAgentCreatorName = suggested;
      }
    }
    if (!normalizeCreatorText(state.workbenchAgentCreatorEmoji)) {
      state.workbenchAgentCreatorEmoji = suggestAgentEmojiFromDesign(mapping);
    }
  } else if (snapshot.mapping) {
    state.workbenchAgentCreatorStep = "review";
  }
  state.requestUpdate?.();
}

function normalizeCreatorText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function resolveSelfPendingHumanInvite(
  state: AppPortState,
): WorkbenchCollaborationPendingHumanInvite | null {
  const identities = new Set(
    [
      state.platformAuthState?.employeeAccess?.employeeUserId,
      state.hello?.auth?.provider === "trusted-proxy" ? state.hello.auth.user : null,
      state.platformAuthState?.session?.user,
      state.platformAuthState?.session?.email,
      state.bootstrapAuthSession?.user,
      state.bootstrapAuthSession?.email,
    ]
      .map((value) => value?.trim().toLowerCase() ?? "")
      .filter(Boolean),
  );
  return (
    (state.workbenchMemberGovernancePendingInvites ?? []).find((entry) => {
      const id = entry.intentId
        .replace(/^invite:|^draft:/, "")
        .trim()
        .toLowerCase();
      return Boolean(id && identities.has(id));
    }) ?? null
  );
}

function hashAsciiSlug(rawName: string): string {
  let hash = 2166136261;
  for (let i = 0; i < rawName.length; i += 1) {
    hash ^= rawName.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `n${(hash >>> 0).toString(36).slice(0, 10)}`;
}

function deriveAgentSlug(
  rawName: string,
  normalizeInternalKeySegment: (value: string | null | undefined) => string,
  deriveWorkspaceGroupId: (value: string) => string,
): string {
  const asciiSlug = normalizeInternalKeySegment(rawName);
  if (asciiSlug) {
    return asciiSlug;
  }
  const readableAscii = deriveWorkspaceGroupId(rawName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (readableAscii) {
    return readableAscii;
  }
  return hashAsciiSlug(rawName.trim().toLowerCase());
}

function upsertWorkbenchAgent(state: AppPortState, agent: GatewayAgentRow) {
  const current = state.agentsList;
  if (!current) {
    return;
  }
  const existingIndex = current.agents.findIndex((entry) => entry.id === agent.id);
  const nextAgents =
    existingIndex >= 0
      ? current.agents.map((entry, index) =>
          index === existingIndex ? { ...entry, ...agent } : entry,
        )
      : [...current.agents, agent];
  state.agentsList = {
    ...current,
    agents: nextAgents,
  };
}

function upsertWorkbenchSpace(
  state: AppPortState,
  space: CollaborationSpaceSnapshotTransport | null | undefined,
) {
  if (!space?.id) {
    return;
  }
  const currentSpaces = state.collaborationSpacesResult?.spaces ?? [];
  const existingIndex = currentSpaces.findIndex((entry) => entry?.id === space.id);
  const nextSpaces =
    existingIndex >= 0
      ? currentSpaces.map((entry, index) =>
          index === existingIndex ? { ...entry, ...space } : entry,
        )
      : [...currentSpaces, space];
  state.collaborationSpacesResult = {
    spaces: nextSpaces,
  };
}

function resetCloudWorkspaceDraft(state: AppPortState) {
  state.workbenchWorkspaceCloudGeneratedConfig = null;
  state.workbenchWorkspaceCloudConnectionState = "idle";
  state.workbenchWorkspaceCloudConnectionMessage = null;
  state.workbenchWorkspaceCloudCanRead = false;
  state.workbenchWorkspaceCloudCanWrite = false;
  state.workbenchWorkspaceCloudBrowserError = null;
  state.workbenchWorkspaceCloudBrowserCurrentPath = "";
  state.workbenchWorkspaceCloudBrowserParentPath = null;
  state.workbenchWorkspaceCloudBrowserEntries = [];
  state.workbenchWorkspaceCloudSelectedPath = "";
}

function clearLocalWorkspaceValidation(state: AppPortState) {
  state.workbenchAgentCreatorLocalValidationState = "idle";
  state.workbenchAgentCreatorLocalValidationMessage = null;
  state.workbenchAgentCreatorLocalResolvedPath = null;
  state.workbenchAgentCreatorLocalReadable = false;
  state.workbenchAgentCreatorLocalWritable = false;
}

function isRegionWorkspaceProvider(provider: WorkspaceCloudProvider) {
  return provider === "aliyun-oss" || provider === "aws-s3" || provider === "huawei-obs";
}

function isCustomEndpointWorkspaceProvider(provider: WorkspaceCloudProvider) {
  return provider === "s3-compatible";
}

function isAzureWorkspaceProvider(provider: WorkspaceCloudProvider) {
  return provider === "azure-blob";
}

function joinWorkspacePath(root: string, ...segments: string[]) {
  const separator = root.includes("\\") ? "\\" : "/";
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  const normalizedSegments = segments
    .map((segment) => segment.trim().replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter(Boolean);
  return [normalizedRoot, ...normalizedSegments].join(separator);
}

function resolveCloudCredentialId(state: AppPortState, provider: WorkspaceCloudProvider) {
  if (isAzureWorkspaceProvider(provider)) {
    return (state.workbenchWorkspaceCloudAccountName ?? "").trim();
  }
  return (state.workbenchWorkspaceCloudAccessKeyId ?? "").trim();
}

async function validateAgentCreatorLocalWorkspace(
  state: AppPortState,
  pathValue: string | null | undefined,
) {
  if (!state.client || !state.connected) {
    state.workbenchAgentCreatorLocalValidationState = "invalid";
    state.workbenchAgentCreatorLocalValidationMessage = "当前未连接到网关，无法校验本地空间。";
    state.workbenchAgentCreatorLocalResolvedPath = null;
    return null;
  }
  const path = pathValue?.trim();
  if (!path) {
    clearLocalWorkspaceValidation(state);
    return null;
  }
  state.workbenchAgentCreatorLocalValidationState = "validating";
  state.workbenchAgentCreatorLocalValidationMessage = null;
  try {
    const result = await state.client.request<WorkspaceLocalValidateResult | null>(
      "workspaces.local.validate",
      { path },
    );
    const ok = Boolean(result?.ok);
    state.workbenchAgentCreatorLocalValidationState = ok ? "valid" : "invalid";
    state.workbenchAgentCreatorLocalValidationMessage =
      result?.message ??
      (ok ? "目录可访问，可用于机器人运行。" : "无法访问该目录，请检查路径或权限。");
    state.workbenchAgentCreatorLocalResolvedPath = result?.resolvedPath ?? null;
    state.workbenchAgentCreatorLocalReadable = Boolean(result?.readable);
    state.workbenchAgentCreatorLocalWritable = Boolean(result?.writable);
    return result;
  } catch (error) {
    state.workbenchAgentCreatorLocalValidationState = "invalid";
    state.workbenchAgentCreatorLocalValidationMessage = String(error);
    state.workbenchAgentCreatorLocalResolvedPath = null;
    state.workbenchAgentCreatorLocalReadable = false;
    state.workbenchAgentCreatorLocalWritable = false;
    return null;
  }
}

async function loadAgentCreatorLocalBrowser(state: AppPortState, path?: string | null) {
  if (!state.client || !state.connected) {
    state.workbenchAgentCreatorLocalBrowserError = "当前未连接到网关，无法浏览本地目录。";
    return;
  }
  state.workbenchAgentCreatorLocalBrowserBusy = true;
  state.workbenchAgentCreatorLocalBrowserError = null;
  try {
    const result = await state.client.request<WorkspaceLocalBrowseResult | null>(
      "workspaces.local.browse",
      path ? { path } : {},
    );
    state.workbenchAgentCreatorLocalBrowserOpen = true;
    state.workbenchAgentCreatorLocalBrowserCurrentPath = result?.currentPath ?? "";
    state.workbenchAgentCreatorLocalBrowserParentPath = result?.parentPath ?? null;
    state.workbenchAgentCreatorLocalBrowserEntries = result?.entries ?? [];
  } catch (error) {
    state.workbenchAgentCreatorLocalBrowserError = String(error);
    state.workbenchAgentCreatorLocalBrowserOpen = true;
  } finally {
    state.workbenchAgentCreatorLocalBrowserBusy = false;
  }
}

function buildCloudWorkspaceParams(state: AppPortState) {
  const provider = state.workbenchWorkspaceCloudProvider ?? "aliyun-oss";
  return {
    provider,
    region: state.workbenchWorkspaceCloudRegion ?? "",
    bucket: state.workbenchWorkspaceCloudBucket ?? "",
    rootPrefix: state.workbenchWorkspaceCloudRootPrefix ?? "",
    endpoint: state.workbenchWorkspaceCloudEndpoint ?? "",
    accountName: state.workbenchWorkspaceCloudAccountName ?? "",
    accessKeyId: resolveCloudCredentialId(state, provider),
    secretAccessKey: state.workbenchWorkspaceCloudSecretAccessKey ?? "",
  } as const;
}

export async function generateAgentCreatorCloudConfig(state: AppPortState) {
  if (!state.client || !state.connected) {
    state.workbenchAgentCreatorError = "当前未连接到网关，无法生成云空间配置。";
    return null;
  }
  const params = buildCloudWorkspaceParams(state);
  const needsEndpoint = isCustomEndpointWorkspaceProvider(params.provider);
  const needsRegion = isRegionWorkspaceProvider(params.provider);
  const needsAccountName = isAzureWorkspaceProvider(params.provider);
  if (!params.bucket.trim()) {
    state.workbenchAgentCreatorError = "请先填写 Bucket。";
    return null;
  }
  if (needsRegion && !params.region.trim()) {
    state.workbenchAgentCreatorError = "请先填写 Region。";
    return null;
  }
  if (needsEndpoint && !params.endpoint.trim()) {
    state.workbenchAgentCreatorError = "请先填写 S3 Endpoint。";
    return null;
  }
  if (needsAccountName && !params.accountName.trim()) {
    state.workbenchAgentCreatorError = "请先填写存储账号名。";
    return null;
  }
  try {
    const generated = await state.client.request<WorkspaceCloudGeneratedConfig | null>(
      "workspaces.cloud.generate-config",
      {
        provider: params.provider,
        ...(params.region.trim() ? { region: params.region.trim() } : {}),
        bucket: params.bucket.trim(),
        rootPrefix: params.rootPrefix,
        ...(params.provider === "s3-compatible" && params.endpoint.trim()
          ? { endpoint: params.endpoint.trim() }
          : {}),
        ...(params.provider === "azure-blob" && params.accountName.trim()
          ? { accountName: params.accountName.trim() }
          : {}),
      },
    );
    state.workbenchWorkspaceCloudGeneratedConfig = generated;
    state.workbenchWorkspaceCloudEndpoint =
      generated?.endpoint ?? state.workbenchWorkspaceCloudEndpoint;
    state.workbenchWorkspaceCloudAccountName =
      generated?.accountName ?? state.workbenchWorkspaceCloudAccountName;
    state.workbenchAgentCreatorError = null;
    return generated;
  } catch (error) {
    state.workbenchAgentCreatorError = String(error);
    return null;
  }
}

export async function testAgentCreatorCloudConnection(state: AppPortState) {
  if (!state.client || !state.connected) {
    state.workbenchWorkspaceCloudConnectionState = "error";
    state.workbenchWorkspaceCloudConnectionMessage = "当前未连接到网关，无法测试云空间。";
    return null;
  }
  const generated =
    state.workbenchWorkspaceCloudGeneratedConfig ?? (await generateAgentCreatorCloudConfig(state));
  if (!generated) {
    return null;
  }
  const params = buildCloudWorkspaceParams(state);
  if (!params.accessKeyId.trim() || !params.secretAccessKey.trim()) {
    state.workbenchWorkspaceCloudConnectionState = "error";
    state.workbenchWorkspaceCloudConnectionMessage = "请先填写云端访问凭据。";
    return null;
  }
  state.workbenchWorkspaceCloudConnectionState = "testing";
  state.workbenchWorkspaceCloudConnectionMessage = null;
  try {
    const result = await state.client.request<WorkspaceCloudConnectionResult | null>(
      "workspaces.cloud.test-connection",
      {
        provider: params.provider,
        ...(generated.region ? { region: generated.region } : {}),
        bucket: generated.bucket,
        rootPrefix: generated.rootPrefix,
        endpoint: generated.endpoint,
        ...(generated.accountName ? { accountName: generated.accountName } : {}),
        accessKeyId: params.accessKeyId.trim(),
        secretAccessKey: params.secretAccessKey.trim(),
      },
    );
    state.workbenchWorkspaceCloudConnectionState = "success";
    state.workbenchWorkspaceCloudConnectionMessage = "已成功连接到云服务。";
    state.workbenchWorkspaceCloudCanRead = Boolean(result?.capabilities.canRead);
    state.workbenchWorkspaceCloudCanWrite = Boolean(result?.capabilities.canWrite);
    return result;
  } catch (error) {
    state.workbenchWorkspaceCloudConnectionState = "error";
    state.workbenchWorkspaceCloudConnectionMessage = String(error);
    state.workbenchWorkspaceCloudCanRead = false;
    state.workbenchWorkspaceCloudCanWrite = false;
    return null;
  }
}

async function loadAgentCreatorCloudBrowser(state: AppPortState, path?: string | null) {
  if (!state.client || !state.connected) {
    state.workbenchWorkspaceCloudBrowserError = "当前未连接到网关，无法浏览云端空间。";
    return;
  }
  const generated =
    state.workbenchWorkspaceCloudGeneratedConfig ?? (await generateAgentCreatorCloudConfig(state));
  if (!generated) {
    return;
  }
  if ((state.workbenchWorkspaceCloudConnectionState ?? "idle") !== "success") {
    const tested = await testAgentCreatorCloudConnection(state);
    if (!tested) {
      return;
    }
  }
  state.workbenchWorkspaceCloudBrowserBusy = true;
  state.workbenchWorkspaceCloudBrowserError = null;
  try {
    const result = await state.client.request<WorkspaceCloudBrowseResult | null>(
      "workspaces.cloud.browse",
      {
        provider: state.workbenchWorkspaceCloudProvider ?? "aliyun-oss",
        ...(generated.region ? { region: generated.region } : {}),
        bucket: generated.bucket,
        rootPrefix: generated.rootPrefix,
        endpoint: generated.endpoint,
        ...(generated.accountName ? { accountName: generated.accountName } : {}),
        accessKeyId: resolveCloudCredentialId(
          state,
          state.workbenchWorkspaceCloudProvider ?? "aliyun-oss",
        ),
        secretAccessKey: (state.workbenchWorkspaceCloudSecretAccessKey ?? "").trim(),
        ...(path?.trim() ? { path: path.trim() } : {}),
      },
    );
    state.workbenchWorkspaceCloudBrowserOpen = true;
    state.workbenchWorkspaceCloudBrowserCurrentPath = result?.currentPath ?? "";
    state.workbenchWorkspaceCloudBrowserParentPath = result?.parentPath ?? null;
    state.workbenchWorkspaceCloudBrowserEntries = result?.directories ?? [];
  } catch (error) {
    state.workbenchWorkspaceCloudBrowserError = String(error);
    state.workbenchWorkspaceCloudBrowserOpen = true;
  } finally {
    state.workbenchWorkspaceCloudBrowserBusy = false;
  }
}

type WorkbenchInteractionProps = Pick<
  WorkbenchProps,
  | "onOpenAgentCreator"
  | "onOpenSpaceCreator"
  | "agentCreator"
  | "spaceCreator"
  | "onCloseCreator"
  | "onAgentCreatorNameChange"
  | "onAgentCreatorEmojiChange"
  | "onAgentCreatorTemplateChange"
  | "onAgentCreatorWorkspaceKindChange"
  | "onAgentCreatorLocalPathChange"
  | "onValidateAgentCreatorLocalWorkspace"
  | "onOpenAgentCreatorLocalBrowser"
  | "onCloseAgentCreatorLocalBrowser"
  | "onNavigateAgentCreatorLocalBrowser"
  | "onSelectAgentCreatorLocalDirectory"
  | "onAgentCreatorCloudProviderChange"
  | "onAgentCreatorCloudRegionChange"
  | "onAgentCreatorCloudBucketChange"
  | "onAgentCreatorCloudRootPrefixChange"
  | "onAgentCreatorCloudEndpointChange"
  | "onAgentCreatorCloudAccountNameChange"
  | "onAgentCreatorCloudAccessKeyIdChange"
  | "onAgentCreatorCloudSecretAccessKeyChange"
  | "onGenerateAgentCreatorCloudConfig"
  | "onTestAgentCreatorCloudConnection"
  | "onOpenAgentCreatorCloudBrowser"
  | "onCloseAgentCreatorCloudBrowser"
  | "onNavigateAgentCreatorCloudBrowser"
  | "onSelectAgentCreatorCloudDirectory"
  | "onCreateAgent"
  | "onAgentCreatorDesignIntentChange"
  | "onAgentCreatorDesignRevisionChange"
  | "onAgentCreatorDesignTagDraftChange"
  | "onCompileAgentDesign"
  | "onReviseAgentDesign"
  | "onConfirmAgentDesign"
  | "onAgentCreatorWizardBack"
  | "onAgentCreatorUseTemplatePath"
  | "onAgentCreatorSelectStep"
  | "onSpaceCreatorTitleChange"
  | "onSpaceCreatorAvatarChange"
  | "onSpaceCreatorPurposeChange"
  | "onSpaceCreatorCurrentMissionChange"
  | "onSpaceCreatorSystemInstructionsChange"
  | "onSpaceCreatorGroupIdChange"
  | "onSpaceCreatorBack"
  | "onSpaceCreatorToggleHumanSelection"
  | "onSpaceCreatorToggleBotSelection"
  | "onSpaceCreatorCoordinatorChange"
  | "onCreateSpace"
  | "collaborationMemberGovernance"
  | "onMemberGovernancePromptChange"
  | "onMemberGovernanceParse"
  | "onMemberGovernanceOpenSelector"
  | "onMemberGovernanceSearchChange"
  | "onMemberGovernanceToggleHumanSelection"
  | "onMemberGovernanceToggleBotSelection"
  | "onMemberGovernanceCommitSelection"
  | "onMemberGovernanceInviteHuman"
  | "onMemberGovernanceInviteBot"
  | "onMemberGovernanceCancelInvite"
  | "onMemberGovernanceRemoveMember"
  | "onMemberGovernanceApproveBotInvite"
  | "onMemberGovernanceRejectBotInvite"
  | "onMemberGovernanceAcceptSelfInvite"
  | "onMemberGovernanceRejectSelfInvite"
  | "onMemberGovernanceReset"
  | "onOpenFilePreview"
>;

type BuildEmployeeWorkbenchInteractionPropsArgs = {
  state: AppPortState;
  collaborationMemberGovernance: WorkbenchProps["collaborationMemberGovernance"];
  closeCreator: () => void;
  ownedAgents: Array<{
    id: string;
    name?: string | null;
    identity?: { name?: string | null; emoji?: string | null } | null;
    scope?: string | null;
    shareStatus?: string | null;
  }>;
  resolveDefaultAgentWorkspace: (state: AppPortState, snapshot?: ConfigSnapshot | null) => string;
  deriveWorkspaceGroupId: (value: string) => string;
  normalizeValue: (value: string | null | undefined) => string | null;
  findLatestArtifactId: (messages: unknown[]) => string | null;
  buildMemberGovernanceDraftPrompt: (title: string, state: AppPortState) => string;
  persistMemberGovernanceState: (params: {
    currentHumans: WorkbenchCollaborationMemberGovernanceRosterEntry[];
    currentBots: WorkbenchCollaborationMemberGovernanceRosterEntry[];
    pendingHumanInvites: WorkbenchCollaborationPendingHumanInvite[];
    pendingBotInvites: WorkbenchCollaborationPendingBotInvite[];
    successMessage: string;
    keepHumanSelectorOpen?: boolean;
    keepBotSelectorOpen?: boolean;
    invitingHumanId?: string | null;
    invitingBotId?: string | null;
  }) => Promise<void>;
  resetMemberGovernanceState: () => Promise<void>;
  refreshMemberGovernanceSnapshot: () => void;
  spaceCreatorCandidates: {
    candidateHumans: WorkbenchCreatorSelectionEntry[];
    candidateBots: WorkbenchCreatorSelectionEntry[];
  };
};

export function buildEmployeeWorkbenchInteractionProps({
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
}: BuildEmployeeWorkbenchInteractionPropsArgs): WorkbenchInteractionProps {
  const isManagedWorkspace = () => {
    const config = state.configSnapshot?.config as
      | { data?: { mode?: string | null } | null }
      | null
      | undefined;
    return state.bootstrapDataSpace?.mode === "managed" || config?.data?.mode === "managed";
  };
  const managedWorkspaceRoot = "~/.openbot/workspace";
  const normalizeInternalKeySegment = (value: string | null | undefined) =>
    (normalizeValue(value) ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  // Enterprise create ownership intent — one coherent path, no cross-source mix:
  //   tenant/label ← platform session (fallback: bootstrap, then hello)
  //   owner user/seat ← employeeAccess only (same snapshot the gateway heals from)
  // Login email is used only for agent-id slug scoping, never as ownerUserId.
  const platformSession = state.platformAuthState?.session ?? state.bootstrapAuthSession;
  const helloAuth = state.hello?.auth?.provider === "trusted-proxy" ? state.hello.auth : null;
  const employeeAccess = state.platformAuthState?.employeeAccess;
  const currentTenantId =
    normalizeValue(platformSession?.tenantId) ?? normalizeValue(helloAuth?.tenantId) ?? "";
  const currentSeatId = normalizeValue(employeeAccess?.currentSeat?.seatId) ?? "";
  const currentSeatTitle = normalizeValue(employeeAccess?.currentSeat?.title) ?? "";
  const currentUserLabel =
    normalizeValue(platformSession?.displayName) ??
    normalizeValue(helloAuth?.displayName) ??
    normalizeValue(employeeAccess?.employeeUserId) ??
    "";
  const loginUserForSlug =
    normalizeValue(platformSession?.user) ?? normalizeValue(helloAuth?.user) ?? "";
  const ownerScope = normalizeInternalKeySegment(loginUserForSlug);
  const buildScopedEntityId = (kind: "agent" | "space", rawName: string) => {
    const normalizedSlug = normalizeInternalKeySegment(rawName);
    const nameSlug =
      kind === "space"
        ? normalizedSlug || deriveWorkspaceGroupId(rawName)
        : deriveAgentSlug(rawName, normalizeInternalKeySegment, deriveWorkspaceGroupId);
    if (!ownerScope) {
      return nameSlug;
    }
    const prefix = kind === "agent" ? "agt" : "grp";
    return `${prefix}-${ownerScope}-${nameSlug}`;
  };
  return {
    onOpenAgentCreator: () => {
      void (async () => {
        let configSnapshot: ConfigSnapshot | null = null;
        if (!state.workbenchAgentCreatorLocalPath && state.client && state.connected) {
          try {
            configSnapshot = await state.client.request<ConfigSnapshot>("config.get", {});
            if (configSnapshot) {
              state.configSnapshot = configSnapshot;
            }
          } catch {
            configSnapshot = null;
          }
        }
        state.workbenchAgentCreatorName = "";
        state.workbenchAgentCreatorEmoji = "";
        state.workbenchAgentCreatorDesign = emptyWorkbenchAgentDesignState();
        state.workbenchAgentCreatorStep = "intent";
        state.workbenchAgentCreatorRoleSource = "ai";
        state.workbenchAgentCreatorTemplateId = "";
        state.workbenchAgentCreatorTemplates = [];
        state.workbenchAgentCreatorTemplatesLoading = Boolean(state.client && state.connected);
        state.workbenchAgentCreatorWorkspaceKind = "local";
        const managedWorkspace =
          state.bootstrapDataSpace?.mode === "managed" ||
          (configSnapshot?.config as { data?: { mode?: string | null } } | null | undefined)?.data
            ?.mode === "managed" ||
          isManagedWorkspace();
        state.workbenchAgentCreatorLocalPath = managedWorkspace
          ? managedWorkspaceRoot
          : resolveDefaultAgentWorkspace(state, configSnapshot);
        clearLocalWorkspaceValidation(state);
        state.workbenchAgentCreatorBusy = false;
        state.workbenchAgentCreatorError = null;
        state.workbenchAgentCreatorLocalBrowserOpen = false;
        state.workbenchAgentCreatorLocalBrowserBusy = false;
        state.workbenchAgentCreatorLocalBrowserError = null;
        state.workbenchAgentCreatorLocalBrowserCurrentPath = "";
        state.workbenchAgentCreatorLocalBrowserParentPath = null;
        state.workbenchAgentCreatorLocalBrowserEntries = [];
        state.workbenchWorkspaceCloudProvider = "aliyun-oss";
        state.workbenchWorkspaceCloudRegion = "";
        state.workbenchWorkspaceCloudBucket = "";
        state.workbenchWorkspaceCloudRootPrefix = "";
        state.workbenchWorkspaceCloudEndpoint = "";
        state.workbenchWorkspaceCloudAccountName = "";
        state.workbenchWorkspaceCloudAccessKeyId = "";
        state.workbenchWorkspaceCloudSecretAccessKey = "";
        state.workbenchWorkspaceCloudBrowserOpen = false;
        state.workbenchWorkspaceCloudBrowserBusy = false;
        resetCloudWorkspaceDraft(state);
        state.workbenchAgentCreatorOpen = true;
        state.workbenchSpaceCreatorOpen = false;
        if (state.workbenchAgentCreatorLocalPath && !managedWorkspace) {
          void validateAgentCreatorLocalWorkspace(state, state.workbenchAgentCreatorLocalPath);
        }
        if (state.client && state.connected) {
          const templates = await listAgentTemplates(state);
          state.workbenchAgentCreatorTemplates = templates;
          state.workbenchAgentCreatorTemplatesLoading = false;
          const preferred =
            templates.find((entry) => entry.templateId === "generic_worker") ?? templates[0];
          if (preferred) {
            state.workbenchAgentCreatorTemplateId = preferred.templateId;
          }
        } else {
          state.workbenchAgentCreatorTemplatesLoading = false;
        }
      })();
    },
    onOpenSpaceCreator: () => {
      state.workbenchSpaceCreatorTitle = "";
      state.workbenchSpaceCreatorAvatar = "🛰️";
      state.workbenchSpaceCreatorPurpose = "";
      state.workbenchSpaceCreatorCurrentMission = "";
      state.workbenchSpaceCreatorSystemInstructions = "";
      state.workbenchSpaceCreatorGroupId = "";
      state.workbenchSpaceCreatorGroupIdTouched = false;
      state.workbenchSpaceCreatorBusy = false;
      state.workbenchSpaceCreatorError = null;
      state.workbenchSpaceCreatorStep = "details";
      state.workbenchSpaceCreatorSelectedHumanIds = [];
      state.workbenchSpaceCreatorSelectedBotIds = [];
      state.workbenchSpaceCreatorCoordinatorBotId = "";
      state.workbenchSpaceCreatorOpen = true;
      state.workbenchAgentCreatorOpen = false;
    },
    agentCreator: {
      open: Boolean(state.workbenchAgentCreatorOpen),
      busy: Boolean(state.workbenchAgentCreatorBusy),
      error: state.workbenchAgentCreatorError ?? null,
      name: state.workbenchAgentCreatorName ?? "",
      emoji: state.workbenchAgentCreatorEmoji ?? "",
      step: state.workbenchAgentCreatorStep ?? "intent",
      roleSource: state.workbenchAgentCreatorRoleSource ?? "ai",
      design: state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState(),
      templateId: state.workbenchAgentCreatorTemplateId ?? "",
      templates: state.workbenchAgentCreatorTemplates ?? [],
      templatesLoading: Boolean(state.workbenchAgentCreatorTemplatesLoading),
      managedWorkspace: isManagedWorkspace(),
      workspaceKind: state.workbenchAgentCreatorWorkspaceKind ?? "local",
      localPath: state.workbenchAgentCreatorLocalPath ?? "",
      localValidation: {
        state: state.workbenchAgentCreatorLocalValidationState ?? "idle",
        message: state.workbenchAgentCreatorLocalValidationMessage ?? null,
        resolvedPath: state.workbenchAgentCreatorLocalResolvedPath ?? null,
        readable: Boolean(state.workbenchAgentCreatorLocalReadable),
        writable: Boolean(state.workbenchAgentCreatorLocalWritable),
      },
      localDirectoryBrowser: {
        open: Boolean(state.workbenchAgentCreatorLocalBrowserOpen),
        busy: Boolean(state.workbenchAgentCreatorLocalBrowserBusy),
        error: state.workbenchAgentCreatorLocalBrowserError ?? null,
        currentPath: state.workbenchAgentCreatorLocalBrowserCurrentPath ?? "",
        parentPath: state.workbenchAgentCreatorLocalBrowserParentPath ?? null,
        entries: state.workbenchAgentCreatorLocalBrowserEntries ?? [],
      },
      cloudProvider: state.workbenchWorkspaceCloudProvider ?? "aliyun-oss",
      cloudRegion: state.workbenchWorkspaceCloudRegion ?? "",
      cloudBucket: state.workbenchWorkspaceCloudBucket ?? "",
      cloudRootPrefix: state.workbenchWorkspaceCloudRootPrefix ?? "",
      cloudEndpoint: state.workbenchWorkspaceCloudEndpoint ?? "",
      cloudAccountName: state.workbenchWorkspaceCloudAccountName ?? "",
      cloudAccessKeyId: state.workbenchWorkspaceCloudAccessKeyId ?? "",
      cloudSecretAccessKey: state.workbenchWorkspaceCloudSecretAccessKey ?? "",
      cloudGeneratedConfig: state.workbenchWorkspaceCloudGeneratedConfig
        ? { ...state.workbenchWorkspaceCloudGeneratedConfig }
        : null,
      cloudConnection: {
        state: state.workbenchWorkspaceCloudConnectionState ?? "idle",
        message: state.workbenchWorkspaceCloudConnectionMessage ?? null,
        canRead: Boolean(state.workbenchWorkspaceCloudCanRead),
        canWrite: Boolean(state.workbenchWorkspaceCloudCanWrite),
      },
      cloudDirectoryBrowser: {
        open: Boolean(state.workbenchWorkspaceCloudBrowserOpen),
        busy: Boolean(state.workbenchWorkspaceCloudBrowserBusy),
        error: state.workbenchWorkspaceCloudBrowserError ?? null,
        currentPath: state.workbenchWorkspaceCloudBrowserCurrentPath ?? "",
        parentPath: state.workbenchWorkspaceCloudBrowserParentPath ?? null,
        entries: state.workbenchWorkspaceCloudBrowserEntries ?? [],
      },
      cloudSelectedPath: state.workbenchWorkspaceCloudSelectedPath ?? "",
    },
    spaceCreator: {
      open: Boolean(state.workbenchSpaceCreatorOpen),
      busy: Boolean(state.workbenchSpaceCreatorBusy),
      error: state.workbenchSpaceCreatorError ?? null,
      title: state.workbenchSpaceCreatorTitle ?? "",
      avatar: state.workbenchSpaceCreatorAvatar ?? "🛰️",
      purpose: state.workbenchSpaceCreatorPurpose ?? "",
      currentMission: state.workbenchSpaceCreatorCurrentMission ?? "",
      systemInstructions: state.workbenchSpaceCreatorSystemInstructions ?? "",
      groupId: state.workbenchSpaceCreatorGroupId ?? "",
      step: state.workbenchSpaceCreatorStep ?? "details",
      candidateHumans: spaceCreatorCandidates.candidateHumans,
      candidateBots: spaceCreatorCandidates.candidateBots,
      selectedHumanIds: state.workbenchSpaceCreatorSelectedHumanIds ?? [],
      selectedBotIds: state.workbenchSpaceCreatorSelectedBotIds ?? [],
      coordinatorBotId: state.workbenchSpaceCreatorCoordinatorBotId ?? "",
    },
    onCloseCreator: closeCreator,
    onAgentCreatorDesignIntentChange: (value) => {
      const current = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      state.workbenchAgentCreatorDesign = { ...current, intentText: value };
      state.workbenchAgentCreatorError = null;
    },
    onAgentCreatorDesignRevisionChange: (value) => {
      const current = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      state.workbenchAgentCreatorDesign = { ...current, revisionText: value };
    },
    onAgentCreatorDesignTagDraftChange: (draft: WorkbenchDesignTagDraft) => {
      const current = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      state.workbenchAgentCreatorDesign = { ...current, tagDraft: draft };
      state.workbenchAgentCreatorError = null;
    },
    onCompileAgentDesign: async () => {
      const current = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      if (!current.intentText.trim() || !state.client || !state.connected) {
        state.workbenchAgentCreatorError = "请先描述你想要的数字员工，并保持网关已连接。";
        state.requestUpdate?.();
        return;
      }
      state.workbenchAgentCreatorDesign = { ...current, busy: true };
      state.workbenchAgentCreatorError = null;
      state.requestUpdate?.();
      try {
        const snapshot = await state.client.request<DesignGatewaySnapshot>(
          "digitalEmployee.design.compile",
          { rawRequest: current.intentText.trim() },
        );
        applyDesignGatewaySnapshot(state, current, snapshot);
      } catch (error) {
        state.workbenchAgentCreatorError = String(error);
        state.workbenchAgentCreatorDesign = { ...current, busy: false };
        state.requestUpdate?.();
      }
    },
    onReviseAgentDesign: async () => {
      const current = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      if (!current.sessionId || !current.revisionText.trim() || !state.client) {
        return;
      }
      state.workbenchAgentCreatorDesign = { ...current, busy: true };
      state.requestUpdate?.();
      try {
        const snapshot = await state.client.request<DesignGatewaySnapshot>(
          "digitalEmployee.design.revise",
          { sessionId: current.sessionId, rawRevision: current.revisionText.trim() },
        );
        applyDesignGatewaySnapshot(state, { ...current, revisionText: "" }, snapshot);
      } catch (error) {
        state.workbenchAgentCreatorError = String(error);
        state.workbenchAgentCreatorDesign = { ...current, busy: false };
        state.requestUpdate?.();
      }
    },
    onConfirmAgentDesign: async () => {
      const current = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      if (!current.sessionId || !state.client) {
        return;
      }
      state.workbenchAgentCreatorDesign = { ...current, busy: true };
      state.requestUpdate?.();
      try {
        const revision = buildRevisionFromTagDraft(current);
        let latest = current;
        if (revision) {
          const revised = await state.client.request<DesignGatewaySnapshot>(
            "digitalEmployee.design.revise",
            { sessionId: current.sessionId, rawRevision: revision },
          );
          applyDesignGatewaySnapshot(state, current, revised, { preserveTagDraft: true });
          latest = state.workbenchAgentCreatorDesign ?? current;
        }
        const snapshot = await state.client.request<DesignGatewaySnapshot>(
          "digitalEmployee.design.confirm",
          { sessionId: latest.sessionId ?? current.sessionId },
        );
        applyDesignGatewaySnapshot(state, latest, snapshot, { preserveTagDraft: true });
      } catch (error) {
        state.workbenchAgentCreatorError = String(error);
        state.workbenchAgentCreatorDesign = { ...current, busy: false };
        state.requestUpdate?.();
      }
    },
    onAgentCreatorWizardBack: () => {
      const current = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      const step = state.workbenchAgentCreatorStep ?? "intent";
      const roleSource = state.workbenchAgentCreatorRoleSource ?? "ai";
      if (step === "identity" && roleSource === "ai" && current.mapping) {
        state.workbenchAgentCreatorStep = "review";
      } else if (step === "identity" || step === "review") {
        state.workbenchAgentCreatorStep = "intent";
      }
      state.workbenchAgentCreatorError = null;
    },
    onAgentCreatorUseTemplatePath: () => {
      const current = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      state.workbenchAgentCreatorRoleSource = "template";
      state.workbenchAgentCreatorStep = "identity";
      state.workbenchAgentCreatorDesign = {
        ...emptyWorkbenchAgentDesignState(),
        intentText: current.intentText,
      };
      state.workbenchAgentCreatorError = null;
    },
    onAgentCreatorSelectStep: (step: WorkbenchAgentCreatorStep) => {
      const current = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      const roleSource = state.workbenchAgentCreatorRoleSource ?? "ai";
      if (step === "review" && (roleSource !== "ai" || !current.mapping)) {
        return;
      }
      if (step === "identity" && roleSource === "ai" && (!current.mapping || !current.confirmed)) {
        return;
      }
      state.workbenchAgentCreatorStep = step;
      state.workbenchAgentCreatorError = null;
    },
    onAgentCreatorNameChange: (value) => {
      state.workbenchAgentCreatorName = value;
      state.workbenchAgentCreatorError = null;
    },
    onAgentCreatorEmojiChange: (value) => {
      state.workbenchAgentCreatorEmoji = value;
      state.workbenchAgentCreatorError = null;
    },
    onAgentCreatorTemplateChange: (value) => {
      state.workbenchAgentCreatorTemplateId = value;
      state.workbenchAgentCreatorError = null;
    },
    onAgentCreatorWorkspaceKindChange: (value) => {
      state.workbenchAgentCreatorWorkspaceKind = value;
      state.workbenchAgentCreatorError = null;
    },
    onAgentCreatorLocalPathChange: (value) => {
      state.workbenchAgentCreatorLocalPath = value;
      state.workbenchAgentCreatorError = null;
      clearLocalWorkspaceValidation(state);
    },
    onValidateAgentCreatorLocalWorkspace: async () => {
      await validateAgentCreatorLocalWorkspace(state, state.workbenchAgentCreatorLocalPath);
    },
    onOpenAgentCreatorLocalBrowser: async () => {
      await loadAgentCreatorLocalBrowser(
        state,
        normalizeValue(state.workbenchAgentCreatorLocalPath),
      );
    },
    onCloseAgentCreatorLocalBrowser: () => {
      state.workbenchAgentCreatorLocalBrowserOpen = false;
      state.workbenchAgentCreatorLocalBrowserError = null;
    },
    onNavigateAgentCreatorLocalBrowser: async (path) => {
      await loadAgentCreatorLocalBrowser(state, path);
    },
    onSelectAgentCreatorLocalDirectory: (path) => {
      state.workbenchAgentCreatorLocalPath = path;
      state.workbenchAgentCreatorError = null;
      state.workbenchAgentCreatorLocalBrowserOpen = false;
      void validateAgentCreatorLocalWorkspace(state, path);
    },
    onAgentCreatorCloudProviderChange: (value) => {
      state.workbenchWorkspaceCloudProvider = value;
      if (!isRegionWorkspaceProvider(value)) {
        state.workbenchWorkspaceCloudRegion = "";
      }
      if (!isCustomEndpointWorkspaceProvider(value)) {
        state.workbenchWorkspaceCloudEndpoint = "";
      }
      if (!isAzureWorkspaceProvider(value)) {
        state.workbenchWorkspaceCloudAccountName = "";
      }
      state.workbenchAgentCreatorError = null;
      resetCloudWorkspaceDraft(state);
    },
    onAgentCreatorCloudRegionChange: (value) => {
      state.workbenchWorkspaceCloudRegion = value;
      state.workbenchAgentCreatorError = null;
      resetCloudWorkspaceDraft(state);
    },
    onAgentCreatorCloudBucketChange: (value) => {
      state.workbenchWorkspaceCloudBucket = value;
      state.workbenchAgentCreatorError = null;
      resetCloudWorkspaceDraft(state);
    },
    onAgentCreatorCloudRootPrefixChange: (value) => {
      state.workbenchWorkspaceCloudRootPrefix = value;
      state.workbenchAgentCreatorError = null;
      resetCloudWorkspaceDraft(state);
    },
    onAgentCreatorCloudEndpointChange: (value) => {
      state.workbenchWorkspaceCloudEndpoint = value;
      state.workbenchAgentCreatorError = null;
      resetCloudWorkspaceDraft(state);
    },
    onAgentCreatorCloudAccountNameChange: (value) => {
      state.workbenchWorkspaceCloudAccountName = value;
      state.workbenchAgentCreatorError = null;
      resetCloudWorkspaceDraft(state);
    },
    onAgentCreatorCloudAccessKeyIdChange: (value) => {
      state.workbenchWorkspaceCloudAccessKeyId = value;
      state.workbenchAgentCreatorError = null;
      resetCloudWorkspaceDraft(state);
    },
    onAgentCreatorCloudSecretAccessKeyChange: (value) => {
      state.workbenchWorkspaceCloudSecretAccessKey = value;
      state.workbenchAgentCreatorError = null;
      resetCloudWorkspaceDraft(state);
    },
    onGenerateAgentCreatorCloudConfig: async () => {
      await generateAgentCreatorCloudConfig(state);
    },
    onTestAgentCreatorCloudConnection: async () => {
      await testAgentCreatorCloudConnection(state);
    },
    onOpenAgentCreatorCloudBrowser: async () => {
      await loadAgentCreatorCloudBrowser(
        state,
        normalizeValue(state.workbenchWorkspaceCloudSelectedPath) ??
          normalizeValue(state.workbenchWorkspaceCloudRootPrefix),
      );
    },
    onCloseAgentCreatorCloudBrowser: () => {
      state.workbenchWorkspaceCloudBrowserOpen = false;
      state.workbenchWorkspaceCloudBrowserError = null;
    },
    onNavigateAgentCreatorCloudBrowser: async (path) => {
      await loadAgentCreatorCloudBrowser(state, path);
    },
    onSelectAgentCreatorCloudDirectory: (path) => {
      state.workbenchWorkspaceCloudSelectedPath = path;
      state.workbenchWorkspaceCloudRootPrefix = path;
      if (state.workbenchWorkspaceCloudGeneratedConfig) {
        state.workbenchWorkspaceCloudGeneratedConfig = {
          ...state.workbenchWorkspaceCloudGeneratedConfig,
          rootPrefix: path,
        };
      }
      state.workbenchWorkspaceCloudBrowserOpen = false;
      state.workbenchAgentCreatorError = null;
    },
    onCreateAgent: async () => {
      const name = normalizeValue(state.workbenchAgentCreatorName);
      const emoji = normalizeValue(state.workbenchAgentCreatorEmoji);
      const design = state.workbenchAgentCreatorDesign ?? emptyWorkbenchAgentDesignState();
      if (design.mapping && !design.confirmed) {
        state.workbenchAgentCreatorError = "请先确认设计，再创建机器人。";
        return;
      }
      if (!name) {
        state.workbenchAgentCreatorError = "请先填写机器人名称。";
        return;
      }
      if (!state.client || !state.connected) {
        state.workbenchAgentCreatorError = "当前未连接到网关，无法创建机器人。";
        return;
      }
      const platformRole = state.platformAuthState?.platformRole;
      const bypassAgentCreateCap =
        isPlatformAdminSessionKind(state.platformAuthState?.sessionKind) ||
        platformRole === "admin" ||
        platformRole === "super-admin";
      const creatableAgentCount = countEmployeeWorkbenchNavAgents(ownedAgents);
      if (!bypassAgentCreateCap && creatableAgentCount >= EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT) {
        state.workbenchAgentCreatorError = `每位成员最多可创建 ${EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT} 个 AI 助手（不含大白管家）。`;
        return;
      }
      const agentId = buildScopedEntityId("agent", name);
      const duplicateOwnedAgent = ownedAgents.find(
        (entry) =>
          normalizeValue(entry.name) === name || normalizeValue(entry.identity?.name) === name,
      );
      if (duplicateOwnedAgent) {
        const duplicateLabel =
          normalizeValue(duplicateOwnedAgent.identity?.name) ??
          normalizeValue(duplicateOwnedAgent.name) ??
          duplicateOwnedAgent.id;
        state.workbenchAgentCreatorError = `你已创建过同名机器人「${duplicateLabel}」，请直接复用或修改名称。`;
        return;
      }
      if (agentId && ownedAgents.some((entry) => entry.id === agentId)) {
        state.workbenchAgentCreatorError = "该名称生成的机器人 ID 已被占用，请修改名称后重试。";
        return;
      }
      if (currentTenantId && state.platformAuthState?.employeeAccess && !currentSeatId) {
        if (state.platformAuthState.employeeAccess.pendingOffer) {
          closeCreator();
          state.workbenchPrimaryModule = "settings";
          state.workbenchSettingsView = "personal";
          state.workbenchPersonalSettingsTab = "account";
          return;
        }
        state.workbenchAgentCreatorError =
          "当前账号尚未绑定企业岗位，请联系企业管理员分配岗位后再创建 AI 助手。";
        return;
      }
      state.workbenchAgentCreatorBusy = true;
      state.workbenchAgentCreatorError = null;
      try {
        let workspaceId: string | null = null;
        let runtimePath: string | null = null;
        if ((state.workbenchAgentCreatorWorkspaceKind ?? "local") === "local") {
          const managedWorkspace = isManagedWorkspace();
          const workspaceRoot = managedWorkspace
            ? managedWorkspaceRoot
            : state.workbenchAgentCreatorLocalPath;
          const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
          if (!normalizedWorkspaceRoot) {
            state.workbenchAgentCreatorError = "请先在个人设置中配置 OpenBot 工作空间根目录。";
            return;
          }
          const validation: WorkspaceLocalValidateResult | null = managedWorkspace
            ? {
                ok: true,
                resolvedPath: normalizedWorkspaceRoot,
                isDirectory: true,
                readable: true,
                writable: true,
              }
            : ((await validateAgentCreatorLocalWorkspace(state, normalizedWorkspaceRoot)) ?? null);
          if (!validation?.ok) {
            state.workbenchAgentCreatorError =
              validation?.message ??
              "OpenBot 工作空间根目录不可用，请先在个人设置中检查路径或权限。";
            return;
          }
          const allocatedRuntimePath = joinWorkspacePath(
            validation.resolvedPath,
            "agents",
            agentId ||
              deriveAgentSlug(name, normalizeInternalKeySegment, deriveWorkspaceGroupId) ||
              "agent",
          );
          const createdWorkspace = await state.client.request<WorkspacesCreateResult | null>(
            "workspaces.create",
            {
              name: `${name} Workspace`,
              kind: "local",
              local: {
                path: allocatedRuntimePath,
              },
            },
          );
          workspaceId = createdWorkspace?.workspaceId ?? null;
          runtimePath = createdWorkspace?.runtimePath ?? allocatedRuntimePath;
        } else {
          const generated =
            state.workbenchWorkspaceCloudGeneratedConfig ??
            (await generateAgentCreatorCloudConfig(state));
          if (!generated) {
            return;
          }
          if ((state.workbenchWorkspaceCloudConnectionState ?? "idle") !== "success") {
            const tested = await testAgentCreatorCloudConnection(state);
            if (!tested) {
              return;
            }
          }
          const selectedCloudPath =
            normalizeValue(state.workbenchWorkspaceCloudSelectedPath) ??
            normalizeValue(state.workbenchWorkspaceCloudRootPrefix);
          if (!selectedCloudPath) {
            state.workbenchAgentCreatorError = "请先选择云端空间路径。";
            return;
          }
          const createdWorkspace = await state.client.request<WorkspacesCreateResult | null>(
            "workspaces.create",
            {
              name: `${name} Workspace`,
              kind: "cloud",
              cloud: {
                provider: state.workbenchWorkspaceCloudProvider ?? "aliyun-oss",
                ...(generated.region ? { region: generated.region } : {}),
                bucket: generated.bucket,
                rootPrefix: selectedCloudPath,
                endpoint: generated.endpoint,
                ...(generated.accountName ? { accountName: generated.accountName } : {}),
              },
              credentials: {
                accessKeyId: resolveCloudCredentialId(
                  state,
                  state.workbenchWorkspaceCloudProvider ?? "aliyun-oss",
                ),
                secretAccessKey: state.workbenchWorkspaceCloudSecretAccessKey ?? "",
              },
            },
          );
          workspaceId = createdWorkspace?.workspaceId ?? null;
          runtimePath = createdWorkspace?.runtimePath ?? null;
        }
        if (!runtimePath) {
          state.workbenchAgentCreatorError = "Workspace 创建成功前，无法生成机器人运行目录。";
          return;
        }
        const created = await state.client.request<{
          agentId?: string | null;
          name?: string | null;
        } | null>("agents.create", {
          name,
          ...(agentId ? { agentId } : {}),
          workspace: runtimePath,
          ...(emoji ? { emoji } : {}),
          ...(design.confirmed
            ? {
                skipCapabilityAutoInstall: true,
                ...(design.createRequest?.blueprintId
                  ? { blueprintId: design.createRequest.blueprintId }
                  : {}),
                ...(design.createRequest?.blueprintVersion
                  ? { blueprintVersion: design.createRequest.blueprintVersion }
                  : {}),
              }
            : {}),
          ...(AGENT_CREATE_SUPPORTS_TEMPLATE_ID &&
          normalizeValue(state.workbenchAgentCreatorTemplateId) &&
          !design.confirmed
            ? { templateId: normalizeValue(state.workbenchAgentCreatorTemplateId) }
            : {}),
          ...(currentTenantId ? { tenantId: currentTenantId } : {}),
          // Do NOT send ownerUserId. Request-body owner is intent-only and the
          // gateway always binds ownership to the authenticated session actor.
          // Stale employeeAccess.employeeUserId (e.g. previous account still in
          // UI state) was causing OWNER_ACTOR_MISMATCH for valid employee creates.
          ...(currentUserLabel ? { ownerUserLabel: currentUserLabel } : {}),
          ...(currentSeatId ? { ownerPositionId: currentSeatId } : {}),
          ...(currentSeatTitle ? { ownerPositionLabel: currentSeatTitle } : {}),
        });
        const createdAgentId = normalizeValue(created?.agentId);
        let createdPartial = false;
        if (createdAgentId && design.confirmed && design.sessionId) {
          const finished = await state.client.request<{
            session?: { status?: string };
            skillInstall?: { failed?: Array<{ skillKey: string }> };
          } | null>("digitalEmployee.design.instantiate", {
            sessionId: design.sessionId,
            agentId: createdAgentId,
          });
          if (finished?.session?.status === "PARTIAL") {
            createdPartial = true;
            const failed = finished.skillInstall?.failed?.map((item) => item.skillKey).join("、");
            state.workbenchAgentCreatorError = failed
              ? `机器人已创建，部分能力待配置：${failed}`
              : "机器人已创建，部分能力待配置。";
          }
        }
        if (createdAgentId && workspaceId) {
          await state.client.request("robots.bind-workspace", {
            agentId: createdAgentId,
            workspaceId,
          });
        }
        await reloadEmployeeWorkbenchAgents(state);
        if (createdAgentId) {
          const ownerId =
            normalizeValue(state.platformAuthState?.employeeAccess?.employeeUserId) ||
            normalizeValue(state.platformAuthState?.session?.user) ||
            undefined;
          upsertWorkbenchAgent(state, {
            id: createdAgentId,
            name: created?.name ?? name,
            ...(ownerId ? { ownerId } : {}),
            scope: "self",
            identity: emoji
              ? {
                  name: created?.name ?? name,
                  emoji,
                }
              : {
                  name: created?.name ?? name,
                },
          } satisfies GatewayAgentRow);
        }
        if (!createdPartial) {
          closeCreator();
        }
        if (createdAgentId) {
          const sessionKey = `agent:${createdAgentId}:main`;
          state.workbenchTeamSelectedKey = sessionKey;
          switchEmployeeWorkbenchSession(state, sessionKey, "assistant");
        }
      } catch (error) {
        state.workbenchAgentCreatorError = formatEmployeeAgentCreateError(error);
      } finally {
        state.workbenchAgentCreatorBusy = false;
      }
    },
    onSpaceCreatorTitleChange: (value) => {
      state.workbenchSpaceCreatorTitle = value;
      if (!state.workbenchSpaceCreatorGroupIdTouched) {
        state.workbenchSpaceCreatorGroupId = deriveWorkspaceGroupId(value);
      }
      state.workbenchSpaceCreatorError = null;
    },
    onSpaceCreatorAvatarChange: (value) => {
      state.workbenchSpaceCreatorAvatar = value;
      state.workbenchSpaceCreatorError = null;
    },
    onSpaceCreatorPurposeChange: (value) => {
      state.workbenchSpaceCreatorPurpose = value;
      state.workbenchSpaceCreatorError = null;
    },
    onSpaceCreatorCurrentMissionChange: (value) => {
      state.workbenchSpaceCreatorCurrentMission = value;
      state.workbenchSpaceCreatorError = null;
    },
    onSpaceCreatorSystemInstructionsChange: (value) => {
      state.workbenchSpaceCreatorSystemInstructions = value;
      state.workbenchSpaceCreatorError = null;
    },
    onSpaceCreatorGroupIdChange: (value) => {
      state.workbenchSpaceCreatorGroupId = value;
      state.workbenchSpaceCreatorGroupIdTouched = true;
      state.workbenchSpaceCreatorError = null;
    },
    onSpaceCreatorBack: () => {
      state.workbenchSpaceCreatorStep = "details";
      state.workbenchSpaceCreatorError = null;
    },
    onSpaceCreatorToggleHumanSelection: (id) => {
      const selectedIds = new Set(state.workbenchSpaceCreatorSelectedHumanIds ?? []);
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }
      state.workbenchSpaceCreatorSelectedHumanIds = [...selectedIds];
    },
    onSpaceCreatorToggleBotSelection: (id) => {
      const selectedIds = new Set(state.workbenchSpaceCreatorSelectedBotIds ?? []);
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }
      state.workbenchSpaceCreatorSelectedBotIds = [...selectedIds];
      const coordinatorId = state.workbenchSpaceCreatorCoordinatorBotId?.trim() ?? "";
      if (coordinatorId && !selectedIds.has(coordinatorId)) {
        state.workbenchSpaceCreatorCoordinatorBotId = "";
      }
    },
    onSpaceCreatorCoordinatorChange: (value: string) => {
      const selectedIds = new Set(state.workbenchSpaceCreatorSelectedBotIds ?? []);
      const next = value.trim();
      state.workbenchSpaceCreatorCoordinatorBotId = next && selectedIds.has(next) ? next : "";
    },
    onCreateSpace: async () => {
      const title = normalizeValue(state.workbenchSpaceCreatorTitle);
      const avatar = normalizeValue(state.workbenchSpaceCreatorAvatar) ?? "🛰️";
      const purpose = normalizeValue(state.workbenchSpaceCreatorPurpose);
      const currentMission = normalizeValue(state.workbenchSpaceCreatorCurrentMission);
      const systemInstructions = (state.workbenchSpaceCreatorSystemInstructions ?? "")
        .split(/\r?\n+/)
        .map((value) => normalizeValue(value))
        .filter(Boolean) as string[];
      const groupId = buildScopedEntityId("space", state.workbenchSpaceCreatorTitle ?? "");
      if (!title) {
        state.workbenchSpaceCreatorError = "请先填写协作小组名称。";
        return;
      }
      if (!groupId) {
        state.workbenchSpaceCreatorError = "当前无法生成协作小组标识。";
        return;
      }
      const existingSpace = (state.collaborationSpacesResult?.spaces ?? []).find(
        (entry) =>
          normalizeValue(entry.id) === groupId || normalizeValue(entry.groupId) === groupId,
      );
      if (existingSpace) {
        state.workbenchSpaceCreatorError = "你已创建过同名协作小组，请直接复用或修改名称。";
        return;
      }
      if ((state.workbenchSpaceCreatorStep ?? "details") !== "members") {
        state.workbenchSpaceCreatorStep = "members";
        state.workbenchSpaceCreatorError = null;
        return;
      }
      const selectedHumanIds = new Set(state.workbenchSpaceCreatorSelectedHumanIds ?? []);
      const selectedBotIds = new Set(state.workbenchSpaceCreatorSelectedBotIds ?? []);
      const actorEmployeeUserId = normalizeValue(employeeAccess?.employeeUserId);
      const creatorIdentity =
        actorEmployeeUserId ?? normalizeValue(loginUserForSlug) ?? normalizeValue(helloAuth?.user);
      const creatorIdentities = new Set(
        [
          actorEmployeeUserId,
          loginUserForSlug,
          helloAuth?.user,
          platformSession?.user,
          platformSession?.email,
          state.bootstrapAuthSession?.user,
          state.bootstrapAuthSession?.email,
        ]
          .map((value) => normalizeValue(value)?.toLowerCase() ?? "")
          .filter(Boolean),
      );
      const ownedSpaceCount = countEmployeeWorkbenchOwnedSpaces(
        (state.collaborationSpacesResult?.spaces ?? []).map((entry) => ({
          ownerUserId:
            normalizeValue(entry.ownerUserId) ??
            normalizeValue(entry.operatingState?.governance?.ownerUserId) ??
            null,
        })),
        creatorIdentities,
      );
      if (ownedSpaceCount >= EMPLOYEE_WORKBENCH_COLLABORATION_SPACE_NAV_LIMIT) {
        state.workbenchSpaceCreatorError = `每位成员最多可创建 ${EMPLOYEE_WORKBENCH_COLLABORATION_SPACE_NAV_LIMIT} 个协作小组；加入他人创建的小组不占用名额。`;
        return;
      }
      // Owner is always an active member — never require self-invite / self-select.
      const selectedHumans = spaceCreatorCandidates.candidateHumans
        .filter(
          (entry) =>
            selectedHumanIds.has(entry.id) && !creatorIdentities.has(entry.id.trim().toLowerCase()),
        )
        .map((entry) => ({
          userId: entry.id,
          name: entry.label,
        }));
      const humansWithCreator = creatorIdentity
        ? [
            {
              userId: creatorIdentity,
              name: currentUserLabel || creatorIdentity,
            },
            ...selectedHumans,
          ]
        : selectedHumans;
      const selectedBotEntries = spaceCreatorCandidates.candidateBots.filter((entry) =>
        selectedBotIds.has(entry.id),
      );
      const selectedBots = selectedBotEntries
        .filter((entry) => entry.actionMode === "add")
        .map((entry) => ({
          agentId: entry.id,
          name: entry.label,
        }));
      const invitedBots = selectedBotEntries
        .filter((entry) => entry.actionMode !== "add")
        .map((entry) => ({
          agentId: entry.id,
          name: entry.label,
        }));
      state.workbenchSpaceCreatorBusy = true;
      state.workbenchSpaceCreatorError = null;
      try {
        const response = (await updateEmployeeWorkbenchSpaceMembers(state, {
          groupId,
          title,
          avatar,
          ...(currentTenantId ? { tenantId: currentTenantId } : {}),
          ...(currentSeatId ? { ownerPositionId: currentSeatId } : {}),
          ...(currentSeatTitle ? { ownerPositionLabel: currentSeatTitle } : {}),
          ...(currentUserLabel ? { ownerUserLabel: currentUserLabel } : {}),
          ...(actorEmployeeUserId ? { actorEmployeeUserId } : {}),
          ...(purpose ? { purpose } : {}),
          ...(currentMission ? { currentMission } : {}),
          collaborationMode: "discussion_driven",
          ...(systemInstructions.length > 0 ? { systemInstructions } : {}),
          ...(state.workbenchSpaceCreatorCoordinatorBotId?.trim() &&
          selectedBotIds.has(state.workbenchSpaceCreatorCoordinatorBotId.trim())
            ? { coordinatorBotId: state.workbenchSpaceCreatorCoordinatorBotId.trim() }
            : {}),
          members: { humans: humansWithCreator, bots: selectedBots },
          ...(invitedBots.length > 0 ? { invites: { bots: invitedBots } } : {}),
        })) as { space?: CollaborationSpaceSnapshotTransport | null } | null;
        upsertWorkbenchSpace(
          state,
          response?.space ?? {
            id: groupId,
            groupId,
            title,
            avatar,
            ...(purpose ? { purpose } : {}),
            ...(currentMission ? { currentMission } : {}),
            ...(systemInstructions.length > 0 ? { systemInstructions } : {}),
            members: { humans: humansWithCreator, bots: selectedBots },
            invites: { humans: [], bots: invitedBots },
          },
        );
        closeCreator();
        const sessionKey = `space:${groupId}`;
        state.workbenchPrimaryModule = "collaboration";
        state.workbenchTeamSelectedKey = sessionKey;
        state.workbenchGroupProfileView = "chat";
        state.workbenchMemberGovernanceDrawerOpen = false;
        state.workbenchMemberGovernanceGroupKey = null;
        switchEmployeeWorkbenchSession(state, sessionKey, "collaboration");
        state.workbenchTeamSelectedKey = sessionKey;
      } catch (error) {
        state.workbenchSpaceCreatorError = String(error);
      } finally {
        state.workbenchSpaceCreatorBusy = false;
      }
    },
    collaborationMemberGovernance,
    onMemberGovernancePromptChange: (value) => {
      state.workbenchMemberGovernancePrompt = value;
      state.workbenchMemberGovernanceResult = null;
      state.workbenchMemberGovernanceError = null;
    },
    onMemberGovernanceParse: () => {
      const title = state.workbenchMemberGovernanceTitle || "协作小组";
      const prompt = buildMemberGovernanceDraftPrompt(title, state);
      const sourceSessionKey =
        normalizeValue(state.workbenchMemberGovernanceGroupKey) ??
        normalizeValue(state.workbenchTeamSelectedKey) ??
        normalizeValue(state.sessionKey) ??
        "";
      state.workbenchMemberGovernanceResult = "已发送给大白管家，请在对话中查看配置建议。";
      state.workbenchMemberGovernanceError = null;
      state.workbenchMemberGovernanceDrawerOpen = false;
      state.workbenchPendingGroupConfigProposal = null;
      state.workbenchGroupConfigProposalDismissedFingerprint = null;
      state.workbenchGroupConfigProposalError = null;
      state.workbenchGroupConfigProposalNotice = null;
      // Real steward chat.send path (not user.daibai.ask). App.openDaibaiHelpFromModule
      // switches session, reloads history, then auto-sends chatMessage.
      void state.openDaibaiHelpFromModule({
        moduleLabel: "成员治理",
        contextMessage: prompt,
        ...(sourceSessionKey ? { sourceSessionKey } : {}),
      });
    },
    onMemberGovernanceOpenSelector: (kind) => {
      if (kind === null) {
        state.workbenchMemberGovernanceSelectorKind = null;
      } else {
        state.workbenchMemberGovernanceSelectorKind = kind;
        refreshMemberGovernanceSnapshot();
        if (kind === "bot") {
          void loadCollaborationOrgBotDirectory(state, { force: true }).then(() => {
            refreshMemberGovernanceSnapshot();
          });
        }
      }
      state.workbenchMemberGovernanceSearch = "";
      state.workbenchMemberGovernanceSelectedHumanIds = [];
      state.workbenchMemberGovernanceSelectedBotIds = [];
      state.workbenchMemberGovernanceResult = null;
      state.workbenchMemberGovernanceError = null;
    },
    onMemberGovernanceSearchChange: (value) => {
      state.workbenchMemberGovernanceSearch = value;
    },
    onMemberGovernanceToggleHumanSelection: (id) => {
      const selectedIds = new Set(state.workbenchMemberGovernanceSelectedHumanIds ?? []);
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }
      state.workbenchMemberGovernanceSelectedHumanIds = [...selectedIds];
    },
    onMemberGovernanceToggleBotSelection: (id) => {
      const selectedIds = new Set(state.workbenchMemberGovernanceSelectedBotIds ?? []);
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
      } else {
        selectedIds.add(id);
      }
      state.workbenchMemberGovernanceSelectedBotIds = [...selectedIds];
    },
    onMemberGovernanceCommitSelection: () => {
      if (
        state.workbenchMemberGovernanceBusy ||
        state.workbenchMemberGovernanceInvitingHumanId ||
        state.workbenchMemberGovernanceInvitingBotId
      ) {
        return;
      }
      void (async () => {
        if (state.workbenchMemberGovernanceSelectorKind === "human") {
          const selectedIds = new Set(state.workbenchMemberGovernanceSelectedHumanIds ?? []);
          const currentIds = new Set(
            (state.workbenchMemberGovernanceCurrentHumans ?? []).map((entry) => entry.id),
          );
          const pendingIds = new Set(
            (state.workbenchMemberGovernancePendingInvites ?? []).map((entry) =>
              entry.intentId.replace(/^invite:|^draft:/, ""),
            ),
          );
          const invitations = (state.workbenchMemberGovernanceCandidateHumans ?? [])
            .filter(
              (entry) =>
                selectedIds.has(entry.id) && !currentIds.has(entry.id) && !pendingIds.has(entry.id),
            )
            .map<WorkbenchCollaborationPendingHumanInvite>((entry) => ({
              intentId: `invite:${entry.id}`,
              label: entry.label,
            }));
          if (invitations.length === 0) {
            state.workbenchMemberGovernanceSelectorKind = null;
            state.workbenchMemberGovernanceSearch = "";
            state.workbenchMemberGovernanceSelectedHumanIds = [];
            state.workbenchMemberGovernanceError = null;
            state.workbenchMemberGovernanceResult = "没有新增成员。";
            return;
          }
          await persistMemberGovernanceState({
            currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
            currentBots: state.workbenchMemberGovernanceCurrentBots ?? [],
            pendingHumanInvites: [
              ...(state.workbenchMemberGovernancePendingInvites ?? []),
              ...invitations,
            ],
            pendingBotInvites: state.workbenchMemberGovernancePendingBotInvites ?? [],
            successMessage:
              invitations.length === 1
                ? `已向 ${invitations[0]?.label ?? "该成员"} 发送加入邀请。`
                : `已向 ${invitations.length} 位成员发送加入邀请。`,
          });
          return;
        }
        if (state.workbenchMemberGovernanceSelectorKind === "bot") {
          const selectedIds = new Set(state.workbenchMemberGovernanceSelectedBotIds ?? []);
          const currentIds = new Set(
            (state.workbenchMemberGovernanceCurrentBots ?? []).map((entry) => entry.id),
          );
          const pendingIds = new Set(
            (state.workbenchMemberGovernancePendingBotInvites ?? []).map((entry) => entry.agentId),
          );
          const selectedEntries = (state.workbenchMemberGovernanceCandidateBots ?? []).filter(
            (entry) =>
              selectedIds.has(entry.id) && !currentIds.has(entry.id) && !pendingIds.has(entry.id),
          );
          const actorIdentities = new Set(
            [
              state.platformAuthState?.session?.user,
              state.platformAuthState?.session?.email,
              state.bootstrapAuthSession?.user,
              state.bootstrapAuthSession?.email,
            ]
              .map((value) => value?.trim().toLowerCase() ?? "")
              .filter(Boolean),
          );
          const ownedAgentIds = new Set(
            state.platformAuthState?.employeeAccess?.ownedAgentIds ?? [],
          );
          for (const entry of state.workbenchCollaborationOrgBotDirectory ?? []) {
            if (isCollaborationOrgBotOwnedByActor(entry, actorIdentities, ownedAgentIds)) {
              ownedAgentIds.add(entry.agentId);
            }
          }
          const resolveOwned = (agentId: string) =>
            isCollaborationOrgBotOwnedByActor(
              {
                agentId,
                ownerUserId:
                  (state.workbenchCollaborationOrgBotDirectory ?? []).find(
                    (bot) => bot.agentId === agentId,
                  )?.ownerUserId ?? null,
              },
              actorIdentities,
              ownedAgentIds,
            );
          const directAdditions = selectedEntries
            .filter((entry) => entry.actionMode === "add" || resolveOwned(entry.id))
            .map<WorkbenchCollaborationMemberGovernanceRosterEntry>((entry) => ({
              id: entry.id,
              label: entry.label,
              kind: "bot",
            }));
          const directAdditionIds = new Set(directAdditions.map((entry) => entry.id));
          const pendingInvites = selectedEntries
            .filter((entry) => !directAdditionIds.has(entry.id))
            .map<WorkbenchCollaborationPendingBotInvite>((entry) => {
              const groupLabel = entry.orgSegments?.[0];
              return {
                agentId: entry.id,
                label: entry.label,
                ownerName:
                  groupLabel && groupLabel.endsWith(" 的机器人")
                    ? groupLabel.replace(/ 的机器人$/, "")
                    : undefined,
                canApprove: resolveOwned(entry.id),
              };
            });
          if (directAdditions.length === 0 && pendingInvites.length === 0) {
            state.workbenchMemberGovernanceSelectorKind = null;
            state.workbenchMemberGovernanceSearch = "";
            state.workbenchMemberGovernanceSelectedBotIds = [];
            state.workbenchMemberGovernanceError = null;
            state.workbenchMemberGovernanceResult = "没有新增机器人。";
            return;
          }
          const successParts = [];
          if (directAdditions.length > 0) {
            successParts.push(`已加入 ${directAdditions.length} 个机器人`);
          }
          if (pendingInvites.length === 1) {
            successParts.push(`已邀请 ${pendingInvites[0]?.label ?? "该机器人"}，待对方加入`);
          } else if (pendingInvites.length > 1) {
            successParts.push(`已邀请 ${pendingInvites.length} 个机器人，待对方加入`);
          }
          await persistMemberGovernanceState({
            currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
            currentBots: [
              ...(state.workbenchMemberGovernanceCurrentBots ?? []),
              ...directAdditions,
            ],
            pendingHumanInvites: state.workbenchMemberGovernancePendingInvites ?? [],
            pendingBotInvites: [
              ...(state.workbenchMemberGovernancePendingBotInvites ?? []),
              ...pendingInvites,
            ],
            successMessage: `${successParts.join("；")}。`,
            keepBotSelectorOpen: pendingInvites.length > 0 && directAdditions.length === 0,
          });
        }
      })();
    },
    onMemberGovernanceInviteHuman: (id) => {
      if (
        state.workbenchMemberGovernanceBusy ||
        state.workbenchMemberGovernanceInvitingHumanId ||
        state.workbenchMemberGovernanceInvitingBotId
      ) {
        if (
          state.workbenchMemberGovernanceInvitingHumanId &&
          state.workbenchMemberGovernanceInvitingHumanId !== id
        ) {
          state.workbenchMemberGovernanceError = "请等待当前邀请完成后再邀请其他成员。";
          state.workbenchMemberGovernanceResult = null;
        }
        return;
      }
      void (async () => {
        const currentIds = new Set(
          (state.workbenchMemberGovernanceCurrentHumans ?? []).map((entry) => entry.id),
        );
        const pendingIds = new Set(
          (state.workbenchMemberGovernancePendingInvites ?? []).map((entry) =>
            entry.intentId.replace(/^invite:|^draft:/, ""),
          ),
        );
        const entry = (state.workbenchMemberGovernanceCandidateHumans ?? []).find(
          (candidate) => candidate.id === id,
        );
        if (
          !entry ||
          entry.disabled ||
          currentIds.has(id) ||
          pendingIds.has(id) ||
          entry.actionMode !== "invite"
        ) {
          return;
        }
        await persistMemberGovernanceState({
          currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
          currentBots: state.workbenchMemberGovernanceCurrentBots ?? [],
          pendingHumanInvites: [
            ...(state.workbenchMemberGovernancePendingInvites ?? []),
            {
              intentId: `invite:${entry.id}`,
              label: entry.label,
            },
          ],
          pendingBotInvites: state.workbenchMemberGovernancePendingBotInvites ?? [],
          successMessage: `已向 ${entry.label} 发送加入邀请。`,
          keepHumanSelectorOpen: true,
          invitingHumanId: id,
        });
      })();
    },
    onMemberGovernanceInviteBot: (id) => {
      if (
        state.workbenchMemberGovernanceBusy ||
        state.workbenchMemberGovernanceInvitingHumanId ||
        state.workbenchMemberGovernanceInvitingBotId
      ) {
        // Sibling rows stay clickable during another invite's in-flight state;
        // surface a clear wait hint instead of a silent no-op.
        if (
          state.workbenchMemberGovernanceInvitingBotId &&
          state.workbenchMemberGovernanceInvitingBotId !== id
        ) {
          state.workbenchMemberGovernanceError = "请等待当前邀请完成后再邀请其他机器人。";
          state.workbenchMemberGovernanceResult = null;
        }
        return;
      }
      void (async () => {
        const currentIds = new Set(
          (state.workbenchMemberGovernanceCurrentBots ?? []).map((entry) => entry.id),
        );
        const pendingIds = new Set(
          (state.workbenchMemberGovernancePendingBotInvites ?? []).map((entry) => entry.agentId),
        );
        const entry = (state.workbenchMemberGovernanceCandidateBots ?? []).find(
          (candidate) => candidate.id === id,
        );
        if (
          !entry ||
          entry.disabled ||
          currentIds.has(id) ||
          pendingIds.has(id) ||
          (entry.actionMode !== "invite" && entry.actionMode !== "add")
        ) {
          return;
        }
        const actorIdentities = new Set(
          [
            state.platformAuthState?.session?.user,
            state.platformAuthState?.session?.email,
            state.bootstrapAuthSession?.user,
            state.bootstrapAuthSession?.email,
          ]
            .map((value) => value?.trim().toLowerCase() ?? "")
            .filter(Boolean),
        );
        const ownedAgentIds = new Set(state.platformAuthState?.employeeAccess?.ownedAgentIds ?? []);
        for (const bot of state.workbenchCollaborationOrgBotDirectory ?? []) {
          if (isCollaborationOrgBotOwnedByActor(bot, actorIdentities, ownedAgentIds)) {
            ownedAgentIds.add(bot.agentId);
          }
        }
        const owned = isCollaborationOrgBotOwnedByActor(
          {
            agentId: entry.id,
            ownerUserId:
              (state.workbenchCollaborationOrgBotDirectory ?? []).find(
                (bot) => bot.agentId === entry.id,
              )?.ownerUserId ?? null,
          },
          actorIdentities,
          ownedAgentIds,
        );
        if (owned || entry.actionMode === "add") {
          await persistMemberGovernanceState({
            currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
            currentBots: [
              ...(state.workbenchMemberGovernanceCurrentBots ?? []),
              { id: entry.id, label: entry.label, kind: "bot" },
            ],
            pendingHumanInvites: state.workbenchMemberGovernancePendingInvites ?? [],
            pendingBotInvites: state.workbenchMemberGovernancePendingBotInvites ?? [],
            successMessage: `已加入机器人 ${entry.label}。`,
            keepBotSelectorOpen: true,
            invitingBotId: id,
          });
          return;
        }
        const groupLabel = entry.orgSegments?.[0];
        await persistMemberGovernanceState({
          currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
          currentBots: state.workbenchMemberGovernanceCurrentBots ?? [],
          pendingHumanInvites: state.workbenchMemberGovernancePendingInvites ?? [],
          pendingBotInvites: [
            ...(state.workbenchMemberGovernancePendingBotInvites ?? []),
            {
              agentId: entry.id,
              label: entry.label,
              ownerName:
                groupLabel && groupLabel.endsWith(" 的机器人")
                  ? groupLabel.replace(/ 的机器人$/, "")
                  : undefined,
              canApprove: false,
            },
          ],
          successMessage: `已邀请 ${entry.label}，待对方加入。`,
          keepBotSelectorOpen: true,
          invitingBotId: id,
        });
      })();
    },
    onMemberGovernanceCancelInvite: (intentId) => {
      if (state.workbenchMemberGovernanceBusy) {
        return;
      }
      void persistMemberGovernanceState({
        currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
        currentBots: state.workbenchMemberGovernanceCurrentBots ?? [],
        pendingHumanInvites: (state.workbenchMemberGovernancePendingInvites ?? []).filter(
          (entry) => entry.intentId !== intentId,
        ),
        pendingBotInvites: state.workbenchMemberGovernancePendingBotInvites ?? [],
        successMessage: "已撤销邀请。",
        keepHumanSelectorOpen: true,
      });
    },
    onMemberGovernanceRemoveMember: (id, kind) => {
      if (state.workbenchMemberGovernanceBusy) {
        return;
      }
      void persistMemberGovernanceState({
        currentHumans:
          kind === "human"
            ? (state.workbenchMemberGovernanceCurrentHumans ?? []).filter(
                (entry) => entry.id !== id,
              )
            : (state.workbenchMemberGovernanceCurrentHumans ?? []),
        currentBots:
          kind === "bot"
            ? (state.workbenchMemberGovernanceCurrentBots ?? []).filter((entry) => entry.id !== id)
            : (state.workbenchMemberGovernanceCurrentBots ?? []),
        pendingHumanInvites:
          kind === "human"
            ? (state.workbenchMemberGovernancePendingInvites ?? []).filter(
                (entry) => entry.intentId.replace(/^invite:|^draft:/, "") !== id,
              )
            : (state.workbenchMemberGovernancePendingInvites ?? []),
        pendingBotInvites:
          kind === "bot"
            ? (state.workbenchMemberGovernancePendingBotInvites ?? []).filter(
                (entry) => entry.agentId !== id,
              )
            : (state.workbenchMemberGovernancePendingBotInvites ?? []),
        successMessage: "已更新当前成员。",
      });
    },
    onMemberGovernanceApproveBotInvite: (agentId) => {
      if (state.workbenchMemberGovernanceBusy) {
        return;
      }
      const pendingInvite = (state.workbenchMemberGovernancePendingBotInvites ?? []).find(
        (entry) => entry.agentId === agentId,
      );
      if (!pendingInvite?.canApprove) {
        return;
      }
      void persistMemberGovernanceState({
        currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
        currentBots: [
          ...(state.workbenchMemberGovernanceCurrentBots ?? []),
          {
            id: pendingInvite.agentId,
            label: pendingInvite.label,
            kind: "bot",
          },
        ],
        pendingHumanInvites: state.workbenchMemberGovernancePendingInvites ?? [],
        pendingBotInvites: (state.workbenchMemberGovernancePendingBotInvites ?? []).filter(
          (entry) => entry.agentId !== agentId,
        ),
        successMessage: "已同意机器人加入协作小组。",
      });
    },
    onMemberGovernanceRejectBotInvite: (agentId) => {
      if (state.workbenchMemberGovernanceBusy) {
        return;
      }
      void persistMemberGovernanceState({
        currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
        currentBots: state.workbenchMemberGovernanceCurrentBots ?? [],
        pendingHumanInvites: state.workbenchMemberGovernancePendingInvites ?? [],
        pendingBotInvites: (state.workbenchMemberGovernancePendingBotInvites ?? []).filter(
          (entry) => entry.agentId !== agentId,
        ),
        successMessage: "已拒绝机器人加入协作小组。",
      });
    },
    onMemberGovernanceAcceptSelfInvite: () => {
      if (state.workbenchMemberGovernanceBusy) {
        return;
      }
      const pending = resolveSelfPendingHumanInvite(state);
      if (!pending) {
        return;
      }
      const userId = pending.intentId.replace(/^invite:|^draft:/, "").trim();
      if (!userId) {
        return;
      }
      const currentHumans = state.workbenchMemberGovernanceCurrentHumans ?? [];
      const alreadyMember = currentHumans.some((entry) => entry.id === userId);
      void persistMemberGovernanceState({
        currentHumans: alreadyMember
          ? currentHumans
          : [...currentHumans, { id: userId, label: pending.label, kind: "human" }],
        currentBots: state.workbenchMemberGovernanceCurrentBots ?? [],
        pendingHumanInvites: (state.workbenchMemberGovernancePendingInvites ?? []).filter(
          (entry) => entry.intentId !== pending.intentId,
        ),
        pendingBotInvites: state.workbenchMemberGovernancePendingBotInvites ?? [],
        successMessage: "已加入协作小组。",
      });
    },
    onMemberGovernanceRejectSelfInvite: () => {
      if (state.workbenchMemberGovernanceBusy) {
        return;
      }
      const pending = resolveSelfPendingHumanInvite(state);
      if (!pending) {
        return;
      }
      void persistMemberGovernanceState({
        currentHumans: state.workbenchMemberGovernanceCurrentHumans ?? [],
        currentBots: state.workbenchMemberGovernanceCurrentBots ?? [],
        pendingHumanInvites: (state.workbenchMemberGovernancePendingInvites ?? []).filter(
          (entry) => entry.intentId !== pending.intentId,
        ),
        pendingBotInvites: state.workbenchMemberGovernancePendingBotInvites ?? [],
        successMessage: "已拒绝加入协作小组。",
      });
    },
    onMemberGovernanceReset: () => {
      if (state.workbenchMemberGovernanceBusy) {
        return;
      }
      void resetMemberGovernanceState();
    },
    onOpenFilePreview: () => {
      if (isCollaborationArtifactPreviewOpen(state)) {
        state.handleCloseSidebar();
        return;
      }
      closeCollaborationMemberGovernanceDrawer(state);
      const artifactId = findLatestArtifactId(state.chatMessages);
      if (!artifactId) {
        state.handleOpenArtifactPreview();
        return;
      }
      state.handleOpenArtifact(artifactId);
    },
  };
}
