import type { PlatformAuthImapConfig } from "./platform-auth-imap.js";
import { runPlatformAuthImapSession } from "./platform-auth-imap.js";

export type PlatformAuthImapMessageSummary = {
  uid: number;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  messageId?: string;
  snippet?: string;
};

export type PlatformAuthImapMessageDetail = PlatformAuthImapMessageSummary & {
  bodyText?: string;
};

export type PlatformAuthImapListOptions = {
  mailbox?: string;
  limit?: number;
  uid?: number;
  includeBody?: boolean;
};

export type PlatformAuthImapSearchOptions = {
  mailbox?: string;
  query?: string;
  unseen?: boolean;
  limit?: number;
  includeBody?: boolean;
};

function quoteImapString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function parseHeaderBlock(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let currentKey = "";
  for (const line of raw.split(/\r?\n/)) {
    if (!line) {
      continue;
    }
    if (/^\s/.test(line) && currentKey) {
      headers[currentKey] = `${headers[currentKey]} ${line.trim()}`;
      continue;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    currentKey = line.slice(0, idx).trim().toLowerCase();
    headers[currentKey] = line.slice(idx + 1).trim();
  }
  return headers;
}

function extractLiterals(raw: string): string[] {
  const literals: string[] = [];
  const pattern = /\{(\d+)\}\r?\n/g;
  let match: RegExpExecArray | null = pattern.exec(raw);
  while (match) {
    const size = Number(match[1]);
    const start = match.index + match[0].length;
    literals.push(raw.slice(start, start + size));
    match = pattern.exec(raw);
  }
  return literals;
}

export function parsePlatformAuthImapFetchSummaries(raw: string): PlatformAuthImapMessageSummary[] {
  const summaries: PlatformAuthImapMessageSummary[] = [];
  const fetchChunks = raw.split(/\* \d+ FETCH /).slice(1);
  for (const chunk of fetchChunks) {
    const uidMatch = chunk.match(/UID (\d+)/i);
    if (!uidMatch) {
      continue;
    }
    const uid = Number(uidMatch[1]);
    if (!Number.isFinite(uid)) {
      continue;
    }
    const literals = extractLiterals(chunk);
    const headerLiteral =
      literals.find((entry) => /^(from:|to:|subject:|date:|message-id:)/im.test(entry)) ??
      literals[0] ??
      "";
    const bodyLiteral =
      literals.find((entry) => entry !== headerLiteral && !/^(from:|to:|subject:)/im.test(entry)) ??
      "";
    const headers = parseHeaderBlock(headerLiteral);
    summaries.push({
      uid,
      from: headers.from,
      to: headers.to,
      subject: headers.subject,
      date: headers.date,
      messageId: headers["message-id"],
      snippet: bodyLiteral ? normalizeSnippet(bodyLiteral) : undefined,
    });
  }
  return summaries;
}

function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 512);
}

export function parsePlatformAuthImapSearchUids(raw: string): number[] {
  const uids: number[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\* SEARCH (.+)$/);
    if (!match?.[1]?.trim()) {
      continue;
    }
    for (const token of match[1].trim().split(/\s+/)) {
      const uid = Number(token);
      if (Number.isFinite(uid)) {
        uids.push(uid);
      }
    }
  }
  return uids;
}

function resolveLimit(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(value), 50);
}

function buildFetchFields(includeBody: boolean): string {
  const headerFields = "BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)]";
  if (!includeBody) {
    return `(UID ${headerFields} BODY.PEEK[TEXT]<0.512>)`;
  }
  return `(UID ${headerFields} BODY.PEEK[TEXT]<0.8192>)`;
}

