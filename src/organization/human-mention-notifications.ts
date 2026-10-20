/**
 * Tenant-scoped persistent inbox for human @mentions in collaboration groups.
 *
 * Separate from the agent mention journal (mentions.sqlite / mentions.jsonl) —
 * humans are not agents and must not share that store.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { assertSafeTenantId, resolveTenantControlPlaneDir } from "../gateway/tenant-store-paths.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../infra/json-files.js";

export type HumanMentionNotification = {
  mentionId: string;
  targetUserId: string;
  sourceUserId: string;
  groupId: string;
  sessionKey: string;
  sourceMessageId: string;
  excerpt: string;
  displayName?: string;
  createdAt: string;
  readAt?: string | null;
  acknowledgedAt?: string | null;
};

export type HumanMentionNotificationStore = {
  version: 1;
  byMentionId: Record<string, HumanMentionNotification>;
};

const STORE_FILE = "human-mention-notifications.json";
const locks = new Map<string, ReturnType<typeof createAsyncLock>>();

function lockFor(filePath: string) {
  let lock = locks.get(filePath);
  if (!lock) {
    lock = createAsyncLock();
    locks.set(filePath, lock);
  }
  return lock;
}

export function resolveHumanMentionNotificationStorePath(tenantId: string): string {
  assertSafeTenantId(tenantId);
  return path.join(resolveTenantControlPlaneDir(tenantId), STORE_FILE);
}

function emptyStore(): HumanMentionNotificationStore {
  return { version: 1, byMentionId: {} };
}

export async function loadHumanMentionNotificationStore(
  tenantId: string,
): Promise<HumanMentionNotificationStore> {
  const filePath = resolveHumanMentionNotificationStorePath(tenantId);
  const loaded = await readJsonFile<HumanMentionNotificationStore>(filePath);
  if (!loaded || typeof loaded !== "object" || loaded.version !== 1) {
    return emptyStore();
  }
  return {
    version: 1,
    byMentionId: loaded.byMentionId ?? {},
  };
}

async function saveStore(tenantId: string, store: HumanMentionNotificationStore): Promise<void> {
  const filePath = resolveHumanMentionNotificationStorePath(tenantId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonAtomic(filePath, store);
}

export type UpsertHumanMentionNotificationParams = {
  tenantId: string;
  notification: Omit<HumanMentionNotification, "createdAt" | "readAt" | "acknowledgedAt"> & {
    createdAt?: string;
  };
  now?: () => Date;
};

/**
 * Idempotent upsert by mentionId. Retries with the same mentionId do not create
 * duplicates; createdAt/readAt from the first write are preserved.
 */
export async function upsertHumanMentionNotification(
  params: UpsertHumanMentionNotificationParams,
): Promise<{ notification: HumanMentionNotification; created: boolean }> {
  const lock = lockFor(resolveHumanMentionNotificationStorePath(params.tenantId));
  return lock(async () => {
    const store = await loadHumanMentionNotificationStore(params.tenantId);
    const existing = store.byMentionId[params.notification.mentionId];
    if (existing) {
      return { notification: existing, created: false };
    }
    const createdAt =
      params.notification.createdAt ?? (params.now ?? (() => new Date()))().toISOString();
    const notification: HumanMentionNotification = {
      ...params.notification,
      createdAt,
      readAt: null,
      acknowledgedAt: null,
    };
    store.byMentionId[notification.mentionId] = notification;
    await saveStore(params.tenantId, store);
    return { notification, created: true };
  });
}

export type ListHumanMentionNotificationsParams = {
  tenantId: string;
  targetUserId: string;
  unreadOnly?: boolean;
  limit?: number;
};

export async function listHumanMentionNotifications(
  params: ListHumanMentionNotificationsParams,
): Promise<HumanMentionNotification[]> {
  const store = await loadHumanMentionNotificationStore(params.tenantId);
  const target = params.targetUserId.trim().toLowerCase();
  const items = Object.values(store.byMentionId)
    .filter((entry) => entry.targetUserId.trim().toLowerCase() === target)
    .filter((entry) => (params.unreadOnly ? !entry.readAt && !entry.acknowledgedAt : true))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  const limit = params.limit && params.limit > 0 ? params.limit : items.length;
  return items.slice(0, limit);
}

export type AckHumanMentionNotificationParams = {
  tenantId: string;
  targetUserId: string;
  mentionId: string;
  now?: () => Date;
};

export async function acknowledgeHumanMentionNotification(
  params: AckHumanMentionNotificationParams,
): Promise<HumanMentionNotification | null> {
  const lock = lockFor(resolveHumanMentionNotificationStorePath(params.tenantId));
  return lock(async () => {
    const store = await loadHumanMentionNotificationStore(params.tenantId);
    const existing = store.byMentionId[params.mentionId];
    if (!existing) {
      return null;
    }
    if (existing.targetUserId.trim().toLowerCase() !== params.targetUserId.trim().toLowerCase()) {
      return null;
    }
    const now = (params.now ?? (() => new Date()))().toISOString();
    const updated: HumanMentionNotification = {
      ...existing,
      readAt: existing.readAt ?? now,
      acknowledgedAt: now,
    };
    store.byMentionId[params.mentionId] = updated;
    await saveStore(params.tenantId, store);
    return updated;
  });
}
