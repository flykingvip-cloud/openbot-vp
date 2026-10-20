import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../utils.js";
import {
  USER_OPERATIONAL_IDENTITY_CREDENTIAL_SECRET_STORE_VERSION,
  type UserOperationalIdentityCredentialSecretStore,
} from "./user-operational-identity-types.js";

const DEFAULT_SECRETS_FILENAME = "openbot-user-operational-identity-secrets.json";

export function resolveDefaultUserOperationalIdentitySecretsStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_SECRETS_FILENAME);
}

export function normalizeUserOperationalIdentityCredentialSecretStore(
  parsed: Partial<UserOperationalIdentityCredentialSecretStore> | null | undefined,
): UserOperationalIdentityCredentialSecretStore {
  return {
    version: parsed?.version ?? USER_OPERATIONAL_IDENTITY_CREDENTIAL_SECRET_STORE_VERSION,
    secrets: parsed?.secrets ?? {},
  };
}

export async function loadUserOperationalIdentityCredentialSecretStore(
  storePath?: string,
): Promise<UserOperationalIdentityCredentialSecretStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultUserOperationalIdentitySecretsStorePath(),
  );
  const parsed =
    await readJsonFile<Partial<UserOperationalIdentityCredentialSecretStore>>(resolvedPath);
  return normalizeUserOperationalIdentityCredentialSecretStore(parsed);
}

export async function saveUserOperationalIdentityCredentialSecretStore(
  store: UserOperationalIdentityCredentialSecretStore,
  storePath?: string,
): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultUserOperationalIdentitySecretsStorePath(),
  );
  const normalized = normalizeUserOperationalIdentityCredentialSecretStore({
    ...store,
    version: USER_OPERATIONAL_IDENTITY_CREDENTIAL_SECRET_STORE_VERSION,
  });
  await writeJsonAtomic(resolvedPath, normalized);
}

export async function withUserOperationalIdentityCredentialSecretStoreWriteLock<T>(
  fn: (store: UserOperationalIdentityCredentialSecretStore) => Promise<T> | T,
  storePath?: string,
): Promise<T> {
  const store = await loadUserOperationalIdentityCredentialSecretStore(storePath);
  const result = await fn(store);
  await saveUserOperationalIdentityCredentialSecretStore(store, storePath);
  return result;
}
