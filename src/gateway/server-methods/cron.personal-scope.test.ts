import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveQueryScopeMock = vi.fn();
const resolveTrustedAttributionMock = vi.fn();
const readCronRunLogEntriesPageAllMock = vi.fn();
const readCronRunLogEntriesPageMock = vi.fn();

vi.mock("../scope-attribution.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scope-attribution.js")>();
  return {
    ...actual,
    resolveQueryScope: resolveQueryScopeMock,
    resolveTrustedAttribution: resolveTrustedAttributionMock,
  };
});

vi.mock("../../cron/run-log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cron/run-log.js")>();
  return {
    ...actual,
    readCronRunLogEntriesPageAll: readCronRunLogEntriesPageAllMock,
    readCronRunLogEntriesPage: readCronRunLogEntriesPageMock,
  };
});

const OWN_JOB = {
  id: "job-own",
  name: "我的巡检",
  ownership: { ownerId: "user-self", tenantId: "001" },
};
const COLLEAGUE_JOB = {
  id: "job-colleague",
  name: "股市分析",
  ownership: { ownerId: "user-colleague", tenantId: "001" },
};
const ALL_JOBS = [OWN_JOB, COLLEAGUE_JOB];

function captureRespond() {
  const calls: Array<{
    ok: boolean;
    payload?: unknown;
    error?: { code?: string; message?: string };
  }> = [];
  return {
    calls,
    respond: (ok: boolean, payload?: unknown, error?: { code?: string; message?: string }) => {
      calls.push({ ok, payload, error });
    },
  };
}

/** Minimal cron context: listPage applies the handler-provided visibility filter. */
function makeContext() {
  const enqueueRun = vi.fn().mockResolvedValue({ queued: true });
  const update = vi.fn().mockResolvedValue(OWN_JOB);
  const remove = vi.fn().mockResolvedValue({ removed: true });
  return {
    enqueueRun,
    update,
    remove,
    context: {
      cronStorePath: "/tmp/openbot-test/cron/jobs.json",
      logGateway: { info: vi.fn(), warn: vi.fn() },
      cron: {
        getJob: (jobId: string) => ALL_JOBS.find((job) => job.id === jobId),
        list: vi.fn().mockResolvedValue(ALL_JOBS),
        listPage: vi.fn(
          async (opts: {
            scopeVisible?: (ownership: { ownerId?: string; tenantId?: string }) => boolean;
          }) => {
            const jobs = opts.scopeVisible
              ? ALL_JOBS.filter((job) => opts.scopeVisible?.(job.ownership))
              : ALL_JOBS;
            return { jobs, total: jobs.length, offset: 0, limit: 50, hasMore: false };
          },
        ),
        enqueueRun,
        update,
        remove,
      },
    },
  };
}

/** An enterprise-admin cookie: the session that leaked a colleague's job. */
const ENTERPRISE_CLIENT = { sessionDomain: "enterprise", user: "self@test.com" } as never;

