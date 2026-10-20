import {
  deriveSessionChatType,
  parseAgentSessionKey,
} from "../../../../src/sessions/session-key-utils.js";
import { resolveSessionDisplayName } from "../app-render.helpers.ts";
import type { SessionsListResult } from "../types.ts";

export type FrontstageSessionCard = {
  key: string;
  title: string;
  subtitle: string;
  agentId: string;
  updatedAt: number | null;
  chatType: "direct" | "group" | "channel";
  surface: string | null;
  subject: string | null;
};

export type FrontstageContactCard = {
  id: string;
  title: string;
  latestSessionKey: string;
  latestUpdatedAt: number | null;
  surfaces: string[];
  personaIds: string[];
  sessionKeys: string[];
  sessionCount: number;
};

export type FrontstageGroupCard = {
  id: string;
  title: string;
  latestSessionKey: string;
  latestUpdatedAt: number | null;
  chatType: "group" | "channel";
  surfaces: string[];
  personaIds: string[];
  sessionKeys: string[];
  sessionCount: number;
};

type SessionRow = SessionsListResult["sessions"][number];

function normalizeFrontstageChatType(
  value: ReturnType<typeof deriveSessionChatType>,
): "direct" | "group" | "channel" {
  if (value === "direct" || value === "group") {
    return value;
  }
  return "channel";
}

