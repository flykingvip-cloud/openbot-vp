/**
 * In-memory「我的申请」摘要状态。成功页重渲染不丢列表；测试随 onboarding reset 清空。
 */

import { mergeDaibaiMyApplications, type DaibaiMyApplication } from "./daibai-my-applications.ts";

export type DaibaiMyApplicationsPhase = "idle" | "loading" | "ready" | "error" | "unavailable";

export type DaibaiMyApplicationsUiState = {
  phase: DaibaiMyApplicationsPhase;
  error: string | null;
  requests: DaibaiMyApplication[];
  optimistic: DaibaiMyApplication[];
  cancellingId: string | null;
  cancelErrorById: Record<string, string>;
};

let generation = 0;

let state: DaibaiMyApplicationsUiState = {
  phase: "idle",
  error: null,
  requests: [],
  optimistic: [],
  cancellingId: null,
  cancelErrorById: {},
};

function emptyState(): DaibaiMyApplicationsUiState {
  return {
    phase: "idle",
    error: null,
    requests: [],
    optimistic: [],
    cancellingId: null,
    cancelErrorById: {},
  };
}

export function getDaibaiMyApplicationsUiState(): DaibaiMyApplicationsUiState {
  return state;
}

export function visibleDaibaiMyApplications(): DaibaiMyApplication[] {
  return mergeDaibaiMyApplications(state.requests, state.optimistic);
}

export function resetDaibaiMyApplicationsUiForTests(): void {
  generation += 1;
  state = emptyState();
}

export function beginDaibaiMyApplicationsLoad(): number {
  generation += 1;
  state = { ...state, phase: "loading", error: null };
  return generation;
}

export function completeDaibaiMyApplicationsLoad(
  token: number,
  requests: DaibaiMyApplication[],
): boolean {
  if (token !== generation) {
    return false;
  }
  state = { ...state, phase: "ready", error: null, requests };
  return true;
}

export function failDaibaiMyApplicationsLoad(token: number, message: string): boolean {
  if (token !== generation) {
    return false;
  }
  state = { ...state, phase: "error", error: message };
  return true;
}

export function markDaibaiMyApplicationsUnavailable(): void {
  state = { ...state, phase: "unavailable", error: null };
}

export function noteDaibaiMyApplicationSubmitted(application: DaibaiMyApplication): void {
  const approvalId = application.approvalId.trim();
  if (!approvalId) {
    return;
  }
  state = {
    ...state,
    optimistic: [...state.optimistic.filter((item) => item.approvalId !== approvalId), application],
  };
}

export function beginDaibaiMyApplicationCancel(approvalId: string): void {
  const nextErrors = { ...state.cancelErrorById };
  delete nextErrors[approvalId];
  state = { ...state, cancellingId: approvalId, cancelErrorById: nextErrors };
}

export function failDaibaiMyApplicationCancel(approvalId: string, message: string): void {
  state = {
    ...state,
    cancellingId: state.cancellingId === approvalId ? null : state.cancellingId,
    cancelErrorById: { ...state.cancelErrorById, [approvalId]: message },
  };
}

function patchCancelled(item: DaibaiMyApplication): DaibaiMyApplication {
  return item.status === "pending" ? { ...item, status: "cancelled" } : item;
}

export function markDaibaiMyApplicationCancelled(approvalId: string): void {
  state = {
    ...state,
    cancellingId: state.cancellingId === approvalId ? null : state.cancellingId,
    requests: state.requests.map((item) =>
      item.approvalId === approvalId ? patchCancelled(item) : item,
    ),
    optimistic: state.optimistic.map((item) =>
      item.approvalId === approvalId ? patchCancelled(item) : item,
    ),
  };
}
