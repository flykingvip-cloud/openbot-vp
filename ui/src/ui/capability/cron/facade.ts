import {
  addCronJob,
  cancelCronEdit,
  loadCronJobs,
  loadCronModelSuggestions,
  loadCronRuns,
  loadCronStatus,
  loadMoreCronJobs,
  loadMoreCronRuns,
  normalizeCronFormState,
  reloadCronJobs,
  removeCronJob,
  runCronJob,
  startCronClone,
  startCronEdit,
  toggleCronJob,
  resetCronJobsState,
  updateCronJobsFilter,
  updateCronRunsFilter,
  validateCronForm,
  type CronFieldErrors,
  type CronJobsLastStatusFilter,
  type CronJobsScheduleKindFilter,
  type CronModelSuggestionsState,
  type CronState,
} from "../../controllers/cron.ts";
import type {
  CronDeliveryStatus,
  CronJob,
  CronJobsEnabledFilter,
  CronJobsSortBy,
  CronRunScope,
  CronRunsStatusFilter,
  CronRunsStatusValue,
  CronSortDir,
} from "../../types.ts";
import type { CronFormState } from "../../ui-types.ts";

export type CronCapabilityJobsFilterPatch = Partial<{
  cronJobsQuery: string;
  cronJobsEnabledFilter: CronJobsEnabledFilter;
  cronJobsScheduleKindFilter: CronJobsScheduleKindFilter;
  cronJobsLastStatusFilter: CronJobsLastStatusFilter;
  cronJobsSortBy: CronJobsSortBy;
  cronJobsSortDir: CronSortDir;
}>;

export type CronCapabilityRunsFilterPatch = Partial<{
  cronRunsScope: CronRunScope;
  cronRunsStatuses: CronRunsStatusValue[];
  cronRunsDeliveryStatuses: CronDeliveryStatus[];
  cronRunsStatusFilter: CronRunsStatusFilter;
  cronRunsQuery: string;
  cronRunsSortDir: CronSortDir;
}>;

export type CronCapabilityStatusState = Pick<
  CronState,
  "client" | "connected" | "cronStatus" | "cronError"
>;

export type CronCapabilityModelSuggestionsState = CronModelSuggestionsState;

export type CronCapabilityJobsState = Pick<
  CronState,
  | "client"
  | "connected"
  | "cronLoading"
  | "cronJobsLoadingMore"
  | "cronJobs"
  | "cronJobsTotal"
  | "cronJobsHasMore"
  | "cronJobsNextOffset"
  | "cronJobsLimit"
  | "cronJobsQuery"
  | "cronJobsEnabledFilter"
  | "cronJobsScheduleKindFilter"
  | "cronJobsLastStatusFilter"
  | "cronJobsSortBy"
  | "cronJobsSortDir"
  | "cronEditingJobId"
  | "cronForm"
  | "cronFieldErrors"
  | "cronError"
  | "cronRuns"
  | "cronRunsTotal"
  | "cronRunsHasMore"
  | "cronRunsNextOffset"
  | "cronRunsJobId"
  | "cronPersonalScopeOnly"
>;

export type CronCapabilityRunsState = Pick<
  CronState,
  | "client"
  | "connected"
  | "cronRunsJobId"
  | "cronRunsLoadingMore"
  | "cronRuns"
  | "cronRunsTotal"
  | "cronRunsHasMore"
  | "cronRunsNextOffset"
  | "cronRunsLimit"
  | "cronRunsScope"
  | "cronRunsStatuses"
  | "cronRunsDeliveryStatuses"
  | "cronRunsStatusFilter"
  | "cronRunsQuery"
  | "cronRunsSortDir"
  | "cronError"
>;

