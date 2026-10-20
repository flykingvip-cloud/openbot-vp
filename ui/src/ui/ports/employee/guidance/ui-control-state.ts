/**
 * In-memory per-scope guidance UI controls (ack / defer / high-risk pending).
 * Not an authority for progress — Gateway progress store is.
 */

import { guidanceScopeAckKey, type UiGuidanceSnapshot } from "./orchestrate-surface.ts";

/** Default defer window — closed guidance must not auto-reappear immediately. */
export const GUIDANCE_DEFER_MS = 60 * 60 * 1000;

export const GUIDANCE_CONTENT_VERSION = "2026.09.03-p3";

type GuidanceUiControlState = {
  acknowledgedKeys: Set<string>;
  deferredUntilMsByKey: Map<string, number>;
  highRiskPendingKey: string | null;
  shownKeys: Set<string>;
};

const uiControlState: GuidanceUiControlState = {
  acknowledgedKeys: new Set(),
  deferredUntilMsByKey: new Map(),
  highRiskPendingKey: null,
  shownKeys: new Set(),
};

/** Test / takeover seam — reset between browser cases. */
export function resetGuidanceUiControlStateForTests(): void {
  uiControlState.acknowledgedKeys.clear();
  uiControlState.deferredUntilMsByKey.clear();
  uiControlState.highRiskPendingKey = null;
  uiControlState.shownKeys.clear();
}

export function getGuidanceUiControlState(): {
  acknowledgedKeys: ReadonlySet<string>;
  deferredUntilMsByKey: ReadonlyMap<string, number>;
  highRiskPendingKey: string | null;
  shownKeys: ReadonlySet<string>;
} {
  return {
    acknowledgedKeys: uiControlState.acknowledgedKeys,
    deferredUntilMsByKey: uiControlState.deferredUntilMsByKey,
    highRiskPendingKey: uiControlState.highRiskPendingKey,
    shownKeys: uiControlState.shownKeys,
  };
}

export function acknowledgeGuidanceSnapshot(snapshot: UiGuidanceSnapshot): string {
  const key = guidanceScopeAckKey(snapshot.scope, snapshot.entityId);
  uiControlState.acknowledgedKeys.add(key);
  uiControlState.deferredUntilMsByKey.delete(key);
  if (uiControlState.highRiskPendingKey === key) {
    uiControlState.highRiskPendingKey = null;
  }
  return key;
}

export function deferGuidanceSnapshot(
  snapshot: UiGuidanceSnapshot,
  deferMs = GUIDANCE_DEFER_MS,
  nowMs = Date.now(),
): string {
  const key = guidanceScopeAckKey(snapshot.scope, snapshot.entityId);
  uiControlState.deferredUntilMsByKey.set(key, nowMs + deferMs);
  if (uiControlState.highRiskPendingKey === key) {
    uiControlState.highRiskPendingKey = null;
  }
  return key;
}

export function requestGuidanceHighRiskConfirm(snapshot: UiGuidanceSnapshot): string {
  const key = guidanceScopeAckKey(snapshot.scope, snapshot.entityId);
  uiControlState.highRiskPendingKey = key;
  return key;
}

export function clearGuidanceHighRiskConfirm(snapshot?: UiGuidanceSnapshot | null): void {
  if (!snapshot) {
    uiControlState.highRiskPendingKey = null;
    return;
  }
  const key = guidanceScopeAckKey(snapshot.scope, snapshot.entityId);
  if (uiControlState.highRiskPendingKey === key) {
    uiControlState.highRiskPendingKey = null;
  }
}

export function isGuidanceHighRiskPending(snapshot: UiGuidanceSnapshot): boolean {
  return (
    uiControlState.highRiskPendingKey === guidanceScopeAckKey(snapshot.scope, snapshot.entityId)
  );
}

export function markGuidanceShownKey(snapshot: UiGuidanceSnapshot): boolean {
  const key = guidanceScopeAckKey(snapshot.scope, snapshot.entityId);
  if (uiControlState.shownKeys.has(key)) {
    return false;
  }
  uiControlState.shownKeys.add(key);
  return true;
}
