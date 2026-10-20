import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import type { KnowledgeObject } from "./types.js";

export type KnowledgeRecentVisit = {
  objectId: string;
  title: string;
  source: KnowledgeObject["source"];
  visitedAt: number;
};

const MAX_RECENT_VISITS = 12;
const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "recent-visits.json");

type RecentVisitsStore = {
  scopes: Record<string, KnowledgeRecentVisit[]>;
};

function scopeKey(params: { userId?: string | null; seatId?: string | null }): string {
  return `${params.userId ?? "anonymous"}::${params.seatId ?? "none"}`;
}

function emptyStore(): RecentVisitsStore {
  return { scopes: {} };
}

function sanitizeVisit(value: unknown): KnowledgeRecentVisit | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const objectId = typeof record.objectId === "string" ? record.objectId.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const source = record.source;
  const visitedAt =
    typeof record.visitedAt === "number" && Number.isFinite(record.visitedAt)
      ? record.visitedAt
      : Date.now();
  if (!objectId || !title) {
    return null;
  }
  if (source !== "personal" && source !== "enterprise" && source !== "data") {
    return null;
  }
  return { objectId, title, source, visitedAt };
}

function readStore(storePath: string = DEFAULT_STORE_FILE): RecentVisitsStore {
  try {
    if (!fs.existsSync(storePath)) {
      return emptyStore();
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return emptyStore();
    }
    const record = parsed as Record<string, unknown>;
    const rawScopes =
      typeof record.scopes === "object" && record.scopes !== null && !Array.isArray(record.scopes)
        ? (record.scopes as Record<string, unknown>)
        : {};
    const scopes: RecentVisitsStore["scopes"] = {};
    for (const [key, visits] of Object.entries(rawScopes)) {
      if (!key.trim() || !Array.isArray(visits)) {
        continue;
      }
      const normalized = visits
        .map((item) => sanitizeVisit(item))
        .filter((item): item is KnowledgeRecentVisit => item !== null)
        .slice(0, MAX_RECENT_VISITS);
      if (normalized.length > 0) {
        scopes[key] = normalized;
      }
    }
    return { scopes };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: RecentVisitsStore, storePath: string = DEFAULT_STORE_FILE): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function recordKnowledgeRecentVisit(params: {
  userId?: string | null;
  seatId?: string | null;
  object: KnowledgeObject;
  storePath?: string;
}): KnowledgeRecentVisit[] {
  const storePath = params.storePath ?? DEFAULT_STORE_FILE;
  const key = scopeKey(params);
  const store = readStore(storePath);
  const current = store.scopes[key] ?? [];
  const nextVisit: KnowledgeRecentVisit = {
    objectId: params.object.id,
    title: params.object.title,
    source: params.object.source,
    visitedAt: Date.now(),
  };
  const filtered = current.filter((item) => item.objectId !== params.object.id);
  const next = [nextVisit, ...filtered].slice(0, MAX_RECENT_VISITS);
  store.scopes[key] = next;
  writeStore(store, storePath);
  return next;
}

export function listKnowledgeRecentVisits(params: {
  userId?: string | null;
  seatId?: string | null;
  limit?: number;
  storePath?: string;
}): KnowledgeRecentVisit[] {
  const storePath = params.storePath ?? DEFAULT_STORE_FILE;
  const key = scopeKey(params);
  const limit = Math.min(Math.max(params.limit ?? 8, 1), MAX_RECENT_VISITS);
  return (readStore(storePath).scopes[key] ?? []).slice(0, limit);
}

/** Test helper — clears persisted recent visits (entire store file). */
export function resetKnowledgeRecentVisitsStore(storePath: string = DEFAULT_STORE_FILE): void {
  try {
    if (fs.existsSync(storePath)) {
      fs.rmSync(storePath);
    }
  } catch {
    // ignore
  }
}
