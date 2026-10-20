import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import type { PlatformAuthLeadNotification } from "./platform-auth.js";

const DEFAULT_SMTP_TIMEOUT_MS = 12_000;
const SMTP_ENV_KEYS = [
  "OPENBOT_SMTP_HOST",
  "OPENBOT_SMTP_PORT",
  "OPENBOT_SMTP_USER",
  "OPENBOT_SMTP_PASS",
  "OPENBOT_SMTP_FROM",
  "OPENBOT_SMTP_REPLY_TO",
  "OPENBOT_SMTP_SECURE",
  "OPENBOT_SMTP_STARTTLS",
  "OPENBOT_SMTP_TIMEOUT_MS",
  "OPENCLAW_SMTP_HOST",
  "OPENCLAW_SMTP_PORT",
  "OPENCLAW_SMTP_USER",
  "OPENCLAW_SMTP_PASS",
  "OPENCLAW_SMTP_FROM",
  "OPENCLAW_SMTP_REPLY_TO",
  "OPENCLAW_SMTP_SECURE",
  "OPENCLAW_SMTP_STARTTLS",
  "OPENCLAW_SMTP_TIMEOUT_MS",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_REPLY_TO",
  "SMTP_SECURE",
  "SMTP_STARTTLS",
  "SMTP_TIMEOUT_MS",
] as const;

type EnvKey = (typeof SMTP_ENV_KEYS)[number];
type EnvReader = Record<string, string | undefined>;

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  startTls: boolean;
  user?: string;
  pass?: string;
  from: string;
  replyTo?: string;
  timeoutMs: number;
};

export type PlatformAuthSmtpConfig = SmtpConfig;

export type PlatformAuthEmailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string;
  references?: string;
  attachments?: PlatformAuthEmailAttachment[];
};

type SmtpResponse = {
  code: number;
  lines: string[];
};

export type PlatformAuthEmailDeliveryResult =
  | {
      status: "sent";
      messageId: string;
    }
  | {
      status: "queued";
      reason: "smtp_not_configured" | "unsupported_notification" | "missing_recipient";
    }
  | {
      status: "failed";
      error: string;
    };

function readEnv(env: EnvReader, keys: EnvKey[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolvePlatformAuthSmtpConfig(env: EnvReader = process.env): SmtpConfig | null {
  const host = readEnv(env, ["OPENBOT_SMTP_HOST", "OPENCLAW_SMTP_HOST", "SMTP_HOST"]);
  const user = readEnv(env, ["OPENBOT_SMTP_USER", "OPENCLAW_SMTP_USER", "SMTP_USER"]);
  const pass = readEnv(env, ["OPENBOT_SMTP_PASS", "OPENCLAW_SMTP_PASS", "SMTP_PASS"]);
  const from = readEnv(env, ["OPENBOT_SMTP_FROM", "OPENCLAW_SMTP_FROM", "SMTP_FROM"]) ?? user;
  if (!host || !from) {
    return null;
  }

  const portRaw = readEnv(env, ["OPENBOT_SMTP_PORT", "OPENCLAW_SMTP_PORT", "SMTP_PORT"]);
  const explicitSecure = readEnv(env, [
    "OPENBOT_SMTP_SECURE",
    "OPENCLAW_SMTP_SECURE",
    "SMTP_SECURE",
  ]);
  const secure = parseBoolean(explicitSecure, portRaw === "465");
  const port = parsePositiveInteger(portRaw, secure ? 465 : 587);
  const replyTo = readEnv(env, [
    "OPENBOT_SMTP_REPLY_TO",
    "OPENCLAW_SMTP_REPLY_TO",
    "SMTP_REPLY_TO",
  ]);
  return {
    host,
    port,
    secure,
    startTls: parseBoolean(
      readEnv(env, ["OPENBOT_SMTP_STARTTLS", "OPENCLAW_SMTP_STARTTLS", "SMTP_STARTTLS"]),
      !secure,
    ),
    ...(user ? { user } : {}),
    ...(pass ? { pass } : {}),
    from,
    ...(replyTo ? { replyTo } : {}),
    timeoutMs: parsePositiveInteger(
      readEnv(env, ["OPENBOT_SMTP_TIMEOUT_MS", "OPENCLAW_SMTP_TIMEOUT_MS", "SMTP_TIMEOUT_MS"]),
      DEFAULT_SMTP_TIMEOUT_MS,
    ),
  };
}

function readPayloadString(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readPayloadStringList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeEmailForCompare(value: string): string {
  return value.trim().toLowerCase();
}

function looksLikeEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.includes("@")) {
    return false;
  }
  const at = trimmed.lastIndexOf("@");
  const domain = trimmed.slice(at + 1);
  return domain.includes(".") && domain.length > 2;
}

export function resolvePlatformAuthEmailGreeting(params: {
  preferredName: string;
  email: string;
  fallback?: string;
}): string {
  const fallback = params.fallback?.trim() || "你好";
  const preferred = params.preferredName.trim();
  const email = params.email.trim();
  if (!preferred) {
    return fallback;
  }
  if (looksLikeEmailAddress(preferred)) {
    return fallback;
  }
  if (email && normalizeEmailForCompare(preferred) === normalizeEmailForCompare(email)) {
    return fallback;
  }
  return preferred;
}

export function formatPlatformAuthExpiry(isoTimestamp: string): string {
  const trimmed = isoTimestamp.trim();
  if (!trimmed || trimmed === "null") {
    return "";
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return trimmed;
  }
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(parsed));
  return `${formatted}（北京时间）`;
}

