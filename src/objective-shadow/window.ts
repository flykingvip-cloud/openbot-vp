import fs from "node:fs";
import path from "node:path";
import type { ShadowIngress } from "./types.js";

export const SHADOW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const SHADOW_WINDOW_N = 500;

export type ShadowWindowState = {
  firstWriteAtMs: number | null;
  counts: Partial<Record<ShadowIngress, number>>;
  seenRunIds: string[];
  stopped: boolean;
};

export function emptyWindowState(): ShadowWindowState {
  return { firstWriteAtMs: null, counts: {}, seenRunIds: [], stopped: false };
}

export function readWindowState(filePath: string): ShadowWindowState {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as ShadowWindowState;
    return {
      firstWriteAtMs: typeof parsed.firstWriteAtMs === "number" ? parsed.firstWriteAtMs : null,
      counts: parsed.counts ?? {},
      seenRunIds: Array.isArray(parsed.seenRunIds) ? parsed.seenRunIds : [],
      stopped: parsed.stopped,
    };
  } catch {
    return emptyWindowState();
  }
}

export function writeWindowState(filePath: string, state: ShadowWindowState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state)}\n`, "utf8");
}

export function isWindowClosed(
  state: ShadowWindowState,
  ingress: ShadowIngress,
  nowMs: number,
): boolean {
  if (state.stopped) {
    return true;
  }
  if (state.firstWriteAtMs !== null && nowMs - state.firstWriteAtMs >= SHADOW_WINDOW_MS) {
    return true;
  }
  const count = state.counts[ingress] ?? 0;
  return count >= SHADOW_WINDOW_N;
}

export function recordSuccessfulWrite(
  state: ShadowWindowState,
  ingress: ShadowIngress,
  runId: string,
  nowMs: number,
): ShadowWindowState {
  const seen = state.seenRunIds.includes(runId) ? state.seenRunIds : [...state.seenRunIds, runId];
  return {
    firstWriteAtMs: state.firstWriteAtMs ?? nowMs,
    counts: {
      ...state.counts,
      [ingress]: (state.counts[ingress] ?? 0) + 1,
    },
    seenRunIds: seen,
    stopped: state.stopped,
  };
}
