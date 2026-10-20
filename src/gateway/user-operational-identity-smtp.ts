import { resolveOperationalIdentityImapConfig } from "./operational-identity-imap-config.js";
import { findPersonalEmailProviderPreset } from "./personal-email-providers.js";
import type { PlatformAuthEmailAttachment } from "./platform-auth-email.js";
import {
  resolvePlatformAuthSmtpConfig,
  sendPlatformAuthSmtpMail,
  verifyPlatformAuthSmtpConfig,
} from "./platform-auth-email.js";
import { probePlatformAuthImapConnection } from "./platform-auth-imap.js";
import type { UserOperationalIdentityCredentialSecret } from "./user-operational-identity-types.js";

export type UserOperationalIdentitySmtpBindInput = {
  from: string;
  host?: string;
  port?: number | string;
  user?: string;
  pass?: string;
  secure?: boolean | string;
  startTls?: boolean | string;
  replyTo?: string;
  imapHost?: string;
  imapPort?: number | string;
  imapUser?: string;
  /** When true, reuse gateway OPENBOT_SMTP_* / platform SMTP env. */
  usePlatformSmtp?: boolean;
};

function enrichPersonalEmailBindInput(
  input: UserOperationalIdentitySmtpBindInput,
): UserOperationalIdentitySmtpBindInput {
  if (input.usePlatformSmtp) {
    return input;
  }
  const preset = findPersonalEmailProviderPreset(input.from);
  if (!preset) {
    return input;
  }
  const port =
    input.port ??
    (typeof input.port === "number" ? input.port : undefined) ??
    String(preset.smtpPort);
  return {
    ...input,
    host: input.host?.trim() || preset.smtpHost,
    port,
    imapHost: input.imapHost?.trim() || preset.imapHost,
    imapPort: input.imapPort ?? String(preset.imapPort),
    secure: input.secure ?? (preset.useSsl ? "1" : "0"),
    user: input.user?.trim() || input.from.trim(),
    imapUser: input.imapUser?.trim() || input.user?.trim() || input.from.trim(),
  };
}

function readMetadata(secret: UserOperationalIdentityCredentialSecret, key: string): string {
  return secret.metadata?.[key]?.trim() ?? "";
}

/** Normalize `Name <email@x>` / bare email for equality checks. */
export function extractPersonalEmailAddress(value: string): string {
  const trimmed = value.trim();
  const angled = trimmed.match(/<([^>]+)>/);
  return (angled?.[1] ?? trimmed).trim().toLowerCase();
}

function parseBooleanFlag(value: boolean | string | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function isValidPersonalEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.includes("@") || trimmed.includes(" ")) {
    return false;
  }
  const at = trimmed.lastIndexOf("@");
  const domain = trimmed.slice(at + 1);
  return domain.includes(".") && domain.length > 2 && at > 0;
}

