/**
 * Enterprise contribution summary aggregation for the platform enterprise directory.
 *
 * Reads governance proposals (capability asset packages submitted by an enterprise's
 * employees) and rolls them up per enterprise so the platform console can show how much
 * each tenant is contributing to the shared capability supply.
 *
 * Pure aggregation over `listProposals()`; no IO beyond the governance store read.
 */

import { listProposals } from "../capability-governance-store.js";
import type { ControlUiPlatformEnterpriseSummary } from "../control-ui-contract.js";

type ContributionSummary = NonNullable<ControlUiPlatformEnterpriseSummary["contributionSummary"]>;

/** A zero-filled contribution summary (all six counters present at 0). */
export function emptyContributionSummary(): ContributionSummary {
  return {
    submittedAssetPackages: 0,
    approvedAssets: 0,
    incubationCandidates: 0,
    platformCandidates: 0,
    crossTenantReuseCount: 0,
    publishedSharedAssets: 0,
  };
}

/** True when a proposal manifest carries an enterprise asset package payload. */
function hasAssetPackage(manifest: Record<string, unknown>): boolean {
  const pkg = manifest.enterpriseAssetPackage;
  return typeof pkg === "object" && pkg !== null;
}

/** Read the asset package promotion intent, if present. */
function promotionIntentOf(manifest: Record<string, unknown>): string | undefined {
  const pkg = manifest.enterpriseAssetPackage;
  if (typeof pkg === "object" && pkg !== null) {
    const intent = (pkg as Record<string, unknown>).promotionIntent;
    return typeof intent === "string" ? intent : undefined;
  }
  return undefined;
}

/**
 * Build a per-enterprise map of contribution summaries from governance proposals.
 *
 * Only proposals that (a) reference an enterprise and (b) carry an
 * `enterpriseAssetPackage` count as contributions. Counters:
 * - `submittedAssetPackages`: all asset-package proposals for the enterprise.
 * - `approvedAssets`: those with status `approved`.
 * - `incubationCandidates`: all asset-package proposals (every package is an
 *   incubation candidate until promoted/rejected).
 * - `platformCandidates`: those whose promotion intent is `platform_candidate`.
 */
export function buildEnterpriseContributionSummaries(): Map<string, ContributionSummary> {
  const byEnterprise = new Map<string, ContributionSummary>();
  for (const proposal of listProposals()) {
    const enterpriseId = proposal.enterpriseId;
    if (!enterpriseId || !hasAssetPackage(proposal.manifest)) {
      continue;
    }
    const current: ContributionSummary =
      byEnterprise.get(enterpriseId) ?? emptyContributionSummary();
    current.submittedAssetPackages = (current.submittedAssetPackages ?? 0) + 1;
    current.incubationCandidates = (current.incubationCandidates ?? 0) + 1;
    if (proposal.status === "approved") {
      current.approvedAssets = (current.approvedAssets ?? 0) + 1;
    }
    if (promotionIntentOf(proposal.manifest) === "platform_candidate") {
      current.platformCandidates = (current.platformCandidates ?? 0) + 1;
    }
    byEnterprise.set(enterpriseId, current);
  }
  return byEnterprise;
}
