import { describe, expect, it, vi } from "vitest";
import { CRON_COMPLETION_EMPTY_PREFIX } from "./completion-contract.js";
import { CRON_ACCOUNT_MISSING_PREFIX } from "./sandbox-account-preflight.js";
import { createIsolatedRegressionJob } from "./service.issue-regressions.test-helpers.js";
import { createCronServiceState } from "./service/state.js";
import { applyJobResult } from "./service/timer.js";

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

describe("applyJobResult P4 account-missing / empty soft-alert", () => {
  it("disables job on cron_account:missing (fail-closed, non-success)", () => {
    const startedAt = Date.parse("2026-10-29T08:00:00.000Z");
    const endedAt = startedAt + 20;
    const enqueueSystemEvent = vi.fn();
    const state = createCronServiceState({
      cronEnabled: true,
      storePath: "/tmp/cron-p4-account-missing.json",
      log: noopLogger as never,
      nowMs: () => endedAt,
      enqueueSystemEvent,
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(),
      cronConfig: {
        failureAlert: {
          enabled: true,
          after: 1,
          cooldownMs: 0,
          channel: "last",
        },
      } as never,
    });

    const job = createIsolatedRegressionJob({
      id: "p4-account-missing",
      name: "p4-account-missing",
      scheduledAt: startedAt,
      schedule: { kind: "every", everyMs: 60_000, anchorMs: startedAt - 60_000 },
      payload: { kind: "agentTurn", message: "ping" },
      state: { nextRunAtMs: startedAt - 1_000, runningAtMs: startedAt - 500 },
    });

    const shouldDelete = applyJobResult(state, job, {
      status: "error",
      error: `${CRON_ACCOUNT_MISSING_PREFIX} Managed multitenant sandbox requires job.ownership`,
      startedAt,
      endedAt,
    });

    expect(shouldDelete).toBe(false);
    expect(job.enabled).toBe(false);
    expect(job.state.nextRunAtMs).toBeUndefined();
    expect(job.state.lastStatus).toBe("error");
    expect(job.state.lastError?.startsWith(CRON_ACCOUNT_MISSING_PREFIX)).toBe(true);
    expect(job.state.consecutiveErrors).toBeGreaterThanOrEqual(1);
    expect(noopLogger.warn).toHaveBeenCalled();
    // Soft/failure alert path must not leak raw secrets — truncated error only.
    const alertText = String(enqueueSystemEvent.mock.calls[0]?.[0] ?? "");
    if (alertText) {
      expect(alertText).not.toMatch(/password|token|secret|api[_-]?key/i);
      expect(alertText).toContain("cron_account:missing");
    }
  });

  it("disables job on raw managed sandbox server-derived account error", () => {
    const startedAt = Date.parse("2026-10-29T08:30:00.000Z");
    const endedAt = startedAt + 4200;
    const enqueueSystemEvent = vi.fn();
    const state = createCronServiceState({
      cronEnabled: true,
      storePath: "/tmp/cron-p4-raw-sandbox-account.json",
      log: noopLogger as never,
      nowMs: () => endedAt,
      enqueueSystemEvent,
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(),
      cronConfig: {
        failureAlert: {
          enabled: true,
          after: 1,
          cooldownMs: 0,
          channel: "last",
        },
      } as never,
    });

    const job = createIsolatedRegressionJob({
      id: "p4-raw-sandbox-account",
      name: "daily-update",
      scheduledAt: startedAt,
      schedule: { kind: "every", everyMs: 60_000, anchorMs: startedAt - 60_000 },
      payload: { kind: "agentTurn", message: "daily update" },
      state: { nextRunAtMs: startedAt - 1_000, runningAtMs: startedAt - 500 },
    });

    const shouldDelete = applyJobResult(state, job, {
      status: "error",
      error: "Managed multitenant sandbox requires a server-derived account (tenantId and userId).",
      startedAt,
      endedAt,
    });

    expect(shouldDelete).toBe(false);
    expect(job.enabled).toBe(false);
    expect(job.state.nextRunAtMs).toBeUndefined();
    expect(job.state.consecutiveErrors).toBeGreaterThanOrEqual(1);
  });

  it("records empty completion as non-success with deduped soft-alert", () => {
    const startedAt = Date.parse("2026-10-29T09:00:00.000Z");
    const endedAt = startedAt + 15;
    let now = endedAt;
    const enqueueSystemEvent = vi.fn();
    const state = createCronServiceState({
      cronEnabled: true,
      storePath: "/tmp/cron-p4-empty.json",
      log: noopLogger as never,
      nowMs: () => now,
      enqueueSystemEvent,
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(),
    });

    const job = createIsolatedRegressionJob({
      id: "p4-empty",
      name: "p4-empty",
      scheduledAt: startedAt,
      schedule: { kind: "at", at: new Date(startedAt).toISOString() },
      payload: { kind: "agentTurn", message: "ping" },
      state: { nextRunAtMs: startedAt - 1_000, runningAtMs: startedAt - 500 },
    });

    const emptyError = `${CRON_COMPLETION_EMPTY_PREFIX} no deliverable produced`;
    const shouldDelete = applyJobResult(state, job, {
      status: "error",
      error: emptyError,
      startedAt,
      endedAt,
    });

    expect(shouldDelete).toBe(false);
    expect(job.state.lastStatus).toBe("error");
    expect(job.state.lastError?.startsWith(CRON_COMPLETION_EMPTY_PREFIX)).toBe(true);
    // Empty is a completion hold: consecutiveErrors must not climb as transport failure.
    expect(job.state.consecutiveErrors ?? 0).toBe(0);
    expect(enqueueSystemEvent).toHaveBeenCalledTimes(1);
    const text = String(enqueueSystemEvent.mock.calls[0]?.[0] ?? "");
    expect(text).toContain("cron_completion:empty");
    expect(text).not.toMatch(/password|token|secret|api[_-]?key/i);
    expect(typeof job.state.lastFailureAlertAtMs).toBe("number");
    // One-shot at + completion hold disables (not success delete).
    expect(job.enabled).toBe(false);

    // Dedup within default cooldown: second empty must not re-alert.
    now = endedAt + 1_000;
    job.enabled = true;
    applyJobResult(state, job, {
      status: "error",
      error: emptyError,
      startedAt: now,
      endedAt: now + 10,
    });
    expect(enqueueSystemEvent).toHaveBeenCalledTimes(1);
  });

  it("does not treat empty completion as ok / deleteAfterRun success", () => {
    const startedAt = Date.parse("2026-10-29T10:00:00.000Z");
    const endedAt = startedAt + 10;
    const state = createCronServiceState({
      cronEnabled: true,
      storePath: "/tmp/cron-p4-empty-delete.json",
      log: noopLogger as never,
      nowMs: () => endedAt,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob: vi.fn(),
    });
    const job = createIsolatedRegressionJob({
      id: "p4-empty-at",
      name: "p4-empty-at",
      scheduledAt: startedAt,
      schedule: { kind: "at", at: new Date(startedAt).toISOString() },
      payload: { kind: "agentTurn", message: "ping" },
      state: { nextRunAtMs: startedAt - 1_000, runningAtMs: startedAt - 500 },
    });
    job.deleteAfterRun = true;

    const shouldDelete = applyJobResult(state, job, {
      status: "error",
      error: `${CRON_COMPLETION_EMPTY_PREFIX} blank`,
      startedAt,
      endedAt,
    });
    expect(shouldDelete).toBe(false);
    expect(job.state.lastStatus).not.toBe("ok");
  });
});
