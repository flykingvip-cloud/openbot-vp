/**
 * 席位规则只注入该席位已绑定的机器人。
 * 绑定来源：defaultAgentAssetIds，以及未撤销的 agent 资产绑定。
 */
export type SeatAgentBindingRef = {
  assetType: string;
  assetId: string;
  revokedAt?: string | null;
  status?: string | null;
};

export function resolveSeatBoundAgentIds(input: {
  defaultAgentAssetIds?: readonly string[] | null;
  assetBindings?: readonly SeatAgentBindingRef[] | null;
}): string[] {
  const ids = new Set<string>();
  for (const raw of input.defaultAgentAssetIds ?? []) {
    const id = raw.trim();
    if (id) {
      ids.add(id);
    }
  }
  for (const binding of input.assetBindings ?? []) {
    if (binding.assetType !== "agent") {
      continue;
    }
    if (binding.revokedAt) {
      continue;
    }
    if (binding.status === "revoked") {
      continue;
    }
    const id = binding.assetId.trim();
    if (id) {
      ids.add(id);
    }
  }
  return [...ids].toSorted();
}

export function projectSeatRulesForAgent<T>(input: {
  agentId: string;
  boundAgentIds: readonly string[];
  rules: readonly T[];
}): { injected: boolean; rules: T[] } {
  const agentId = input.agentId.trim();
  if (!agentId || !input.boundAgentIds.includes(agentId)) {
    return { injected: false, rules: [] };
  }
  return { injected: true, rules: [...input.rules] };
}
