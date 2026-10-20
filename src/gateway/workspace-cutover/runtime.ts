import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { resolveDataRoot } from "../../config/data-space.js";
import type { OpenBotConfig } from "../../config/types.js";
import { isTerminalCutoverState } from "./state-machine.js";
import { FileWorkspaceCutoverStore, type WorkspaceCutoverStore } from "./store.js";
import type { WorkspaceCutoverOperation } from "./types.js";

export const WORKSPACE_CUTOVER_META_DIR = "workspace-cutover";
export const WORKSPACE_CUTOVER_OPERATIONS_FILENAME = "operations.json";

export function resolveWorkspaceCutoverOperationsPath(dataRoot: string): string {
  return path.join(
    path.resolve(dataRoot),
    ".meta",
    WORKSPACE_CUTOVER_META_DIR,
    WORKSPACE_CUTOVER_OPERATIONS_FILENAME,
  );
}

let cachedGatewayStore: FileWorkspaceCutoverStore | undefined;

export function createWorkspaceCutoverStore(params?: {
  cfg?: OpenBotConfig;
  dataRoot?: string;
}): FileWorkspaceCutoverStore {
  const dataRoot = params?.dataRoot ?? resolveDataRoot(params?.cfg ?? loadConfig());
  return new FileWorkspaceCutoverStore(resolveWorkspaceCutoverOperationsPath(dataRoot));
}

/** Process-wide cutover store under `{dataRoot}/.meta/workspace-cutover/operations.json`. */
export function getGatewayWorkspaceCutoverStore(cfg?: OpenBotConfig): FileWorkspaceCutoverStore {
  if (!cachedGatewayStore) {
    cachedGatewayStore = createWorkspaceCutoverStore({ cfg });
  }
  return cachedGatewayStore;
}

export function resetGatewayWorkspaceCutoverStoreForTests(): void {
  cachedGatewayStore = undefined;
}

export function listActiveCutoverOperationsForResource(
  store: WorkspaceCutoverStore,
  resourceId: string,
): WorkspaceCutoverOperation[] {
  return store
    .listByResource(resourceId)
    .filter((operation) => !isTerminalCutoverState(operation.state));
}
