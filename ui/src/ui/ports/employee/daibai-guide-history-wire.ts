/**
 * 大白引导 ↔ 网关聊天记录。
 * localStorage 只做本机缓存；chat.guide.append / chat.history 才是留存。
 * 不授予 MCP / OI，也不改机器人上岗培养。
 */

import {
  latestDaibaiGuideCard,
  planDaibaiGuideAppend,
  type DaibaiGuideCardState,
} from "../../../../../src/shared/daibai-guide-card.ts";
import { isDaibaiWorkbenchSession, type DaibaiAutoAskState } from "../../controllers/daibai.ts";
import { isDaibaiGuideAcknowledgedForUser } from "../../storage.ts";
import {
  findDaibaiTeamAgent,
  type DaibaiTeamOnboardingState,
} from "./views/daibai-team-onboarding-model.ts";
import {
  clearDaibaiTeamGuideDirty,
  getDaibaiTeamOnboardingState,
  isDaibaiTeamGuideDirty,
  replaceDaibaiTeamGuideFromGateway,
  setDaibaiTeamGuidePersistListener,
} from "./views/daibai-team-onboarding-session.ts";

type GuideHistoryClient = {
  request: (method: string, payload: unknown) => Promise<unknown>;
};

export type DaibaiGuideHistoryHost = DaibaiAutoAskState & {
  client: GuideHistoryClient | null;
  connected: boolean;
  sessionKey: string;
  chatMessages?: unknown[];
  settings?: {
    daibaiGuideAcknowledged?: boolean;
    daibaiGuideAcknowledgedUsers?: Record<string, true>;
  } | null;
  requestUpdate?: () => void;
};

function guideUserKey(state: DaibaiGuideHistoryHost): string | null {
  return (
    state.hello?.auth?.user?.trim() ||
    state.platformAuthState?.session?.user?.trim() ||
    state.bootstrapAuthSession?.user?.trim() ||
    null
  );
}

let host: DaibaiGuideHistoryHost | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const sentKeys = new Set<string>();

function guideStatePayload(state: DaibaiTeamOnboardingState): DaibaiGuideCardState {
  return {
    step: "page",
    path: state.path,
    category: state.category,
    selectedIds: state.selectedIds,
    selectedLabels: state.selectedIds.flatMap((id) => {
      const label = state.customNames[id]?.trim() || findDaibaiTeamAgent(id)?.name || "";
      return label ? [label] : [];
    }),
    role: state.role as DaibaiGuideCardState["role"],
    taskText: state.taskText,
    proposedIds: state.proposedIds,
    customNames: Object.entries(state.customNames).map(([id, name]) => ({ id, name })),
    created: state.created.map((member) => ({
      catalogId: member.catalogId,
      agentId: member.agentId,
      name: member.name,
    })),
  };
}

function applyTeamCard(messages: readonly unknown[]): boolean {
  const card = latestDaibaiGuideCard(messages, "team");
  if (!card?.state) {
    return false;
  }
  if (isDaibaiTeamGuideDirty()) {
    return false;
  }
  const current = getDaibaiTeamOnboardingState();
  const next: DaibaiTeamOnboardingState = {
    ...current,
    step: "page",
    path: card.state.path,
    category: card.state.category,
    selectedIds: card.state.selectedIds,
    role: card.state.role,
    taskText: card.state.taskText,
    proposedIds: card.state.proposedIds,
    customNames: Object.fromEntries(card.state.customNames.map((entry) => [entry.id, entry.name])),
    planning: false,
    busy: false,
    error: null,
    created: card.state.created,
  };
  replaceDaibaiTeamGuideFromGateway(next);
  return true;
}

async function appendGuide(slot: "welcome" | "team", state: DaibaiTeamOnboardingState | null) {
  const current = host;
  if (!current?.client || !current.connected || !current.sessionKey.trim()) {
    return;
  }
  if (!isDaibaiWorkbenchSession(current)) {
    return;
  }
  const plan = planDaibaiGuideAppend({
    slot,
    state: state ? guideStatePayload(state) : undefined,
  });
  if (!plan || sentKeys.has(plan.idempotencyKey)) {
    return;
  }
  sentKeys.add(plan.idempotencyKey);
  try {
    await current.client.request("chat.guide.append", {
      sessionKey: current.sessionKey,
      slot,
      ...(plan.card.state ? { state: plan.card.state } : {}),
    });
    if (slot === "team") {
      const latest = planDaibaiGuideAppend({
        slot: "team",
        state: guideStatePayload(getDaibaiTeamOnboardingState()),
      });
      if (latest?.idempotencyKey === plan.idempotencyKey) {
        clearDaibaiTeamGuideDirty();
      }
    }
  } catch {
    sentKeys.delete(plan.idempotencyKey);
  }
}

function scheduleGuideFlush(): void {
  if (!host || !isDaibaiWorkbenchSession(host)) {
    return;
  }
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDaibaiGuideHistoryNow();
  }, 280);
}

export async function flushDaibaiGuideHistoryNow(): Promise<void> {
  const current = host;
  if (!current || !isDaibaiWorkbenchSession(current)) {
    return;
  }
  const state = getDaibaiTeamOnboardingState();
  const acknowledged = isDaibaiGuideAcknowledgedForUser(
    current.settings ?? {},
    guideUserKey(current),
  );
  const messages = Array.isArray(current.chatMessages) ? current.chatMessages : [];
  const hasWelcome = latestDaibaiGuideCard(messages, "welcome") !== null;
  if ((!acknowledged || state.step === "page") && !hasWelcome) {
    await appendGuide("welcome", null);
  }
  if (state.step === "page") {
    await appendGuide("team", state);
  }
}

/** Read guide cards out of the steward transcript and cache them locally. */
export function noteDaibaiGuideHistory(input: object): void {
  const state = input as DaibaiGuideHistoryHost;
  host = state;
  if (!isDaibaiWorkbenchSession(state)) {
    return;
  }
  const messages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
  for (const slot of ["welcome", "team"] as const) {
    const card = latestDaibaiGuideCard(messages, slot);
    if (!card) {
      continue;
    }
    const known = planDaibaiGuideAppend({ slot, state: card.state, now: card.updatedAt });
    if (known) {
      sentKeys.add(known.idempotencyKey);
    }
  }
  const applied = applyTeamCard(messages);
  if (applied) {
    state.requestUpdate?.();
  }
  scheduleGuideFlush();
}

export function installDaibaiGuideHistoryBridge(): void {
  setDaibaiTeamGuidePersistListener(() => {
    scheduleGuideFlush();
  });
}

installDaibaiGuideHistoryBridge();

/** Test hook: drop the in-memory dedupe set. */
export function resetDaibaiGuideHistoryWireForTests(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  sentKeys.clear();
  host = null;
}
