/**
 * In-memory stepper for the steward team-building surface.
 * Survives workbench re-renders without a second app-state stack.
 *
 * localStorage is a same-browser cache. Gateway chat history is the
 * retention source (#792 leave-out reversed): see daibai-guide-history-wire.
 */

import { resetDaibaiMcpScanUiForTests } from "./daibai-mcp-scan-session.ts";
import { resetDaibaiMyApplicationsUiForTests } from "./daibai-my-applications-session.ts";
import { resetDaibaiOiEnrollmentUiForTests } from "./daibai-oi-enrollment-session.ts";
import {
  createDaibaiTeamOnboardingState,
  reduceDaibaiTeamOnboarding,
  type DaibaiTeamOnboardingAction,
  type DaibaiTeamOnboardingEvent,
  type DaibaiTeamOnboardingState,
} from "./daibai-team-onboarding-model.ts";

const DAIBAI_TEAM_GUIDE_STORAGE_KEY = "openbot.daibai.team-guide.v1";

let state: DaibaiTeamOnboardingState = createDaibaiTeamOnboardingState();
let events: DaibaiTeamOnboardingEvent[] = [];
let planDelayMs = 720;
let planToken = 0;
let hydrated = false;
let guideOwnerKey = "local";
let guideDirty = false;
let suppressGuidePersistListener = false;

type DaibaiTeamGuidePersistListener = (state: DaibaiTeamOnboardingState) => void;
let guidePersistListener: DaibaiTeamGuidePersistListener | null = null;

/** Gateway history bridge. Local cache writes stay here; the listener appends. */
export function setDaibaiTeamGuidePersistListener(
  listener: DaibaiTeamGuidePersistListener | null,
): void {
  guidePersistListener = listener;
}

export function isDaibaiTeamGuideDirty(): boolean {
  return guideDirty;
}

export function clearDaibaiTeamGuideDirty(): void {
  guideDirty = false;
}

function guideStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

function isRetainedGuideState(value: unknown): value is DaibaiTeamOnboardingState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Partial<DaibaiTeamOnboardingState>;
  return row.step === "page" && Array.isArray(row.selectedIds);
}

function readGuideStore(): Record<string, DaibaiTeamOnboardingState> {
  const box = guideStorage();
  if (!box) {
    return {};
  }
  try {
    const raw = box.getItem(DAIBAI_TEAM_GUIDE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const store: Record<string, DaibaiTeamOnboardingState> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isRetainedGuideState(value)) {
        store[key] = { ...createDaibaiTeamOnboardingState(), ...value, step: "page" };
      }
    }
    return store;
  } catch {
    return {};
  }
}

/** Cache in-progress and completed guide pages per signed-in user. */
function persistDaibaiTeamGuideState(): void {
  const box = guideStorage();
  if (!box) {
    return;
  }
  try {
    const store = readGuideStore();
    if (state.step === "page") {
      store[guideOwnerKey] = state;
    } else {
      delete store[guideOwnerKey];
    }
    if (Object.keys(store).length === 0) {
      box.removeItem(DAIBAI_TEAM_GUIDE_STORAGE_KEY);
      return;
    }
    box.setItem(DAIBAI_TEAM_GUIDE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode: the in-memory transcript still covers this tab.
  }
  if (!suppressGuidePersistListener) {
    guidePersistListener?.(state);
  }
}

function hydrateDaibaiTeamGuideState(): void {
  if (hydrated) {
    return;
  }
  hydrated = true;
  const stored = readGuideStore()[guideOwnerKey];
  if (!stored) {
    return;
  }
  state = stored;
}

/** Scope the retained guide to the signed-in user so accounts on one browser do not share it. */
export function bindDaibaiTeamGuideOwner(userKey: string | null | undefined): void {
  const next = userKey?.trim() || "local";
  if (hydrated && next === guideOwnerKey) {
    return;
  }
  if (hydrated && next !== guideOwnerKey) {
    persistDaibaiTeamGuideState();
    guideOwnerKey = next;
    hydrated = false;
    state = createDaibaiTeamOnboardingState();
    events = [];
  } else {
    guideOwnerKey = next;
  }
  hydrateDaibaiTeamGuideState();
}

export function getDaibaiTeamOnboardingState(): DaibaiTeamOnboardingState {
  hydrateDaibaiTeamGuideState();
  return state;
}

export function getDaibaiTeamOnboardingEvents(): readonly DaibaiTeamOnboardingEvent[] {
  return events;
}

/** Drop the in-memory page and read the persisted transcript again. */
export function reloadDaibaiTeamGuideFromStorageForTests(): DaibaiTeamOnboardingState {
  hydrated = false;
  state = createDaibaiTeamOnboardingState();
  events = [];
  return getDaibaiTeamOnboardingState();
}

/** Apply a steward-session card read back from chat.history. Does not re-append. */
export function replaceDaibaiTeamGuideFromGateway(next: DaibaiTeamOnboardingState): void {
  suppressGuidePersistListener = true;
  try {
    state = next;
    hydrated = true;
    guideDirty = false;
    persistDaibaiTeamGuideState();
  } finally {
    suppressGuidePersistListener = false;
  }
}

export function resetDaibaiTeamOnboardingForTests(): void {
  planToken += 1;
  planDelayMs = 720;
  state = createDaibaiTeamOnboardingState();
  events = [];
  hydrated = true;
  guideOwnerKey = "local";
  guideDirty = false;
  suppressGuidePersistListener = false;
  try {
    guideStorage()?.removeItem(DAIBAI_TEAM_GUIDE_STORAGE_KEY);
  } catch {
    // best-effort
  }
  resetDaibaiMcpScanUiForTests();
  resetDaibaiOiEnrollmentUiForTests();
  resetDaibaiMyApplicationsUiForTests();
}

export function setDaibaiTeamPlanDelayForTests(ms: number): void {
  planDelayMs = ms;
}

export function dispatchDaibaiTeamOnboarding(
  action: DaibaiTeamOnboardingAction,
): DaibaiTeamOnboardingEvent[] {
  hydrateDaibaiTeamGuideState();
  if (action.type === "reset" || action.type === "skip" || action.type === "choosePath") {
    planToken += 1;
  }
  const next = reduceDaibaiTeamOnboarding(state, action);
  state = next.state;
  if (next.events.length > 0) {
    events = [...events, ...next.events];
  }
  guideDirty = true;
  persistDaibaiTeamGuideState();
  return next.events;
}

/** Text fields update without a re-render so the caret stays put. */
export function patchDaibaiTeamDraft(patch: {
  taskText?: string;
  rename?: { id: string; name: string };
}): void {
  hydrateDaibaiTeamGuideState();
  if (patch.taskText !== undefined) {
    state = { ...state, taskText: patch.taskText };
  }
  if (patch.rename) {
    state = reduceDaibaiTeamOnboarding(state, {
      type: "rename",
      id: patch.rename.id,
      name: patch.rename.name,
    }).state;
  }
  guideDirty = true;
  persistDaibaiTeamGuideState();
}

export function scheduleDaibaiTeamPlan(notify: () => void): void {
  planToken += 1;
  const token = planToken;
  dispatchDaibaiTeamOnboarding({ type: "beginPlan" });
  notify();
  const delay = planDelayMs;
  setTimeout(() => {
    if (token !== planToken) {
      return;
    }
    dispatchDaibaiTeamOnboarding({ type: "finishPlan" });
    notify();
  }, delay);
}
