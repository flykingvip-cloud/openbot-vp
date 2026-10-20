import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";

export const ENTERPRISE_OPERATIONAL_IDENTITY_CREDENTIAL_SECRET_STORE_VERSION = 1;

export type EnterpriseOperationalIdentityCredentialSecret = {
  credentialBindingId: string;
  tenantId: string;
  connectorId: string;
  kind: "oauth_token";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  accountLabel?: string;
  externalAccountId?: string;
  scope?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type EnterpriseOperationalIdentityCredentialSecretStore = {
  version: number;
  secrets: Record<string, EnterpriseOperationalIdentityCredentialSecret>;
};

const DEFAULT_SECRETS_FILENAME = "openbot-enterprise-operational-identity-secrets.json";

export function resolveDefaultEnterpriseOperationalIdentitySecretsStorePath(): string {
  return path.join(CONFIG_DIR, DEFAULT_SECRETS_FILENAME);
}

export function normalizeEnterpriseOperationalIdentityCredentialSecretStore(
  parsed: Partial<EnterpriseOperationalIdentityCredentialSecretStore> | null | undefined,
): EnterpriseOperationalIdentityCredentialSecretStore {
  return {
    version: parsed?.version ?? ENTERPRISE_OPERATIONAL_IDENTITY_CREDENTIAL_SECRET_STORE_VERSION,
    secrets: parsed?.secrets ?? {},
  };
}

export async function loadEnterpriseOperationalIdentityCredentialSecretStore(
  storePath?: string,
): Promise<EnterpriseOperationalIdentityCredentialSecretStore> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultEnterpriseOperationalIdentitySecretsStorePath(),
  );
  const parsed =
    await readJsonFile<Partial<EnterpriseOperationalIdentityCredentialSecretStore>>(resolvedPath);
  return normalizeEnterpriseOperationalIdentityCredentialSecretStore(parsed);
}

export async function saveEnterpriseOperationalIdentityCredentialSecretStore(
  store: EnterpriseOperationalIdentityCredentialSecretStore,
  storePath?: string,
): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultEnterpriseOperationalIdentitySecretsStorePath(),
  );
  const normalized = normalizeEnterpriseOperationalIdentityCredentialSecretStore({
    ...store,
    version: ENTERPRISE_OPERATIONAL_IDENTITY_CREDENTIAL_SECRET_STORE_VERSION,
  });
  await writeJsonAtomic(resolvedPath, normalized);
}

export async function withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock<T>(
  fn: (store: EnterpriseOperationalIdentityCredentialSecretStore) => Promise<T> | T,
  storePath?: string,
): Promise<T> {
  const store = await loadEnterpriseOperationalIdentityCredentialSecretStore(storePath);
  const result = await fn(store);
  await saveEnterpriseOperationalIdentityCredentialSecretStore(store, storePath);
  return result;
}
