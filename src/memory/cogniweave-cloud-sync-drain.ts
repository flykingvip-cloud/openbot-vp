import {
  drainOutbox,
  FileLocalIntelligenceMirror,
  FileSyncOutbox,
  pullIntoMirror,
  type CloudAuthContext,
  type CloudIntelligenceClient,
  type DrainOutboxResult,
  type MirrorFreshness,
  type PullIntoMirrorResult,
} from "../../packages/cogniweave-sdk/src/index.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("memory/cogniweave-cloud-sync");

export type CogniWeaveCloudSyncTickResult = {
  drain: DrainOutboxResult;
  pull: PullIntoMirrorResult;
};

/**
 * CW2-P5 manager wiring — one async tick: outbox drain then mirror pull.
 * Never call from writeBack hot path; always fire-and-forget with inFlight guard.
 */
export async function drainCogniWeaveCloudSync(params: {
  stateDir: string;
  client: CloudIntelligenceClient;
  auth: CloudAuthContext;
  outboxLimit?: number;
  pullLimit?: number;
  nowMs?: number;
}): Promise<CogniWeaveCloudSyncTickResult> {
  const outbox = new FileSyncOutbox(params.stateDir);
  const mirror = new FileLocalIntelligenceMirror(params.stateDir);
  const drain = await drainOutbox({
    outbox,
    client: params.client,
    auth: params.auth,
    limit: params.outboxLimit,
    nowMs: params.nowMs,
  });
  const pull = await pullIntoMirror({
    client: params.client,
    mirror,
    auth: params.auth,
    nowMs: params.nowMs,
    limit: params.pullLimit,
  });
  return { drain, pull };
}

export type CogniWeaveCloudSyncStatusSnapshot = {
  enabled: boolean;
  outboxPending: number;
  outboxFailed: number;
  mirrorFreshness: MirrorFreshnessStatusSafe;
  lastError?: string;
};

type MirrorFreshnessStatusSafe = MirrorFreshness["status"];

/** Read-only status for manager.status().custom — no envelope/snippet leakage. */
export async function readCogniWeaveCloudSyncStatus(params: {
  stateDir: string;
  enabled: boolean;
  lastError?: string;
}): Promise<CogniWeaveCloudSyncStatusSnapshot> {
  if (!params.enabled) {
    return {
      enabled: false,
      outboxPending: 0,
      outboxFailed: 0,
      mirrorFreshness: "never_synced",
    };
  }
  const outbox = new FileSyncOutbox(params.stateDir);
  const mirror = new FileLocalIntelligenceMirror(params.stateDir);
  const entries = (await outbox.list?.()) ?? [];
  let outboxPending = 0;
  let outboxFailed = 0;
  for (const entry of entries) {
    if (entry.status === "pending" || entry.status === "processing") {
      outboxPending += 1;
    } else if (entry.status === "failed") {
      outboxFailed += 1;
    }
  }
  const freshness = await mirror.getFreshness();
  return {
    enabled: true,
    outboxPending,
    outboxFailed,
    mirrorFreshness: freshness.status,
    ...(params.lastError ? { lastError: params.lastError.slice(0, 200) } : {}),
  };
}

export type CogniWeaveCloudSyncLoopHandle = {
  stop: () => void;
};

/**
 * Background interval with inFlight guard. Tick errors are logged, not thrown.
 */
export function startCogniWeaveCloudSyncLoop(params: {
  stateDir: string;
  client: CloudIntelligenceClient;
  auth: CloudAuthContext;
  intervalMs: number;
  isClosed?: () => boolean;
  onError?: (message: string) => void;
}): CogniWeaveCloudSyncLoopHandle {
  let inFlight = false;
  const tick = () => {
    if (params.isClosed?.()) {
      return;
    }
    if (inFlight) {
      return;
    }
    inFlight = true;
    void drainCogniWeaveCloudSync({
      stateDir: params.stateDir,
      client: params.client,
      auth: params.auth,
    })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        params.onError?.(message);
        log.warn(`cloud sync tick failed: ${message}`);
      })
      .finally(() => {
        inFlight = false;
      });
  };

  // Startup drain — fire-and-forget (do not block manager.create).
  tick();
  const timer = setInterval(tick, params.intervalMs);
  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}
