/**
 * Child-process worker: one claimStallContinue against a shared ledgerDir.
 * Proves O_EXCL slot claims across real OS processes (not same-loop microtasks).
 */
const ledgerDir = process.env.OPENBOT_STALL_LEDGER_DIR;
const sessionKey = process.env.OPENBOT_STALL_SESSION_KEY;
const quotaCycleId = process.env.OPENBOT_STALL_QUOTA_CYCLE_ID;
const nowMs = Number.parseInt(process.env.OPENBOT_STALL_NOW_MS ?? "", 10);
const workerId = process.env.OPENBOT_STALL_WORKER_ID ?? "w";

if (!ledgerDir || !sessionKey || !quotaCycleId || !Number.isFinite(nowMs)) {
  console.error("worker-misconfigured");
  process.exit(2);
}

const { claimStallContinue } = await import("../stall-continue-ledger.ts");
const result = claimStallContinue({
  ledgerDir,
  sessionKey,
  quotaCycleId,
  nowMs,
  kind: `worker:${workerId}`,
});

if (result.allowed) {
  console.log(`claim-ok:${workerId}:slot:${result.claimedSlot}:used:${result.continuesUsed}`);
} else {
  console.log(`claim-fail:${workerId}:reason:${result.stopReason ?? "denied"}`);
}
