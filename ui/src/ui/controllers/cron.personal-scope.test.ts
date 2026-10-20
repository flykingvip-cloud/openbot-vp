import { describe, expect, it, vi } from "vitest";
import { loadCronJobsPage, loadCronRuns, resetCronJobsState, type CronState } from "./cron.ts";

type RequestSpy = ReturnType<typeof vi.fn>;

function makeJob(id: string) {
  return { id, name: id } as unknown as CronState["cronJobs"][number];
}

function makeState(
  overrides: Partial<CronState> = {},
): CronState & { client: { request: RequestSpy } } {
  const request = vi.fn().mockResolvedValue({ jobs: [makeJob("job-own")], total: 1 });
  return {
    client: { request } as never,
    connected: true,
    cronLoading: false,
    cronJobsLoadingMore: false,
    cronJobs: [],
    cronJobsTotal: 0,
    cronJobsHasMore: false,
    cronJobsNextOffset: null,
    cronJobsLimit: 50,
    cronJobsQuery: "",
    cronJobsEnabledFilter: "all",
    cronJobsScheduleKindFilter: "all",
    cronJobsLastStatusFilter: "all",
    cronJobsSortBy: "nextRunAtMs",
    cronJobsSortDir: "asc",
    cronStatus: null,
    cronError: null,
    cronForm: {} as never,
    cronFieldErrors: {},
    cronEditingJobId: null,
    cronRunsJobId: null,
    cronRunsLoadingMore: false,
    cronRuns: [],
    cronRunsTotal: 0,
    cronRunsHasMore: false,
    cronRunsNextOffset: null,
    cronRunsLimit: 50,
    cronRunsScope: "all",
    cronRunsStatuses: [],
    cronRunsDeliveryStatuses: [],
    cronRunsStatusFilter: "all",
    cronRunsQuery: "",
    cronRunsSortDir: "desc",
    cronBusy: false,
    ...overrides,
  } as CronState & { client: { request: RequestSpy } };
}

describe("cron personal scope (UI)", () => {
  it("sends ownerScope personal when the surface is personal-only", async () => {
    const state = makeState({ cronPersonalScopeOnly: true });
    await loadCronJobsPage(state);
    const params = state.client.request.mock.calls[0]?.[1] as { ownerScope?: string };
    expect(params.ownerScope).toBe("personal");
  });

  it("omits ownerScope for admin surfaces", async () => {
    const state = makeState();
    await loadCronJobsPage(state);
    const params = state.client.request.mock.calls[0]?.[1] as { ownerScope?: string };
    expect(params.ownerScope).toBeUndefined();
  });

  it("clears a stale list when a refresh fails", async () => {
    const state = makeState({
      cronJobs: [makeJob("job-from-previous-session")],
      cronJobsTotal: 1,
      cronJobsHasMore: true,
      cronJobsNextOffset: 50,
      cronEditingJobId: "job-from-previous-session",
    });
    state.client.request.mockRejectedValue(new Error("not authorized"));

    await loadCronJobsPage(state);

    expect(state.cronJobs).toEqual([]);
    expect(state.cronJobsTotal).toBe(0);
    expect(state.cronJobsHasMore).toBe(false);
    expect(state.cronJobsNextOffset).toBeNull();
    // The pending edit target survives: dropping it would turn the next save
    // into a duplicate `cron.add` instead of an update.
    expect(state.cronEditingJobId).toBe("job-from-previous-session");
    expect(state.cronError).toContain("not authorized");
  });

  it("keeps already loaded pages when an append fails", async () => {
    const state = makeState({
      cronJobs: [makeJob("job-own")],
      cronJobsTotal: 2,
      cronJobsHasMore: true,
      cronJobsNextOffset: 1,
    });
    state.client.request.mockRejectedValue(new Error("boom"));

    await loadCronJobsPage(state, { append: true });

    expect(state.cronJobs.map((job) => job.id)).toEqual(["job-own"]);
  });

  it("drops cached jobs when the gateway session is gone", async () => {
    const state = makeState({
      connected: false,
      cronJobs: [makeJob("job-from-previous-session")],
      cronJobsTotal: 1,
      cronRuns: [{ jobId: "job-from-previous-session" } as never],
      cronRunsJobId: "job-from-previous-session",
    });

    await loadCronJobsPage(state);

    expect(state.cronJobs).toEqual([]);
    expect(state.cronRuns).toEqual([]);
    expect(state.cronRunsJobId).toBeNull();
    expect(state.client.request).not.toHaveBeenCalled();
  });

  it("resetCronJobsState clears list and run pagination together", () => {
    const state = makeState({
      cronJobs: [makeJob("job-own")],
      cronJobsTotal: 3,
      cronJobsHasMore: true,
      cronJobsNextOffset: 2,
      cronRuns: [{ jobId: "job-own" } as never],
      cronRunsTotal: 5,
      cronRunsHasMore: true,
      cronRunsNextOffset: 4,
      cronRunsJobId: "job-own",
    });

    resetCronJobsState(state);

    expect(state.cronJobs).toEqual([]);
    expect(state.cronJobsTotal).toBe(0);
    expect(state.cronJobsNextOffset).toBeNull();
    expect(state.cronRuns).toEqual([]);
    expect(state.cronRunsTotal).toBe(0);
    expect(state.cronRunsHasMore).toBe(false);
    expect(state.cronRunsNextOffset).toBeNull();
    expect(state.cronRunsJobId).toBeNull();
  });
});

