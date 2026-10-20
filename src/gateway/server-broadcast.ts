import { MAX_BUFFERED_BYTES } from "./server-constants.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { logWs, shouldLogWs, summarizeAgentEventForWsLog } from "./ws-log.js";

const ADMIN_SCOPE = "operator.admin";
const APPROVALS_SCOPE = "operator.approvals";
const PAIRING_SCOPE = "operator.pairing";

/** Default TTL for optional server-side event fan-out dedupe keys. */
export const DEFAULT_EVENT_DEDUPE_TTL_MS = 60_000;

const EVENT_SCOPE_GUARDS: Record<string, string[]> = {
  "exec.approval.requested": [APPROVALS_SCOPE],
  "exec.approval.resolved": [APPROVALS_SCOPE],
  "device.pair.requested": [PAIRING_SCOPE],
  "device.pair.resolved": [PAIRING_SCOPE],
  "node.pair.requested": [PAIRING_SCOPE],
  "node.pair.resolved": [PAIRING_SCOPE],
};

export type GatewayBroadcastStateVersion = {
  presence?: number;
  health?: number;
};

export type GatewayBroadcastOpts = {
  dropIfSlow?: boolean;
  stateVersion?: GatewayBroadcastStateVersion;
  /**
   * Optional server-side fan-out dedupe key. Identical keys within TTL skip
   * re-broadcast (no seq bump, no socket sends). Events without a key are
   * never deduped. Does not claim client-side replay idempotency.
   */
  dedupeKey?: string;
  /** Override TTL for this key; defaults to broadcaster defaultDedupeTtlMs. */
  dedupeTtlMs?: number;
};

export type GatewayBroadcastFn = (
  event: string,
  payload: unknown,
  opts?: GatewayBroadcastOpts,
) => void;

export type GatewayBroadcastToConnIdsFn = (
  event: string,
  payload: unknown,
  connIds: ReadonlySet<string>,
  opts?: GatewayBroadcastOpts,
) => void;

export type GatewayBroadcasterOptions = {
  clients: Set<GatewayWsClient>;
  /** Test clock; defaults to Date.now. */
  now?: () => number;
  /** Default TTL when opts.dedupeKey is set without dedupeTtlMs. */
  defaultDedupeTtlMs?: number;
};

function hasEventScope(client: GatewayWsClient, event: string): boolean {
  const required = EVENT_SCOPE_GUARDS[event];
  if (!required) {
    return true;
  }
  const role = client.connect.role ?? "operator";
  if (role !== "operator") {
    return false;
  }
  const scopes = Array.isArray(client.connect.scopes) ? client.connect.scopes : [];
  if (scopes.includes(ADMIN_SCOPE)) {
    return true;
  }
  return required.some((scope) => scopes.includes(scope));
}

function pruneEventDedupe(cache: Map<string, number>, nowMs: number): void {
  for (const [key, expiresAt] of cache) {
    if (expiresAt <= nowMs) {
      cache.delete(key);
    }
  }
}

export function createGatewayBroadcaster(params: GatewayBroadcasterOptions) {
  let seq = 0;
  const now = params.now ?? Date.now;
  const defaultDedupeTtlMs = params.defaultDedupeTtlMs ?? DEFAULT_EVENT_DEDUPE_TTL_MS;
  /** dedupeKey → expiresAtMs */
  const eventDedupe = new Map<string, number>();

  const shouldSkipDedupe = (opts?: GatewayBroadcastOpts): boolean => {
    const key = opts?.dedupeKey?.trim();
    if (!key) {
      return false;
    }
    const nowMs = now();
    pruneEventDedupe(eventDedupe, nowMs);
    const existing = eventDedupe.get(key);
    if (existing !== undefined && existing > nowMs) {
      return true;
    }
    const ttl = opts?.dedupeTtlMs ?? defaultDedupeTtlMs;
    eventDedupe.set(key, nowMs + Math.max(0, ttl));
    return false;
  };

  const broadcastInternal = (
    event: string,
    payload: unknown,
    opts?: GatewayBroadcastOpts,
    targetConnIds?: ReadonlySet<string>,
  ) => {
    if (shouldSkipDedupe(opts)) {
      if (shouldLogWs()) {
        logWs("out", "event-deduped", {
          event,
          dedupeKey: opts?.dedupeKey,
          clients: params.clients.size,
        });
      }
      return;
    }
    if (params.clients.size === 0) {
      return;
    }
    const isTargeted = Boolean(targetConnIds);
    const eventSeq = isTargeted ? undefined : ++seq;
    const frame = JSON.stringify({
      type: "event",
      event,
      payload,
      seq: eventSeq,
      stateVersion: opts?.stateVersion,
    });
    if (shouldLogWs()) {
      const logMeta: Record<string, unknown> = {
        event,
        seq: eventSeq ?? "targeted",
        clients: params.clients.size,
        targets: targetConnIds ? targetConnIds.size : undefined,
        dropIfSlow: opts?.dropIfSlow,
        presenceVersion: opts?.stateVersion?.presence,
        healthVersion: opts?.stateVersion?.health,
        dedupeKey: opts?.dedupeKey,
      };
      if (event === "agent") {
        Object.assign(logMeta, summarizeAgentEventForWsLog(payload));
      }
      logWs("out", "event", logMeta);
    }
    for (const c of params.clients) {
      if (targetConnIds && !targetConnIds.has(c.connId)) {
        continue;
      }
      if (!hasEventScope(c, event)) {
        continue;
      }
      const slow = c.socket.bufferedAmount > MAX_BUFFERED_BYTES;
      if (slow && opts?.dropIfSlow) {
        continue;
      }
      if (slow) {
        try {
          c.socket.close(1008, "slow consumer");
        } catch {
          /* ignore */
        }
        continue;
      }
      try {
        c.socket.send(frame);
      } catch {
        /* ignore */
      }
    }
  };

  const broadcast: GatewayBroadcastFn = (event, payload, opts) =>
    broadcastInternal(event, payload, opts);

  const broadcastToConnIds: GatewayBroadcastToConnIdsFn = (event, payload, connIds, opts) => {
    if (connIds.size === 0) {
      return;
    }
    broadcastInternal(event, payload, opts, connIds);
  };

  return { broadcast, broadcastToConnIds };
}
