import type { GatewayBrowserClient } from "../gateway.ts";
import { requestCapabilityInstallPreflight } from "./capability-install-preflight.ts";
import { sanitizeEmployeeSkillSummary, type EmployeeSkillSummary } from "./skill-models.ts";
import type { SkillMessage } from "./skills.ts";

export type RobotSkillEntry = EmployeeSkillSummary & {
  enabled: boolean;
  installedVersion: string;
  latestVersion: string | null;
};

export type RobotSkillsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  robotSkillsLoading: boolean;
  robotSkillsError: string | null;
  robotSkillsList: RobotSkillEntry[];
  robotSkillsBusyKey: string | null;
  robotSkillsAgentId: string | null;
  robotSkillsMessages: Record<string, SkillMessage>;
};

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeRobotSkill(value: unknown): RobotSkillEntry {
  const record = asRecord(value) ?? {};
  return {
    ...sanitizeEmployeeSkillSummary(record),
    enabled: record.enabled !== false,
    installedVersion:
      typeof record.installedVersion === "string" ? record.installedVersion.trim() : "",
    latestVersion: typeof record.latestVersion === "string" ? record.latestVersion.trim() : null,
  };
}

function normalizeRobotSkillList(value: unknown): RobotSkillEntry[] {
  const record = asRecord(value);
  const rawSkills = Array.isArray(value)
    ? value
    : Array.isArray(record?.skills)
      ? record.skills
      : [];
  return rawSkills.map(normalizeRobotSkill);
}

function setRobotSkillMessage(state: RobotSkillsState, key: string, message?: SkillMessage) {
  if (!key.trim()) {
    return;
  }
  const next = { ...state.robotSkillsMessages };
  if (message) {
    next[key] = message;
  } else {
    delete next[key];
  }
  state.robotSkillsMessages = next;
}

export async function loadRobotSkills(state: RobotSkillsState, agentId: string): Promise<void> {
  if (!state.client || !state.connected || state.robotSkillsLoading) {
    return;
  }
  state.robotSkillsLoading = true;
  state.robotSkillsError = null;
  try {
    const result = await state.client.request("robot-skills.list", { agentId });
    state.robotSkillsList = normalizeRobotSkillList(result);
    state.robotSkillsAgentId = agentId;
  } catch (err) {
    state.robotSkillsError = getErrorMessage(err);
  } finally {
    state.robotSkillsLoading = false;
  }
}

export async function toggleRobotSkillEnabled(
  state: RobotSkillsState,
  skillId: string,
  enabled: boolean,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const previous = state.robotSkillsList;
  state.robotSkillsBusyKey = skillId;
  state.robotSkillsError = null;
  state.robotSkillsList = previous.map((entry) =>
    entry.id === skillId ? { ...entry, enabled } : entry,
  );
  try {
    await state.client.request("robot-skills.toggle", {
      agentId: state.robotSkillsAgentId,
      skillId,
      enabled,
    });
    setRobotSkillMessage(state, skillId, {
      kind: "success",
      message: enabled ? "能力已启用" : "能力已禁用",
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.robotSkillsList = previous;
    state.robotSkillsError = message;
    setRobotSkillMessage(state, skillId, { kind: "error", message });
  } finally {
    state.robotSkillsBusyKey = null;
  }
}

export async function upgradeRobotSkill(state: RobotSkillsState, skillId: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.robotSkillsBusyKey = skillId;
  state.robotSkillsError = null;
  try {
    await state.client.request("robot-skills.upgrade", {
      agentId: state.robotSkillsAgentId,
      skillId,
    });
    if (state.robotSkillsAgentId) {
      await loadRobotSkills(state, state.robotSkillsAgentId);
    }
    setRobotSkillMessage(state, skillId, { kind: "success", message: "能力已更新" });
  } catch (err) {
    const message = getErrorMessage(err);
    state.robotSkillsError = message;
    setRobotSkillMessage(state, skillId, { kind: "error", message });
  } finally {
    state.robotSkillsBusyKey = null;
  }
}

export async function removeRobotSkill(state: RobotSkillsState, skillId: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  const previous = state.robotSkillsList;
  state.robotSkillsBusyKey = skillId;
  state.robotSkillsError = null;
  state.robotSkillsList = previous.filter((entry) => entry.id !== skillId);
  try {
    await state.client.request("robot-skills.remove", {
      agentId: state.robotSkillsAgentId,
      skillId,
    });
    setRobotSkillMessage(state, skillId, { kind: "success", message: "能力已从机器人移除" });
  } catch (err) {
    const message = getErrorMessage(err);
    state.robotSkillsList = previous;
    state.robotSkillsError = message;
    setRobotSkillMessage(state, skillId, { kind: "error", message });
  } finally {
    state.robotSkillsBusyKey = null;
  }
}

export async function installSkillToRobot(
  state: RobotSkillsState,
  skillId: string,
  agentId: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.robotSkillsBusyKey = skillId;
  state.robotSkillsError = null;
  try {
    const preflight = await requestCapabilityInstallPreflight(state.client, {
      agentId,
      capabilityId: skillId,
    });
    if (preflight && !preflight.canInstall) {
      state.robotSkillsError = preflight.nextStep;
      setRobotSkillMessage(state, skillId, { kind: "error", message: preflight.nextStep });
      return;
    }
    await state.client.request("robot-skills.install", { agentId, skillId });
    await loadRobotSkills(state, agentId);
    setRobotSkillMessage(state, skillId, { kind: "success", message: "能力已安装" });
  } catch (err) {
    const message = getErrorMessage(err);
    state.robotSkillsError = message;
    setRobotSkillMessage(state, skillId, { kind: "error", message });
  } finally {
    state.robotSkillsBusyKey = null;
  }
}
