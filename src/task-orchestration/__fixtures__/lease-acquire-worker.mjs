/**
 * Child-process worker: one tryAcquireLease against a shared rootDir.
 */
const rootDir = process.env.OPENBOT_LEASE_ROOT;
const jobStepId = process.env.OPENBOT_LEASE_JOB_STEP_ID;
const holder = process.env.OPENBOT_LEASE_HOLDER;
const nowMs = Number.parseInt(process.env.OPENBOT_LEASE_NOW_MS ?? "", 10);
const leaseTtlMs = Number.parseInt(process.env.OPENBOT_LEASE_TTL_MS ?? "30000", 10);

if (!rootDir || !jobStepId || !holder || !Number.isFinite(nowMs)) {
  console.error("worker-misconfigured");
  process.exit(2);
}

const { createOrchLeaseStore } = await import("../lease-store.ts");
const store = createOrchLeaseStore({ rootDir });
const result = store.tryAcquireLease({
  jobStepId,
  holder,
  nowMs,
  leaseTtlMs,
});

if (result.ok) {
  console.log(`acquire-ok:${result.record.leaseHolder}`);
} else {
  console.log(`acquire-fail:${result.reason}`);
}
