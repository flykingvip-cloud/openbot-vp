import { cronCapability } from "../../capability/cron/index.ts";
import { presenceCapability } from "../../capability/presence/index.ts";
import type { AppCapabilitySlices } from "../../capability/view-state.ts";
import { adaptPresenceLoadCapabilityState } from "../../capability/view-state.ts";
import { loadMeshShellData } from "../../controllers/mesh-shell.ts";
import type { EnterprisePortActionState } from "./action-state.ts";

export type CreateEnterprisePortActionsArgs = {
  actionState: EnterprisePortActionState;
  capabilityState: AppCapabilitySlices;
};

export function createEnterprisePortActions({ actionState }: CreateEnterprisePortActionsArgs) {
  const presenceLoadState = adaptPresenceLoadCapabilityState(actionState);
  const cronFormState = actionState;
  const cronJobsState = actionState;
  const cronManageState = actionState;
  const cronRunsState = actionState;

  return {
    overview: {
      onRefresh: () => actionState.loadOverview(),
    },
    dataGovernance: {
      onRefresh: async () => {
        await actionState.loadOverview();
      },
    },
    organization: {
      onRefresh: () => actionState.refreshEnterpriseOrganization(),
      onCreateInvite: () => actionState.createPlatformAuthInvite(),
      onImportOrganizationRows: (
        rows: Parameters<typeof actionState.importEnterpriseOrganizationRows>[0],
      ) => actionState.importEnterpriseOrganizationRows(rows),
      onBuildOrganization: (
        payload: Parameters<typeof actionState.buildEnterpriseOrganization>[0],
      ) => actionState.buildEnterpriseOrganization(payload),
      onSendActivationEmails: (emails?: string[]) =>
        actionState.sendEnterpriseOrganizationActivationEmails(emails),
      onSubmitAuth: () => actionState.submitPlatformAuth(),
      onSwitchToEnterpriseAdmin: (tenantId: string) =>
        actionState.switchPlatformAuthSessionKind("enterprise-admin", tenantId),
      onRefreshUsers: () => actionState.refreshEnterpriseOrganization(),
      onRefreshTeams: () => actionState.refreshEnterpriseOrganization(),
      onRefreshRoles: () => actionState.refreshEnterpriseOrganization(),
      onOffboardMember: (user: string) => actionState.removePlatformAuthMember(user),
      /** 员工名录 → 发送管理员邀请（员工保留原密码，接受后获得双重身份）。 */
      onInviteEnterpriseAdmin: (user: string, options?: { resend?: boolean }) =>
        actionState.invitePlatformEnterpriseAdmin(user, options),
      onSendSeatOffer: (tenantId: string, seatId: string, employeeEmail: string) =>
        actionState.sendEnterpriseSeatAssignmentOffer(tenantId, seatId, employeeEmail),
      onCancelSeatOffer: (tenantId: string, offerId: string) =>
        actionState.cancelEnterpriseSeatAssignmentOffer(tenantId, offerId),
      onRemindSeatOffer: (tenantId: string, offerId: string, employeeEmail?: string | null) =>
        actionState.remindEnterpriseSeatAssignmentOffer(tenantId, offerId, employeeEmail),
      onStartSeatHandover: (tenantId: string, seatId: string) =>
        actionState.startEnterpriseSeatHandover(tenantId, seatId),
      onReviewHandover: (
        tenantId: string,
        handoverCaseId: string,
        reviewSummary: string,
        exceptionFlags?: string[],
      ) =>
        actionState.reviewEnterpriseSeatHandover(
          tenantId,
          handoverCaseId,
          reviewSummary,
          exceptionFlags,
        ),
      onApproveHandover: (tenantId: string, handoverCaseId: string) =>
        actionState.approveEnterpriseSeatHandover(tenantId, handoverCaseId),
      onRebindHandover: (tenantId: string, handoverCaseId: string, employeeEmail: string) =>
        actionState.rebindEnterpriseSeatHandover(tenantId, handoverCaseId, employeeEmail),
      onMutateOrganizationDepartment: async (
        tenantId: string,
        mutation: Parameters<typeof actionState.mutateEnterpriseOrganizationDepartment>[1],
      ) => {
        const result = await actionState.mutateEnterpriseOrganizationDepartment(tenantId, mutation);
        return result;
      },
      /** Live host error after a failed organization department mutation (if any). */
      getOrganizationDepartmentMutationError: () => actionState.platformAuthError,
      onDeleteSeat: (tenantId: string, seatId: string) =>
        actionState.mutateEnterpriseOrganizationDepartment(tenantId, {
          action: "delete-seat",
          seatId,
        }),
      onDeleteSeatAndMember: (tenantId: string, seatId: string) =>
        actionState.mutateEnterpriseOrganizationDepartment(tenantId, {
          action: "delete-seat-and-member",
          seatId,
        }),
      onCreateSeat: (
        tenantId: string,
        params: Parameters<typeof actionState.createEnterpriseSeat>[1],
      ) => actionState.createEnterpriseSeat(tenantId, params),
      onUpdateSeatProfile: (
        tenantId: string,
        seatId: string,
        params: Omit<Parameters<typeof actionState.createEnterpriseSeat>[1], "seatId">,
      ) => actionState.createEnterpriseSeat(tenantId, { ...params, seatId }),
      onTransferOwnership: (
        tenantId: string,
        subjectKind: "agent" | "group",
        subjectId: string,
        positionId: string,
        previousUserId: string,
        newUserId: string,
        newUserLabel: string,
      ) =>
        actionState.transferMeshOwnership(
          tenantId,
          subjectKind,
          subjectId,
          positionId,
          previousUserId,
          newUserId,
          newUserLabel,
        ),
      onRevokeOwnership: (
        tenantId: string,
        subjectKind: "agent" | "group",
        subjectId: string,
        revokedByUserId: string,
        revokedByUserLabel: string,
        reason?: string,
      ) =>
        actionState.revokeMeshOwnership(
          tenantId,
          subjectKind,
          subjectId,
          revokedByUserId,
          revokedByUserLabel,
          reason,
        ),
    },
    usageManagement: {
      onRefresh: () => actionState.loadOverview(),
      onUninstall: () => actionState.loadOverview(),
      onAcknowledge: () => actionState.loadOverview(),
      onUpdateGovernanceConfig: () => actionState.loadOverview(),
      onCronRefresh: async () => {
        await cronCapability.loadStatus(actionState);
        await cronCapability.loadJobs(cronJobsState);
      },
      onCronFormChange: (patch: Partial<typeof actionState.cronForm>) => {
        actionState.cronForm = cronCapability.normalizeForm({
          ...actionState.cronForm,
          ...patch,
        });
        actionState.cronFieldErrors = cronCapability.validateForm(actionState.cronForm);
      },
      onCronAdd: () => cronCapability.addJob(cronManageState),
      onCronEdit: (job: (typeof actionState.cronJobs)[number]) =>
        cronCapability.startEdit(cronFormState, job),
      onCronClone: (job: (typeof actionState.cronJobs)[number]) =>
        cronCapability.startClone(cronFormState, job),
      onCronCancelEdit: () => cronCapability.cancelEdit(cronFormState),
      onCronToggle: (job: (typeof actionState.cronJobs)[number], enabled: boolean) =>
        cronCapability.toggleJob(cronManageState, job, enabled),
      onCronRun: (job: (typeof actionState.cronJobs)[number], mode?: "force" | "due") =>
        cronCapability.runJob(cronManageState, job, mode ?? "force"),
      onCronRemove: (job: (typeof actionState.cronJobs)[number]) =>
        cronCapability.removeJob(cronManageState, job),
      onCronLoadRuns: async (jobId: string) => {
        cronCapability.updateRunsFilter(cronRunsState, { cronRunsScope: "job" });
        await cronCapability.loadRuns(cronRunsState, jobId);
      },
      onCronLoadMoreJobs: () => cronCapability.loadMoreJobs(cronJobsState),
      onCronJobsFiltersChange: async (patch: {
        cronJobsQuery?: string;
        cronJobsEnabledFilter?: import("../../types.ts").CronJobsEnabledFilter;
        cronJobsScheduleKindFilter?: import("../../controllers/cron.ts").CronJobsScheduleKindFilter;
        cronJobsLastStatusFilter?: import("../../controllers/cron.ts").CronJobsLastStatusFilter;
        cronJobsSortBy?: import("../../types.ts").CronJobsSortBy;
        cronJobsSortDir?: import("../../types.ts").CronSortDir;
      }) => {
        cronCapability.updateJobsFilter(cronJobsState, patch);
        await cronCapability.reloadJobs(cronJobsState);
      },
      onCronJobsFiltersReset: async () => {
        cronCapability.updateJobsFilter(cronJobsState, {
          cronJobsQuery: "",
          cronJobsEnabledFilter: "all",
          cronJobsScheduleKindFilter: "all",
          cronJobsLastStatusFilter: "all",
          cronJobsSortBy: "nextRunAtMs",
          cronJobsSortDir: "asc",
        });
        await cronCapability.reloadJobs(cronJobsState);
      },
      onCronLoadMoreRuns: () => cronCapability.loadMoreRuns(cronRunsState),
      onCronRunsFiltersChange: async (patch: {
        cronRunsScope?: import("../../types.ts").CronRunScope;
        cronRunsStatuses?: import("../../types.ts").CronRunsStatusValue[];
        cronRunsDeliveryStatuses?: import("../../types.ts").CronDeliveryStatus[];
        cronRunsStatusFilter?: import("../../types.ts").CronRunsStatusFilter;
        cronRunsQuery?: string;
        cronRunsSortDir?: import("../../types.ts").CronSortDir;
      }) => {
        cronCapability.updateRunsFilter(cronRunsState, patch);
        await cronCapability.loadRuns(cronRunsState, actionState.cronRunsJobId);
      },
    },
    mesh: {
      onRefresh: async () => {
        await actionState.loadOverview();
        await presenceCapability.load(presenceLoadState);
      },
      onRefreshOverview: () => actionState.loadOverview(),
      onRefreshRuntime: async () => {
        await Promise.all([
          loadMeshShellData(actionState as never),
          presenceCapability.load(presenceLoadState),
        ]);
      },
      onRefreshIncidents: () => actionState.loadOverview(),
      onTransferOwnership: (
        tenantId: string,
        subjectKind: "agent" | "group",
        subjectId: string,
        positionId: string,
        previousUserId: string,
        newUserId: string,
        newUserLabel: string,
      ) =>
        actionState.transferMeshOwnership(
          tenantId,
          subjectKind,
          subjectId,
          positionId,
          previousUserId,
          newUserId,
          newUserLabel,
        ),
      onRevokeOwnership: (
        tenantId: string,
        subjectKind: "agent" | "group",
        subjectId: string,
        revokedByUserId: string,
        revokedByUserLabel: string,
        reason?: string,
      ) =>
        actionState.revokeMeshOwnership(
          tenantId,
          subjectKind,
          subjectId,
          revokedByUserId,
          revokedByUserLabel,
          reason,
        ),
    },
    usage: {
      onRefresh: () => actionState.loadOverview(),
      onRefreshBreakdown: () => actionState.loadOverview(),
      onRefreshHistory: () => actionState.loadOverview(),
    },
    settings: {
      onRefresh: () => actionState.loadOverview(),
      onLogout: () => actionState.logoutPlatformAuth(),
      onRefreshIntegrations: () => actionState.loadOverview(),
      onRefreshPolicies: () => actionState.loadOverview(),
      onRefreshIdentities: (tenantId: string) =>
        actionState.loadEnterpriseOperationalIdentities(tenantId),
      onRevokeIdentity: (tenantId: string, identityId: string) =>
        actionState.revokeEnterpriseOperationalIdentity(tenantId, identityId),
      onCreateConnectorCredential: (tenantId: string, connectorId: string) =>
        actionState.createEnterpriseConnectorCredential(tenantId, { connectorId }),
      onProbeImChannel: (tenantId: string, channelId: string) =>
        actionState.probeTenantImChannel(tenantId, channelId),
      onSyncChannelToOperationalIdentity: (tenantId: string, connectorId: string) =>
        actionState.syncChannelToOperationalIdentity(tenantId, connectorId),
      onNavigateToImChannelCredentials: (tenantId: string, channelId: string) =>
        actionState.navigateToEnterpriseImChannelCredentials(tenantId, channelId),
      onReauthorizeIdentity: (tenantId: string, identityId: string) =>
        actionState.reauthorizeEnterpriseOperationalIdentity(tenantId, identityId),
      onOpenIdentityEditor: (
        _tenantId: string,
        params: Parameters<typeof actionState.openEnterpriseIdentityEditor>[0],
      ) => {
        actionState.openEnterpriseIdentityEditor(params);
      },
      onCloseIdentityEditor: () => actionState.closeEnterpriseIdentityEditor(),
      onSubmitIdentityEditor: (tenantId: string) =>
        actionState.submitEnterpriseIdentityEditor(tenantId),
      onRemoveIdentityBinding: (tenantId: string, bindingId: string) =>
        actionState.removeEnterpriseOperationalIdentityBinding(tenantId, bindingId),
      onOpenDataSourceGovernanceDetail: (tenantId: string, sourceId: string) =>
        actionState.openEnterpriseDataSourceGovernanceDetail(tenantId, sourceId),
      onCloseDataSourceGovernanceDetail: () =>
        actionState.closeEnterpriseDataSourceGovernanceDetail(),
      onVerifyIdentity: (tenantId: string, identityId: string) =>
        actionState.verifyEnterpriseOperationalIdentity(tenantId, identityId),
      onOpenIdentityRevokeConfirm: (identityId: string) =>
        actionState.openEnterpriseIdentityRevokeConfirm(identityId),
    },
    instances: {
      onRefresh: () => presenceCapability.load(presenceLoadState),
    },
  };
}

export type EnterprisePortActions = ReturnType<typeof createEnterprisePortActions>;
