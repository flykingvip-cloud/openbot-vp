/**
 * Capability composer contracts for learning-governance overlays.
 */
export interface CapabilitySet {
  personal: string[];
  group: string[];
  participation: string[];
  filtered: string[];
  final: string[];
}

export interface CapabilityComposer {
  composeCapabilities(params: {
    botId: string;
    groupId: string;
    personalCapabilities: string[];
    groupCapabilities: string[];
    participationOverlay?: string[];
    policyFilters?: string[];
  }): Promise<CapabilitySet>;
  isCapabilityAllowed(capability: string, capabilitySet: CapabilitySet): boolean;
}

function toUniqueCapabilities(capabilities: string[]): string[] {
  return [...new Set(capabilities.map((entry) => entry.trim()).filter(Boolean))];
}

function parsePolicyFilters(filters: string[]) {
  const allow = new Set<string>();
  const block = new Set<string>();

  for (const filter of filters.map((entry) => entry.trim()).filter(Boolean)) {
    if (filter.startsWith("allow:")) {
      allow.add(filter.slice("allow:".length).trim());
      continue;
    }
    if (filter.startsWith("block:")) {
      block.add(filter.slice("block:".length).trim());
      continue;
    }
    if (filter.startsWith("!")) {
      block.add(filter.slice(1).trim());
      continue;
    }
    allow.add(filter);
  }

  return { allow, block };
}

export class DefaultCapabilityComposer implements CapabilityComposer {
  async composeCapabilities(params: {
    botId: string;
    groupId: string;
    personalCapabilities: string[];
    groupCapabilities: string[];
    participationOverlay?: string[];
    policyFilters?: string[];
  }): Promise<CapabilitySet> {
    void params.botId;
    void params.groupId;

    const personal = toUniqueCapabilities(params.personalCapabilities);
    const group = toUniqueCapabilities(params.groupCapabilities);
    const participation = toUniqueCapabilities(params.participationOverlay ?? []);
    const combined = toUniqueCapabilities([...personal, ...group, ...participation]);
    const { allow, block } = parsePolicyFilters(params.policyFilters ?? []);

    const filtered = combined.filter((capability) => {
      if (allow.size > 0 && !allow.has(capability)) {
        return false;
      }
      return !block.has(capability);
    });

    return {
      personal,
      group,
      participation,
      filtered,
      final: filtered,
    };
  }

  isCapabilityAllowed(capability: string, capabilitySet: CapabilitySet): boolean {
    return capabilitySet.final.includes(capability.trim());
  }
}
