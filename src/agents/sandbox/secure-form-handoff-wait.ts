/**
 * In-process waiters for Secure Form handoff return (P5b → auto-resume).
 *
 * Agent tool `secure_form.await_return` blocks here until:
 *   - `notifyHandoffReturned` (releaseControl /「交给AI」rare path), or
 *   - page-state gate cleared (QR/SMS signed-in / fixture-ok) via pollGateCleared, or
 *   - timeout.
 * Never carries secrets.
 */

import { pollHandoffGateCleared, type HandoffGatePageProbe } from "./secure-form-handoff-gate.js";

const DEFAULT_TIMEOUT_MS = 600_000;
/** Late await_return still sees a recent handoff_returned (mirrors approval grace). */
const RECENT_GRACE_MS = 15_000;
const DEFAULT_GATE_POLL_MS = 1_500;

type Waiter = {
  resolve: (status: "handoff_returned" | "handoff_timeout") => void;
  timer: ReturnType<typeof setTimeout>;
};

const WAITERS = new Map<string, Set<Waiter>>();
const RECENT_RETURNED = new Map<string, number>();
/** How the most recent return was signaled (for tests / receipts; never secrets). */
const RECENT_RESUME = new Map<string, "manual_handback" | "auto_gate_cleared">();

export function resetSecureFormHandoffWaitForTests() {
  for (const set of WAITERS.values()) {
    for (const w of set) {
      clearTimeout(w.timer);
    }
  }
  WAITERS.clear();
  RECENT_RETURNED.clear();
  RECENT_RESUME.clear();
}

function pruneRecent(now = Date.now()) {
  for (const [key, at] of RECENT_RETURNED) {
    if (at + RECENT_GRACE_MS <= now) {
      RECENT_RETURNED.delete(key);
      RECENT_RESUME.delete(key);
    }
  }
}

/** Wake all await_return waiters for this session (no secrets). */
/** True when any session is blocked in await_return (auth handoff in progress). */
export function hasActiveHandoffWaiters(): boolean {
  for (const set of WAITERS.values()) {
    if (set.size > 0) {
      return true;
    }
  }
  return false;
}

export function peekHandoffResumeReason(
  sessionKey: string,
): "manual_handback" | "auto_gate_cleared" | null {
  return RECENT_RESUME.get(sessionKey.trim()) ?? null;
}

export function notifyHandoffReturned(
  sessionKey: string,
  nowMs = Date.now(),
  resume: "manual_handback" | "auto_gate_cleared" = "manual_handback",
) {
  const key = sessionKey.trim();
  if (!key) {
    return;
  }
  RECENT_RETURNED.set(key, nowMs);
  RECENT_RESUME.set(key, resume);
  const set = WAITERS.get(key);
  if (!set || set.size === 0) {
    return;
  }
  WAITERS.delete(key);
  for (const w of set) {
    clearTimeout(w.timer);
    w.resolve("handoff_returned");
  }
}

/**
 * Block until handoff_returned for sessionKey, or timeout.
 * If a return happened within the grace window, resolves immediately.
 * When pollGateCleared is set, also resumes on page-state gate clear (no click).
 */
export function waitForHandoffReturn(params: {
  sessionKey: string;
  timeoutMs?: number;
  nowMs?: number;
  /** Probe page DOM/URL; when gate clears, auto-resume without「交给AI」. */
  pollGateCleared?: HandoffGatePageProbe;
  pollIntervalMs?: number;
  /** Called once when auto gate clear fires (release control, broadcast, etc.). */
  onAutoGateCleared?: () => void | Promise<void>;
}): Promise<"handoff_returned" | "handoff_timeout"> {
  const key = params.sessionKey.trim();
  if (!key) {
    return Promise.resolve("handoff_timeout");
  }
  const now = params.nowMs ?? Date.now();
  pruneRecent(now);
  const recentAt = RECENT_RETURNED.get(key);
  if (recentAt !== undefined && recentAt + RECENT_GRACE_MS > now) {
    return Promise.resolve("handoff_returned");
  }
  const timeoutMs =
    typeof params.timeoutMs === "number" && params.timeoutMs > 0
      ? params.timeoutMs
      : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const abort = new AbortController();
    const finish = (status: "handoff_returned" | "handoff_timeout") => {
      if (settled) {
        return;
      }
      settled = true;
      abort.abort();
      resolve(status);
    };

    const entry: Waiter = {
      resolve: finish,
      timer: null as unknown as ReturnType<typeof setTimeout>,
    };
    entry.timer = setTimeout(() => {
      const set = WAITERS.get(key);
      set?.delete(entry);
      if (set && set.size === 0) {
        WAITERS.delete(key);
      }
      finish("handoff_timeout");
    }, timeoutMs);
    let set = WAITERS.get(key);
    if (!set) {
      set = new Set();
      WAITERS.set(key, set);
    }
    set.add(entry);

    if (params.pollGateCleared) {
      void (async () => {
        const cleared = await pollHandoffGateCleared({
          probe: params.pollGateCleared!,
          intervalMs: params.pollIntervalMs ?? DEFAULT_GATE_POLL_MS,
          signal: abort.signal,
          shouldStop: () => settled,
        });
        if (!cleared || settled) {
          return;
        }
        try {
          await params.onAutoGateCleared?.();
        } catch {
          // Release/broadcast failures must not block resume once gate is clear.
        }
        // Prefer resolving via notify so grace + resume reason stay consistent.
        notifyHandoffReturned(key, Date.now(), "auto_gate_cleared");
      })();
    }
  });
}
