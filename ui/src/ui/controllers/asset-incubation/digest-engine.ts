import type { GatewayBrowserClient } from "../../gateway.ts";
import { recordLocalAdoption } from "./adoption-sync.ts";

export type WeeklyDigestEntryView = {
  id: string;
  kind: "review" | "admin_recommend" | "organizational";
  label: string;
  summary: string;
  capabilityId?: string;
  fingerprint?: string;
  recurrenceCount?: number;
};

export type WeeklyDigestView = {
  weekKey: string;
  builtAt: number;
  headline: string;
  entries: WeeklyDigestEntryView[];
};

const DIGEST_ACK_STORAGE_KEY = "openbot.asset-incubation.digest-ack.v1";

function weekStartMs(now: number): number {
  const date = new Date(now);
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - diff);
  return date.getTime();
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

export function currentWeekKey(now = Date.now()): string {
  return `week-${weekStartMs(now)}`;
}

export function loadDigestAckWeekKey(): string | null {
  if (!canUseStorage()) {
    return null;
  }
  try {
    const raw = localStorage.getItem(DIGEST_ACK_STORAGE_KEY);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

export function ackWeeklyDigest(weekKey: string): void {
  if (!canUseStorage()) {
    return;
  }
  try {
    localStorage.setItem(DIGEST_ACK_STORAGE_KEY, weekKey.trim());
  } catch {
    // best-effort
  }
}

export function shouldShowWeeklyDigest(digest: WeeklyDigestView | null, now = Date.now()): boolean {
  if (!digest || digest.entries.length === 0) {
    return false;
  }
  const ack = loadDigestAckWeekKey();
  const weekKey = digest.weekKey || currentWeekKey(now);
  return ack !== weekKey;
}

export function buildLocalWeeklyDigest(params?: {
  now?: number;
  reviewSuggestions?: WeeklyDigestEntryView[];
}): WeeklyDigestView {
  const now = params?.now ?? Date.now();
  const entries = params?.reviewSuggestions ?? [];
  return {
    weekKey: currentWeekKey(now),
    builtAt: now,
    headline:
      entries.length === 0 ? "本周暂无新的资产回顾项" : `本周有 ${entries.length} 项资产值得回顾`,
    entries,
  };
}

export async function scheduleDigestWithSync(params: {
  client?: GatewayBrowserClient | null;
  topLimit?: number;
  minRecurrence?: number;
}): Promise<WeeklyDigestView> {
  if (params.client) {
    try {
      const remote = await params.client.request<WeeklyDigestView>(
        "asset-incubation.digest.build",
        {
          topLimit: params.topLimit ?? 8,
          minRecurrence: params.minRecurrence ?? 3,
        },
      );
      if (remote?.weekKey) {
        for (const entry of remote.entries) {
          if (entry.kind === "admin_recommend" && entry.capabilityId?.trim()) {
            recordLocalAdoption(entry.capabilityId, { adminRecommended: true });
          }
        }
        return remote;
      }
    } catch {
      // fall through to local shell
    }
  }
  return buildLocalWeeklyDigest();
}

export function clearDigestStorageForTests(): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.removeItem(DIGEST_ACK_STORAGE_KEY);
}
