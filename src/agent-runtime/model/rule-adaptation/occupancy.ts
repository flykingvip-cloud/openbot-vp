/**
 * Occupancy adapter for the governed shadow model port.
 *
 * Reuses existing model governance, and does not invent a second lease,
 * TTL, or billing-recovery system:
 * - In-memory turn slot: `createRunAdmissionLease` in
 *   `src/agent-runtime/model/admission-lease.ts` (held until explicit
 *   `dispose()`; no in-memory TTL).
 * - Commercial / agent-run slot: `tryAcquireAgentRunSlot` /
 *   `finishAgentRun` / `countActiveAgentRuns` in
 *   `src/gateway/billing/agent-run-registry.ts`, with tenant
 *   `maxConcurrentRuns` and `SEAT_CONCURRENCY_LIMIT_EXCEEDED`.
 * - Orphan recovery: `DEFAULT_AGENT_RUN_STALE_MS = 3 * 60 * 60 * 1000`,
 *   `resolveAgentRunStaleMs`, `reapStaleActiveAgentRunsOnStartup` /
 *   `reapStaleActiveAgentRunsInStore`. Reap is triggered when a later
 *   acquire hits the cap, and on startup — it is not a live timer on the
 *   in-memory JS session.
 *
 * `tryAcquireEnterpriseAgentRun` itself does not take a storePath and would
 * write the default production registry. This adapter always requires an
 * explicit `storePath` (tests must pass a temp file) and never writes
 * `CONFIG_DIR/openbot-agent-run-registry.json`.
 *
 * Production default stale policy is unchanged. Tests may pass a short
 * `staleMs` into the existing reap helpers; they must not mutate process
 * env as a standing config.
 *
 * After official stale reap has finished a registry record, disposing the
 * corresponding in-memory session reuses that existing limit. It is not a
 * new early-release of a still-running request's slot.
 *
 * Bounded: registry slots and acquired in-memory leases (once official reap
 * has finished the stale run and the matching session is disposed).
 * Not bounded: an abandoned never-returning Promise may remain pending
 * in-process; usage that arrives only after process exit cannot be posted.
 */
import type { AcquireAgentRunResult } from "../../../gateway/billing/agent-run-governance.js";
import {
  countActiveAgentRuns,
  finishAgentRun,
  reapStaleActiveAgentRunsOnStartup,
  resolveAgentRunStaleMs,
  resolveDefaultAgentRunRegistryStorePath,
  tryAcquireAgentRunSlot,
} from "../../../gateway/billing/agent-run-registry.js";
import type { ModelSessionPorts } from "../authorized-session.js";

export type ShadowHeldSession = {
  dispose: () => Promise<void> | void;
  readonly held?: boolean;
};

export type ShadowRegistryOccupancyOptions = {
  storePath: string;
  enterpriseId: string;
  maxConcurrentRuns: number;
  /** Optional short window for tests, passed to existing reap helpers. */
  staleMs?: number;
  allowBurstConcurrency?: boolean;
  maxBurstRuns?: number;
  billingSeatId?: string;
  seatMaxConcurrentRuns?: number;
  agentId?: string;
  botId?: string;
};

export type ShadowRegistryOccupancy = {
  admission: ModelSessionPorts["admission"];
  storePath: string;
  staleMs: number;
  maxConcurrentRuns: number;
  governanceOccupancyReady: true;
  watch(runId: string, session: ShadowHeldSession): void;
  unwatch(runId: string): void;
  countActiveSlots(): Promise<number>;
  countWatchedHeld(): number;
  /**
   * Call the existing startup/cap reap helper with the injectable staleMs,
   * then dispose watched sessions whose registry records were officially
   * finished. Does not finish fresh, still-running slots.
   */
  reapOfficiallyFinishedAndDispose(): Promise<{ reapedRunIds: string[] }>;
};

function assertInjectableStorePath(storePath: string): string {
  const trimmed = storePath.trim();
  if (!trimmed) {
    throw new Error("shadow occupancy requires an explicit injectable storePath");
  }
  const production = resolveDefaultAgentRunRegistryStorePath();
  if (trimmed === production) {
    throw new Error("shadow occupancy must not use the production agent-run registry path");
  }
  return trimmed;
}

