/**
 * Vault Sync Gateway authorization — actor identity comes from the authenticated
 * WS client (`client.user`), never from unverified RPC params alone.
 */
import type { VaultSyncControlPlane } from "./store/control-plane.js";
import type { VaultMemberRecord, VaultRecord } from "./types.js";

export const VAULT_SYNC_LOCAL_OPERATOR = "local-operator";

export type VaultSyncGatewayClient =
  | {
      user?: string;
    }
  | null
  | undefined;

export class VaultSyncAuthError extends Error {
  readonly code: "forbidden" | "unauthenticated";

  constructor(code: "forbidden" | "unauthenticated", message: string) {
    super(message);
    this.code = code;
  }
}

/** Whether legacy gateway-side sync (password + rootPath on server) is allowed. */
export function legacyGatewaySyncEnabled(): boolean {
  return process.env.OPENBOT_VAULT_SYNC_LEGACY_GATEWAY_SYNC === "1";
}

/**
 * Resolve the authenticated account id for Vault Sync RPCs.
 * - Platform-authenticated clients: `client.user` (email) is authoritative.
 * - Unauthenticated local dev: falls back to `local-operator`.
 */
export function resolveVaultSyncActor(client: VaultSyncGatewayClient): string {
  const user = typeof client?.user === "string" ? client.user.trim() : "";
  return user || VAULT_SYNC_LOCAL_OPERATOR;
}

/**
 * Reject when RPC supplies an account id that disagrees with the session actor.
 * Prevents callers from forging owner/actor/member ids while authenticated.
 */
export function assertVaultSyncActorMatches(
  client: VaultSyncGatewayClient,
  paramAccountId: string | undefined | null,
  label = "accountId",
): string {
  const actor = resolveVaultSyncActor(client);
  const param = typeof paramAccountId === "string" ? paramAccountId.trim() : "";
  if (param && param !== actor) {
    throw new VaultSyncAuthError("forbidden", `${label} does not match authenticated user`);
  }
  return actor;
}

export function getVaultOrThrow(plane: VaultSyncControlPlane, vaultId: string): VaultRecord {
  const vault = plane.getVault(vaultId);
  if (!vault) {
    throw new Error("vault not found");
  }
  return vault;
}

/** Vault owner or (when team enabled) active owner/admin member. */
export function assertVaultManager(
  plane: VaultSyncControlPlane,
  vaultId: string,
  actorAccountId: string,
): VaultMemberRecord | null {
  const vault = getVaultOrThrow(plane, vaultId);
  if (vault.ownerAccountId === actorAccountId) {
    return null;
  }
  if (!vault.teamEnabled) {
    throw new VaultSyncAuthError("forbidden", "not vault owner");
  }
  const member = plane.getMember(vaultId, actorAccountId);
  if (!member || member.status !== "active") {
    throw new VaultSyncAuthError("forbidden", "not a vault member");
  }
  if (member.role !== "owner" && member.role !== "admin") {
    throw new VaultSyncAuthError("forbidden", "insufficient role");
  }
  return member;
}

export function assertVaultOwner(
  plane: VaultSyncControlPlane,
  vaultId: string,
  actorAccountId: string,
): void {
  const vault = getVaultOrThrow(plane, vaultId);
  if (vault.ownerAccountId !== actorAccountId) {
    throw new VaultSyncAuthError("forbidden", "not vault owner");
  }
}

export function assertVaultMemberOrOwner(
  plane: VaultSyncControlPlane,
  vaultId: string,
  accountId: string,
): VaultMemberRecord | null {
  const vault = getVaultOrThrow(plane, vaultId);
  if (vault.ownerAccountId === accountId) {
    return null;
  }
  if (!vault.teamEnabled) {
    throw new VaultSyncAuthError("forbidden", "team not enabled");
  }
  const member = plane.getMember(vaultId, accountId);
  if (!member || member.status !== "active") {
    throw new VaultSyncAuthError("forbidden", "not an active member");
  }
  return member;
}
