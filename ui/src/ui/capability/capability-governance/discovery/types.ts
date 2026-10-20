// Discovery adapter interface.
//
// Each external source (npm, GitHub topic, Clawhub, MCP registry)
// implements `SourceAdapter`. The discovery dispatcher calls all
// registered adapters and merges results into the proposal pipeline.

import type { CapabilityManifest, SecurityFinding } from "../types.ts";

export type DiscoveryFilter = {
  /** Only return capabilities matching this keyword. */
  keyword?: string;
  /** Maximum results per adapter invocation. */
  limit?: number;
};

export type DiscoveredCapability = {
  /** Adapter-assigned dedup key: `(sourceId, externalId, version)`. */
  sourceId: string;
  externalId: string;
  version: string;
  /** Partially-filled manifest (adapter fills what it can). */
  manifest: CapabilityManifest;
  /** Security findings detected during discovery (pre-proposal). */
  findings: SecurityFinding[];
  /** Raw provenance for audit. */
  provenance: {
    url: string;
    fetchedAt: string;
    registryName: string;
  };
};

export interface SourceAdapter {
  /** Stable identifier for this adapter (e.g. "npm", "github-topic"). */
  readonly id: string;
  /** Human-readable label. */
  readonly label: string;
  /** Discover capabilities from the external source. */
  discover(filter?: DiscoveryFilter): Promise<DiscoveredCapability[]>;
}