async function fetchUidSummaries(params: {
  config: PlatformAuthImapConfig;
  mailbox: string;
  uids: number[];
  includeBody: boolean;
}): Promise<PlatformAuthImapMessageSummary[]> {
  if (params.uids.length === 0) {
    return [];
  }
  return await runPlatformAuthImapSession(params.config, async (session) => {
    await session.login();
    await session.selectMailbox(params.mailbox);
    const fetchFields = buildFetchFields(params.includeBody);
    const uidSet = params.uids.join(",");
    const fetched = await session.command(`UID FETCH ${uidSet} ${fetchFields}`);
    if (fetched.status !== "OK") {
      throw new Error(fetched.text || "IMAP FETCH 失败。");
    }
    await session.logout();
    return parsePlatformAuthImapFetchSummaries(fetched.raw);
  });
}

export async function listPlatformAuthImapMessages(
  config: PlatformAuthImapConfig,
  options: PlatformAuthImapListOptions = {},
): Promise<PlatformAuthImapMessageSummary[]> {
  const mailbox = options.mailbox?.trim() || "INBOX";
  const limit = resolveLimit(options.limit, options.uid != null ? 1 : 10);
  const includeBody = options.includeBody === true;

  if (options.uid != null) {
    return await fetchUidSummaries({
      config,
      mailbox,
      uids: [options.uid],
      includeBody,
    });
  }

  return await runPlatformAuthImapSession(config, async (session) => {
    await session.login();
    await session.selectMailbox(mailbox);
    const searched = await session.command("UID SEARCH ALL");
    if (searched.status !== "OK") {
      throw new Error(searched.text || "IMAP SEARCH 失败。");
    }
    const uids = parsePlatformAuthImapSearchUids(searched.raw).slice(-limit).toReversed();
    await session.logout();
    if (uids.length === 0) {
      return [];
    }
    return await fetchUidSummaries({
      config,
      mailbox,
      uids,
      includeBody,
    });
  });
}

export async function searchPlatformAuthImapMessages(
  config: PlatformAuthImapConfig,
  options: PlatformAuthImapSearchOptions = {},
): Promise<PlatformAuthImapMessageSummary[]> {
  const mailbox = options.mailbox?.trim() || "INBOX";
  const limit = resolveLimit(options.limit, 20);
  const includeBody = options.includeBody === true;
  const query = options.query?.trim();

  return await runPlatformAuthImapSession(config, async (session) => {
    await session.login();
    await session.selectMailbox(mailbox);
    let criteria = "ALL";
    if (options.unseen) {
      criteria = "UNSEEN";
    } else if (query) {
      criteria = `TEXT ${quoteImapString(query)}`;
    }
    const searched = await session.command(`UID SEARCH ${criteria}`);
    if (searched.status !== "OK") {
      throw new Error(searched.text || "IMAP SEARCH 失败。");
    }
    const uids = parsePlatformAuthImapSearchUids(searched.raw).slice(-limit).toReversed();
    await session.logout();
    if (uids.length === 0) {
      return [];
    }
    return await fetchUidSummaries({
      config,
      mailbox,
      uids,
      includeBody,
    });
  });
}

export async function readPlatformAuthImapMessageByUid(
  config: PlatformAuthImapConfig,
  params: { mailbox?: string; uid: number; includeBody?: boolean },
): Promise<PlatformAuthImapMessageDetail | null> {
  const messages = await listPlatformAuthImapMessages(config, {
    mailbox: params.mailbox,
    uid: params.uid,
    limit: 1,
    includeBody: params.includeBody ?? true,
  });
  const message = messages[0];
  if (!message) {
    return null;
  }
  return {
    ...message,
    bodyText: message.snippet,
  };
}

export function extractEmailAddressFromHeader(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  const angle = value.match(/<([^>]+)>/);
  if (angle?.[1]?.trim()) {
    return angle[1].trim();
  }
  if (value.includes("@")) {
    return value.trim();
  }
  return null;
}

export function buildReplyEmailSubject(subject: string | undefined): string {
  const normalized = subject?.trim() || "(no subject)";
  if (/^re:/i.test(normalized)) {
    return normalized;
  }
  return `Re: ${normalized}`;
}

export function normalizeMessageIdHeader(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
}