export function shouldSkipUserOperationalIdentitySmtpProbe(): boolean {
  const raw =
    process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_SMTP_SKIP_PROBE?.trim() ||
    process.env.OPENCLAW_USER_OPERATIONAL_IDENTITY_SMTP_SKIP_PROBE?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

export function resolveUserOperationalIdentitySmtpConfig(
  secret: UserOperationalIdentityCredentialSecret,
): ReturnType<typeof resolvePlatformAuthSmtpConfig> {
  if (secret.metadata?.source === "platform_env") {
    const platform = resolvePlatformAuthSmtpConfig();
    if (!platform) {
      return null;
    }
    // Envelope FROM must stay on the platform-authorized domain (e.g. Aliyun
    // OPENBOT_SMTP_FROM). Personal addresses are Reply-To only — otherwise
    // relays reject MAIL FROM for Gmail/etc. while AUTH uses platform creds.
    const personal =
      readMetadata(secret, "personalEmail") ||
      readMetadata(secret, "smtpReplyTo") ||
      readMetadata(secret, "smtpFrom") ||
      secret.accountLabel?.trim() ||
      "";
    const platformFromAddress = extractPersonalEmailAddress(platform.from);
    const personalAddress = personal ? extractPersonalEmailAddress(personal) : "";
    const replyTo =
      readMetadata(secret, "smtpReplyTo") ||
      (personalAddress && personalAddress !== platformFromAddress ? personal : "") ||
      platform.replyTo ||
      undefined;
    return {
      ...platform,
      from: platform.from,
      ...(replyTo ? { replyTo } : {}),
    };
  }
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
  const user = readMetadata(secret, "smtpUser") || undefined;
  const pass = secret.accessToken?.trim() || undefined;
  return {
    host,
    port,
    secure: readMetadata(secret, "smtpSecure") === "1",
    startTls: readMetadata(secret, "smtpStartTls") !== "0",
    user,
    pass,
    from,
    replyTo: readMetadata(secret, "smtpReplyTo") || undefined,
    timeoutMs: Number(readMetadata(secret, "smtpTimeoutMs")) || 12_000,
  };
}

export function buildPersonalEmailSmtpConfig(rawInput: UserOperationalIdentitySmtpBindInput):
  | {
      ok: true;
      config: NonNullable<ReturnType<typeof resolvePlatformAuthSmtpConfig>>;
      source: "custom" | "platform_env";
      imap?: {
        host: string;
        port: number;
        user: string;
        secure: boolean;
      };
    }
  | { ok: false; code: string; error: string } {
  const input = enrichPersonalEmailBindInput(rawInput);
  const from = input.from.trim();
  if (!isValidPersonalEmailAddress(from)) {
    return {
      ok: false,
      code: "USER_IDENTITY_EMAIL_INVALID",
      error: "邮箱地址格式无效。",
    };
  }

  if (input.usePlatformSmtp) {
    const platform = resolvePlatformAuthSmtpConfig();
    if (!platform) {
      return {
        ok: false,
        code: "USER_IDENTITY_PLATFORM_SMTP_NOT_CONFIGURED",
        error: "网关未配置平台 SMTP（OPENBOT_SMTP_*），请改用自定义 SMTP 或先配置网关邮件服务。",
      };
    }
    return {
      ok: true,
      source: "platform_env",
      config: {
        ...platform,
        // Keep platform envelope identity; user's address is Reply-To.
        from: platform.from,
        replyTo: from,
      },
    };
  }

  const host = (input.host ?? "").trim();
  if (!host) {
    return {
      ok: false,
      code: "USER_IDENTITY_SMTP_HOST_REQUIRED",
      error: "SMTP 主机不能为空。",
    };
  }
  const pass = (input.pass ?? "").trim();
  if (!pass) {
    return {
      ok: false,
      code: "USER_IDENTITY_SMTP_PASS_REQUIRED",
      error: "SMTP 密码 / 授权码不能为空。",
    };
  }
  const portRaw = input.port;
  const port =
    typeof portRaw === "number"
      ? portRaw
      : Number.parseInt(String(portRaw ?? "").trim() || "587", 10);
  if (!Number.isFinite(port) || port <= 0) {
    return {
      ok: false,
      code: "USER_IDENTITY_SMTP_PORT_INVALID",
      error: "SMTP 端口无效。",
    };
  }
  const secure = parseBooleanFlag(input.secure, port === 465);
  const startTls = parseBooleanFlag(input.startTls, !secure);
  const user = (input.user ?? "").trim() || from;
  const replyTo = (input.replyTo ?? "").trim() || undefined;
  const imapHost = (input.imapHost ?? "").trim();
  const imapPortRaw = input.imapPort;
  const imapPort =
    typeof imapPortRaw === "number"
      ? imapPortRaw
      : Number.parseInt(String(imapPortRaw ?? "").trim() || "993", 10);
  const imapUser = (input.imapUser ?? "").trim() || user;
  const imap =
    imapHost && Number.isFinite(imapPort) && imapPort > 0
      ? {
          host: imapHost,
          port: imapPort,
          user: imapUser,
          secure: imapPort === 993,
        }
      : undefined;
  return {
    ok: true,
    source: "custom",
    config: {
      host,
      port,
      secure,
      startTls,
      user,
      pass,
      from,
      ...(replyTo ? { replyTo } : {}),
      timeoutMs: 12_000,
    },
    ...(imap ? { imap } : {}),
  };
}

export async function probeUserOperationalIdentitySmtpCredentials(params: {
  config: NonNullable<ReturnType<typeof resolvePlatformAuthSmtpConfig>>;
}): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  if (shouldSkipUserOperationalIdentitySmtpProbe()) {
    return { ok: true };
  }
  const verified = await verifyPlatformAuthSmtpConfig(params.config);
  if (!verified.ok) {
    return {
      ok: false,
      code: "USER_IDENTITY_SMTP_PROBE_FAILED",
      error: `SMTP 校验失败：${verified.error}`,
    };
  }
  return { ok: true };
}