describe("cron personal scope authorization", () => {
  beforeEach(() => {
    // Without an explicit personal scope this session sees the whole tenant.
    resolveQueryScopeMock.mockResolvedValue({ kind: "tenant", tenantId: "001" });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-self", tenantId: "001" });
    readCronRunLogEntriesPageAllMock.mockResolvedValue({
      entries: [],
      total: 0,
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
    });
    readCronRunLogEntriesPageMock.mockResolvedValue({
      entries: [],
      total: 0,
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("cron.list keeps a tenant-wide session on its own jobs when ownerScope is personal", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.list"]({
      params: { ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    const payload = capture.calls[0]?.payload as { jobs: Array<{ id: string }> } | undefined;
    expect(payload?.jobs.map((job) => job.id)).toEqual(["job-own"]);
  });

  it("cron.list still honors the session scope when ownerScope is absent", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.list"]({
      params: {},
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    const payload = capture.calls[0]?.payload as { jobs: Array<{ id: string }> } | undefined;
    expect(payload?.jobs.map((job) => job.id)).toEqual(["job-own", "job-colleague"]);
  });

  it("cron.list fails closed when a personal request has no identified owner", async () => {
    resolveTrustedAttributionMock.mockResolvedValue({ tenantId: "001" });
    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.list"]({
      params: { ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(capture.calls[0]?.error?.message).toContain("personal cron scope");
    expect(context.cron.listPage).not.toHaveBeenCalled();
  });

  it("cron.run rejects a colleague's job under personal scope and never enqueues", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context, enqueueRun } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.run"]({
      params: { id: COLLEAGUE_JOB.id, ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(capture.calls[0]?.error?.message).toBe("not authorized for this cron job");
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("cron.run enqueues the caller's own job under personal scope", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context, enqueueRun } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.run"]({
      params: { id: OWN_JOB.id, ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    expect(enqueueRun).toHaveBeenCalledWith(OWN_JOB.id, "force");
  });

  it("cron.run authorizes tenant scope even without ownerScope", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "self", ownerId: "user-self" });
    const { cronHandlers } = await import("./cron.js");
    const { context, enqueueRun } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.run"]({
      params: { id: COLLEAGUE_JOB.id },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("cron.update rejects a colleague's job under personal scope", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context, update } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.update"]({
      params: { id: COLLEAGUE_JOB.id, patch: { enabled: false }, ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("cron.remove rejects a colleague's job under personal scope", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context, remove } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.remove"]({
      params: { id: COLLEAGUE_JOB.id, ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("cron.runs rejects a colleague's job history under personal scope", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.runs"]({
      params: { scope: "job", id: COLLEAGUE_JOB.id, ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(readCronRunLogEntriesPageMock).not.toHaveBeenCalled();
  });

  it("cron.runs restricts the aggregate history to the caller's own jobs", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.runs"]({
      params: { scope: "all", ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    const opts = readCronRunLogEntriesPageAllMock.mock.calls[0]?.[0] as {
      allowedJobIds?: string[];
      jobNameById?: Record<string, string>;
    };
    expect(opts.allowedJobIds).toEqual(["job-own"]);
    expect(Object.keys(opts.jobNameById ?? {})).toEqual(["job-own"]);
  });

  it("cron.runs stays unrestricted for platform scope", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.runs"]({
      params: { scope: "all" },
      respond: capture.respond,
      client: { sessionDomain: "platform", user: "root@test.com" } as never,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    const opts = readCronRunLogEntriesPageAllMock.mock.calls[0]?.[0] as {
      allowedJobIds?: string[];
    };
    expect(opts.allowedJobIds).toBeUndefined();
  });
});

describe("cron personal scope intersects the session scope", () => {
  beforeEach(() => {
    readCronRunLogEntriesPageMock.mockResolvedValue({
      entries: [],
      total: 0,
      offset: 0,
      limit: 50,
      hasMore: false,
      nextOffset: null,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hides the caller's own job from another tenant's session", async () => {
    // Same user, two memberships: the session is bound to tenant 002, the job
    // lives in tenant 001. Narrowing on the owner axis must not widen tenants.
    resolveQueryScopeMock.mockResolvedValue({ kind: "tenant", tenantId: "002" });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-self", tenantId: "002" });

    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.list"]({
      params: { ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    const payload = capture.calls[0]?.payload as { jobs: Array<{ id: string }> } | undefined;
    expect(payload?.jobs).toEqual([]);
  });

  it("refuses to run the caller's own job from another tenant's session", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "tenant", tenantId: "002" });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-self", tenantId: "002" });

    const { cronHandlers } = await import("./cron.js");
    const { context, enqueueRun } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.run"]({
      params: { id: OWN_JOB.id, ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("still allows a platform session to run any job", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });

    const { cronHandlers } = await import("./cron.js");
    const { context, enqueueRun } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.run"]({
      params: { id: COLLEAGUE_JOB.id },
      respond: capture.respond,
      client: { sessionDomain: "platform", user: "root@test.com" } as never,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    expect(enqueueRun).toHaveBeenCalledWith(COLLEAGUE_JOB.id, "force");
  });

  it("rejects run history for a deleted job instead of exposing orphaned logs", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.runs"]({
      params: { scope: "job", id: "job-deleted-after-run", ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(capture.calls[0]?.error?.message).toBe("not authorized for this cron job");
    expect(readCronRunLogEntriesPageMock).not.toHaveBeenCalled();
  });

  it("authorizes the jobId param variant the same way as id", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context, remove } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.remove"]({
      params: { jobId: COLLEAGUE_JOB.id, ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("reads own run history when the job still exists", async () => {
    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.runs"]({
      params: { scope: "job", id: OWN_JOB.id, ownerScope: "personal" },
      respond: capture.respond,
      client: ENTERPRISE_CLIENT,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    expect(readCronRunLogEntriesPageMock).toHaveBeenCalledTimes(1);
  });
});

describe("cron personal scope edge cases", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pins a platform admin to their own jobs on their personal surface", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-self" });

    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.list"]({
      params: { ownerScope: "personal" },
      respond: capture.respond,
      client: { sessionDomain: "platform", user: "root@test.com" } as never,
      context: context as never,
    } as never);

    const payload = capture.calls[0]?.payload as { jobs: Array<{ id: string }> } | undefined;
    expect(payload?.jobs.map((job) => job.id)).toEqual(["job-own"]);
  });

  it("refuses a platform admin's personal-scope run of someone else's job", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    resolveTrustedAttributionMock.mockResolvedValue({ ownerId: "user-self" });

    const { cronHandlers } = await import("./cron.js");
    const { context, enqueueRun } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.run"]({
      params: { id: COLLEAGUE_JOB.id, ownerScope: "personal" },
      respond: capture.respond,
      client: { sessionDomain: "platform", user: "root@test.com" } as never,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("keeps a local single-operator gateway usable instead of failing closed", async () => {
    // No platform-auth identity layer: no sessionDomain, no user, no ownerId.
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    resolveTrustedAttributionMock.mockResolvedValue({});

    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.list"]({
      params: { ownerScope: "personal" },
      respond: capture.respond,
      client: null,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(true);
    const payload = capture.calls[0]?.payload as { jobs: Array<{ id: string }> } | undefined;
    expect(payload?.jobs.map((job) => job.id)).toEqual(["job-own", "job-colleague"]);
  });

  it("still fails closed for a real session that cannot be attributed", async () => {
    resolveQueryScopeMock.mockResolvedValue({ kind: "platform" });
    resolveTrustedAttributionMock.mockResolvedValue({});

    const { cronHandlers } = await import("./cron.js");
    const { context } = makeContext();
    const capture = captureRespond();

    await cronHandlers["cron.list"]({
      params: { ownerScope: "personal" },
      respond: capture.respond,
      client: { sessionDomain: "employee", user: "self@test.com" } as never,
      context: context as never,
    } as never);

    expect(capture.calls[0]?.ok).toBe(false);
    expect(context.cron.listPage).not.toHaveBeenCalled();
  });
});
