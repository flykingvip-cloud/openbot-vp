import { nowIso } from "./monitor-store.js";
import type { AdapterErrorCategory, MonitorHealthState, MonitorTarget } from "./types.js";

export function mapErrorToHealth(category: AdapterErrorCategory): MonitorHealthState {
  switch (category) {
    case "rate_limit":
    case "captcha":
      return "rate_limited";
    case "reauth_required":
      return "reauth_required";
    case "timeout":
    case "process_error":
    case "invalid_output":
    case "unknown":
    default:
      return "failed";
  }
}

export function mapErrorToEventType(
  category: AdapterErrorCategory,
): "monitor.failed" | "monitor.reauth_required" | "monitor.rate_limited" {
  const health = mapErrorToHealth(category);
  if (health === "reauth_required") {
    return "monitor.reauth_required";
  }
  if (health === "rate_limited") {
    return "monitor.rate_limited";
  }
  return "monitor.failed";
}

export function applyFailureCooldown(params: {
  target: MonitorTarget;
  category: AdapterErrorCategory;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  params.target.healthState = mapErrorToHealth(params.category);
  params.target.lastFailureAt = nowIso(now);
  // Pause / cooldown; no infinite auto-retry.
  if (params.category === "reauth_required") {
    params.target.cursor.cooldownUntil = nowIso(now + 6 * 60 * 60_000);
    params.target.enabled = params.target.enabled; // keep enabled but blocked by cooldown
    return;
  }
  if (params.category === "rate_limit" || params.category === "captcha") {
    params.target.cursor.cooldownUntil = nowIso(now + 2 * 60 * 60_000);
    return;
  }
  params.target.cursor.cooldownUntil = nowIso(now + 30 * 60_000);
}

export function computeNextDueAt(target: MonitorTarget, now = Date.now()): number {
  if (target.cursor.cooldownUntil) {
    const cooldown = Date.parse(target.cursor.cooldownUntil);
    if (Number.isFinite(cooldown) && cooldown > now) {
      return cooldown;
    }
  }
  if (target.cursor.backoffUntil) {
    const backoff = Date.parse(target.cursor.backoffUntil);
    if (Number.isFinite(backoff) && backoff > now) {
      return backoff;
    }
  }
  const last = target.lastSuccessAt ? Date.parse(target.lastSuccessAt) : 0;
  const intervalMs = Math.max(60, target.pollIntervalSeconds) * 1000;
  if (!Number.isFinite(last) || last <= 0) {
    return now;
  }
  return last + intervalMs;
}

export function applyEmptyRunBackoff(target: MonitorTarget, now = Date.now()): void {
  target.cursor.consecutiveEmptyRuns = (target.cursor.consecutiveEmptyRuns ?? 0) + 1;
  const empty = target.cursor.consecutiveEmptyRuns;
  if (empty < 2) {
    target.cursor.backoffUntil = undefined;
    return;
  }
  // Exponential backoff on consecutive empty runs, capped at 6h.
  const base = Math.max(60, target.pollIntervalSeconds) * 1000;
  const delay = Math.min(6 * 60 * 60_000, base * 2 ** Math.min(empty - 1, 5));
  target.cursor.backoffUntil = nowIso(now + delay);
}

export function resetEmptyRunBackoff(target: MonitorTarget): void {
  target.cursor.consecutiveEmptyRuns = 0;
  target.cursor.backoffUntil = undefined;
}
