export type CronExecutionAgentOption = {
  id: string;
  label: string;
  emoji?: string | null;
  source: "owned" | "participating";
};

export type CronExecutionGroupOption = {
  sessionKey: string;
  label: string;
  memberCount: number;
  purpose?: string;
  mission?: string;
};

export function buildCronExecutionAgents(
  agents: Array<{
    id: string;
    name?: string | null;
    identity?: { name?: string | null; emoji?: string | null } | null;
    source?: "owned" | "participating";
  }>,
): CronExecutionAgentOption[] {
  return agents
    .map((agent) => ({
      id: agent.id,
      label: (agent.identity?.name ?? agent.name ?? agent.id).trim() || agent.id,
      emoji: agent.identity?.emoji ?? null,
      source: agent.source ?? "owned",
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN"));
}

export function buildCronExecutionGroups(
  groups: Array<{
    sessionKey: string;
    title: string;
    memberCount?: number;
    purpose?: string | null;
    mission?: string | null;
  }>,
): CronExecutionGroupOption[] {
  return groups
    .map((group) => ({
      sessionKey: group.sessionKey,
      label: group.title,
      memberCount: group.memberCount ?? 0,
      purpose: group.purpose?.trim() || undefined,
      mission: group.mission?.trim() || undefined,
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN"));
}

export function resolveAgentLabel(agents: CronExecutionAgentOption[], agentId: string): string {
  return agents.find((entry) => entry.id === agentId)?.label ?? agentId;
}

export function resolveGroupLabel(groups: CronExecutionGroupOption[], sessionKey: string): string {
  return groups.find((entry) => entry.sessionKey === sessionKey)?.label ?? sessionKey;
}
