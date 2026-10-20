/**
 * Directed notice to a real person in the same tenant.
 * Robots cannot open a human's chat; this records a notice on their
 * workbench and asks that client to refresh.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PlatformAuthStore } from "../gateway/platform-auth/store-types.js";
import { broadcastWorkbenchSignalsInvalidate } from "../gateway/workbench/signals-invalidate.js";
import { resolveConfigDir } from "../utils.js";

export type TenantHuman = {
  userId: string;
  displayName: string;
  email: string;
};

export type TenantHumanNoticeStatus = "pending" | "confirmed";

export type TenantHumanNotice = {
  id: string;
  tenantId: string;
  recipientUserId: string;
  recipientDisplayName: string;
  message: string;
  fromAgentId?: string;
  /** Session key of the chat that sent the notice (receipt target). */
  fromSessionKey?: string;
  senderUserId?: string;
  status?: TenantHumanNoticeStatus;
  createdAt: string;
  confirmedAt?: string;
  receiptDelivered?: boolean;
};

function noticesPath(): string {
  return path.join(resolveConfigDir(), "tenant-human-notices.json");
}

export function listTenantHumans(store: PlatformAuthStore, tenantId: string): TenantHuman[] {
  const enterpriseId = tenantId.trim();
  if (!enterpriseId) {
    return [];
  }
  const humans: TenantHuman[] = [];
  for (const membership of Object.values(store.memberships)) {
    if (membership.enterpriseId !== enterpriseId) {
      continue;
    }
    const user = store.users[membership.userId];
    if (!user || user.status !== "active") {
      continue;
    }
    humans.push({
      userId: user.id,
      displayName: user.displayName.trim() || user.email,
      email: user.email,
    });
  }
  humans.sort((a, b) => a.displayName.localeCompare(b.displayName, "zh"));
  return humans;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "");
}

export function resolveTenantHuman(
  humans: readonly TenantHuman[],
  target: string,
): TenantHuman | undefined {
  const needle = normalizeToken(target);
  if (!needle) {
    return undefined;
  }
  const exact = humans.filter((human) =>
    [human.userId, human.displayName, human.email].some(
      (value) => normalizeToken(value) === needle,
    ),
  );
  return exact.length === 1 ? exact[0] : undefined;
}

export function readTenantHumanNotices(tenantId?: string): TenantHumanNotice[] {
  let raw = "[]";
  try {
    raw = fs.readFileSync(noticesPath(), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const notices = parsed.filter((row): row is TenantHumanNotice => {
    return Boolean(
      row && typeof row === "object" && typeof (row as TenantHumanNotice).id === "string",
    );
  });
  const scope = tenantId?.trim();
  return scope ? notices.filter((row) => row.tenantId === scope) : notices;
}

export function listPendingTenantHumanNotices(input: {
  tenantId: string;
  recipientUserId: string;
}): TenantHumanNotice[] {
  const tenantId = input.tenantId.trim();
  const recipientUserId = input.recipientUserId.trim();
  return readTenantHumanNotices(tenantId).filter(
    (notice) =>
      notice.recipientUserId === recipientUserId && (notice.status ?? "pending") === "pending",
  );
}

/** Prefer the sender's current chat; legacy notices fall back to agent main. */
export function resolveTenantHumanReceiptSessionKey(
  notice: Pick<TenantHumanNotice, "fromSessionKey" | "fromAgentId">,
  fallbackMainSessionKey: (agentId: string) => string = (agentId) => `agent:${agentId}:main`,
): string | undefined {
  const fromSessionKey = notice.fromSessionKey?.trim();
  if (fromSessionKey) {
    return fromSessionKey;
  }
  const agentId = notice.fromAgentId?.trim();
  return agentId ? fallbackMainSessionKey(agentId) : undefined;
}

async function deliverTenantHumanReceipt(notice: TenantHumanNotice): Promise<boolean> {
  const { defaultConversationSessionKey, postConversationPeerLine } =
    await import("../conversation-task/conversation-handoff.js");
  const sessionKey = resolveTenantHumanReceiptSessionKey(notice, defaultConversationSessionKey);
  if (!sessionKey) {
    return false;
  }
  await postConversationPeerLine({
    sessionKey,
    message: `${notice.recipientDisplayName}已确认：${notice.message}`,
    senderLabel: notice.recipientDisplayName,
    sourceSessionKey: `tenant-notice:${notice.id}`,
    ...(notice.senderUserId ? { sessionOwnerPlatformUserId: notice.senderUserId } : {}),
  });
  return true;
}

export async function confirmTenantHumanNotice(input: {
  tenantId: string;
  recipientUserId: string;
  noticeId: string;
  deliverReceipt?: (notice: TenantHumanNotice) => Promise<boolean>;
}): Promise<TenantHumanNotice | null> {
  const tenantId = input.tenantId.trim();
  const recipientUserId = input.recipientUserId.trim();
  const noticeId = input.noticeId.trim();
  const all = readTenantHumanNotices();
  const index = all.findIndex(
    (notice) =>
      notice.id === noticeId &&
      notice.tenantId === tenantId &&
      notice.recipientUserId === recipientUserId &&
      (notice.status ?? "pending") === "pending",
  );
  if (index < 0) {
    return null;
  }
  const current = all[index];
  if (!current) {
    return null;
  }
  const deliver = input.deliverReceipt ?? deliverTenantHumanReceipt;
  let receiptDelivered = false;
  try {
    receiptDelivered = await deliver(current);
  } catch {
    receiptDelivered = false;
  }
  const confirmed: TenantHumanNotice = {
    ...current,
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
    receiptDelivered,
  };
  all[index] = confirmed;
  const file = noticesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  broadcastWorkbenchSignalsInvalidate({
    reason: "collaboration",
    userIds: [recipientUserId, current.senderUserId].filter((id): id is string => Boolean(id)),
  });
  return confirmed;
}

export function recordTenantHumanNotice(input: {
  tenantId: string;
  recipient: TenantHuman;
  message: string;
  fromAgentId?: string;
  /** Session key of the chat that sent the notice (receipt target). */
  fromSessionKey?: string;
  senderUserId?: string;
}): TenantHumanNotice {
  const notice: TenantHumanNotice = {
    id: crypto.randomUUID(),
    tenantId: input.tenantId.trim(),
    recipientUserId: input.recipient.userId,
    recipientDisplayName: input.recipient.displayName,
    message: input.message.trim(),
    status: "pending",
    ...(input.fromAgentId?.trim() ? { fromAgentId: input.fromAgentId.trim() } : {}),
    ...(input.fromSessionKey?.trim() ? { fromSessionKey: input.fromSessionKey.trim() } : {}),
    ...(input.senderUserId?.trim() ? { senderUserId: input.senderUserId.trim() } : {}),
    createdAt: new Date().toISOString(),
  };
  const existing = readTenantHumanNotices();
  const file = noticesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([...existing, notice], null, 2));
  broadcastWorkbenchSignalsInvalidate({
    reason: "collaboration",
    userIds: [notice.recipientUserId],
  });
  return notice;
}