function formatExpiryLine(prefix: string, isoTimestamp: string): string {
  const formatted = formatPlatformAuthExpiry(isoTimestamp);
  return formatted ? `\n\n${prefix}${formatted}` : "";
}

function renderSeatAssignmentOfferEmail(
  notification: PlatformAuthLeadNotification,
): EmailMessage | null {
  if (
    notification.type !== "seat-assignment-offer-email" &&
    notification.type !== "seat-assignment-offer-reminder-email"
  ) {
    return null;
  }
  const payload = notification.payload;
  const to = notification.email ?? readPayloadString(payload, "employeeEmail");
  if (!to.trim()) {
    return null;
  }
  const seatTitle = readPayloadString(payload, "seatTitle", "岗位");
  const enterpriseName = readPayloadString(payload, "enterpriseName", "企业");
  const employeeName = resolvePlatformAuthEmailGreeting({
    preferredName: readPayloadString(payload, "employeeDisplayName"),
    email: to,
  });
  const offeredBy = readPayloadString(payload, "offeredByDisplayName", "管理员");
  const confirmationUrl = readPayloadString(payload, "confirmationUrl");
  const expiresAt = readPayloadString(payload, "expiresAt");
  const agentIds = readPayloadStringList(payload, "agentIds");
  const agentAssetsText = agentIds.length > 0 ? `\n岗位 AI 工具集：${agentIds.join(", ")}` : "";
  const isReminder = notification.type === "seat-assignment-offer-reminder-email";
  const subject = isReminder
    ? `【OpenBot】岗位绑定提醒：${seatTitle}`
    : `【OpenBot】请确认岗位绑定：${seatTitle}`;
  const actionText = confirmationUrl
    ? `请打开以下链接，在个人设置中接受或拒绝这次岗位绑定：\n${confirmationUrl}`
    : "请登录 OpenBot，在个人设置中接受或拒绝这次岗位绑定。";
  const expiryText = formatExpiryLine("该确认请求有效期至：", expiresAt);
  const text = [
    `${employeeName}，`,
    "",
    `${enterpriseName} 的 ${offeredBy} 邀请你确认绑定岗位「${seatTitle}」。${agentAssetsText}`,
    actionText,
    expiryText.trim(),
    "",
    "如果你没有预期收到这封邮件，可以忽略它。",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
  const escapedUrl = escapeHtml(confirmationUrl);
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2328;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
      <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(employeeName)}，</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.65;">
        ${escapeHtml(enterpriseName)} 的 ${escapeHtml(offeredBy)} 邀请你确认绑定岗位
        <strong>${escapeHtml(seatTitle)}</strong>。
      </p>
      ${
        agentIds.length > 0
          ? `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">岗位 AI 工具集：${escapeHtml(agentIds.join(", "))}</p>`
          : ""
      }
      ${
        confirmationUrl
          ? `<p style="margin:24px 0;"><a href="${escapedUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">确认岗位绑定</a></p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">如果按钮无法打开，请复制链接：<br><a href="${escapedUrl}" style="color:#2563eb;">${escapedUrl}</a></p>`
          : `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">请登录 OpenBot，在个人设置中接受或拒绝这次岗位绑定。</p>`
      }
      ${
        expiresAt && expiresAt !== "null"
          ? `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;">该确认请求有效期至：${escapeHtml(formatPlatformAuthExpiry(expiresAt))}</p>`
          : ""
      }
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">如果你没有预期收到这封邮件，可以忽略它。</p>
    </div>
  </body>
</html>`;
  return {
    to,
    subject,
    text,
    html,
  };
}

function renderActivationEmail(notification: PlatformAuthLeadNotification): EmailMessage | null {
  if (
    notification.type !== "employee-activation-email" &&
    notification.type !== "admin-activation-email"
  ) {
    return null;
  }
  const payload = notification.payload;
  const to =
    notification.email ||
    readPayloadString(payload, "employeeEmail") ||
    readPayloadString(payload, "adminEmail") ||
    readPayloadString(payload, "workEmail");
  if (!to.trim()) {
    return null;
  }
  const isEmployee = notification.type === "employee-activation-email";
  const enterpriseName = readPayloadString(payload, "enterpriseName", "企业");
  const displayName = resolvePlatformAuthEmailGreeting({
    preferredName: readPayloadString(
      payload,
      isEmployee ? "employeeName" : "adminName",
      readPayloadString(payload, "contactName"),
    ),
    email: to,
  });
  const code = readPayloadString(payload, "code");
  const expiresAt = readPayloadString(payload, "expiresAt");
  const activationUrl = readPayloadString(payload, "activationUrl");
  const seatTitle = readPayloadString(payload, "seatTitle");
  if (!code && !activationUrl) {
    return null;
  }
  const subject = isEmployee
    ? `【OpenBot】请激活你的岗位身份${seatTitle ? `：${seatTitle}` : ""}`
    : `【OpenBot】请激活企业管理员账号：${enterpriseName}`;
  const roleLine = isEmployee
    ? `${enterpriseName} 已为你预创建企业组织身份${seatTitle ? `，岗位为「${seatTitle}」` : ""}。`
    : `${enterpriseName} 已为你预创建企业管理员账号。`;
  const actionLine = activationUrl
    ? `请打开以下链接完成邮箱验证、账号注册和身份激活：\n${activationUrl}`
    : `请在 OpenBot 登录页选择激活流程，并输入激活码：${code}`;
  const formattedExpiry = formatPlatformAuthExpiry(expiresAt);
  const expiryText = formattedExpiry ? `\n\n该激活链接有效期至：${formattedExpiry}` : "";
  const text = [
    `${displayName}，`,
    "",
    roleLine,
    code ? `激活码：${code}` : "",
    actionLine,
    expiryText.trim(),
    "",
    "如果你没有预期收到这封邮件，可以忽略它。",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
  const escapedUrl = escapeHtml(activationUrl);
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2328;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
      <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(displayName)}，</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.65;">${escapeHtml(roleLine)}</p>
      ${
        code
          ? `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">激活码：<strong>${escapeHtml(code)}</strong></p>`
          : ""
      }
      ${
        activationUrl
          ? `<p style="margin:24px 0;"><a href="${escapedUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">${isEmployee ? "激活岗位身份" : "激活管理员账号"}</a></p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">如果按钮无法打开，请复制链接：<br><a href="${escapedUrl}" style="color:#2563eb;">${escapedUrl}</a></p>`
          : `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">请在 OpenBot 登录页选择激活流程，并输入上方激活码。</p>`
      }
      ${
        formattedExpiry
          ? `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;">该激活链接有效期至：${escapeHtml(formattedExpiry)}</p>`
          : ""
      }
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">如果你没有预期收到这封邮件，可以忽略它。</p>
    </div>
  </body>
