import type { PlatformAuthImapConfig } from "./platform-auth-imap.js";

/** Minimal credential shape shared by user + enterprise operational identity secrets. */
export type OperationalIdentityImapCredentialLike = {
  accessToken?: string;
  metadata?: Record<string, string>;
};

function readMetadata(secret: OperationalIdentityImapCredentialLike, key: string): string {
  return secret.metadata?.[key]?.trim() ?? "";
}

export function resolveOperationalIdentityImapConfig(
  secret: OperationalIdentityImapCredentialLike,
): PlatformAuthImapConfig | null {
  const host = readMetadata(secret, "imapHost");
  if (!host) {
    return null;
  }
  const portRaw = readMetadata(secret, "imapPort");
  const port = portRaw ? Number(portRaw) : 993;
  if (!Number.isFinite(port)) {
    return null;
  }
  const user = readMetadata(secret, "imapUser") || readMetadata(secret, "smtpUser");
  const pass = secret.accessToken?.trim() || "";
  if (!user || !pass) {
    return null;
  }
  const encryption = readMetadata(secret, "imapEncryption").toLowerCase();
  const secure =
    encryption === "ssl"
      ? true
      : encryption === "starttls"
        ? false
        : readMetadata(secret, "imapSecure") === "1" || port === 993;
  return {
    host,
    port,
    secure,
    user,
    pass,
    timeoutMs: Number(readMetadata(secret, "imapTimeoutMs")) || 12_000,
  };
}
