import type { ControlUiAuthMode } from "../../../../../src/gateway/control-ui-contract.js";
import type { AppViewState } from "../../app-view-state.ts";
import type { GatewayConnectionPhase } from "../../gateway-connection-phase.ts";
import { createPortStateLens } from "../port-state-lens.ts";
import type { HandoverAssetCategoryFilter } from "./view-types.ts";
import type { EnterpriseHandoverSessionDataTransferSnapshot } from "./views/enterprise-handover-asset-helpers.ts";

/**
 * Runtime fields that still live on the centralized `App` class but have not
 * yet migrated into the shared shell slices. Keep this limited to non-OIG
 * transitional fields; enterprise identity editor state is part of AppViewState.
 */
type EnterpriseRuntimeOnlyState = {
  bootstrapAuthMode: ControlUiAuthMode | null;
  enterpriseOrganizationMonthlyUsageLoading: boolean;
  enterpriseOrganizationMonthlyUsageError: string | null;
  enterpriseOrganizationMonthlyUsage: {
    tenantId: string;
    startDate: string;
    endDate: string;
    agents: Array<{
      agentId: string;
      totalTokens: number;
      totalCost: number;
      sessionCount: number;
      lastActiveAt: number | null;
    }>;
    seats: Array<{
      seatId: string;
      agentIds: string[];
      totalTokens: number;
      totalCost: number;
      sessionCount: number;
      lastActiveAt: number | null;
      unmatchedAgentIds: string[];
    }>;
    unmatchedAgentIds: string[];
    users: Array<{
      userId: string;
      totalTokens: number;
      totalCost: number;
      sessionCount: number;
      lastActiveAt: number | null;
    }>;
  } | null;
  enterpriseHandoverEditorSeatId: string | null;
  enterpriseHandoverEditorTeamLabel: string | null;
  enterpriseHandoverEditorAssetSnapshot: {
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
    sessionDataTransfer: EnterpriseHandoverSessionDataTransferSnapshot | null;
  } | null;
  enterpriseHandoverEditorAssetQuery: string;
  enterpriseHandoverEditorAssetKindFilter: HandoverAssetCategoryFilter;
  configActiveSection: string | null;
  tenantConfigTenantId: string | null;
  tenantConfigForm: Record<string, unknown> | null;
  tenantConfigBaseHash: string | null;
  tenantConfigLoading: boolean;
  tenantConfigSaving: boolean;
  tenantConfigDirty: boolean;
  tenantConfigError: string | null;
  gatewayConnectionPhase?: GatewayConnectionPhase;
  enterpriseOrganizationSnapshot?: unknown;
  enterpriseOrganizationSnapshotLoading?: boolean;
};

/**
 * Lens source = the shared view-state plus the transitional runtime-only fields
 * above. The runtime `App` instance passed to `adaptEnterprisePortState` carries
 * all of these at runtime.
 */
type EnterpriseLensSource = AppViewState & EnterpriseRuntimeOnlyState;

