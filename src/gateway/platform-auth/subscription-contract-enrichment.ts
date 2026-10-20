/**
 * Attach active subscription commercialContract windows onto platform enterprise summaries.
 * Reminder-only: never mutates subscription/enterprise status.
 */

import { listActiveSubscriptions } from "../billing/subscriptions-store.js";
import type { ControlUiPlatformEnterpriseSummary } from "../control-ui-contract.js";

export async function attachActiveSubscriptionContracts(
  enterprises: ControlUiPlatformEnterpriseSummary[],
  storePath?: string,
): Promise<ControlUiPlatformEnterpriseSummary[]> {
  if (enterprises.length === 0) {
    return enterprises;
  }
  try {
    const active = await listActiveSubscriptions(storePath);
    const contractByEnterprise = new Map<
      string,
      { contractStart?: string; contractEnd?: string }
    >();
    for (const sub of active) {
      const contract = sub.commercialContract;
      if (!contract?.contractEnd) {
        continue;
      }
      // One active subscription per enterprise in practice; last write wins if duplicates.
      contractByEnterprise.set(sub.enterpriseId, {
        contractStart: contract.contractStart,
        contractEnd: contract.contractEnd,
      });
    }
    if (contractByEnterprise.size === 0) {
      return enterprises;
    }
    return enterprises.map((enterprise) => {
      const contract = contractByEnterprise.get(enterprise.id);
      if (!contract) {
        return enterprise;
      }
      return {
        ...enterprise,
        ...(contract.contractStart ? { contractStart: contract.contractStart } : {}),
        ...(contract.contractEnd ? { contractEnd: contract.contractEnd } : {}),
      };
    });
  } catch {
    // Reminder enrichment must never break platform-auth responses.
    return enterprises;
  }
}
