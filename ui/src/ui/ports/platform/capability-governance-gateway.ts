import type {
  CapabilityGovernanceSnapshot,
  CapabilityProposal,
  CapabilityRegistryEntry,
} from "../../capability/capability-governance/types.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";

type GatewayRegistryEntry = CapabilityRegistryEntry & {
  createdAt?: string;
  updatedAt?: string;
};

export type CapabilityGovernanceSnapshotHost = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  capabilityGovernanceSnapshot: CapabilityGovernanceSnapshot | null;
  lastError?: string | null;
};

export function normalizeCapabilityGovernanceSnapshot(input: {
  proposals?: CapabilityProposal[];
  registry?: GatewayRegistryEntry[];
}): CapabilityGovernanceSnapshot {
  return {
    proposals: input.proposals ?? [],
    registry: (input.registry ?? []).map((entry) => ({
      ...entry,
      distribution: {
        ...entry.distribution,
        employeeVisibilityMode:
          entry.distribution?.employeeVisibilityMode ?? "enterprise_review_required",
      },
      lastLifecycleEvent: entry.lastLifecycleEvent ?? {
        capabilityId: entry.manifest.id,
        fromState: null,
        toState: entry.lifecycleState,
        at: entry.updatedAt ?? entry.createdAt ?? new Date().toISOString(),
      },
    })),
    metrics: [],
  };
}

export async function refreshCapabilityGovernanceSnapshot(
  host: CapabilityGovernanceSnapshotHost,
): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    const [proposalsResult, registryResult] = await Promise.all([
      host.client.request<{ proposals?: CapabilityProposal[] }>(
        "capabilities.governance.listProposals",
        {},
      ),
      host.client.request<{ entries?: GatewayRegistryEntry[] }>(
        "capabilities.governance.listRegistry",
        {},
      ),
    ]);
    host.capabilityGovernanceSnapshot = normalizeCapabilityGovernanceSnapshot({
      proposals: proposalsResult.proposals,
      registry: registryResult.entries,
    });
  } catch (error) {
    if ("lastError" in host) {
      host.lastError = error instanceof Error ? error.message : "能力发现池刷新失败。";
    }
  }
}
