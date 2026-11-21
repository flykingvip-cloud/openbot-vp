import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  root: vi.fn(() => "/tmp/authorized-audit"),
  assert: vi.fn(),
}));
vi.mock("./reconcile-audit.js", () => ({ reconcileCommittedInvocationAudits: mocks.scan }));
vi.mock("../tenant-store-paths.js", () => ({
  resolveTenantRuntimeStateRootForContext: mocks.root,
  assertWithinTenantRoot: mocks.assert,
}));
import { startInvocationAuditRecovery } from "./audit-recovery-scheduler.js";
const grant = {
  principalId: "service",
  context: { tenantId: "tenant", userId: "user", domain: "enterprise" as const },
  agentIds: ["allowed"],
};
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("rechecks authority and blocks a revoked grant before scanning", async () => {
  vi.useFakeTimers();
  const authorize = vi
    .fn()
    .mockResolvedValueOnce(grant)
    .mockResolvedValue({ ...grant, context: { ...grant.context, tenantId: "other" } });
  const onError = vi.fn();
  const scheduler = startInvocationAuditRecovery({
    tenantId: "tenant",
    authorize,
    onError,
    intervalMs: 100,
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.scan).toHaveBeenCalledTimes(1);
  expect(mocks.scan).toHaveBeenCalledWith(
    expect.objectContaining({ agentIds: ["allowed"], userId: "user", tenantId: "tenant" }),
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(mocks.scan).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledTimes(1);
  await scheduler.stop();
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds shutdown during hung authorization and never scans after late resolution", async () => {
  vi.useFakeTimers();
  let resolve!: (value: typeof grant) => void;
  const scheduler = startInvocationAuditRecovery({
    tenantId: "tenant",
    authorize: () =>
      new Promise((done) => {
        resolve = done;
      }),
    onError: vi.fn(),
    intervalMs: 100,
  });
  const stopping = expect(scheduler.stop()).rejects.toThrow("deadline exceeded");
  await vi.advanceTimersByTimeAsync(12000);
  await stopping;
  expect(vi.getTimerCount()).toBe(0);
  resolve(grant);
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.scan).not.toHaveBeenCalled();
});
it("retries after projection failure without losing scheduling", async () => {
  vi.useFakeTimers();
  mocks.scan.mockImplementationOnce(() => {
    throw new Error("disk unavailable");
  });
  const onError = vi.fn();
  const scheduler = startInvocationAuditRecovery({
    tenantId: "tenant",
    authorize: async () => grant,
    onError,
    intervalMs: 100,
  });
  await vi.advanceTimersByTimeAsync(101);
  expect(mocks.scan).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(1);
  await scheduler.stop();
});