describe("cron run-log state hygiene", () => {
  it("clears stale run entries when a runs refresh is rejected", async () => {
    const state = makeState({
      cronRunsScope: "job",
      cronRunsJobId: "job-colleague",
      cronRuns: [{ jobId: "job-colleague" } as never],
      cronRunsTotal: 1,
      cronRunsHasMore: true,
      cronRunsNextOffset: 1,
    });
    state.client.request.mockRejectedValue(new Error("not authorized for this cron job"));

    await loadCronRuns(state, "job-colleague");

    expect(state.cronRuns).toEqual([]);
    expect(state.cronRunsTotal).toBe(0);
    expect(state.cronRunsHasMore).toBe(false);
    expect(state.cronRunsNextOffset).toBeNull();
    expect(state.cronRunsJobId).toBeNull();
    expect(state.cronError).toContain("not authorized");
  });

  it("keeps the selected run detail when only the job list fails", async () => {
    const state = makeState({
      cronJobs: [makeJob("job-own")],
      cronRuns: [{ jobId: "job-own" } as never],
      cronRunsJobId: "job-own",
      cronRunsTotal: 1,
    });
    state.client.request.mockRejectedValue(new Error("boom"));

    await loadCronJobsPage(state);

    expect(state.cronJobs).toEqual([]);
    // A transient list error must not deselect the run panel being read.
    expect(state.cronRunsJobId).toBe("job-own");
    expect(state.cronRuns).toHaveLength(1);
  });

  it("sends ownerScope personal on run-log reads for personal surfaces", async () => {
    const state = makeState({ cronPersonalScopeOnly: true, cronRunsScope: "all" });
    state.client.request.mockResolvedValue({ entries: [], total: 0 });

    await loadCronRuns(state, null);

    const params = state.client.request.mock.calls[0]?.[1] as { ownerScope?: string };
    expect(params.ownerScope).toBe("personal");
  });
});

describe("cronCapability.setPersonalScopeOnly", () => {
  it("does not wipe an admin list when explicitly set to false", async () => {
    const { cronCapability } = await import("../capability/cron/facade.ts");
    const state = makeState({ cronJobs: [makeJob("job-a")], cronJobsTotal: 1 });

    // Unset already means "admin surface"; an explicit false is not a change.
    cronCapability.setPersonalScopeOnly(state, false);

    expect(state.cronJobs).toHaveLength(1);
    expect(state.cronJobsTotal).toBe(1);
  });

  it("clears cached jobs when switching into personal scope", async () => {
    const { cronCapability } = await import("../capability/cron/facade.ts");
    const state = makeState({
      cronJobs: [makeJob("job-a")],
      cronJobsTotal: 1,
      cronRuns: [{ jobId: "job-a" } as never],
      cronRunsJobId: "job-a",
    });

    cronCapability.setPersonalScopeOnly(state, true);

    expect(state.cronPersonalScopeOnly).toBe(true);
    expect(state.cronJobs).toEqual([]);
    expect(state.cronRuns).toEqual([]);
    expect(state.cronRunsJobId).toBeNull();
  });

  it("clears cached jobs when leaving personal scope", async () => {
    const { cronCapability } = await import("../capability/cron/facade.ts");
    const state = makeState({
      cronPersonalScopeOnly: true,
      cronJobs: [makeJob("job-own")],
      cronJobsTotal: 1,
    });

    cronCapability.setPersonalScopeOnly(state, false);

    expect(state.cronPersonalScopeOnly).toBe(false);
    expect(state.cronJobs).toEqual([]);
  });
});
