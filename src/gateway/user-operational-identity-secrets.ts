import { loadUserOperationalIdentityCredentialSecretStore } from "./user-operational-identity-secrets-persistence.js";
import type { UserOperationalIdentityCredentialSecret } from "./user-operational-identity-types.js";

export function getUserOperationalIdentityCredentialSecret(params: {
  handleId: string;
  ownerId: string;
  secretStore?: { secrets: Record<string, UserOperationalIdentityCredentialSecret> };
}): UserOperationalIdentityCredentialSecret | null {
  const store = params.secretStore;
  const secret = store?.secrets[params.handleId];
  if (!secret || secret.ownerId !== params.ownerId || !secret.accessToken?.trim()) {
    return null;
  }
  return secret;
}

export async function loadUserOperationalIdentityCredentialSecretForHandle(params: {
  handleId: string;
  ownerId: string;
  storePath?: string;
}): Promise<UserOperationalIdentityCredentialSecret | null> {
  const secretStore = await loadUserOperationalIdentityCredentialSecretStore(params.storePath);
  return getUserOperationalIdentityCredentialSecret({
    handleId: params.handleId,
    ownerId: params.ownerId,
    secretStore,
  });
}

export function isSimulatedUserOperationalIdentityCredentialSecret(
  secret: UserOperationalIdentityCredentialSecret,
): boolean {
  if (
    secret.kind === "smtp" ||
    secret.kind === "wechat_oa" ||
    secret.kind === "social_account" ||
    secret.kind === "github_token"
  ) {
    return false;
  }
  if (secret.kind === "simulated") {
    return true;
  }
  if (secret.kind === "oauth_token" || secret.kind === "github_token") {
    return false;
  }
  return secret.accessToken?.trim().startsWith("simulated:") ?? false;
}

/**
 * Redacted credential metadata safe to return to agent/runtime callers.
 * Never includes accessToken or refreshToken.
 */
export function summarizeUserOperationalIdentityCredentialSecret(
  secret: UserOperationalIdentityCredentialSecret,
): {
  handleId: string;
  provider: string;
  kind: string;
  accountLabel?: string;
  simulated: boolean;
} {
  return {
    handleId: secret.handleId,
    provider: secret.provider,
    kind: secret.kind,
    accountLabel: secret.accountLabel,
    simulated: isSimulatedUserOperationalIdentityCredentialSecret(secret),
  };
}
