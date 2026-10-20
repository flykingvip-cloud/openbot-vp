import type { GatewayAgentRow } from "../../../types.ts";
import type {
  WorkbenchSettingsGroupEntry,
  WorkbenchSettingsRobotEntry,
} from "./workbench-types.ts";

type SpaceLike = {
  id?: string | null;
  groupId?: string | null;
  title?: string | null;
};

export type WorkbenchSeatOfferDisplayLabels = {
  defaultAgentLabel: string | null;
  agentToolLabels: string[];
  defaultSpaceLabels: string[];
};

const SEAT_STATUS_LABELS: Record<string, { zh: string; en: string }> = {
  vacant: { zh: "空闲", en: "Vacant" },
  assigned: { zh: "已分配", en: "Assigned" },
  occupied: { zh: "在岗", en: "Active" },
  handover_pending: { zh: "交接中", en: "Handover pending" },
  frozen: { zh: "已冻结", en: "Frozen" },
  active: { zh: "正常", en: "Active" },
};

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function formatWorkbenchSeatStatus(
  status: string | null | undefined,
  locale: "zh-CN" | "en" = "zh-CN",
): string {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) {
    return locale === "en" ? "Unbound" : "未绑定";
  }
  const entry = SEAT_STATUS_LABELS[normalized];
  if (entry) {
    return locale === "en" ? entry.en : entry.zh;
  }
  return normalized.replace(/_/g, " ");
}

export function buildWorkbenchSeatOfferDisplayLabels(params: {
  agents: GatewayAgentRow[];
  robotEntries: WorkbenchSettingsRobotEntry[];
  groupEntries: WorkbenchSettingsGroupEntry[];
  spaces: SpaceLike[];
  defaultAgentId?: string | null;
  agentIds?: string[];
  defaultSpaceIds?: string[];
}): WorkbenchSeatOfferDisplayLabels {
  const agentLookup = new Map<string, string>();
  for (const agent of params.agents) {
    const label = agent.name?.trim() || agent.identity?.name?.trim();
    if (label) {
      agentLookup.set(agent.id, label);
    }
  }
  for (const entry of params.robotEntries) {
    const label = entry.name?.trim();
    if (label) {
      agentLookup.set(entry.id, label);
    }
  }

  const spaceLookup = new Map<string, string>();
  for (const space of params.spaces) {
    const title = space.title?.trim();
    if (!title) {
      continue;
    }
    if (space.id) {
      spaceLookup.set(space.id, title);
    }
    if (space.groupId) {
      spaceLookup.set(space.groupId, title);
    }
  }
  for (const group of params.groupEntries) {
    const title = group.title?.trim();
    if (!title) {
      continue;
    }
    if (group.groupId) {
      spaceLookup.set(group.groupId, title);
    }
    if (group.sessionKey) {
      spaceLookup.set(group.sessionKey, title);
    }
  }

  const resolveAgent = (id: string) => agentLookup.get(id) ?? id;
  const resolveSpace = (id: string) => spaceLookup.get(id) ?? id;

  return {
    defaultAgentLabel: params.defaultAgentId?.trim()
      ? resolveAgent(params.defaultAgentId.trim())
      : null,
    agentToolLabels: (params.agentIds ?? []).map((id) => resolveAgent(id.trim())).filter(Boolean),
    defaultSpaceLabels: dedupePreserveOrder(
      (params.defaultSpaceIds ?? []).map((id) => resolveSpace(id.trim())).filter(Boolean),
    ),
  };
}
