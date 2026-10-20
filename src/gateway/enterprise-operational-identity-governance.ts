/**
 * Tenant-owned enterprise Operational Identity write path governance.
 * Keeps enterprise seat-assets aggregate separate from user-owned OI store.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { compensateOperationalIdentityAggregateWrite } from "./data-governance/logical-compensate.js";
import {
  finalizeOperationalIdentityWriteSession,
  prepareOperationalIdentityWriteSession,
  type OperationalIdentityWriteSession,
} from "./data-governance/operational-identity-register.js";
import { ownershipProofForEnterpriseOperationalIdentity } from "./data-governance/ownership-proof.js";
import type { GovernanceOwnershipProof } from "./data-governance/write-gate.js";
import {
  saveEnterpriseSeatAssetsStore,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

export type SaveEnterpriseOiGovernedParams = {
  storePath: string | undefined;
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  /** Identity ids (or credential-binding grains) touched by this mutation. */
  governedIdentityIds: string[];
  /**
   * Trusted proof from authenticated enterprise admin route.
   * Defaults to tenant-owned enterprise-oi system principal when omitted after auth.
   */
  ownershipProof?: GovernanceOwnershipProof;
  governanceStateDir?: string;
  providerByIdentityId?: Record<string, string | null | undefined>;
  credentialHandleByIdentityId?: Record<string, string | null | undefined>;
};

/**
 * Persist enterprise seat-assets after OI identity/credential/binding/policy mutations
 * under allocate → pending → physical write → active (or gate when already active).
 * Shared JSON aggregate: pre-write snapshot + logical restore on create abort (never
 * quarantine the whole store for one identity).
 */
export async function saveEnterpriseSeatAssetsStoreWithOiGovernance(
  params: SaveEnterpriseOiGovernedParams,
): Promise<void> {
  const tenantId = params.tenantId.trim();
  if (!tenantId) {
    throw new Error("governance_write_denied:managed_requires_tenant");
  }
  const identityIds = [
    ...new Set(params.governedIdentityIds.map((id) => id.trim()).filter(Boolean)),
  ];
  if (identityIds.length === 0) {
    throw new Error("governance_write_denied:missing_oi_identity");
  }

  const ownershipProof =
    params.ownershipProof ?? ownershipProofForEnterpriseOperationalIdentity({ tenantId });
  const stateDir = params.governanceStateDir ?? resolveStateDir();
  const canonicalLocator =
    params.storePath?.trim() || path.join(stateDir, "enterprise-seat-assets.json");
  const allowedRoots = [path.dirname(path.resolve(canonicalLocator)), stateDir];
  const sessions: Array<{ identityId: string; session: OperationalIdentityWriteSession }> = [];
  const priorStoreJson = fs.existsSync(canonicalLocator)
    ? fs.readFileSync(canonicalLocator, "utf8")
    : null;

  try {
    for (const identityId of identityIds) {
      const session = await prepareOperationalIdentityWriteSession({
        tenantId,
        identityId,
        canonicalLocator,
        ownershipProof,
        provider: params.providerByIdentityId?.[identityId] ?? null,
        credentialHandleId: params.credentialHandleByIdentityId?.[identityId] ?? null,
        stateDir,
      });
      sessions.push({ identityId, session });
    }

    await saveEnterpriseSeatAssetsStore(params.storePath, params.store);

    for (const { session } of sessions) {
      await finalizeOperationalIdentityWriteSession({
        session,
        ok: true,
        stateDir,
        allowedRoots,
      });
    }
  } catch (err) {
    for (const { identityId, session } of sessions) {
      try {
        await finalizeOperationalIdentityWriteSession({
          session,
          ok: false,
          reason: String((err as Error)?.message ?? err),
          stateDir,
          allowedRoots,
          logicalCompensate: async () =>
            compensateOperationalIdentityAggregateWrite({
              storePath: canonicalLocator,
              identityId,
              priorStoreJson,
            }),
        });
      } catch {
        // best-effort abort
      }
    }
    throw err;
  }
}
