import type { EnterpriseOperationalIdentityCredentialSecret } from "../enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import type {
  EnterpriseOperationalIdentityProvider,
  LegacyOperationalIdentityProvider,
} from "../enterprise-operational-identity-types.js";
import type { EnterpriseConnectorCredentialBinding } from "../enterprise-seat-assets-store.js";
import type {
  OperationalIdentityCredentialReadinessItem,
  OperationalIdentityRegistrationProfile,
} from "./contract.js";
import type { OperationalIdentityCredentialProbeResult } from "./credential-probe.js";
import { getOperationalIdentityRegistrationProfile } from "./registration-profiles.js";

function readMetadataValue(
  secret: EnterpriseOperationalIdentityCredentialSecret | null,
  key: string,
): string {
  return secret?.metadata?.[key]?.trim() ?? "";
}

function isFieldSatisfied(
  fieldKey: string,
  profile: OperationalIdentityRegistrationProfile,
  secret: EnterpriseOperationalIdentityCredentialSecret | null,
): boolean {
  const spec = profile.manualFields?.find((entry) => entry.key === fieldKey);
  if (!spec) {
    if (fieldKey === "authorizer_appid" || fieldKey === "appId") {
      return Boolean(secret?.externalAccountId?.trim() || readMetadataValue(secret, "appId"));
    }
    return false;
  }
  if (spec.storage === "secret") {
    return Boolean(secret?.accessToken?.trim());
  }
  return Boolean(readMetadataValue(secret, spec.key));
}

export function assessOperationalIdentityCredentialReadiness(params: {
  provider: EnterpriseOperationalIdentityProvider | LegacyOperationalIdentityProvider;
  credential: EnterpriseConnectorCredentialBinding | null;
  secret: EnterpriseOperationalIdentityCredentialSecret | null;
  externalAccountId?: string;
  probeResults?: Record<string, OperationalIdentityCredentialProbeResult>;
}): {
  ready: boolean;
  items: OperationalIdentityCredentialReadinessItem[];
  missingRequiredFields: string[];
} {
  if (
    params.provider === "feishu" ||
    params.provider === "wecom" ||
    params.provider === "dingtalk" ||
    params.provider === "enterprise-email" ||
    params.provider === "jira"
  ) {
    return { ready: false, items: [], missingRequiredFields: ["legacy_provider"] };
  }
  const profile = getOperationalIdentityRegistrationProfile(params.provider);
  const items: OperationalIdentityCredentialReadinessItem[] = [];
  const missingRequiredFields: string[] = [];

  if (!params.credential || params.credential.status === "revoked") {
    items.push({
      key: "credential_binding",
      label: "凭证绑定",
      satisfied: false,
      scope: "field",
    });
    return { ready: false, items, missingRequiredFields: ["credential_binding"] };
  }
  items.push({
    key: "credential_binding",
    label: "凭证绑定",
    satisfied: true,
    scope: "field",
  });

  const usesOAuthOnly = profile.methods.includes("oauth") && !profile.methods.includes("manual");
  if (usesOAuthOnly) {
    const oauthReady = Boolean(
      params.secret?.accessToken?.trim() ||
      params.secret?.refreshToken?.trim() ||
      params.externalAccountId?.trim(),
    );
    items.push({
      key: "oauth_token",
      label: "OAuth 授权凭证",
      satisfied: oauthReady,
      scope: "field",
    });
    if (!oauthReady) {
      missingRequiredFields.push("oauth_token");
    }
  } else if (profile.manualFields) {
    for (const field of profile.manualFields) {
      const satisfied =
        field.storage === "secret"
          ? Boolean(
              params.secret?.accessToken?.trim() || readMetadataValue(params.secret, field.key),
            )
          : Boolean(readMetadataValue(params.secret, field.key));
      items.push({
        key: field.key,
        label: field.label,
        satisfied,
        scope: "field",
      });
      if (field.required && !satisfied) {
        missingRequiredFields.push(field.key);
      }
    }
  }

  for (const check of profile.verifyChecks) {
    const probe = params.probeResults?.[check.key];
    let satisfied: boolean;
    let detail: string | undefined;
    if (probe) {
      satisfied = probe.ok;
      detail = probe.detail;
    } else if (missingRequiredFields.length > 0) {
      satisfied = false;
      detail = "请先补齐上方必填项。";
    } else if (check.key === "authorizer_appid" || check.key === "appId") {
      satisfied = Boolean(
        params.externalAccountId?.trim() || readMetadataValue(params.secret, "appId"),
      );
    } else if (
      check.key === "client_credential" ||
      check.key === "authorizer_token" ||
      check.key === "oauth_token"
    ) {
      satisfied = Boolean(
        params.secret?.accessToken?.trim() || params.secret?.refreshToken?.trim(),
      );
    } else if (check.key === "github_auth") {
      satisfied = Boolean(
        params.secret?.accessToken?.trim() ||
        readMetadataValue(params.secret, "personalAccessToken") ||
        readMetadataValue(params.secret, "installationId"),
      );
      if (!satisfied) {
        detail = "请配置 GitHub App Installation ID 或 fine-grained PAT。";
      }
    } else if (check.key === "smtp_reachable" || check.key === "smtp_from") {
      satisfied =
        isFieldSatisfied("smtpHost", profile, params.secret) &&
        isFieldSatisfied("smtpFrom", profile, params.secret) &&
        Boolean(params.secret?.accessToken?.trim());
    } else if (check.key === "imap_reachable") {
      const imapConfigured = Boolean(readMetadataValue(params.secret, "imapHost"));
      const imapProbe = params.probeResults?.[check.key];
      if (!imapConfigured) {
        satisfied = true;
        detail = "未配置 IMAP（可选）；Agent 仅可使用发信能力。";
      } else if (imapProbe) {
        satisfied = imapProbe.ok;
        detail = imapProbe.detail;
      } else {
        satisfied = false;
        detail = "请先保存 IMAP 配置并重新测试连接。";
      }
    } else if (check.key === "operator_userid") {
      satisfied = Boolean(
        params.externalAccountId?.trim() || readMetadataValue(params.secret, "defaultUserId"),
      );
    } else if (check.key === "api_signature") {
      const signatureProbe = params.probeResults?.[check.key];
      if (signatureProbe) {
        satisfied = signatureProbe.ok;
        detail = signatureProbe.detail;
      } else {
        satisfied = false;
        detail = "请先保存凭证并重新测试连接。";
      }
    } else {
      satisfied = true;
    }
    items.push({
      key: check.key,
      label: check.label,
      satisfied,
      scope: "verify",
      ...(detail ? { detail } : {}),
    });
    if (!satisfied && missingRequiredFields.length === 0 && check.key !== "imap_reachable") {
      missingRequiredFields.push(check.key);
    }
  }

  const ready = items.every((item) => item.satisfied);
  return { ready, items, missingRequiredFields };
}

export function resolveIdentityStatusFromReadiness(params: {
  credentialStatus: EnterpriseConnectorCredentialBinding["status"];
  ready: boolean;
  expiresAt?: string;
  nowIso: string;
}): "active" | "expired" | "reauth_required" {
  if (params.credentialStatus === "reauthorization_required") {
    return "reauth_required";
  }
  if (params.credentialStatus === "revoked") {
    return "expired";
  }
  if (params.expiresAt && params.expiresAt <= params.nowIso) {
    return "expired";
  }
  if (!params.ready) {
    return "reauth_required";
  }
  return "active";
}
