import type { GatewayBrowserClient } from "../gateway.ts";
import { requestCapabilityInstallPreflight } from "./capability-install-preflight.ts";
import {
  sanitizeEmployeeSkillSummary,
  sanitizeSkillHealth,
  type SkillHealth,
} from "./skill-models.ts";
import type { SkillMessage } from "./skills.ts";

/**
 * Health summary for a robot capability item.
 * Maps directly from SkillHealth but uses the same shape for consistency.
 */
export type SkillHealthSummary = SkillHealth;

export type RobotCapabilityItem = {
  relationId: string;
  skillId: string;
  name: string;
  summary: string;
  health: SkillHealthSummary;
  enabled: boolean;
  lastInvokedAt: number | null;
  usageCount: number;
  hasNewerVersion: boolean;
  secondary: {
    installedVersion: string;
    latestVersion: string | null;
  };
};

export type RobotCapabilityState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  agentId: string | null;
  items: RobotCapabilityItem[];
  busyRelationId: string | null;
  expandedSkillId: string | null;
  messages: Record<string, SkillMessage>;
};

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCapabilityItem(value: unknown): RobotCapabilityItem {
  const record = asRecord(value) ?? {};
  const summary = sanitizeEmployeeSkillSummary(record);
  const health = sanitizeSkillHealth(record.health);
  const installedVersion =
    typeof record.installedVersion === "string" ? record.installedVersion.trim() : "";
  const latestVersion =
    typeof record.latestVersion === "string" ? record.latestVersion.trim() : null;
  return {
    relationId: typeof record.relationId === "string" ? record.relationId.trim() : summary.id,
    skillId: summary.id,
    name: summary.profile.name,
    summary: summary.profile.summary,
    health,
    enabled: record.enabled !== false,
    lastInvokedAt: optionalNumber(record.lastInvokedAt),
    usageCount: Math.max(0, optionalNumber(record.usageCount) ?? summary.usageCount),
    hasNewerVersion: Boolean(latestVersion && latestVersion !== installedVersion),
    secondary: {
      installedVersion,
      latestVersion,
    },
  };
}

function normalizeCapabilityList(value: unknown): RobotCapabilityItem[] {
  const record = asRecord(value);
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.skills)
        ? record.skills
        : [];
  return rawItems.map(normalizeCapabilityItem);
}

function setMessage(state: RobotCapabilityState, key: string, message?: SkillMessage) {
  if (!key.trim()) {
    return;
  }
  const next = { ...state.messages };
  if (message) {
    next[key] = message;
  } else {
    delete next[key];
  }
  state.messages = next;
}

export async function loadRobotCapabilities(
  state: RobotCapabilityState,
  agentId: string,
): Promise<void> {
  if (!state.client || !state.connected || state.loading) {
    return;
  }
  state.loading = true;
  state.error = null;
  try {
    const result = await state.client.request("robot-capability.list", { agentId });
    state.items = normalizeCapabilityList(result);
    state.agentId = agentId;
  } catch (err) {
    state.error = getErrorMessage(err);
  } finally {
    state.loading = false;
  }
}

export async function toggleCapabilityEnabled(
  state: RobotCapabilityState,
  relationId: string,
  enabled: boolean,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const previous = state.items;
  state.busyRelationId = relationId;
  state.error = null;
  // Optimistic update
  state.items = previous.map((item) =>
    item.relationId === relationId ? { ...item, enabled } : item,
  );
  try {
    await state.client.request("robot-capability.toggle", { relationId, enabled });
    setMessage(state, relationId, {
      kind: "success",
      message: enabled ? "能力已启用" : "能力已禁用",
    });
  } catch (err) {
    const message = getErrorMessage(err);
    // Rollback on failure
    state.items = previous;
    state.error = message;
    setMessage(state, relationId, { kind: "error", message });
  } finally {
    state.busyRelationId = null;
  }
}

export async function switchCapabilityVersion(
  state: RobotCapabilityState,
  relationId: string,
  targetVersion: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.busyRelationId = relationId;
  state.error = null;
  try {
    await state.client.request("robot-capability.switch-version", { relationId, targetVersion });
    // Reload to get updated version info
    if (state.agentId) {
      await loadRobotCapabilities(state, state.agentId);
    }
    setMessage(state, relationId, { kind: "success", message: "已切换到新版本" });
  } catch (err) {
    const message = getErrorMessage(err);
    state.error = message;
    setMessage(state, relationId, { kind: "error", message });
  } finally {
    state.busyRelationId = null;
  }
}

export async function removeCapability(
  state: RobotCapabilityState,
  relationId: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const previous = state.items;
  state.busyRelationId = relationId;
  state.error = null;
  // Optimistic removal from list
  state.items = previous.filter((item) => item.relationId !== relationId);
  try {
    await state.client.request("robot-capability.remove", { relationId });
    setMessage(state, relationId, { kind: "success", message: "能力已从机器人移除" });
  } catch (err) {
    const message = getErrorMessage(err);
    // Rollback on failure
    state.items = previous;
    state.error = message;
    setMessage(state, relationId, { kind: "error", message });
  } finally {
    state.busyRelationId = null;
  }
}

export async function installSkillToRobot(
  state: RobotCapabilityState,
  skillId: string,
  agentId: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.busyRelationId = skillId;
  state.error = null;
  try {
    const preflight = await requestCapabilityInstallPreflight(state.client, {
      agentId,
      capabilityId: skillId,
    });
    if (preflight && !preflight.canInstall) {
      state.error = preflight.nextStep;
      setMessage(state, skillId, { kind: "error", message: preflight.nextStep });
      return;
    }
    await state.client.request("robot-capability.install", { agentId, skillId });
    // Reload to get the new item with server-assigned relationId
    await loadRobotCapabilities(state, agentId);
    setMessage(state, skillId, { kind: "success", message: "能力已安装" });
  } catch (err) {
    const message = getErrorMessage(err);
    state.error = message;
    setMessage(state, skillId, { kind: "error", message });
  } finally {
    state.busyRelationId = null;
  }
}

export function expandCapability(state: RobotCapabilityState, skillId: string | null): void {
  state.expandedSkillId = state.expandedSkillId === skillId ? null : skillId;
}
