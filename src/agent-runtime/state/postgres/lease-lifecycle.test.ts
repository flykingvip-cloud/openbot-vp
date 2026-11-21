import { afterEach, expect, it, vi } from "vitest";
import type { PostgresExecutionRepository } from "./execution.js";
import { acquireExecutionLease } from "./lease-lifecycle.js";
afterEach(() => vi.useRealTimers());
function repository(renew = vi.fn(async () => true)) {
  return {
    claim: vi.fn(async () => ({ fence: "2", version: "3" })),
    renew,
  } as unknown as PostgresExecutionRepository;
}
it("propagates parent cancellation and stops renewal on disposal", async () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const renew = vi.fn(async () => true);
  const repo = repository(renew);
  const lease = await acquireExecutionLease({
    repository: repo,
    tenantId: "tenant",
    executionId: "execution",
    owner: "worker",
    parentSignal: parent.signal,
    leaseMs: 300,
  });
  await vi.advanceTimersByTimeAsync(100);
  expect(renew).toHaveBeenCalledTimes(1);
  parent.abort("cancelled");
  expect(lease.signal.reason).toBe("cancelled");
  await lease.dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(["rejected", "error"])("aborts execution when renewal is %s", async (mode) => {
  vi.useFakeTimers();
  const renew = vi.fn(async () => {
    if (mode === "error") {
      throw new Error("database unavailable");
    }
    return false;
  });
  const lease = await acquireExecutionLease({
    repository: repository(renew),
    tenantId: "tenant",
    executionId: "execution",
    owner: "worker",
    leaseMs: 300,
  });
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(lease.signal.aborted).toBe(true);
  } finally {
    await lease.dispose();
  }
});
it("rejects missing trusted identity before claiming", async () => {
  const repo = repository();
  await expect(
    acquireExecutionLease({ repository: repo, tenantId: "", executionId: "e", owner: "w" }),
  ).rejects.toThrow("Trusted");
});

it("aborts at local lease expiry even when database renewal never resolves", async () => {
  vi.useFakeTimers();
  let finish!: (value: boolean) => void;
  const renew = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const lease = await acquireExecutionLease({
    repository: repository(renew),
    tenantId: "tenant",
    executionId: "execution",
    owner: "worker",
    leaseMs: 300,
  });
  await vi.advanceTimersByTimeAsync(301);
  expect(lease.signal.aborted).toBe(true);
  expect(String(lease.signal.reason)).toContain("deadline exceeded");
  expect(renew).toHaveBeenCalledTimes(1);
  finish(true);
  await lease.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds disposal of a permanently hung renewal", async () => {
  vi.useFakeTimers();
  const renew = vi.fn(() => new Promise<boolean>(() => {}));
  const lease = await acquireExecutionLease({
    repository: repository(renew),
    tenantId: "tenant",
    executionId: "execution",
    owner: "worker",
    leaseMs: 300,
  });
  await vi.advanceTimersByTimeAsync(100);
  const disposal = expect(lease.dispose()).rejects.toThrow("Lease disposal deadline exceeded");
  await vi.advanceTimersByTimeAsync(12000);
  await disposal;
  expect(lease.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
