import fs from "node:fs/promises";
import path from "node:path";
import { writeFileWithinRoot } from "../../infra/fs-safe.js";
import type { MemoryProfileEntry } from "./types.js";

const USER_PROFILE_RELATIVE = path.join("memory", "user_profile.json");

type UserProfileFile = {
  version: 1;
  updatedAt: string;
  entries: Record<string, MemoryProfileEntry>;
  appliedSourceMessageIds: string[];
};

function emptyProfile(): UserProfileFile {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    entries: {},
    appliedSourceMessageIds: [],
  };
}

function profilePath(workspaceDir: string): string {
  return path.join(workspaceDir, USER_PROFILE_RELATIVE);
}

export async function readUserProfileStore(workspaceDir: string): Promise<UserProfileFile> {
  try {
    const raw = await fs.readFile(profilePath(workspaceDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<UserProfileFile>;
    if (!parsed || parsed.version !== 1 || typeof parsed.entries !== "object" || !parsed.entries) {
      return emptyProfile();
    }
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : emptyProfile().updatedAt,
      entries: parsed.entries,
      appliedSourceMessageIds: Array.isArray(parsed.appliedSourceMessageIds)
        ? parsed.appliedSourceMessageIds.filter((id) => typeof id === "string")
        : [],
    };
  } catch {
    return emptyProfile();
  }
}

export async function readUserProfileEntries(workspaceDir: string): Promise<MemoryProfileEntry[]> {
  const store = await readUserProfileStore(workspaceDir);
  return Object.values(store.entries);
}

export async function upsertUserProfileEntry(params: {
  workspaceDir: string;
  entry: Omit<MemoryProfileEntry, "version" | "updatedAt" | "previousValue"> & {
    previousValue?: string;
  };
}): Promise<MemoryProfileEntry | "idempotent"> {
  const store = await readUserProfileStore(params.workspaceDir);
  if (store.appliedSourceMessageIds.includes(params.entry.sourceMessageId)) {
    return "idempotent";
  }

  const now = new Date().toISOString();
  const existing = store.entries[params.entry.key];
  const next: MemoryProfileEntry = existing
    ? {
        ...params.entry,
        scope: "user",
        source: "conversation",
        updatedAt: now,
        version: existing.value === params.entry.value ? existing.version : existing.version + 1,
        previousValue:
          existing.value === params.entry.value ? existing.previousValue : existing.value,
      }
    : {
        ...params.entry,
        scope: "user",
        source: "conversation",
        updatedAt: now,
        version: 1,
      };

  store.entries[params.entry.key] = next;
  store.appliedSourceMessageIds = [...store.appliedSourceMessageIds, params.entry.sourceMessageId];
  if (store.appliedSourceMessageIds.length > 500) {
    store.appliedSourceMessageIds = store.appliedSourceMessageIds.slice(-500);
  }
  store.updatedAt = now;

  await writeFileWithinRoot({
    rootDir: params.workspaceDir,
    relativePath: USER_PROFILE_RELATIVE,
    data: `${JSON.stringify(store, null, 2)}\n`,
    encoding: "utf8",
  });
  return next;
}
