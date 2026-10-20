// Feature: shared-agent-identity-access-control-plane

import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import { assertAgentOwnershipInvariant } from "./ownership.js";
import { type AgentRegistryStore, createEmptyAgentRegistryStore } from "./types.js";

const STORE_FILE = "openbot-agent-registry.json";

export function resolveAgentRegistryStorePath(): string {
  return path.join(CONFIG_DIR, STORE_FILE);
}

function normalizeRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, T>)
    : {};
}

/**
 * Loads the registry, tolerating a missing or malformed file by returning an empty
 * store. Reads never throw, so an authorization path can always evaluate (and, with
 * no assets, fail closed) instead of erroring out.
 */
export async function loadAgentRegistryStore(
  storePath = resolveAgentRegistryStorePath(),
): Promise<AgentRegistryStore> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentRegistryStore>;
    return {
      version: 1,
      assets: normalizeRecord(parsed.assets),
      deployments: normalizeRecord(parsed.deployments),
      revisions: normalizeRecord(parsed.revisions),
      ownerBindings: normalizeRecord(parsed.ownerBindings),
      quarantine: normalizeRecord(parsed.quarantine),
    };
  } catch {
    return createEmptyAgentRegistryStore();
  }
}

/**
 * Writes the registry through a temp file + rename so a crash cannot leave a
 * half-written canonical identity file behind.
 *
 * The ownership invariant is checked here because this is the transaction boundary for a
 * JSON store: a create-then-bind sequence is legal in memory, but a state where an active
 * asset has no single owner must never reach disk.
 */
export async function saveAgentRegistryStore(
  store: AgentRegistryStore,
  storePath = resolveAgentRegistryStorePath(),
): Promise<void> {
  assertAgentOwnershipInvariant(store);
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tempPath, storePath);
}
