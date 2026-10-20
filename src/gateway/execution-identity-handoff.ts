/**
 * In-process inherit of a frozen turn identity onto a spawned child run.
 *
 * Spawn talks to the gateway as a local CLI client, so the child `agent` RPC
 * has no Control UI cookie. Identity must not travel as model-controlled RPC
 * params. The parent tool stages the already-frozen object against the child
 * idempotency key; the agent handler consumes it in the same process.
 *
 * External clients cannot populate this map. Absence stays absence: an
 * unstaged child falls through to whatever the authenticated caller actually
 * presented (usually nothing → unique enrollment).
 */
import {
  hasAuthenticatedIdentity,
  type ExecutionIdentityContext,
} from "./execution-identity-context.js";

const stagedByIdempotencyKey = new Map<string, ExecutionIdentityContext>();

export function stageSpawnExecutionIdentity(
  idempotencyKey: string,
  identity: ExecutionIdentityContext | null | undefined,
): void {
  const key = idempotencyKey.trim();
  if (!key || !identity || !hasAuthenticatedIdentity(identity)) {
    return;
  }
  stagedByIdempotencyKey.set(key, identity);
}

/**
 * Read the staged identity WITHOUT consuming it.
 *
 * The `agent` handler needs the spawning parent's identity twice: once early, to
 * resolve the tenant-scoped session store (a managed child session cannot be
 * loaded by an identity-less loopback client), and once at dispatch, where the
 * frozen identity is handed to the child run. Dispatch keeps the consuming
 * `take`; this peek exists so the earlier lookup does not steal it.
 */
export function peekStagedSpawnExecutionIdentity(
  idempotencyKey: string | null | undefined,
): ExecutionIdentityContext | undefined {
  const key = idempotencyKey?.trim();
  if (!key) {
    return undefined;
  }
  return stagedByIdempotencyKey.get(key);
}

export function takeStagedSpawnExecutionIdentity(
  idempotencyKey: string | null | undefined,
): ExecutionIdentityContext | undefined {
  const key = idempotencyKey?.trim();
  if (!key) {
    return undefined;
  }
  const identity = stagedByIdempotencyKey.get(key);
  if (identity) {
    stagedByIdempotencyKey.delete(key);
  }
  return identity;
}

export function discardStagedSpawnExecutionIdentity(
  idempotencyKey: string | null | undefined,
): void {
  const key = idempotencyKey?.trim();
  if (key) {
    stagedByIdempotencyKey.delete(key);
  }
}

export function resetSpawnExecutionIdentityHandoffForTest(): void {
  stagedByIdempotencyKey.clear();
}
