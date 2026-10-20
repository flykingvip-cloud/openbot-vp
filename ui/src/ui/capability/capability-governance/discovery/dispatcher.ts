// Discovery Dispatcher
//
// Orchestrates multiple SourceAdapters, deduplicates results, and
// converts them into CapabilityProposals for the governance pipeline.
//
// Usage:
//   const dispatcher = new DiscoveryDispatcher([npmAdapter]);
//   const proposals = await dispatcher.run();
//   // → feed proposals into the governance state

import type { CapabilityProposal } from "../types.ts";
import type { DiscoveredCapability, DiscoveryFilter, SourceAdapter } from "./types.ts";

export type DiscoveryRunResult = {
  discovered: DiscoveredCapability[];
  proposals: CapabilityProposal[];
  errors: Array<{ adapterId: string; error: unknown }>;
};

function dedupKey(item: DiscoveredCapability): string {
  return `${item.sourceId}:${item.externalId}:${item.version}`;
}

function toProposal(item: DiscoveredCapability): CapabilityProposal {
  return {
    proposalId: `proposal:${item.sourceId}:${item.externalId}@${item.version}`,
    submittedAt: item.provenance.fetchedAt,
    submittedBy: item.sourceId,
    status: "proposed",
    manifest: item.manifest,
    findings: item.findings,
  };
}

export class DiscoveryDispatcher {
  private adapters: SourceAdapter[];

  constructor(adapters: SourceAdapter[]) {
    this.adapters = adapters;
  }

  /** Register an additional adapter at runtime. */
  addAdapter(adapter: SourceAdapter): void {
    if (!this.adapters.some((a) => a.id === adapter.id)) {
      this.adapters.push(adapter);
    }
  }

  /** Run all adapters, deduplicate, and produce proposals. */
  async run(filter?: DiscoveryFilter): Promise<DiscoveryRunResult> {
    const errors: DiscoveryRunResult["errors"] = [];
    const allDiscovered: DiscoveredCapability[] = [];

    // Run adapters in parallel.
    const results = await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        try {
          return await adapter.discover(filter);
        } catch (error) {
          errors.push({ adapterId: adapter.id, error });
          return [];
        }
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allDiscovered.push(...result.value);
      }
    }

    // Deduplicate by (sourceId, externalId, version).
    const seen = new Set<string>();
    const unique: DiscoveredCapability[] = [];
    for (const item of allDiscovered) {
      const key = dedupKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(item);
    }

    // Convert to proposals.
    const proposals = unique.map(toProposal);

    return { discovered: unique, proposals, errors };
  }

  /** List registered adapter IDs. */
  get adapterIds(): string[] {
    return this.adapters.map((a) => a.id);
  }
}
