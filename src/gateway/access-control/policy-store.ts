// Feature: shared-agent-identity-access-control-plane

import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import type { EnterpriseAccessPolicyV2 } from "./policy-v2-types.js";

const STORE_FILE = "openbot-access-policies.json";

export type AccessPolicyStore = {
  version: 2;
  /** Keyed by `policyId`, so an upsert is naturally idempotent. */
  policies: Record<string, EnterpriseAccessPolicyV2>;
};

export function resolveAccessPolicyStorePath(): string {
  return path.join(CONFIG_DIR, STORE_FILE);
}

export function createEmptyAccessPolicyStore(): AccessPolicyStore {
  return { version: 2, policies: {} };
}

/**
 * Loads the V2 policy set, degrading to an empty store on a missing or malformed
 * file. An empty set means default deny, which is the safe direction.
 */
export async function loadAccessPolicyStore(
  storePath = resolveAccessPolicyStorePath(),
): Promise<AccessPolicyStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath, "utf8")) as Partial<AccessPolicyStore>;
    const policies =
      parsed.policies && typeof parsed.policies === "object" && !Array.isArray(parsed.policies)
        ? parsed.policies
        : {};
    return { version: 2, policies };
  } catch {
    return createEmptyAccessPolicyStore();
  }
}

/** Writes through a temp file + rename so a crash cannot truncate the policy set. */
export async function saveAccessPolicyStore(
  store: AccessPolicyStore,
  storePath = resolveAccessPolicyStorePath(),
): Promise<void> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, storePath);
}

/** Active policies for one enterprise; revoked rows are excluded. */
export function listTenantPolicies(
  store: AccessPolicyStore,
  enterpriseId: string,
): EnterpriseAccessPolicyV2[] {
  return Object.values(store.policies)
    .filter((policy) => policy.enterpriseId === enterpriseId && !policy.revokedAt)
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function countActiveTenantPolicies(store: AccessPolicyStore, enterpriseId: string): number {
  return listTenantPolicies(store, enterpriseId).length;
}

/**
 * Inserts or replaces policies by id. Deterministic migration ids therefore make a
 * re-run a no-op instead of duplicating grants.
 */
export function upsertAccessPolicies(
  store: AccessPolicyStore,
  policies: EnterpriseAccessPolicyV2[],
): { inserted: number; updated: number } {
  let inserted = 0;
  let updated = 0;
  for (const policy of policies) {
    if (store.policies[policy.policyId]) {
      updated += 1;
    } else {
      inserted += 1;
    }
    store.policies[policy.policyId] = policy;
  }
  return { inserted, updated };
}

/** Soft-revokes a policy so history stays reconstructable for audit. */
export function revokeAccessPolicy(
  store: AccessPolicyStore,
  policyId: string,
  nowIso: string,
): EnterpriseAccessPolicyV2 | undefined {
  const policy = store.policies[policyId];
  if (!policy || policy.revokedAt) {
    return undefined;
  }
  policy.revokedAt = nowIso;
  return policy;
}
