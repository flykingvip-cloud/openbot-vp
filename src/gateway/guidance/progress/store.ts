/**
 * File-backed GuidanceProgressStore under Gateway state (not browser).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../../infra/json-files.js";
import { CONFIG_DIR } from "../../../utils.js";
import type {
  GuidanceProgressKey,
  GuidanceProgressRecord,
  GuidanceProgressStore,
} from "./types.js";
import { GUIDANCE_PROGRESS_VERSION } from "./types.js";

export type FileGuidanceProgressStoreOptions = {
  /** Override root (tests). Default: CONFIG_DIR/guidance-progress */
  rootDir?: string;
};

const withLock = createAsyncLock();

export function resolveGuidanceProgressRoot(opts?: FileGuidanceProgressStoreOptions): string {
  return opts?.rootDir?.trim() || path.join(CONFIG_DIR, "guidance-progress");
}

export function resolveGuidanceProgressPath(
  key: GuidanceProgressKey,
  opts?: FileGuidanceProgressStoreOptions,
): string {
  return path.join(
    resolveGuidanceProgressRoot(opts),
    key.tenantId,
    key.userId,
    key.scope,
    `${key.entityId}.json`,
  );
}

function isProgressRecord(value: unknown): value is GuidanceProgressRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const raw = value as Record<string, unknown>;
  return (
    raw.version === GUIDANCE_PROGRESS_VERSION &&
    typeof raw.tenantId === "string" &&
    typeof raw.userId === "string" &&
    typeof raw.scope === "string" &&
    typeof raw.entityId === "string" &&
    typeof raw.scenario === "string" &&
    typeof raw.currentStage === "string" &&
    Array.isArray(raw.completedSteps) &&
    typeof raw.nextActionKind === "string" &&
    typeof raw.confidence === "string" &&
    typeof raw.status === "string" &&
    typeof raw.lastSeenAt === "number" &&
    typeof raw.createdAt === "number" &&
    typeof raw.updatedAt === "number"
  );
}

export function createFileGuidanceProgressStore(
  opts?: FileGuidanceProgressStoreOptions,
): GuidanceProgressStore {
  return {
    async read(key) {
      const filePath = resolveGuidanceProgressPath(key, opts);
      const parsed = await readJsonFile<unknown>(filePath);
      if (!isProgressRecord(parsed)) {
        return null;
      }
      // Defense: refuse cross-key pollution if file was moved/forged.
      if (
        parsed.tenantId !== key.tenantId ||
        parsed.userId !== key.userId ||
        parsed.scope !== key.scope ||
        parsed.entityId !== key.entityId
      ) {
        return null;
      }
      return parsed;
    },

    async write(record) {
      const filePath = resolveGuidanceProgressPath(record, opts);
      await withLock(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await writeJsonAtomic(filePath, record);
      });
      return record;
    },

    async delete(key) {
      const filePath = resolveGuidanceProgressPath(key, opts);
      await withLock(async () => {
        try {
          await fs.unlink(filePath);
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code;
          if (code !== "ENOENT") {
            throw err;
          }
        }
      });
    },
  };
}
