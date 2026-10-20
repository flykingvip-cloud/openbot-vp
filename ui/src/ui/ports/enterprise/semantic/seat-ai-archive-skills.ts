/**
 * 岗位档案技能投影缓存：按 seat 聚合 robot-capability.list（既有 RPC，无新后端）。
 */

import type { GatewayBrowserClient } from "../../../gateway.ts";
import { requestEnterpriseAppRerender } from "../views/enterprise-surface-shared.ts";

const skillsBySeatId = new Map<string, string[]>();
const inflightBySeatId = new Map<string, Promise<void>>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectSkillNames(payload: unknown): string[] {
  const record = asRecord(payload);
  const rawItems = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.items)
      ? record.items
      : Array.isArray(record?.skills)
        ? record.skills
        : [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of rawItems) {
    const entry = asRecord(item);
    const name =
      (typeof entry?.name === "string" && entry.name.trim()) ||
      (typeof entry?.skillId === "string" && entry.skillId.trim()) ||
      (typeof entry?.id === "string" && entry.id.trim()) ||
      "";
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function getSeatArchiveKnownSkills(seatId: string): string[] {
  return [...(skillsBySeatId.get(seatId) ?? [])];
}

export function getSeatArchiveKnownSkillsMap(): ReadonlyMap<string, readonly string[]> {
  return skillsBySeatId;
}

export function resetSeatArchiveSkillsCacheForTests() {
  skillsBySeatId.clear();
  inflightBySeatId.clear();
}

export function collectUniqueSeatAgentIds(params: {
  agentIds: readonly string[];
  defaultAgentId?: string | null;
}): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...params.agentIds, params.defaultAgentId]) {
    const id = candidate?.trim() ?? "";
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * 打开档案时按岗位 Bot 拉取技能；结果写入缓存并触发企业端重渲染。
 * 无 agent / 无 client 时静默跳过。
 */
export function ensureSeatArchiveSkillsLoaded(params: {
  client: GatewayBrowserClient | null | undefined;
  connected?: boolean;
  seatId: string;
  agentIds: readonly string[];
  defaultAgentId?: string | null;
}): void {
  const agentIds = collectUniqueSeatAgentIds({
    agentIds: params.agentIds,
    defaultAgentId: params.defaultAgentId,
  });
  if (!params.client || params.connected === false || agentIds.length === 0) {
    return;
  }
  if (skillsBySeatId.has(params.seatId) || inflightBySeatId.has(params.seatId)) {
    return;
  }

  const load = (async () => {
    const names = new Set<string>();
    await Promise.all(
      agentIds.map(async (agentId) => {
        try {
          const result = await params.client!.request("robot-capability.list", { agentId });
          for (const name of collectSkillNames(result)) {
            names.add(name);
          }
        } catch {
          // 单 agent 失败不影响其他；保持空投影即可
        }
      }),
    );
    skillsBySeatId.set(
      params.seatId,
      [...names].toSorted((left, right) => left.localeCompare(right)),
    );
    requestEnterpriseAppRerender();
  })().finally(() => {
    inflightBySeatId.delete(params.seatId);
  });

  inflightBySeatId.set(params.seatId, load);
}
