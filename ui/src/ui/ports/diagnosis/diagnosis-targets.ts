/**
 * Enterprise diagnosis target picker.
 * Roster SoT is the enterprise mesh (数字人 + 协作小组), not skill-event fallback.
 * Session keys follow the live chat convention so diagnose() can attach a session file.
 */
import {
  BUILTIN_STEWARD_AGENT_ID,
  BUILTIN_STEWARD_NAME,
  isBuiltinStewardAgent,
} from "../../builtin-steward-selection.ts";

export const ALL_DIAGNOSIS_TARGET_ID = "all";
export const DIAGNOSIS_ALL_TARGET_CAP = 8;

export type DiagnosisTargetKind = "agent" | "group";

export type DiagnosisTargetOption = {
  id: string;
  kind: DiagnosisTargetKind;
  label: string;
  agentId: string;
  sessionKey: string;
  steward: boolean;
};

export type DiagnosisTargetRoster = {
  agents?: Array<{ agentId: string; name?: string | null }>;
  groups?: Array<{ groupId: string; name?: string | null }>;
  spaces?: Array<{
    id: string;
    groupId?: string | null;
    title?: string | null;
    coordinatorBotId?: string | null;
  }>;
};

export function agentDiagnosisSessionKey(agentId: string): string {
  return `agent:${agentId}:main`;
}

export function groupDiagnosisSessionKey(groupId: string, coordinatorAgentId: string): string {
  return `agent:${coordinatorAgentId}:space:${groupId}`;
}

export function diagnosisTargetsFromEnterpriseRoster(
  roster: DiagnosisTargetRoster = {},
): DiagnosisTargetOption[] {
  const agentsById = new Map<string, DiagnosisTargetOption>();
  const groupsById = new Map<string, DiagnosisTargetOption>();

  agentsById.set(BUILTIN_STEWARD_AGENT_ID, {
    id: `agent:${BUILTIN_STEWARD_AGENT_ID}`,
    kind: "agent",
    label: BUILTIN_STEWARD_NAME,
    agentId: BUILTIN_STEWARD_AGENT_ID,
    sessionKey: agentDiagnosisSessionKey(BUILTIN_STEWARD_AGENT_ID),
    steward: true,
  });

  for (const agent of roster.agents ?? []) {
    const agentId = agent.agentId?.trim();
    if (!agentId) {
      continue;
    }
    const steward = isBuiltinStewardAgent(agentId);
    const existing = agentsById.get(agentId);
    const label = steward ? BUILTIN_STEWARD_NAME : agent.name?.trim() || existing?.label || agentId;
    agentsById.set(agentId, {
      id: `agent:${agentId}`,
      kind: "agent",
      label,
      agentId,
      sessionKey: agentDiagnosisSessionKey(agentId),
      steward,
    });
  }

  for (const group of roster.groups ?? []) {
    const groupId = group.groupId?.trim();
    if (!groupId) {
      continue;
    }
    groupsById.set(groupId, {
      id: `group:${groupId}`,
      kind: "group",
      label: group.name?.trim() || groupId,
      agentId: BUILTIN_STEWARD_AGENT_ID,
      sessionKey: groupDiagnosisSessionKey(groupId, BUILTIN_STEWARD_AGENT_ID),
      steward: true,
    });
  }

  for (const space of roster.spaces ?? []) {
    const groupId = space.groupId?.trim() || space.id?.trim();
    if (!groupId) {
      continue;
    }
    const coordinator = space.coordinatorBotId?.trim() || BUILTIN_STEWARD_AGENT_ID;
    const existing = groupsById.get(groupId);
    groupsById.set(groupId, {
      id: `group:${groupId}`,
      kind: "group",
      label: space.title?.trim() || existing?.label || groupId,
      agentId: coordinator,
      sessionKey: groupDiagnosisSessionKey(groupId, coordinator),
      steward: isBuiltinStewardAgent(coordinator),
    });
  }

  const agents = [...agentsById.values()].toSorted((left, right) => {
    if (left.steward !== right.steward) {
      return left.steward ? -1 : 1;
    }
    return left.label.localeCompare(right.label, "zh-CN");
  });
  const groups = [...groupsById.values()].toSorted((left, right) =>
    left.label.localeCompare(right.label, "zh-CN"),
  );
  return [...agents, ...groups];
}

export function isAllDiagnosisTarget(id: string | null | undefined): boolean {
  return id?.trim() === ALL_DIAGNOSIS_TARGET_ID;
}

export function findDiagnosisTarget(
  targets: readonly DiagnosisTargetOption[],
  id: string | null | undefined,
): DiagnosisTargetOption | null {
  const selected = id?.trim();
  if (!selected || selected === ALL_DIAGNOSIS_TARGET_ID) {
    return null;
  }
  return targets.find((row) => row.id === selected) ?? null;
}