export type CronCapabilityManageState = Pick<
  CronState,
  | "client"
  | "connected"
  | "cronBusy"
  | "cronError"
  | "cronForm"
  | "cronFieldErrors"
  | "cronEditingJobId"
  | "cronJobs"
  | "cronRunsScope"
  | "cronRunsJobId"
  | "cronRuns"
  | "cronRunsTotal"
  | "cronRunsHasMore"
  | "cronRunsNextOffset"
  | "cronStatus"
>;

export type CronCapabilityFormState = Pick<
  CronState,
  "cronForm" | "cronFieldErrors" | "cronEditingJobId" | "cronRunsJobId" | "cronJobs"
>;

export type CronCapabilityJob = CronJob;
export type CronCapabilityForm = CronFormState;
export type CronCapabilityFieldErrors = CronFieldErrors;

export const cronCapability = {
  normalizeForm: normalizeCronFormState,
  validateForm: validateCronForm,
  /**
   * Pin a surface to the signed-in user's own cron jobs. Personal surfaces
   * ("我的定时任务") call this before loading so every cron request carries
   * `ownerScope: "personal"`; the gateway resolves the owner from the session,
   * so it can only narrow. Switching the flag clears the cached list to avoid
   * showing a broader session's jobs while the scoped reload is in flight.
   */
  setPersonalScopeOnly: (state: CronCapabilityJobsState, personalOnly: boolean) => {
    // Compare normalized values: an unset flag already means "admin surface", so
    // an explicit `false` must not count as a change and wipe a loaded list.
    if ((state.cronPersonalScopeOnly ?? false) === personalOnly) {
      return;
    }
    state.cronPersonalScopeOnly = personalOnly;
    resetCronJobsState(state);
  },
  resetJobs: (state: CronCapabilityJobsState) => resetCronJobsState(state),
  loadStatus: (state: CronCapabilityStatusState) => loadCronStatus(state as unknown as CronState),
  loadModelSuggestions: (state: CronCapabilityModelSuggestionsState) =>
    loadCronModelSuggestions(state),
  loadJobs: (state: CronCapabilityJobsState) => loadCronJobs(state as unknown as CronState),
  loadMoreJobs: (state: CronCapabilityJobsState) => loadMoreCronJobs(state as unknown as CronState),
  reloadJobs: (state: CronCapabilityJobsState) => reloadCronJobs(state as unknown as CronState),
  updateJobsFilter: (state: CronCapabilityJobsState, patch: CronCapabilityJobsFilterPatch) =>
    updateCronJobsFilter(state as unknown as CronState, patch),
  loadRuns: (state: CronCapabilityRunsState, jobId: string | null, opts?: { append?: boolean }) =>
    loadCronRuns(state as unknown as CronState, jobId, opts),
  loadMoreRuns: (state: CronCapabilityRunsState) => loadMoreCronRuns(state as unknown as CronState),
  updateRunsFilter: (state: CronCapabilityRunsState, patch: CronCapabilityRunsFilterPatch) =>
    updateCronRunsFilter(state as unknown as CronState, patch),
  addJob: (state: CronCapabilityManageState) => addCronJob(state as unknown as CronState),
  startEdit: (state: CronCapabilityFormState, job: CronCapabilityJob) =>
    startCronEdit(state as unknown as CronState, job),
  startClone: (state: CronCapabilityFormState, job: CronCapabilityJob) =>
    startCronClone(state as unknown as CronState, job),
  cancelEdit: (state: CronCapabilityFormState) => cancelCronEdit(state as unknown as CronState),
  toggleJob: (state: CronCapabilityManageState, job: CronCapabilityJob, enabled: boolean) =>
    toggleCronJob(state as unknown as CronState, job, enabled),
  runJob: (
    state: CronCapabilityManageState,
    job: CronCapabilityJob,
    mode: "force" | "due" = "force",
  ) => runCronJob(state as unknown as CronState, job, mode),
  removeJob: (state: CronCapabilityManageState, job: CronCapabilityJob) =>
    removeCronJob(state as unknown as CronState, job),
} as const;
