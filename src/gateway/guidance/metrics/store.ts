/**
 * Append-only guidance metrics store (Gateway authority).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createAsyncLock } from "../../../infra/json-files.js";
import { CONFIG_DIR } from "../../../utils.js";
import type { GuidanceMetricEvent } from "./types.js";

export type GuidanceMetricsStore = {
  append(event: GuidanceMetricEvent): Promise<void>;
  list(filter: {
    tenantId: string;
    userId: string;
    limit?: number;
  }): Promise<GuidanceMetricEvent[]>;
};

export type FileGuidanceMetricsStoreOptions = {
  rootDir?: string;
};

const withLock = createAsyncLock();

export function resolveGuidanceMetricsRoot(opts?: FileGuidanceMetricsStoreOptions): string {
  return opts?.rootDir?.trim() || path.join(CONFIG_DIR, "guidance-metrics");
}

export function resolveGuidanceMetricsPath(
  tenantId: string,
  userId: string,
  opts?: FileGuidanceMetricsStoreOptions,
): string {
  const root = path.resolve(resolveGuidanceMetricsRoot(opts));
  const filePath = path.resolve(root, tenantId, userId, "events.jsonl");
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("metrics path escapes store root");
  }
  return filePath;
}

export function createFileGuidanceMetricsStore(
  opts?: FileGuidanceMetricsStoreOptions,
): GuidanceMetricsStore {
  return {
    async append(event) {
      const filePath = resolveGuidanceMetricsPath(event.tenantId, event.userId, opts);
      await withLock(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, "utf8");
      });
    },

    async list(filter) {
      const filePath = resolveGuidanceMetricsPath(filter.tenantId, filter.userId, opts);
      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          return [];
        }
        throw err;
      }
      const limit = Math.max(1, Math.min(filter.limit ?? 200, 2000));
      const lines = raw.split("\n").filter(Boolean);
      const events: GuidanceMetricEvent[] = [];
      for (const line of lines.slice(-limit)) {
        try {
          events.push(JSON.parse(line) as GuidanceMetricEvent);
        } catch {
          // skip corrupt lines
        }
      }
      return events;
    },
  };
}

/**
 * Fail-soft record — never throws to callers of guidance UX.
 * Returns ok=false on validation/store failure without raising.
 */
export async function recordGuidanceMetricSafe(
  store: GuidanceMetricsStore,
  input: unknown,
  parse: (
    value: unknown,
  ) => { ok: true; event: GuidanceMetricEvent } | { ok: false; message: string },
): Promise<{ ok: true; event: GuidanceMetricEvent } | { ok: false; message: string }> {
  try {
    const parsed = parse(input);
    if (!parsed.ok) {
      return parsed;
    }
    await store.append(parsed.event);
    return { ok: true, event: parsed.event };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
