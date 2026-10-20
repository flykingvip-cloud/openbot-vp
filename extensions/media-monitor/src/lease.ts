import { getLease, nowIso, releaseLease, upsertLease } from "./monitor-store.js";
import type { MonitorLease, MonitorStoreData } from "./types.js";

const DEFAULT_LEASE_MS = 10 * 60 * 1000;

export function acquireLease(params: {
  data: MonitorStoreData;
  targetId: string;
  owner: string;
  now?: number;
  leaseMs?: number;
}): { ok: true; lease: MonitorLease } | { ok: false; reason: string; lease?: MonitorLease } {
  const now = params.now ?? Date.now();
  const existing = getLease(params.data, params.targetId);
  if (existing) {
    const until = Date.parse(existing.leaseUntil);
    if (Number.isFinite(until) && until > now && existing.leaseOwner !== params.owner) {
      return { ok: false, reason: "lease_held", lease: existing };
    }
  }
  const leaseMs = params.leaseMs ?? DEFAULT_LEASE_MS;
  const lease: MonitorLease = {
    targetId: params.targetId,
    leaseOwner: params.owner,
    leaseUntil: nowIso(now + leaseMs),
    heartbeatAt: nowIso(now),
  };
  upsertLease(params.data, lease);
  return { ok: true, lease };
}

export function heartbeatLease(params: {
  data: MonitorStoreData;
  targetId: string;
  owner: string;
  now?: number;
  leaseMs?: number;
}): boolean {
  const existing = getLease(params.data, params.targetId);
  if (!existing || existing.leaseOwner !== params.owner) {
    return false;
  }
  const now = params.now ?? Date.now();
  const leaseMs = params.leaseMs ?? DEFAULT_LEASE_MS;
  upsertLease(params.data, {
    ...existing,
    heartbeatAt: nowIso(now),
    leaseUntil: nowIso(now + leaseMs),
  });
  return true;
}

export function releaseOwnedLease(params: {
  data: MonitorStoreData;
  targetId: string;
  owner: string;
}): boolean {
  return releaseLease(params.data, params.targetId, params.owner);
}
