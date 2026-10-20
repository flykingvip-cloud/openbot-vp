import { resolveEnterpriseOperationalIdentityImapConfig } from "./enterprise-operational-identity-imap.js";
import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { sendEnterpriseOperationalIdentityEmail } from "./enterprise-operational-identity-smtp-send.js";
import {
  buildReplyEmailSubject,
  extractEmailAddressFromHeader,
  listPlatformAuthImapMessages,
  normalizeMessageIdHeader,
  readPlatformAuthImapMessageByUid,
  searchPlatformAuthImapMessages,
  type PlatformAuthImapMessageSummary,
} from "./platform-auth-imap-mail.js";

export type EnterpriseOperationalIdentityImapPayload = {
  mailbox?: string;
  uid?: number;
  limit?: number;
  query?: string;
  unseen?: boolean;
  includeBody?: boolean;
  to?: string;
  subject?: string;
  message?: string;
  body?: string;
  html?: string;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export function parseEnterpriseOperationalIdentityImapPayload(
  value: unknown,
): EnterpriseOperationalIdentityImapPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  return {
    mailbox: stringValue(record.mailbox) || undefined,
    uid: numberValue(record.uid),
    limit: numberValue(record.limit),
    query: stringValue(record.query) || undefined,
    unseen: booleanValue(record.unseen),
    includeBody: booleanValue(record.includeBody),
    to: stringValue(record.to) || undefined,
    subject: stringValue(record.subject) || undefined,
    message: stringValue(record.message) || undefined,
    body: stringValue(record.body) || undefined,
    html: stringValue(record.html) || undefined,
  };
}

function requireImapConfig(secret: EnterpriseOperationalIdentityCredentialSecret) {
  const config = resolveEnterpriseOperationalIdentityImapConfig(secret);
  if (!config) {
    throw new Error("IMAP 未配置或参数不完整；读信需要 imapHost 与账号密码。");
  }
  return config;
}

function serializeMessages(messages: PlatformAuthImapMessageSummary[]) {
  return messages.map((message) => ({
    uid: message.uid,
    from: message.from ?? null,
    to: message.to ?? null,
    subject: message.subject ?? null,
    date: message.date ?? null,
    messageId: message.messageId ?? null,
    snippet: message.snippet ?? null,
  }));
}

export async function readEnterpriseOperationalIdentityEmails(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  payload: EnterpriseOperationalIdentityImapPayload;
}): Promise<Record<string, unknown>> {
  const config = requireImapConfig(params.secret);
  const uid = params.payload.uid;
  if (uid != null) {
    const message = await readPlatformAuthImapMessageByUid(config, {
      mailbox: params.payload.mailbox,
      uid,
      includeBody: params.payload.includeBody ?? true,
    });
    if (!message) {
      throw new Error(`未找到 UID=${uid} 的邮件。`);
    }
    return {
      mailbox: params.payload.mailbox?.trim() || "INBOX",
      count: 1,
      messages: [
        {
          uid: message.uid,
          from: message.from ?? null,
          to: message.to ?? null,
          subject: message.subject ?? null,
          date: message.date ?? null,
          messageId: message.messageId ?? null,
          snippet: message.snippet ?? null,
          bodyText: message.bodyText ?? null,
        },
      ],
    };
  }
  const messages = await listPlatformAuthImapMessages(config, {
    mailbox: params.payload.mailbox,
    limit: params.payload.limit,
    includeBody: params.payload.includeBody ?? false,
  });
  return {
    mailbox: params.payload.mailbox?.trim() || "INBOX",
    count: messages.length,
    messages: serializeMessages(messages),
  };
}

export async function searchEnterpriseOperationalIdentityEmails(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  payload: EnterpriseOperationalIdentityImapPayload;
}): Promise<Record<string, unknown>> {
  const config = requireImapConfig(params.secret);
  const messages = await searchPlatformAuthImapMessages(config, {
    mailbox: params.payload.mailbox,
    query: params.payload.query,
    unseen: params.payload.unseen,
    limit: params.payload.limit,
    includeBody: params.payload.includeBody ?? false,
  });
  return {
    mailbox: params.payload.mailbox?.trim() || "INBOX",
    query: params.payload.query ?? null,
    unseen: params.payload.unseen ?? false,
    count: messages.length,
    messages: serializeMessages(messages),
  };
}

export async function replyEnterpriseOperationalIdentityEmail(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  payload: EnterpriseOperationalIdentityImapPayload;
}): Promise<Record<string, unknown>> {
  const uid = params.payload.uid;
  if (uid == null) {
    throw new Error("reply_email 需要 uid（要回复的邮件 UID）。");
  }
  const message = stringValue(params.payload.message) || stringValue(params.payload.body);
  if (!message) {
    throw new Error("reply_email 需要 message（或 body）。");
  }
  const config = requireImapConfig(params.secret);
  const original = await readPlatformAuthImapMessageByUid(config, {
    mailbox: params.payload.mailbox,
    uid,
    includeBody: false,
  });
  if (!original) {
    throw new Error(`未找到 UID=${uid} 的邮件，无法回复。`);
  }
  const to = stringValue(params.payload.to) || extractEmailAddressFromHeader(original.from);
  if (!to) {
    throw new Error("无法从原邮件解析回复地址；请在 payload.to 中指定收件人。");
  }
  const subject = stringValue(params.payload.subject) || buildReplyEmailSubject(original.subject);
  const inReplyTo = normalizeMessageIdHeader(original.messageId);
  const sent = await sendEnterpriseOperationalIdentityEmail({
    secret: params.secret,
    to,
    subject,
    message,
    html: stringValue(params.payload.html) || undefined,
    inReplyTo,
    references: inReplyTo,
  });
  return {
    uid,
    to,
    subject,
    from: sent.from,
    messageId: sent.messageId,
    inReplyTo: inReplyTo ?? null,
    status: sent.status,
  };
}
