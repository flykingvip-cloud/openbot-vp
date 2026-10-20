import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import { compensateOperationalIdentityAggregateWrite } from "./data-governance/logical-compensate.js";
import {
  finalizeOperationalIdentityWriteSession,
  prepareOperationalIdentityWriteSession,
  type OperationalIdentityWriteSession,
} from "./data-governance/operational-identity-register.js";
import {
  ownershipProofFromLocalUser,
  ownershipProofFromTenantUser,
} from "./data-governance/ownership-proof.js";
import type { GovernanceOwnershipProof } from "./data-governance/write-gate.js";
import {
  USER_OPERATIONAL_IDENTITY_STORE_VERSION,
  type UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

const DEFAULT_STORE_FILENAME = "openbot-user-operational-identity.json";

export function resolveDefaultUserOperationalIdentityStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_STORE_FILENAME);
}

export function normalizeUserOperationalIdentityStore(
  parsed: Partial<UserOperationalIdentityStore> | null | undefined,
): UserOperationalIdentityStore {
  return {
    version: parsed?.version ?? USER_OPERATIONAL_IDENTITY_STORE_VERSION,
    identities: parsed?.identities ?? {},
    grants: parsed?.grants ?? {},
    bindingRequests: parsed?.bindingRequests ?? {},
    usageEvents: parsed?.usageEvents ?? {},
    lifecycleEvents: parsed?.lifecycleEvents ?? {},
    continuations: parsed?.continuations ?? {},
    credentialHandles: parsed?.credentialHandles ?? {},
    oauthSessions: parsed?.oauthSessions ?? {},
  };
}

export async function loadUserOperationalIdentityStore(
  storePath?: string,
): Promise<UserOperationalIdentityStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultUserOperationalIdentityStorePath(),
  );
  const parsed = await readJsonFile<Partial<UserOperationalIdentityStore>>(resolvedPath);
  return normalizeUserOperationalIdentityStore(parsed);
}

export type SaveUserOperationalIdentityOptions = {
  governanceStateDir?: string;
  /**
   * Trusted proof from authenticated call entry (TenantContext / membership).
   * Required for any managed (tenantId set) identity — never inferred from identity.ownerId alone.
   */
  governanceOwnershipProof?: GovernanceOwnershipProof;
};

/**
 * Persist user-owned OI metadata store.
 * Managed identities use allocate → pending → write → active; secrets stay in the secrets store.
 */
export async function saveUserOperationalIdentityStore(
  store: UserOperationalIdentityStore,
  storePath?: string,
  options?: SaveUserOperationalIdentityOptions,
): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultUserOperationalIdentityStorePath(),
  );
  const normalized = normalizeUserOperationalIdentityStore({
    ...store,
    version: USER_OPERATIONAL_IDENTITY_STORE_VERSION,
  });
  const stateDir = options?.governanceStateDir ?? resolveStateDir();
  const allowedRoots = [path.dirname(resolvedPath), stateDir];
  const sessions: Array<{ identityId: string; session: OperationalIdentityWriteSession }> = [];
  const priorStoreJson = fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, "utf8") : null;

  try {
    for (const identity of Object.values(normalized.identities)) {
      const tenantId = identity.tenantId?.trim() || null;
      const managed = Boolean(tenantId);
      if (managed && !options?.governanceOwnershipProof) {
        throw new Error("governance_write_denied:missing_ownership_proof");
      }
      if (
        managed &&
        options?.governanceOwnershipProof?.owner.kind === "user" &&
        options.governanceOwnershipProof.owner.userId !== identity.ownerId
      ) {
        // Call-entry proof must authorize this identity owner; do not rebuild proof from payload.
        throw new Error("governance_write_denied:owner_mismatch");
      }
      const session = await prepareOperationalIdentityWriteSession({
        tenantId,
        identityId: identity.identityId,
        canonicalLocator: resolvedPath,
        ownershipProof: options?.governanceOwnershipProof,
        provider: identity.provider,
        credentialHandleId: identity.credentialHandleId,
        stateDir,
      });
      sessions.push({ identityId: identity.identityId, session });
    }

    await writeJsonAtomic(resolvedPath, normalized);

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
              storePath: resolvedPath,
              identityId,
              priorStoreJson,
            }),
        });
      } catch {
        // best-effort abort; surface original error
      }
    }
    throw err;
  }
}

export async function withUserOperationalIdentityStoreWriteLock<T>(
  fn: (store: UserOperationalIdentityStore) => Promise<T> | T,
  storePath?: string,
  options?: SaveUserOperationalIdentityOptions,
): Promise<T> {
  const store = await loadUserOperationalIdentityStore(storePath);
  const result = await fn(store);
  await saveUserOperationalIdentityStore(store, storePath, options);
  return result;
}

/** Call-entry helper: inject trusted ownership proof from authenticated owner + tenant scope. */
export async function withUserOperationalIdentityStoreWriteLockForOwner<T>(
  params: {
    ownerId: string;
    tenantId?: string | null;
    storePath?: string;
    governanceStateDir?: string;
  },
  fn: (store: UserOperationalIdentityStore) => Promise<T> | T,
): Promise<T> {
  const tenantId = params.tenantId?.trim() || null;
  const ownershipProof: GovernanceOwnershipProof = tenantId
    ? ownershipProofFromTenantUser({ tenantId, userId: params.ownerId })
    : ownershipProofFromLocalUser({ userId: params.ownerId });
  return withUserOperationalIdentityStoreWriteLock(fn, params.storePath, {
    governanceStateDir: params.governanceStateDir,
    governanceOwnershipProof: ownershipProof,
  });
}
