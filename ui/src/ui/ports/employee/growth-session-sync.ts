/**
 * Agent Growth OS — 工作台会话打开时同步 growth（spec: agent-growth-lifecycle, P0B 8.4）。
 */

import { isBuiltinStewardAgent } from "../../../../../src/agents/builtin-steward/identity.ts";
import { parseAgentSessionKey } from "../../../../../src/sessions/session-key-utils.ts";
import {
  type AgentGrowthClientState,
  type GrowthEntityRef,
  type GrowthStatusView,
  recordGrowthMilestone,
  recomputeGrowth,
} from "../../controllers/agent-growth.ts";

export type GrowthSessionSyncHost = AgentGrowthClientState & {
  sessionKey: string;
  workbenchActiveGrowthStatus: GrowthStatusView | null;
  workbenchGrowthPendingTask?: GrowthStatusView["pendingTaskContext"];
  /** Session-local: new robots lead with existing 上岗培养 identity, not a second flow. */
  workbenchGrowthPreferCultivate?: boolean;
  requestUpdate?: () => void;
};

/**
 * Brand-new robots (no identity, no first mission) should open on the existing
 * 上岗培养 identity step. Task-first stays once a mission has been sent.
 */
export function shouldAutoPreferIdentityOnboarding(
  view: GrowthStatusView | null | undefined,
): boolean {
  if (!view) {
    return false;
  }
  if (view.lifecycleState !== "birth" && view.lifecycleState !== "growing") {
    return false;
  }
  if (typeof view.preludeDismissedAtMs === "number" && view.preludeDismissedAtMs > 0) {
    return false;
  }
  const funnel = view.funnel;
  if (funnel?.preludeDismissed || funnel?.hasIdentityCompleted || funnel?.hasFirstMissionSent) {
    return false;
  }
  const milestones = view.milestones;
  if (
    typeof milestones?.identityCompletedAtMs === "number" &&
    milestones.identityCompletedAtMs > 0
  ) {
    return false;
  }
  if (typeof milestones?.firstMissionSentAtMs === "number" && milestones.firstMissionSentAtMs > 0) {
    return false;
  }
  if (view.lifecycleState === "growing" && !funnel && !milestones) {
    return false;
  }
  return true;
}

/** 从 sessionKey 解析 growth 实体；大白 steward 会话返回 null。 */
export function resolveGrowthEntityFromSessionKey(sessionKey: string): GrowthEntityRef | null {
  const raw = sessionKey.trim();
  if (!raw) {
    return null;
  }

  const lower = raw.toLowerCase();
  if (lower.startsWith("space:")) {
    const groupId = raw.slice("space:".length).trim();
    return groupId ? { kind: "group", entityId: groupId } : null;
  }

  const parsed = parseAgentSessionKey(raw);
  if (!parsed) {
    return null;
  }
  if (isBuiltinStewardAgent(parsed.agentId)) {
    return null;
  }

  if (parsed.rest.startsWith("space:")) {
    const groupId = parsed.rest.slice("space:".length).trim();
    return groupId ? { kind: "group", entityId: groupId } : null;
  }

  return { kind: "robot", entityId: parsed.agentId };
}

function notifyGrowthSyncHost(state: GrowthSessionSyncHost) {
  state.requestUpdate?.();
}

/** 会话切换后：记录 sessionOpenedAtMs + recompute，更新 workbenchActiveGrowthStatus。 */
export async function syncGrowthOnWorkbenchSessionOpen(
  state: GrowthSessionSyncHost,
  sessionKey: string,
): Promise<void> {
  const ref = resolveGrowthEntityFromSessionKey(sessionKey);
  if (!ref || !state.client || !state.connected) {
    state.workbenchActiveGrowthStatus = null;
    notifyGrowthSyncHost(state);
    return;
  }
  await recordGrowthMilestone(state, ref, "sessionOpenedAtMs");
  let status = await recomputeGrowth(state, ref);
  const preferIdentity = ref.kind === "robot" && shouldAutoPreferIdentityOnboarding(status);
  state.workbenchGrowthPreferCultivate = preferIdentity;
  if (preferIdentity) {
    status = (await recomputeGrowth(state, ref, { preferCultivate: true })) ?? status;
  }
  state.workbenchActiveGrowthStatus = status;
  const pending = state.workbenchActiveGrowthStatus?.pendingTaskContext;
  if (pending?.draftText?.trim()) {
    state.workbenchGrowthPendingTask = pending;
  }
  notifyGrowthSyncHost(state);
}
