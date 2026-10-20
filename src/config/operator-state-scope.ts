import { AsyncLocalStorage } from "node:async_hooks";
import os from "node:os";
import path from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { resolveStateDir } from "./paths.js";

/** Thrown / matched when a store or plugin path escapes the active operator root. */
export const CROSS_OPERATOR_STATE_DENIED = "CROSS_OPERATOR_STATE_DENIED";

const VALID_OPERATOR_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const INVALID_CHARS_RE = /[^a-z0-9._-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

export type OperatorStateScopeStore = {
  /** Normalized operator id for path segments. */
  operatorId: string;
  /** How the id was chosen (for tests / diagnostics; never log raw secrets). */
  source: "request" | "env";
};

const OPERATOR_STATE_SCOPE_KEY: unique symbol = Symbol.for("openbot.operatorStateScope");

const operatorStateScope = (() => {
  const globalState = globalThis as typeof globalThis & {
    [OPERATOR_STATE_SCOPE_KEY]?: AsyncLocalStorage<OperatorStateScopeStore>;
  };
  const existing = globalState[OPERATOR_STATE_SCOPE_KEY];
  if (existing) {
    return existing;
  }
  const created = new AsyncLocalStorage<OperatorStateScopeStore>();
  globalState[OPERATOR_STATE_SCOPE_KEY] = created;
  return created;
})();

/**
 * Normalize an operator id for path segments. Empty input returns undefined
 * (meaning: no operator scope / legacy shared STATE_DIR).
 */
export function normalizeOperatorId(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return undefined;
  }
  if (VALID_OPERATOR_ID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const collapsed = trimmed
    .toLowerCase()
    .replace(INVALID_CHARS_RE, "-")
    .replace(LEADING_DASH_RE, "")
    .replace(TRAILING_DASH_RE, "");
  return collapsed || undefined;
}

/**
 * Derive a stable operator id from an authenticated gateway client.
 * Preference: platformUserId → pairedDeviceId → connect.user.
 * Shared-token-only connects with no user/device stay unscoped (legacy).
 */
export function deriveOperatorIdFromGatewayClient(
  client:
    | {
        platformUserId?: string | null;
        pairedDeviceId?: string | null;
        user?: string | null;
        connect?: { user?: string | null } | null;
      }
    | null
    | undefined,
): string | undefined {
  if (!client) {
    return undefined;
  }
  return (
    normalizeOperatorId(client.platformUserId) ??
    normalizeOperatorId(client.pairedDeviceId) ??
    normalizeOperatorId(client.user) ??
    normalizeOperatorId(client.connect?.user)
  );
}

/** Current ALS store, if any. */
export function getOperatorStateScope(): OperatorStateScopeStore | undefined {
  return operatorStateScope.getStore();
}

/**
 * Run `fn` under a request/turn operator scope. Nested calls replace the id for
 * the duration of the inner run (same ALS semantics as other gateway scopes).
 */
export function withOperatorStateScope<T>(operatorId: string, run: () => T): T {
  const normalized = normalizeOperatorId(operatorId);
  if (!normalized) {
    return run();
  }
  return operatorStateScope.run({ operatorId: normalized, source: "request" }, run);
}

/**
 * Active operator id: request ALS first, then test/dev env override.
 * Unset = single-operator legacy shared STATE_DIR.
 */
export function resolveActiveOperatorId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const scoped = operatorStateScope.getStore()?.operatorId;
  if (scoped) {
    return scoped;
  }
  return normalizeOperatorId(env.OPENBOT_OPERATOR_ID ?? env.OPENCLAW_OPERATOR_ID);
}

/**
 * State root visible to session stores and plugin services.
 * With an active operator (ALS or env): `$STATE_DIR/operators/<id>`.
 * Without: `$STATE_DIR` (byte-compatible with historical single-operator layout).
 */
export function resolveOperatorStateRoot(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
): string {
  const stateDir = resolveStateDir(env, homedir);
  const operatorId = resolveActiveOperatorId(env);
  if (!operatorId) {
    return stateDir;
  }
  return path.join(stateDir, "operators", operatorId);
}

export function isPathInsideRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  if (resolvedCandidate === resolvedRoot) {
    return true;
  }
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Fail closed when an operator scope is active and the store path leaves that root.
 * No-op when no ALS/env operator is active (legacy single-operator gateway).
 */
export function assertSessionStorePathReadable(
  storePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const operatorId = resolveActiveOperatorId(env);
  if (!operatorId) {
    return;
  }
  const root = resolveOperatorStateRoot(env);
  if (!isPathInsideRoot(storePath, root)) {
    throw new Error(
      `${CROSS_OPERATOR_STATE_DENIED}: session store path escapes operator state root for ${operatorId}`,
    );
  }
}