const ENTERPRISE_PORT_STATE_KEYS = [
  "tab",
  "basePath",
  "connected",
  "client",
  "lastError",
  "gatewayConnectionPhase",
  "enterpriseOrganizationSnapshot",
  "enterpriseOrganizationSnapshotLoading",
  "setTab",
  "applySettings",
  "settings",
  "platformAuthState",
  "platformAuthMode",
  "platformAuthBusy",
  "platformAuthError",
  "platformAuthNotice",
  "enterpriseAccessEditorKind",
  "enterpriseAccessEditorTargetKey",
  "enterpriseAccessEditorSelectedPermissionIds",
  "enterpriseAccessEditorNotice",
  "enterpriseAccessRiskConfirmOpen",
  "enterpriseSeatOfferEditorSeatId",
  "enterpriseSeatOfferEditorMode",
  "enterpriseSeatOfferEditorSeatTitle",
  "enterpriseSeatOfferEditorSeatStatus",
  "enterpriseSeatOfferEditorDefaultAgentId",
  "enterpriseSeatOfferEditorAvailableAgentIds",
  "enterpriseSeatOfferEditorDefaultSpaceIds",
  "enterpriseSeatOfferEditorSelectedAgentIds",
  "enterpriseSeatOfferEditorSelectedSpaceIds",
  "enterpriseSeatOfferEditorInheritMode",
  "enterpriseSeatOfferEditorInheritMemoryScope",
  "enterpriseSeatOfferEditorMemoryScopeAvailable",
  "enterpriseSeatOfferEditorEmployeeEmail",
  "enterpriseSeatCreateEditorSeatId",
  "enterpriseSeatCreateEditorOpen",
  "enterpriseSeatCreateEditorSeatTitle",
  "enterpriseSeatCreateEditorTeamLabel",
  "enterpriseSeatCreateEditorResponsibility",
  "enterpriseSeatCreateEditorEmployeeEmail",
  "enterpriseSeatCreateEditorDefaultAgentId",
  "enterpriseSeatCreateEditorAgentIds",
  "enterpriseOwnershipTransferEditorOpen",
  "enterpriseOwnershipTransferEditorTenantId",
  "enterpriseOwnershipTransferEditorSubjectKind",
  "enterpriseOwnershipTransferEditorSubjectId",
  "enterpriseOwnershipTransferEditorSubjectLabel",
  "enterpriseOwnershipTransferEditorPositionId",
  "enterpriseOwnershipTransferEditorPositionLabel",
  "enterpriseOwnershipTransferEditorCurrentManagerUserId",
  "enterpriseOwnershipTransferEditorCurrentManagerLabel",
  "enterpriseOwnershipTransferEditorSelectedUserId",
  "enterpriseHandoverEditorCaseId",
  "enterpriseHandoverEditorSeatTitle",
  "enterpriseHandoverEditorSeatId",
  "enterpriseHandoverEditorStatus",
  "enterpriseHandoverEditorReviewSummary",
  "enterpriseHandoverEditorExceptionFlags",
  "enterpriseHandoverEditorSuccessorEmail",
  "enterpriseHandoverEditorSeatStatus",
  "enterpriseHandoverEditorDefaultAgentIds",
  "enterpriseHandoverEditorDefaultSpaceIds",
  "enterpriseHandoverEditorSelectedAgentIds",
  "enterpriseHandoverEditorSelectedDataKeys",
  "enterpriseHandoverEditorSelectedSpaceIds",
  "enterpriseHandoverEditorSelectedPolicyIds",
  "enterpriseHandoverEditorDraftNotice",
  "enterpriseHandoverEditorCurrentEmployeeEmail",
  "enterpriseHandoverEditorCurrentEmployeeDisplayName",
  "enterpriseHandoverEditorBindingStatus",
  "enterpriseHandoverEditorEmployeePolicies",
  "enterpriseHandoverEditorSeatPolicies",
  "enterpriseHandoverEditorTeamLabel",
  "enterpriseHandoverEditorAssetSnapshot",
  "enterpriseHandoverEditorAssetQuery",
  "enterpriseHandoverEditorAssetKindFilter",
  "enterpriseOperationalIdentities",
  "enterpriseOperationalIdentityBusy",
  "tenantImSyncBusy",
  "tenantImIdentityLinkHint",
  "tenantImProbeBusy",
  "tenantImProbeResult",
  "tenantImProbeError",
  "enterpriseOperationalIdentityLoaded",

  "enterpriseOperationalIdentityError",
  "enterpriseOperationalIdentityNotice",
  "enterpriseIdentityEditorOpen",
  "enterpriseIdentityEditorMode",
  "enterpriseIdentityEditorIdentityId",
  "enterpriseIdentityEditorDisplayName",
  "enterpriseIdentityEditorCredentialBindingId",
  "enterpriseIdentityEditorPolicyId",
  "enterpriseIdentityEditorSeatIds",
  "enterpriseIdentityEditorAgentIds",
  "enterpriseIdentityEditorAllowedActions",
  "enterpriseIdentityEditorPolicyPickerQuery",
  "enterpriseIdentityEditorPolicyDepartmentPaths",
  "enterpriseIdentityEditorDataSourceId",
  "enterpriseIdentityEditorBindingPurpose",
  "enterpriseIdentityEditorBindingId",
  "enterpriseIdentityEditorProvider",
  "enterpriseIdentityEditorCredentialFields",
  "enterpriseIdentityEditorCredentialFieldsReady",
  "enterpriseIdentityEditorInitialSecretsConfigured",
  "enterpriseIdentityRevokeConfirmId",
  "enterpriseIdentityVerifyId",
  "enterpriseIdentityVerifyPhase",
  "enterpriseIdentityVerifyMessage",
  "enterpriseOperationalIdentityDetailId",
  "enterpriseOperationalIdentityDetailTab",
  "enterpriseDataSourceGovernanceSourceId",
  "enterpriseDataSourceGovernanceView",
  "enterpriseDataSourceGovernanceBusy",
  "enterpriseDataSourceGovernanceError",
  "platformAuthEmail",
  "platformAuthPassword",
  "platformAuthCurrentPassword",
  "platformAuthNewPassword",
  "platformAuthDisplayName",
  "platformAuthTenantName",
  "platformAuthSeatTitle",
  "platformAuthInviteCode",
  "platformAuthPolicyTrialDays",
  "platformAuthPolicySeatCount",
  "platformAuthPolicyUpgradeUrl",
  "platformAuthPolicyContactAdvisorUrl",
  "platformAuthInstanceEnterpriseId",
  "platformAuthInstanceTrialDays",
  "platformAuthInstanceSeatCount",
  "platformAuthInstanceUpgradeUrl",
  "platformAuthInstanceContactAdvisorUrl",
  "submitPlatformAuth",
  "switchPlatformAuthSessionKind",
  "logoutPlatformAuth",
  "createPlatformAuthInvite",
  "invitePlatformEnterpriseAdmin",
  "revokePlatformAuthInvite",
  "removePlatformAuthMember",
  "openEnterpriseSeatOfferEditor",
  "closeEnterpriseSeatOfferEditor",
  "submitEnterpriseSeatOffer",
  "openEnterpriseSeatCreateEditor",
  "closeEnterpriseSeatCreateEditor",
  "submitEnterpriseSeatCreate",
  "openEnterpriseOwnershipTransferEditor",
  "closeEnterpriseOwnershipTransferEditor",
  "submitEnterpriseOwnershipTransfer",
  "openEnterpriseHandoverRoute",
  "syncEnterpriseHandoverRoute",
  "openEnterpriseHandoverEditor",
  "closeEnterpriseHandoverEditor",
  "submitEnterpriseHandoverNominate",
  "submitEnterpriseHandoverReview",
  "submitEnterpriseHandoverApproval",
  "submitEnterpriseHandoverRebind",
  "openEnterpriseIdentityEditor",
  "closeEnterpriseIdentityEditor",
  "submitEnterpriseIdentityEditor",
  "saveEnterpriseIdentityCredentialConfig",
  "startEnterpriseOperationalIdentityOAuth",
  "openEnterpriseIdentityRevokeConfirm",
  "closeEnterpriseIdentityRevokeConfirm",
  "revokeEnterpriseOperationalIdentity",
  "verifyEnterpriseOperationalIdentity",
  "revokeEnterpriseOperationalIdentity",
  "changePlatformAuthPassword",
  "updatePlatformTrialPolicy",
  "updatePlatformTrialInstance",
  "hello",
  "configActiveSection",
  "tenantConfigTenantId",
  "tenantConfigForm",
  "tenantConfigBaseHash",
  "tenantConfigLoading",
  "tenantConfigSaving",
  "tenantConfigDirty",
  "tenantConfigError",
  "bootstrapAuthMode",
  "bootstrapAuthSession",
  "enterpriseOrganizationMonthlyUsageLoading",
  "enterpriseOrganizationMonthlyUsageError",
  "enterpriseOrganizationMonthlyUsage",
  "presenceLoading",
  "presenceEntries",
  "presenceError",
  "presenceStatus",
  "agentsList",
  "meshOwnershipLoading",
  "meshOwnershipList",
  "meshOwnershipError",
  "meshLifetimeUsageResult",
  "channelsSnapshot",
  "configIssues",
  "configValid",
  "configSchema",
  "configUiHints",
  "cronLoading",
  "cronJobs",
  "cronJobsLoadingMore",
  "cronJobsTotal",
  "cronJobsHasMore",
  "cronJobsQuery",
  "cronJobsEnabledFilter",
  "cronJobsScheduleKindFilter",
  "cronJobsLastStatusFilter",
  "cronJobsSortBy",
  "cronJobsSortDir",
  "cronError",
  "cronBusy",
  "cronForm",
  "cronFieldErrors",
  "cronEditingJobId",
  "cronRunsJobId",
  "cronRuns",
  "cronRunsTotal",
  "cronRunsHasMore",
  "cronRunsLoadingMore",
  "cronRunsScope",
  "cronRunsStatuses",
  "cronRunsDeliveryStatuses",
  "cronRunsStatusFilter",
  "cronRunsQuery",
  "cronRunsSortDir",
  "cronStatus",
  "nodes",
  "collaborationSpacesResult",
  "sessionsResult",
  "usageResult",
] as const satisfies readonly (keyof EnterpriseLensSource)[];

export type EnterprisePortState = Pick<
  EnterpriseLensSource,
  (typeof ENTERPRISE_PORT_STATE_KEYS)[number]
> & {
  readonly port: "enterprise";
  readonly enterpriseScope: "tenant";
};

export function adaptEnterprisePortState(state: AppViewState): EnterprisePortState {
  return createPortStateLens(state as EnterpriseLensSource, ENTERPRISE_PORT_STATE_KEYS, {
    port: "enterprise" as const,
    enterpriseScope: "tenant" as const,
  });
}