export async function probeUserOperationalIdentityImapCredentials(params: {
  secret: UserOperationalIdentityCredentialSecret;
}): Promise<{ ok: true } | { ok: false; code: string; error: string }> {
  const config = resolveOperationalIdentityImapConfig(params.secret);
  if (!config) {
    return { ok: true };
  }
  if (shouldSkipUserOperationalIdentitySmtpProbe()) {
    return { ok: true };
  }
  const probe = await probePlatformAuthImapConnection(config);
  if (!probe.ok) {
    return {
      ok: false,
      code: "USER_IDENTITY_IMAP_PROBE_FAILED",
      error: `IMAP 校验失败：${probe.error}`,
    };
  }
  return { ok: true };
}

export function buildPersonalEmailCredentialSecret(params: {
  handleId: string;
  ownerId: string;
  displayName?: string;
  /** User-facing personal mailbox (identity external account), may differ from SMTP From. */
  personalEmail?: string;
  config: NonNullable<ReturnType<typeof resolvePlatformAuthSmtpConfig>>;
  source: "custom" | "platform_env";
  imap?: {
    host: string;
    port: number;
    user: string;
    secure: boolean;
  };
  nowIso: string;
}): UserOperationalIdentityCredentialSecret {
  const personalEmail =
    params.personalEmail?.trim() ||
    params.config.replyTo?.trim() ||
    (params.source === "custom" ? params.config.from : "") ||
    "";
  return {
    handleId: params.handleId,
    ownerId: params.ownerId,
    provider: "personal-email",
    kind: "smtp",
    accessToken:
      params.source === "platform_env"
        ? (params.config.pass ?? "env:platform")
        : (params.config.pass ?? ""),
    accountLabel: params.displayName?.trim() || personalEmail || params.config.from,
    metadata: {
      source: params.source,
      smtpHost: params.config.host,
      smtpPort: String(params.config.port),
      smtpFrom: params.config.from,
      smtpUser: params.config.user ?? "",
      smtpSecure: params.config.secure ? "1" : "0",
      smtpStartTls: params.config.startTls ? "1" : "0",
      ...(personalEmail ? { personalEmail } : {}),
      ...(params.config.replyTo
        ? { smtpReplyTo: params.config.replyTo }
        : personalEmail
          ? { smtpReplyTo: personalEmail }
          : {}),
      ...(params.imap
        ? {
            imapHost: params.imap.host,
            imapPort: String(params.imap.port),
            imapUser: params.imap.user,
            imapSecure: params.imap.secure ? "1" : "0",
          }
        : {}),
    },
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
}

export async function sendUserOperationalIdentityEmail(params: {
  secret: UserOperationalIdentityCredentialSecret;
  to: string;
  subject: string;
  message: string;
  attachments?: PlatformAuthEmailAttachment[];
}): Promise<{ messageId: string; from: string; status: "sent"; attachmentCount: number }> {
  const config = resolveUserOperationalIdentitySmtpConfig(params.secret);
  if (!config) {
    throw new Error("SMTP is not configured for this operational identity.");
  }
  const attachments = params.attachments ?? [];
  const messageId = await sendPlatformAuthSmtpMail(config, {
    to: params.to,
    subject: params.subject,
    text: params.message,
    html: `<pre>${params.message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
  return {
    messageId,
    from: config.from,
    status: "sent",
    attachmentCount: attachments.length,
  };
}