</html>`;
  return {
    to,
    subject,
    text,
    html,
  };
}

/**
 * Enterprise co-admin invite: an existing employee is invited to ALSO become an
 * enterprise administrator. Distinct from `admin-activation-email` (new admin
 * sets a password) — the invitee keeps the existing employee password.
 */
export function renderEnterpriseCoAdminInviteEmail(
  notification: PlatformAuthLeadNotification,
): EmailMessage | null {
  if (notification.type !== "enterprise-co-admin-invite-email") {
    return null;
  }
  const payload = notification.payload;
  const to = notification.email || readPayloadString(payload, "inviteeEmail");
  if (!to.trim()) {
    return null;
  }
  const enterpriseName = readPayloadString(payload, "enterpriseName", "企业");
  const inviteeName = resolvePlatformAuthEmailGreeting({
    preferredName: readPayloadString(payload, "inviteeName"),
    email: to,
  });
  const invitedBy = readPayloadString(payload, "issuedByDisplayName", "企业管理员");
  const inviteUrl = readPayloadString(payload, "inviteUrl");
  const expiresAt = readPayloadString(payload, "expiresAt");
  if (!inviteUrl) {
    return null;
  }
  const subject = `【OpenBot】邀请你成为 ${enterpriseName} 的企业管理员`;
  const roleLine = `${enterpriseName} 的 ${invitedBy} 邀请你成为企业管理员。`;
  const dualLine =
    "接受后你的账号将同时拥有员工与企业管理员两种身份：从企业端登录为管理员，从员工端登录仍为员工。登录密码保持不变，无需重新设置。";
  const actionLine = `请打开以下链接，使用你现有的员工账号和密码登录企业端完成接受：\n${inviteUrl}`;
  const formattedExpiry = formatPlatformAuthExpiry(expiresAt);
  const text = [
    `${inviteeName}，`,
    "",
    roleLine,
    dualLine,
    actionLine,
    formattedExpiry ? `该邀请有效期至：${formattedExpiry}` : "",
    "",
    "如果你没有预期收到这封邮件，可以忽略它。",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
  const escapedUrl = escapeHtml(inviteUrl);
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2328;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
      <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(inviteeName)}，</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.65;">${escapeHtml(roleLine)}</p>
      <p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(dualLine)}</p>
      <p style="margin:24px 0;"><a href="${escapedUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">接受管理员邀请</a></p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">如果按钮无法打开，请复制链接：<br><a href="${escapedUrl}" style="color:#2563eb;">${escapedUrl}</a></p>
      ${
        formattedExpiry
          ? `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;">该邀请有效期至：${escapeHtml(formattedExpiry)}</p>`
          : ""
      }
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">如果你没有预期收到这封邮件，可以忽略它。</p>
    </div>
  </body>
