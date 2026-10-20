import type { EnterpriseOperationalIdentityCredentialSecret } from "../enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import type { EnterpriseOperationalIdentityProvider } from "../enterprise-operational-identity-types.js";
import { getOperationalIdentityRegistrationProfile } from "./registration-profiles.js";

export type OperationalIdentityCredentialEditPreview = {
  fields: Record<string, string>;
  secretsConfigured: string[];
};

export function buildOperationalIdentityCredentialEditPreview(params: {
  provider: EnterpriseOperationalIdentityProvider;
  secret: EnterpriseOperationalIdentityCredentialSecret | null;
  externalAccountId?: string;
}): OperationalIdentityCredentialEditPreview | undefined {
  const profile = getOperationalIdentityRegistrationProfile(params.provider);
  if (!profile.methods.includes("manual") || !profile.manualFields?.length) {
    return undefined;
  }
  const fields: Record<string, string> = {};
  const secretsConfigured: string[] = [];
  for (const field of profile.manualFields) {
    if (field.storage === "secret") {
      const configured = Boolean(
        params.secret?.accessToken?.trim() ||
        (field.key === "appSecret" && params.secret?.metadata?.appSecret?.trim()),
      );
      if (configured) {
        secretsConfigured.push(field.key);
      }
      continue;
    }
    const fromMetadata = params.secret?.metadata?.[field.key]?.trim() ?? "";
    const fromExternal =
      field.key === "appId"
        ? params.externalAccountId?.trim() || params.secret?.externalAccountId?.trim() || ""
        : "";
    const value = fromMetadata || fromExternal;
    if (value) {
      fields[field.key] = value;
    }
  }
  if (Object.keys(fields).length === 0 && secretsConfigured.length === 0) {
    return undefined;
  }
  return { fields, secretsConfigured };
}
