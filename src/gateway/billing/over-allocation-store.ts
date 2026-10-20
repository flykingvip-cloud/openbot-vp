/**
 * OverAllocationState — 降级/换套餐后的超配治理状态（P1）。
 *
 * 落盘：`CONFIG_DIR/openbot-over-allocation.json`。
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { CommercialGovernanceStatus, OverAllocationState } from "./types.js";

const STORE_VERSION = 1;

type Store = {
  version: number;
  /** key = enterpriseId */
  states: Record<string, OverAllocationState>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, states: {} };
}

export function resolveDefaultOverAllocationStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-over-allocation.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultOverAllocationStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.states !== "object" || parsed.states === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, states: parsed.states };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultOverAllocationStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export async function getOverAllocationState(
  enterpriseId: string,
  storePath?: string,
): Promise<OverAllocationState | null> {
  const store = await loadStore(storePath);
  return store.states[tenant(enterpriseId)] ?? null;
}

export async function upsertOverAllocationState(
  state: OverAllocationState,
  storePath?: string,
): Promise<OverAllocationState> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const key = tenant(state.enterpriseId);
    store.states[key] = { ...state, enterpriseId: key };
    await saveStore(store, storePath);
    return store.states[key];
  });
}

export async function resolveCommercialGovernanceStatus(
  enterpriseId: string,
  storePath?: string,
): Promise<CommercialGovernanceStatus> {
  const state = await getOverAllocationState(enterpriseId, storePath);
  return state?.status ?? "normal";
}

export function isActionBlockedByOverAllocation(
  state: OverAllocationState | null,
  action: OverAllocationState["blockedActions"][number],
): boolean {
  if (!state || state.status !== "over_allocated") {
    return false;
  }
  return state.blockedActions.includes(action);
}

export async function __resetOverAllocationForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
