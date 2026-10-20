import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import {
  DATA_CONNECTOR_OAUTH_SESSION_STORE_VERSION,
  type DataConnectorOAuthSessionStore,
} from "./connector-oauth-types.js";

const DEFAULT_STORE_FILENAME = "openbot-enterprise-data-oauth-sessions.json";

export function resolveDefaultDataConnectorOAuthSessionStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_STORE_FILENAME);
}

export function normalizeDataConnectorOAuthSessionStore(
  parsed: Partial<DataConnectorOAuthSessionStore> | null | undefined,
): DataConnectorOAuthSessionStore {
  return {
    version: DATA_CONNECTOR_OAUTH_SESSION_STORE_VERSION,
    sessions: parsed?.sessions ?? {},
  };
}

export async function loadDataConnectorOAuthSessionStore(
  storePath?: string,
): Promise<DataConnectorOAuthSessionStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultDataConnectorOAuthSessionStorePath(),
  );
  const parsed = await readJsonFile<Partial<DataConnectorOAuthSessionStore>>(resolvedPath);
  return normalizeDataConnectorOAuthSessionStore(parsed);
}

export async function saveDataConnectorOAuthSessionStore(
  store: DataConnectorOAuthSessionStore,
  storePath?: string,
): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultDataConnectorOAuthSessionStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

let writeChain: Promise<unknown> = Promise.resolve();

export async function withDataConnectorOAuthSessionStoreWriteLock<T>(
  run: (store: DataConnectorOAuthSessionStore) => Promise<T> | T,
  storePath?: string,
): Promise<T> {
  const task = writeChain.then(async () => {
    const store = await loadDataConnectorOAuthSessionStore(storePath);
    const result = await run(store);
    await saveDataConnectorOAuthSessionStore(store, storePath);
    return result;
  });
  writeChain = task.catch(() => undefined);
  return task;
}
