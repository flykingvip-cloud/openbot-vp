import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { resolvePlatformAuthSmtpConfig } from "./platform-auth-email.js";

function readMetadata(secret: EnterpriseOperationalIdentityCredentialSecret, key: string): string {
  return secret.metadata?.[key]?.trim() ?? "";
}

export function resolveEnterpriseOperationalIdentitySmtpConfig(
  secret: EnterpriseOperationalIdentityCredentialSecret,
): ReturnType<typeof resolvePlatformAuthSmtpConfig> {
  const host = readMetadata(secret, "smtpHost");
  const from = readMetadata(secret, "smtpFrom") || secret.accountLabel?.trim();
  if (!host || !from) {
    return null;
  }
  const portRaw = readMetadata(secret, "smtpPort");
  const port = portRaw ? Number(portRaw) : 587;
  if (!Number.isFinite(port)) {
    return null;
  }
  const encryption = readMetadata(secret, "smtpEncryption").toLowerCase();
  let secure = readMetadata(secret, "smtpSecure") === "1";
  let startTls = readMetadata(secret, "smtpStartTls") !== "0";
  if (encryption === "ssl") {
    secure = true;
    startTls = false;
  } else if (encryption === "starttls") {
    secure = false;
    startTls = true;
  } else if (encryption === "none") {
    secure = false;
    startTls = false;
  } else if (!readMetadata(secret, "smtpSecure") && !readMetadata(secret, "smtpStartTls")) {
    secure = port === 465;
    startTls = port === 587;
  }
  const user = readMetadata(secret, "smtpUser") || undefined;
  const pass = secret.accessToken?.trim() || undefined;
  return {
    host,
    port,
    secure,
    startTls,
    user,
    pass,
    from,
    replyTo: readMetadata(secret, "smtpReplyTo") || undefined,
    timeoutMs: Number(readMetadata(secret, "smtpTimeoutMs")) || 12_000,
  };
}