</html>`;
  return { to, subject, text, html };
}

function renderPasswordResetEmail(notification: PlatformAuthLeadNotification): EmailMessage | null {
  if (notification.type !== "password-reset-email") {
    return null;
  }
  const payload = notification.payload;
  const to =
    notification.email ||
    readPayloadString(payload, "email") ||
    readPayloadString(payload, "workEmail");
  if (!to.trim()) {
    return null;
  }
  const displayName = resolvePlatformAuthEmailGreeting({
    preferredName: readPayloadString(payload, "displayName"),
    email: to,
  });
  const code = readPayloadString(payload, "code");
  const expiresAt = readPayloadString(payload, "expiresAt");
  const resetUrl = readPayloadString(payload, "resetUrl");
  const subject = "【OpenBot】重置你的账号密码";
  const actionLine = resetUrl
    ? `请打开以下链接继续重置密码：\n${resetUrl}`
    : `请在 OpenBot 登录页选择“重置密码”，并输入重置码：${code}`;
  const formattedExpiry = formatPlatformAuthExpiry(expiresAt);
  const expiryText = formattedExpiry ? `\n\n该重置请求有效期至：${formattedExpiry}` : "";
  const text = [
    `${displayName}，`,
    "",
    "我们收到了你的密码重置请求。",
    code ? `重置码：${code}` : "",
    actionLine,
    expiryText.trim(),
    "",
    "如果这不是你的操作，可以忽略这封邮件。",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
  const escapedUrl = escapeHtml(resetUrl);
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2328;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
      <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(displayName)}，</p>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.65;">我们收到了你的密码重置请求。</p>
      ${
        code
          ? `<p style="margin:0 0 16px;color:#374151;font-size:14px;line-height:1.6;">重置码：<strong>${escapeHtml(code)}</strong></p>`
          : ""
      }
      ${
        resetUrl
          ? `<p style="margin:24px 0;"><a href="${escapedUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">重置密码</a></p>
      <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">如果按钮无法打开，请复制链接：<br><a href="${escapedUrl}" style="color:#2563eb;">${escapedUrl}</a></p>`
          : `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">请在 OpenBot 登录页选择“重置密码”，并输入上方重置码。</p>`
      }
      ${
        formattedExpiry
          ? `<p style="margin:0 0 16px;color:#6b7280;font-size:14px;">该重置请求有效期至：${escapeHtml(formattedExpiry)}</p>`
          : ""
      }
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">如果这不是你的操作，可以忽略这封邮件。</p>
    </div>
  </body>
