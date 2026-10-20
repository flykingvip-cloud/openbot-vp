import type { GatewayBrowserClient } from "../../gateway.ts";
import type { renderConsoleSubnav } from "../../views/console-subnav.ts";
import type { renderCron } from "../../views/cron.ts";
import type { EnterpriseTenantResolverProps } from "../../views/enterprise-tenant-resolver.ts";
import type { OperationalIdentityGovernancePanelProps } from "../../views/operational-identity-governance-panel.ts";
import type { PlatformAuthPanelProps } from "../../views/platform-auth-panel.ts";
import type { EnterprisePortState } from "./port-state.ts";
import type { EnterprisePortActions } from "./render-actions.ts";
import type { EnterprisePortReadModel } from "./semantic/enterprise-read-model.ts";
import type { EnterpriseHandoverSessionDataTransferSnapshot } from "./views/enterprise-handover-asset-helpers.ts";

/** 岗位交接资产五大业务分类（与数据源映射见 enterprise-handover-editor.ts） */
export type HandoverAssetCategory =
  | "robot"
  | "collaboration_group"
  | "session_data"
  | "knowledge_base"
  | "other";

export type HandoverAssetCategoryFilter = HandoverAssetCategory | "all";

export type EnterprisePortRenderModel = {
  state: EnterprisePortState;
  subnavProps: Parameters<typeof renderConsoleSubnav>[0];
  isResolverSurface: boolean;
  resolverProps: EnterpriseTenantResolverProps;
  client: GatewayBrowserClient | null;
  readModel: EnterprisePortReadModel;
  operationalIdentityGovernancePanel: OperationalIdentityGovernancePanelProps;
  surfaceActions: Pick<
    EnterprisePortActions,
    | "overview"
    | "organization"
    | "dataGovernance"
    | "usageManagement"
    | "mesh"
    | "usage"
    | "settings"
  >;
  authPanelProps: PlatformAuthPanelProps | null;
  cronProps?: Parameters<typeof renderCron>[0];
  /** Tenant-scoped channel credentials (IM connectors). */
  channelCredentialsEditor?: {
    tenantId: string | null;
    channelIds: string[];
    channelLabels?: Record<string, string>;
    selectedChannelId: string | null;
    configForm: Record<string, unknown> | null;
    configSchema: unknown;
    configUiHints: import("../../types.ts").ConfigUiHints;
    loading: boolean;
    saving: boolean;
    dirty: boolean;
    error?: string | null;
    callbackEntries?: import("../../controllers/tenant-im-binding.ts").TenantImCallbackEntry[];
    probeBusy?: boolean;
    probeResult?: import("../../controllers/tenant-im-binding.ts").TenantImProbeResult | null;
    probeError?: string | null;
    syncBusy?: boolean;
    identityLinkHint?: string | null;
    onSelectChannel: (channelId: string) => void;
    onPatch: (path: Array<string | number>, value: unknown) => void;
    onSave: () => void;
    onReload: () => void;
    onProbe?: () => void;
    onSyncOperationalIdentity?: () => void;
  };
  accessControlEditor?: {
    kind: "role" | "user" | null;
    targetKey: string | null;
    selectedPermissionIds: string[];
    notice: string | null;
    riskConfirmOpen: boolean;
    onOpen: (params: { kind: "role" | "user"; targetKey: string; permissionIds: string[] }) => void;
    onClose: () => void;
    onTogglePermission: (permissionId: string) => void;
    onSave: (params: { targetLabel: string; hasHighRisk: boolean }) => void;
    onCancelRisk: () => void;
    onConfirmRisk: (params: { targetLabel: string }) => void;
  };
  createPositionEditor: {
    open: boolean;
    seatId: string | null;
    seatTitle: string;
    teamLabel: string;
    responsibility: string;
    /** 任职邮箱：创建时填写则走邀请激活（注册后自动绑定），不发起待确认绑定。 */
    employeeEmail: string;
    defaultAgentId: string;
    agentIds: string[];
    agentOptions: string[];
    busy: boolean;
    error: string | null;
    notice: string | null;
    onOpen: (params?: {
      seatId?: string | null;
      seatTitle?: string | null;
      teamLabel?: string | null;
      responsibility?: string | null;
      employeeEmail?: string | null;
      defaultAgentId?: string | null;
      agentIds?: string[];
    }) => void;
    onClose: () => void;
    onSeatTitleChange: (value: string) => void;
    onTeamLabelChange: (value: string) => void;
    onResponsibilityChange: (value: string) => void;
    onEmployeeEmailChange: (value: string) => void;
    onDefaultAgentIdChange: (value: string) => void;
    onToggleAgentId: (value: string) => void;
    onSubmit: () => void;
  };
  seatOfferEditor: {
    mode: "offer" | "activation";
    seatId: string | null;
    seatTitle: string;
    seatStatus: string | null;
    defaultAgentId: string | null;
    availableAgentIds: string[];
    defaultSpaceIds: string[];
    selectedAgentIds: string[];
    selectedSpaceIds: string[];
    inheritMode: "full" | "selective";
    inheritMemoryScope: boolean;
    memoryScopeAvailable: boolean;
    employeeEmail: string;
    busy: boolean;
    error: string | null;
    notice: string | null;
    onOpen: (params: {
      mode?: "offer" | "activation";
      seatId: string;
      seatTitle: string;
      seatStatus?: string | null;
      defaultAgentId?: string | null;
      availableAgentIds?: string[];
      defaultSpaceIds?: string[];
      memoryScopeAvailable?: boolean;
      employeeEmail?: string | null;
    }) => void;
    onClose: () => void;
    onEmployeeEmailChange: (value: string) => void;
    onInheritModeChange: (value: "full" | "selective") => void;
    onToggleAgentId: (value: string) => void;
    onToggleSpaceId: (value: string) => void;
    onInheritMemoryScopeChange: (value: boolean) => void;
    onSubmit: () => void;
  };
  identityManagementEditor: {
    open: boolean;
    mode: "register" | "edit" | "policy" | "binding" | "credential";
    identityId: string;
    policyId: string;
    bindingId: string;
    displayName: string;
    credentialBindingId: string;
    provider: string;
    registerStep: "provider" | "connect";
    seatIds: string;
    agentIds: string;
    allowedActions: string;
    policyPickerQuery: string;
    policyDepartmentPaths: string;
    dataSourceId: string;
    bindingPurpose: "source_authentication" | "source_collection" | "source_sync";
    busy: boolean;
    error: string | null;
    notice: string | null;
    eligibleCredentialBindings: Array<{
      credentialBindingId: string;
      connectorId: string;
      ownerType: string;
      ownerId: string;
      status: string;
    }>;
    eligibleDataSources: Array<{
      sourceId: string;
      sourceKey: string;
      displayName: string;
      connectorId: string;
      status: string;
    }>;
    identityOptions: Array<{
      identityId: string;
      displayName: string;
      providerLabel: string;
    }>;
    onOpen: (params: {
      mode: "register" | "edit" | "policy" | "binding" | "credential";
      identityId?: string;
      policyId?: string;
      bindingId?: string;
      displayName?: string;
      credentialBindingId?: string;
      provider?: string;
      seatIds?: string[];
      allowedAgentIds?: string[];
      allowedActions?: string[];
      dataSourceId?: string;
      purpose?: "source_authentication" | "source_collection" | "source_sync";
      initialCredentialFields?: Record<string, string>;
      initialSecretsConfigured?: string[];
      credentialFieldsReady?: boolean;
    }) => void;
    onClose: () => void;
    onDisplayNameChange: (value: string) => void;
    onCredentialBindingIdChange: (value: string) => void;
    onRegisterProviderSelect: (provider: string) => void;
    onRegisterProviderBack: () => void;
    onStartOAuth: (provider: string) => void;
    onIdentityIdChange: (value: string) => void;
    onSeatIdsChange: (value: string) => void;
    onAgentIdsChange: (value: string) => void;
    onAllowedActionsChange: (value: string) => void;
    onPolicyPickerQueryChange: (value: string) => void;
    onPolicyDepartmentPathsChange: (value: string) => void;
    onDataSourceIdChange: (value: string) => void;
    onBindingPurposeChange: (
      value: "source_authentication" | "source_collection" | "source_sync",
    ) => void;
    onSubmit: () => void;
    selectedDetailIdentityId: string;
    detailTab: "usage" | "policy" | "audit" | "security";
    onSelectDetailIdentity: (identityId: string) => void;
    credentialFields: Record<string, string>;
    credentialFieldsReady: boolean;
    credentialSecretsConfigured: string[];
    onCredentialFieldChange: (key: string, value: string) => void;
    onSaveCredentialConfig: () => void;
    onDetailTabChange: (tab: "usage" | "policy" | "audit" | "security") => void;
    revokeConfirmIdentityId: string;
    onOpenRevokeConfirm: (identityId: string) => void;
    onCloseRevokeConfirm: () => void;
    onConfirmRevoke: () => void;
    onVerifyIdentity: (identityId: string) => void;
    onMarkEmployeeBindingActivityRead?: () => void;
  };
  handoverEditor: {
    caseId: string | null;
    seatTitle: string;
    seatId: string | null;
    status: string | null;
    reviewSummary: string;
    exceptionFlags: string;
    successorEmail: string;
    seatStatus: string | null;
    defaultAgentIds: string[];
    defaultSpaceIds: string[];
    selectedAgentIds: string[];
    selectedDataKeys: string[];
    selectedSpaceIds: string[];
    selectedPolicyIds: string[];
    draftNotice: string | null;
    currentEmployeeEmail: string | null;
    currentEmployeeDisplayName: string | null;
    bindingStatus: string | null;
    teamLabel: string | null;
    assetSnapshot: {
      agentIds: string[];
      spaceIds: string[];
      memoryScopeIds: string[];
      memoryScopes: Array<{ scopeId: string; transferClass: string }>;
      connectorProfiles: Array<{
        profileId: string;
        credentialReauthorizationRequired: boolean;
      }>;
      connectorCredentialReauthorizationRequired: boolean;
      frozenAssetBindingIds: string[];
      rebindRequiredAssetBindingIds: string[];
      sessionDataTransfer?: EnterpriseHandoverSessionDataTransferSnapshot | null;
    } | null;
    assetQuery: string;
    assetKindFilter: HandoverAssetCategoryFilter;
    busy: boolean;
    error: string | null;
    notice: string | null;
    employeePolicies: Array<{
      policyId: string;
      resourceType: string;
      resourceId: string;
      action: string;
    }>;
    seatPolicies: Array<{
      policyId: string;
      resourceType: string;
      resourceId: string;
      action: string;
    }>;
    onOpen: (params: {
      handoverCaseId: string;
      seatTitle: string;
      status: string;
      reviewSummary?: string | null;
      exceptionFlags?: string[];
      incomingEmployeeUser?: string | null;
    }) => void;
    onClose: () => void;
    onReviewSummaryChange: (value: string) => void;
    onExceptionFlagsChange: (value: string) => void;
    onSuccessorEmailChange: (value: string) => void;
    onToggleAgentAsset: (id: string) => void;
    onToggleDataAsset: (key: string) => void;
    onToggleSpaceAsset: (id: string) => void;
    onTogglePolicyAsset: (id: string) => void;
    onAssetQueryChange: (value: string) => void;
    onAssetKindFilterChange: (value: HandoverAssetCategoryFilter) => void;
    onSelectAllAssets: () => void;
    onSelectFilteredAssets: () => void;
    onClearSelectedAssets: () => void;
    onSaveDraft: () => void;
    onSubmitNominate: () => void;
    onSubmitReview: () => void;
    onSubmitApproval: () => void;
    onSubmitRebind: () => void;
  };
  ownershipTransferEditor: {
    open: boolean;
    tenantId: string | null;
    subjectKind: "agent" | "group" | null;
    subjectId: string | null;
    subjectLabel: string;
    positionId: string | null;
    positionLabel: string;
    currentManagerUserId: string | null;
    currentManagerLabel: string;
    selectedUserId: string;
    candidateMembers: Array<{
      user: string;
      displayLabel: string;
      seatTitle: string | null;
      seatStatus: string | null;
    }>;
    busy: boolean;
    error: string | null;
    notice: string | null;
    onOpen: (params: {
      tenantId: string;
      subjectKind: "agent" | "group";
      subjectId: string;
      subjectLabel: string;
      positionId: string;
      positionLabel: string;
      currentManagerUserId: string;
      currentManagerLabel: string;
      suggestedUserId?: string | null;
    }) => void;
    onClose: () => void;
    onSelectedUserChange: (value: string) => void;
    onSubmit: () => void;
  };
};