export function deriveSessionCards(
  sessionsResult: SessionsListResult | null,
  kinds: Array<"direct" | "group" | "channel">,
): FrontstageSessionCard[] {
  const rows = sessionsResult?.sessions ?? [];
  return rows
    .map((row) => {
      const parsed = parseAgentSessionKey(row.key);
      const chatType =
        row.kind === "direct" || row.kind === "group"
          ? row.kind
          : normalizeFrontstageChatType(deriveSessionChatType(row.key));
      const hasWorkspaceRouteContext = Boolean(
        row.surface?.trim() || row.room?.trim() || (parsed?.rest && parsed.rest !== "main"),
      );
      if (chatType === "channel" && !hasWorkspaceRouteContext) {
        return null;
      }
      if (!kinds.includes(chatType)) {
        return null;
      }
      const title = resolveSessionDisplayName(row.key, row);
      const subtitle = [
        row.subject?.trim() || null,
        row.surface?.trim() || null,
        chatType === "channel" ? "broadcast space" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        key: row.key,
        title,
        subtitle,
        agentId: parsed?.agentId ?? "main",
        updatedAt: row.updatedAt,
        chatType,
        surface: typeof row.surface === "string" ? row.surface.trim() || null : null,
        subject: typeof row.subject === "string" ? row.subject.trim() || null : null,
      } satisfies FrontstageSessionCard;
    })
    .filter((entry): entry is FrontstageSessionCard => entry !== null)
    .toSorted((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}

function normalizeIdentityPart(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function getDirectContactIdentity(row: SessionRow, card: FrontstageSessionCard): string {
  const scoped = parseAgentSessionKey(row.key)?.rest ?? row.key.trim().toLowerCase();
  const directMatch = scoped.match(/^([^:]+):(direct|dm):(.+)$/);
  if (directMatch) {
    const channelId = normalizeIdentityPart(directMatch[1]) ?? "direct";
    const remoteId = normalizeIdentityPart(directMatch[3]) ?? card.key.toLowerCase();
    return `${channelId}:${remoteId}`;
  }

  const surface = normalizeIdentityPart(card.surface);
  const subject = normalizeIdentityPart(card.subject);
  const title = normalizeIdentityPart(card.title);
  if (surface && subject) {
    return `${surface}:${subject}`;
  }
  if (surface && title) {
    return `${surface}:${title}`;
  }
  if (subject) {
    return subject;
  }
  return row.key.trim().toLowerCase();
}

function getDirectContactTitle(row: SessionRow, card: FrontstageSessionCard): string {
  const subject = row.subject?.trim();
  if (subject) {
    return subject;
  }
  const label = row.label?.trim();
  if (label && label !== row.key) {
    return label;
  }
  const displayName = row.displayName?.trim();
  if (displayName && displayName !== row.key) {
    return displayName;
  }
  return card.title;
}

export function buildContactCards(
  sessionsResult: SessionsListResult | null,
): FrontstageContactCard[] {
  const directCards = deriveSessionCards(sessionsResult, ["direct"]);
  const rowsByKey = new Map((sessionsResult?.sessions ?? []).map((row) => [row.key, row] as const));
  const contacts = new Map<
    string,
    {
      title: string;
      latestSessionKey: string;
      latestUpdatedAt: number | null;
      surfaces: Set<string>;
      personaIds: Set<string>;
      sessionKeys: string[];
    }
  >();

  for (const card of directCards) {
    const row = rowsByKey.get(card.key);
    if (!row) {
      continue;
    }
    const id = getDirectContactIdentity(row, card);
    const title = getDirectContactTitle(row, card);
    const existing = contacts.get(id);
    if (!existing) {
      contacts.set(id, {
        title,
        latestSessionKey: card.key,
        latestUpdatedAt: card.updatedAt,
        surfaces: new Set(card.surface ? [card.surface] : []),
        personaIds: new Set([card.agentId]),
        sessionKeys: [card.key],
      });
      continue;
    }
    existing.sessionKeys.push(card.key);
    existing.personaIds.add(card.agentId);
    if (card.surface) {
      existing.surfaces.add(card.surface);
    }
  }

  return Array.from(contacts.entries())
    .map(([id, entry]) => ({
      id,
      title: entry.title,
      latestSessionKey: entry.latestSessionKey,
      latestUpdatedAt: entry.latestUpdatedAt,
      surfaces: Array.from(entry.surfaces),
      personaIds: Array.from(entry.personaIds),
      sessionKeys: entry.sessionKeys,
      sessionCount: entry.sessionKeys.length,
    }))
    .toSorted((left, right) => (right.latestUpdatedAt ?? 0) - (left.latestUpdatedAt ?? 0));
}

function getGroupIdentity(row: SessionRow, card: FrontstageSessionCard): string {
  const scoped = parseAgentSessionKey(row.key)?.rest ?? row.key.trim().toLowerCase();
  const canonicalMatch = scoped.match(/^([^:]+):(group|channel):(.+)$/);
  if (canonicalMatch) {
    const channelId = normalizeIdentityPart(canonicalMatch[1]) ?? "space";
    const kindCandidate = normalizeIdentityPart(canonicalMatch[2]);
    const kind =
      kindCandidate === "group" || kindCandidate === "channel" ? kindCandidate : card.chatType;
    const remoteId = normalizeIdentityPart(canonicalMatch[3]) ?? card.key.toLowerCase();
    return `${channelId}:${kind}:${remoteId}`;
  }

  const surface = normalizeIdentityPart(card.surface);
  const room = normalizeIdentityPart(row.room);
  const space = normalizeIdentityPart(row.space);
  const subject = normalizeIdentityPart(card.subject);
  const title = normalizeIdentityPart(card.title);
  if (surface && room) {
    return `${surface}:${card.chatType}:${room}`;
  }
  if (surface && space) {
    return `${surface}:${card.chatType}:${space}`;
  }
  if (surface && subject) {
    return `${surface}:${card.chatType}:${subject}`;
  }
  if (surface && title) {
    return `${surface}:${card.chatType}:${title}`;
  }
  if (room) {
    return `${card.chatType}:${room}`;
  }
  if (space) {
    return `${card.chatType}:${space}`;
  }
  if (subject) {
    return `${card.chatType}:${subject}`;
  }
  return row.key.trim().toLowerCase();
}

function getGroupTitle(row: SessionRow, card: FrontstageSessionCard): string {
  const room = row.room?.trim();
  if (room) {
    return room;
  }
  const space = row.space?.trim();
  if (space) {
    return space;
  }
  const subject = row.subject?.trim();
  if (subject) {
    return subject;
  }
  const label = row.label?.trim();
  if (label && label !== row.key) {
    return label;
  }
  const displayName = row.displayName?.trim();
  if (displayName && displayName !== row.key) {
    return displayName;
  }
  return card.title;
}

export function buildGroupCards(sessionsResult: SessionsListResult | null): FrontstageGroupCard[] {
  const groupCards = deriveSessionCards(sessionsResult, ["group", "channel"]);
  const rowsByKey = new Map((sessionsResult?.sessions ?? []).map((row) => [row.key, row] as const));
  const groups = new Map<
    string,
    {
      title: string;
      latestSessionKey: string;
      latestUpdatedAt: number | null;
      chatType: "group" | "channel";
      surfaces: Set<string>;
      personaIds: Set<string>;
      sessionKeys: string[];
    }
  >();

  for (const card of groupCards) {
    const row = rowsByKey.get(card.key);
    if (!row) {
      continue;
    }
    const id = getGroupIdentity(row, card);
    const title = getGroupTitle(row, card);
    const existing = groups.get(id);
    if (!existing) {
      groups.set(id, {
        title,
        latestSessionKey: card.key,
        latestUpdatedAt: card.updatedAt,
        chatType: card.chatType === "group" ? "group" : "channel",
        surfaces: new Set(card.surface ? [card.surface] : []),
        personaIds: new Set([card.agentId]),
        sessionKeys: [card.key],
      });
      continue;
    }
    existing.sessionKeys.push(card.key);
    existing.personaIds.add(card.agentId);
    if (card.surface) {
      existing.surfaces.add(card.surface);
    }
  }

  return Array.from(groups.entries())
    .map(([id, entry]) => ({
      id,
      title: entry.title,
      latestSessionKey: entry.latestSessionKey,
      latestUpdatedAt: entry.latestUpdatedAt,
      chatType: entry.chatType,
      surfaces: Array.from(entry.surfaces),
      personaIds: Array.from(entry.personaIds),
      sessionKeys: entry.sessionKeys,
      sessionCount: entry.sessionKeys.length,
    }))
    .toSorted((left, right) => (right.latestUpdatedAt ?? 0) - (left.latestUpdatedAt ?? 0));
}