</html>`;
  return {
    to,
    subject,
    text,
    html,
  };
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function extractAddress(value: string): string {
  const bracketMatch = /<([^>]+)>/.exec(value);
  return (bracketMatch?.[1] ?? value).trim();
}

function dotStuff(value: string): string {
  return value
    .replace(/\r?\n/g, "\r\n")
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}

function encodeMimeBody(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n")
    .trim();
}

function encodeMimeBytes(content: Buffer): string {
  return content
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n")
    .trim();
}

function asciiFilenameFallback(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return fallback.trim() || "attachment";
}

function encodeContentDisposition(filename: string): string {
  const fallback = asciiFilenameFallback(filename);
  return `Content-Disposition: attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function buildAlternativeBody(params: { boundary: string; text: string; html: string }): string {
  const textBody = encodeMimeBody(params.text);
  const htmlBody = encodeMimeBody(params.html);
  return `--${params.boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${textBody}\r\n--${params.boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${htmlBody}\r\n--${params.boundary}--`;
}

function buildMimeMessage(params: {
  config: SmtpConfig;
  message: EmailMessage;
  messageId: string;
}): string {
  const attachments = params.message.attachments ?? [];
  const altBoundary = `openbot-${randomUUID()}`;
  const alternative = buildAlternativeBody({
    boundary: altBoundary,
    text: params.message.text,
    html: params.message.html,
  });
  const headers = [
    `From: ${params.config.from}`,
    `To: ${params.message.to}`,
    ...(params.config.replyTo ? [`Reply-To: ${params.config.replyTo}`] : []),
    ...(params.message.inReplyTo ? [`In-Reply-To: ${params.message.inReplyTo}`] : []),
    ...(params.message.references ? [`References: ${params.message.references}`] : []),
    `Subject: ${encodeHeader(params.message.subject)}`,
    `Message-ID: <${params.messageId}>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];
  if (attachments.length === 0) {
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    return `${headers.join("\r\n")}\r\n\r\n${alternative}`;
  }
  const mixedBoundary = `openbot-mixed-${randomUUID()}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
  const parts = [
    `--${mixedBoundary}\r\nContent-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n${alternative}`,
  ];
  for (const attachment of attachments) {
    const contentType =
      attachment.contentType.replace(/[\r\n]/g, "").trim() || "application/octet-stream";
    const fallback = asciiFilenameFallback(attachment.filename);
    parts.push(
      `--${mixedBoundary}\r\nContent-Type: ${contentType}; name="${fallback}"\r\nContent-Transfer-Encoding: base64\r\n${encodeContentDisposition(attachment.filename)}\r\n\r\n${encodeMimeBytes(attachment.content)}`,
    );
  }
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${mixedBoundary}--`;
}

class SmtpSession {
  private buffer = "";

  constructor(
    private socket: Socket | TLSSocket,
    private readonly timeoutMs: number,
  ) {
    this.socket.setTimeout(this.timeoutMs, () => {
      this.socket.destroy(new Error("SMTP connection timed out"));
    });
  }

  async readResponse(): Promise<SmtpResponse> {
    const lines: string[] = [];
    while (true) {
      const line = await this.readLine();
      lines.push(line);
      const match = /^(\d{3})([ -])/.exec(line);
      if (match?.[2] === " ") {
        return { code: Number(match[1]), lines };
      }
    }
  }

  async command(command: string, expectedCodes: number[]): Promise<SmtpResponse> {
    this.socket.write(`${command}\r\n`);
    const response = await this.readResponse();
    this.expect(response, expectedCodes);
    return response;
  }

  async data(message: string): Promise<SmtpResponse> {
    this.socket.write(`${dotStuff(message)}\r\n.\r\n`);
    const response = await this.readResponse();
    this.expect(response, [250]);
    return response;
  }

  async startTls(host: string): Promise<void> {
    const nextSocket = connectTls({
      socket: this.socket,
      servername: host,
    });
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        nextSocket.off("secureConnect", onSecureConnect);
        nextSocket.off("error", onError);
      };
      const onSecureConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      nextSocket.once("secureConnect", onSecureConnect);
      nextSocket.once("error", onError);
    });
    nextSocket.setTimeout(this.timeoutMs, () => {
      nextSocket.destroy(new Error("SMTP connection timed out"));
    });
    this.socket = nextSocket;
    this.buffer = "";
  }

  close(): void {
    this.socket.end();
  }

  expect(response: SmtpResponse, expectedCodes: number[]): void {
    if (!expectedCodes.includes(response.code)) {
      throw new Error(`SMTP command failed: ${response.lines.join(" / ")}`);
    }
  }

  private async readLine(): Promise<string> {
    while (!this.buffer.includes("\n")) {
      await this.waitForData();
    }
    const newlineIndex = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
    this.buffer = this.buffer.slice(newlineIndex + 1);
    return line;
  }

  private async waitForData(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.socket.off("data", onData);
        this.socket.off("error", onError);
        this.socket.off("end", onEnd);
        this.socket.off("close", onClose);
      };
      const onData = (chunk: Buffer) => {
        cleanup();
        this.buffer += chunk.toString("utf8");
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onEnd = () => {
        cleanup();
        reject(new Error("SMTP connection closed"));
      };
      const onClose = () => {
        cleanup();
        reject(new Error("SMTP connection closed"));
      };
      this.socket.once("data", onData);
      this.socket.once("error", onError);
      this.socket.once("end", onEnd);
      this.socket.once("close", onClose);
    });
  }
}

function connectSmtp(config: SmtpConfig): Promise<Socket | TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? connectTls({
          host: config.host,
          port: config.port,
          servername: config.host,
        })
      : createConnection({
          host: config.host,
          port: config.port,
        });
    const cleanup = () => {
      socket.off(config.secure ? "secureConnect" : "connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.setTimeout(config.timeoutMs, () => {
      socket.destroy(new Error("SMTP connection timed out"));
    });
    socket.once(config.secure ? "secureConnect" : "connect", onConnect);
    socket.once("error", onError);
  });
}

function hasStartTls(response: SmtpResponse): boolean {
  return response.lines.some((line) => line.toUpperCase().includes("STARTTLS"));
}

function supportsAuthPlain(response: SmtpResponse): boolean {
  return response.lines.some((line) => /\bAUTH(?:=|\s).*?\bPLAIN\b/i.test(line));
}

async function authenticateSmtpSession(
  session: SmtpSession,
  credentials: {
    user: string;
    pass: string;
  },
  capabilities: SmtpResponse,
): Promise<void> {
  if (supportsAuthPlain(capabilities)) {
    const plainPayload = Buffer.from(
      `\u0000${credentials.user}\u0000${credentials.pass}`,
      "utf8",
    ).toString("base64");
    await session.command(`AUTH PLAIN ${plainPayload}`, [235]);
    return;
  }
  await session.command("AUTH LOGIN", [334]);
  await session.command(Buffer.from(credentials.user, "utf8").toString("base64"), [334]);
  await session.command(Buffer.from(credentials.pass, "utf8").toString("base64"), [235]);
}

async function openAuthenticatedSmtpSession(config: SmtpConfig): Promise<SmtpSession> {
  const socket = await connectSmtp(config);
  const session = new SmtpSession(socket, config.timeoutMs);
  let encrypted = config.secure;
  session.expect(await session.readResponse(), [220]);
  let capabilities = await session.command("EHLO openbot.local", [250]);
  if (!config.secure && config.startTls && hasStartTls(capabilities)) {
    await session.command("STARTTLS", [220]);
    await session.startTls(config.host);
    encrypted = true;
    capabilities = await session.command("EHLO openbot.local", [250]);
  }
  if (config.user && config.pass) {
    if (!encrypted) {
      throw new Error("SMTP authentication requires TLS or STARTTLS.");
    }
    await authenticateSmtpSession(
      session,
      {
        user: config.user,
        pass: config.pass,
      },
      capabilities,
    );
  }
  return session;
}

/** Connect + EHLO + optional AUTH, then QUIT. Does not send mail. */
export async function verifyPlatformAuthSmtpConfig(
  config: SmtpConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let session: SmtpSession | null = null;
  try {
    session = await openAuthenticatedSmtpSession(config);
    await session.command("QUIT", [221]);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "SMTP 校验失败",
    };
  } finally {
    session?.close();
  }
}

/** @deprecated Prefer verifyPlatformAuthSmtpConfig; kept for enterprise credential probes. */
export async function probePlatformAuthSmtpConnection(
  config: SmtpConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return verifyPlatformAuthSmtpConfig(config);
}

export async function sendPlatformAuthSmtpMail(
  config: SmtpConfig,
  message: EmailMessage,
): Promise<string> {
  const messageId = `${randomUUID()}@openbot.local`;
  const session = await openAuthenticatedSmtpSession(config);
  try {
    await session.command(`MAIL FROM:<${extractAddress(config.from)}>`, [250]);
    await session.command(`RCPT TO:<${extractAddress(message.to)}>`, [250, 251]);
    await session.command("DATA", [354]);
    await session.data(
      buildMimeMessage({
        config,
        message,
        messageId,
      }),
    );
    await session.command("QUIT", [221]);
    return messageId;
  } finally {
    session.close();
  }
}

export async function deliverPlatformAuthEmailNotification(
  notification: PlatformAuthLeadNotification,
  env: EnvReader = process.env,
): Promise<PlatformAuthEmailDeliveryResult> {
  if (
    notification.type !== "seat-assignment-offer-email" &&
    notification.type !== "seat-assignment-offer-reminder-email" &&
    notification.type !== "employee-activation-email" &&
    notification.type !== "admin-activation-email" &&
    notification.type !== "enterprise-co-admin-invite-email" &&
    notification.type !== "password-reset-email"
  ) {
    return {
      status: "queued",
      reason: "unsupported_notification",
    };
  }
  if (
    !notification.email &&
    !readPayloadString(notification.payload, "employeeEmail") &&
    !readPayloadString(notification.payload, "adminEmail") &&
    !readPayloadString(notification.payload, "inviteeEmail") &&
    !readPayloadString(notification.payload, "workEmail")
  ) {
    return {
      status: "queued",
      reason: "missing_recipient",
    };
  }
  const message =
    renderSeatAssignmentOfferEmail(notification) ??
    renderActivationEmail(notification) ??
    renderEnterpriseCoAdminInviteEmail(notification) ??
    renderPasswordResetEmail(notification);
  if (!message) {
    return {
      status: "queued",
      reason: "missing_recipient",
    };
  }
  const config = resolvePlatformAuthSmtpConfig(env);
  if (!config) {
    return {
      status: "queued",
      reason: "smtp_not_configured",
    };
  }
  try {
    const messageId = await sendPlatformAuthSmtpMail(config, message);
    return {
      status: "sent",
      messageId,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function applyPlatformAuthEmailDeliveryResult(
  notification: PlatformAuthLeadNotification,
  result: PlatformAuthEmailDeliveryResult,
  nowIso: string,
): void {
  delete notification.deliveryError;
  delete notification.deliveryMessageId;
  delete notification.deliveryReason;
  delete notification.deliveredAt;
  if (result.status === "sent") {
    notification.status = "sent";
    notification.deliveredAt = nowIso;
    notification.deliveryMessageId = result.messageId;
    return;
  }
  if (result.status === "failed") {
    notification.status = "delivery_failed";
    notification.deliveryError = result.error;
    return;
  }
  notification.status = "queued";
  notification.deliveryReason = result.reason;
}