export function createShadowRegistryOccupancy(
  options: ShadowRegistryOccupancyOptions,
): ShadowRegistryOccupancy {
  const storePath = assertInjectableStorePath(options.storePath);
  const staleMs = options.staleMs ?? resolveAgentRunStaleMs();
  const watched = new Map<string, ShadowHeldSession>();

  const unwatch = (runId: string): void => {
    watched.delete(runId);
  };

  const disposeReaped = async (reapedRunIds: readonly string[]): Promise<void> => {
    for (const runId of reapedRunIds) {
      const session = watched.get(runId);
      if (!session) {
        continue;
      }
      // Official reap already finished this stale registry record. Disposing
      // the in-memory lease reuses that existing limit; it does not early-
      // release a still-counted running slot.
      try {
        await session.dispose();
      } finally {
        unwatch(runId);
      }
    }
  };

  const reapOfficiallyFinishedAndDispose = async (): Promise<{ reapedRunIds: string[] }> => {
    const reaped = await reapStaleActiveAgentRunsOnStartup(storePath, staleMs);
    await disposeReaped(reaped.reapedRunIds);
    return reaped;
  };

  const tryAcquire = async (runId: string): Promise<AcquireAgentRunResult> => {
    const id = runId.trim();
    const attempt = () =>
      tryAcquireAgentRunSlot(
        {
          runId: id,
          enterpriseId: options.enterpriseId,
          maxConcurrentRuns: options.maxConcurrentRuns,
          allowBurstConcurrency: options.allowBurstConcurrency ?? false,
          ...(options.maxBurstRuns !== undefined ? { maxBurstRuns: options.maxBurstRuns } : {}),
          ...(options.billingSeatId ? { billingSeatId: options.billingSeatId } : {}),
          ...(options.seatMaxConcurrentRuns !== undefined
            ? { seatMaxConcurrentRuns: options.seatMaxConcurrentRuns }
            : {}),
          ...(options.agentId ? { agentId: options.agentId } : {}),
          ...(options.botId ? { botId: options.botId } : {}),
        },
        storePath,
      );

    let result = await attempt();
    if (
      !result.ok &&
      (result.reason === "CONCURRENCY_LIMIT_EXCEEDED" ||
        result.reason === "SEAT_CONCURRENCY_LIMIT_EXCEEDED")
    ) {
      // Same trigger as production tryAcquireAgentRunSlot: reap when a later
      // acquire hits the cap. We also pass the injectable staleMs, because
      // the registry helper's internal reap uses resolveAgentRunStaleMs()
      // (default 3h) and is not a substitute for the test window.
      const reaped = await reapOfficiallyFinishedAndDispose();
      if (reaped.reapedRunIds.length > 0) {
        result = await attempt();
      }
    }

    if (result.ok) {
      return {
        acquired: true,
        enterpriseId: options.enterpriseId,
        skipped: false,
      };
    }
    if (result.reason === "DUPLICATE_ACTIVE") {
      return {
        acquired: false,
        skipped: false,
        reason: "CONCURRENCY_LIMIT_EXCEEDED",
        message: "duplicate active agent run",
      };
    }
    return {
      acquired: false,
      skipped: false,
      reason: result.reason,
      message:
        result.reason === "SEAT_CONCURRENCY_LIMIT_EXCEEDED"
          ? "seat concurrency limit exceeded"
          : "concurrency limit exceeded",
    };
  };

  return {
    storePath,
    staleMs,
    maxConcurrentRuns: options.maxConcurrentRuns,
    governanceOccupancyReady: true,
    admission: {
      tryAcquireEnterpriseAgentRun: async (input) => tryAcquire(input.runId),
      releaseEnterpriseAgentRun: async (runId) => {
        await finishAgentRun(runId, storePath);
      },
    },
    watch(runId, session) {
      watched.set(runId, session);
    },
    unwatch,
    async countActiveSlots() {
      return countActiveAgentRuns(options.enterpriseId, storePath);
    },
    countWatchedHeld() {
      let held = 0;
      for (const session of watched.values()) {
        if (session.held !== false) {
          held += 1;
        }
      }
      return held;
    },
    reapOfficiallyFinishedAndDispose,
  };
}
