import type { EnterpriseOperationalIdentityCredentialSecret } from "../enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import {
  loadEnterpriseOperationalIdentityCredentialSecretStore,
  withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock,
} from "../enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { finalizeWechatOfficialManualCredentialSecret } from "../enterprise-operational-identity-wechat-official-credential.js";
import type { EnterpriseConnectorCredentialBinding } from "../enterprise-seat-assets-store.js";
import {
  registerConnectorCredentialBinding,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { resolveOperationalIdentityAdapterFromConnectorId } from "./adapters.js";
import { getOperationalIdentityRegistrationProfile } from "./registration-profiles.js";

export async function upsertEnterpriseOperationalIdentityCredential(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  connectorId: string;
  ownerType: "employee" | "seat";
  ownerId: string;
  createdBy?: string;
  nowIso: string;
  allowMultiple?: boolean;
  credentialBindingId?: string;
  accountLabel?: string;
  externalAccountId?: string;
  fields?: Record<string, string>;
}): Promise<
  | {
      ok: true;
      binding: EnterpriseConnectorCredentialBinding;
      secret: EnterpriseOperationalIdentityCredentialSecret;
    }
  | { ok: false; code: string; error: string }
> {
  const fields = params.fields ?? {};
  const profile = getOperationalIdentityRegistrationProfile(
    resolveProviderFromConnector(params.connectorId),
  );
  if (!profile.methods.includes("manual")) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_MANUAL_CREDENTIAL_UNSUPPORTED",
      error: "This provider does not support manual credential entry; use OAuth instead.",
    };
  }

  let binding: EnterpriseConnectorCredentialBinding | null = null;
  const existingId = params.credentialBindingId?.trim();
  if (existingId) {
    binding = params.store.credentialBindings[existingId] ?? null;
    if (!binding || binding.tenantId !== params.tenantId) {
      return {
        ok: false,
        code: "ENTERPRISE_IDENTITY_CREDENTIAL_NOT_FOUND",
        error: "Credential binding not found.",
      };
    }
  } else {
    binding = registerConnectorCredentialBinding({
      store: params.store,
      tenantId: params.tenantId,
      connectorId: params.connectorId,
      ownerType: params.ownerType,
      ownerId: params.ownerId,
      createdBy: params.createdBy,
      nowIso: params.nowIso,
      allowMultiple: params.allowMultiple === true,
    });
  }

  const metadata: Record<string, string> = {};
  let secretValue = "";
  for (const field of profile.manualFields ?? []) {
    const raw = fields[field.key]?.trim() ?? "";
    if (field.required && !raw && field.storage === "metadata") {
      return {
        ok: false,
        code: "ENTERPRISE_IDENTITY_CREDENTIAL_FIELD_REQUIRED",
        error: `${field.label} is required.`,
      };
    }
    if (!raw) {
      continue;
    }
    if (field.storage === "secret") {
      secretValue = raw;
    } else {
      metadata[field.key] = raw;
    }
  }
  if (!secretValue) {
    const secretStore = await loadEnterpriseOperationalIdentityCredentialSecretStore();
    secretValue = secretStore.secrets[binding.credentialBindingId]?.accessToken?.trim() ?? "";
  }
  if ((profile.manualFields ?? []).some((field) => field.storage === "secret" && field.required)) {
    if (!secretValue) {
      return {
        ok: false,
        code: "ENTERPRISE_IDENTITY_CREDENTIAL_SECRET_REQUIRED",
        error: "Secret credential field is required.",
      };
    }
  }

  const secretRecord: EnterpriseOperationalIdentityCredentialSecret = {
    credentialBindingId: binding.credentialBindingId,
    tenantId: params.tenantId,
    connectorId: params.connectorId,
    kind: "oauth_token",
    accessToken: secretValue,
    ...(params.accountLabel?.trim() ? { accountLabel: params.accountLabel.trim() } : {}),
    ...(params.externalAccountId?.trim() || fields.appId?.trim() || fields.defaultUserId?.trim()
      ? {
          externalAccountId: (
            params.externalAccountId ||
            fields.appId ||
            fields.defaultUserId
          )?.trim(),
        }
      : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };

  let finalizedSecret = secretRecord;
  const provider = resolveProviderFromConnector(params.connectorId);
  if (provider === "wechat-official") {
    const appId = (params.externalAccountId || fields.appId || metadata.appId)?.trim() ?? "";
    const previousSecret = (await loadEnterpriseOperationalIdentityCredentialSecretStore()).secrets[
      binding.credentialBindingId
    ];
    const appSecret =
      fields.appSecret?.trim() || secretValue || previousSecret?.metadata?.appSecret?.trim() || "";
    if (appId && appSecret) {
      finalizedSecret = await finalizeWechatOfficialManualCredentialSecret({
        secret: {
          ...secretRecord,
          metadata: {
            ...previousSecret?.metadata,
            ...secretRecord.metadata,
            appId,
          },
        },
        appId,
        appSecret,
        nowIso: params.nowIso,
      });
    }
  }

  await withEnterpriseOperationalIdentityCredentialSecretStoreWriteLock(async (secretStore) => {
    const previous = secretStore.secrets[binding.credentialBindingId];
    finalizedSecret.createdAt = previous?.createdAt ?? params.nowIso;
    if (previous?.metadata) {
      finalizedSecret.metadata = { ...previous.metadata, ...finalizedSecret.metadata };
    }
    secretStore.secrets[binding.credentialBindingId] = finalizedSecret;
    return secretStore;
  });

  binding.status = "active";
  binding.updatedAt = params.nowIso;
  params.store.credentialBindings[binding.credentialBindingId] = binding;

  return { ok: true, binding, secret: finalizedSecret };
}

function resolveProviderFromConnector(connectorId: string) {
  const adapter = resolveOperationalIdentityAdapterFromConnectorId(connectorId);
  if (!adapter) {
    throw new Error(`Unsupported connector: ${connectorId}`);
  }
  return adapter.provider;
}
