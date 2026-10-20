import fs from "node:fs/promises";
import path from "node:path";
import { LedgerWriteError } from "./errors.js";
import { foldEvents } from "./fold.js";
import type { ExecutionEvent, ExecutionLedger } from "./types.js";

export type ProgressLedgerStore = {
  readonly taskId: string;
  loadEvents(): Promise<ExecutionEvent[]>;
  append(event: ExecutionEvent): Promise<void>;
};

function assertSafeTaskId(taskId: string): string {
  const trimmed = taskId.trim();
  if (!trimmed) {
    throw new LedgerWriteError("invalid progress ledger task id");
  }
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0")) {
    throw new LedgerWriteError("invalid progress ledger task id");
  }
  return trimmed;
}

export function resolveProgressLedgerPath(params: {
  cronStorePath: string;
  taskId: string;
}): string {
  const storePath = path.resolve(params.cronStorePath);
  const dir = path.resolve(path.dirname(storePath), "progress-ledger");
  const safeTaskId = assertSafeTaskId(params.taskId);
  const resolvedPath = path.resolve(dir, `${safeTaskId}.jsonl`);
  if (!resolvedPath.startsWith(`${dir}${path.sep}`)) {
    throw new LedgerWriteError("invalid progress ledger task id");
  }
  return resolvedPath;
}

export function createMemoryLedgerStore(
  taskId: string,
  seed: ExecutionEvent[] = [],
): ProgressLedgerStore {
  const events = [...seed];
  return {
    taskId,
    async loadEvents() {
      return [...events];
    },
    async append(event) {
      events.push(event);
    },
  };
}

export function createFileLedgerStore(params: {
  cronStorePath: string;
  taskId: string;
}): ProgressLedgerStore {
  const filePath = resolveProgressLedgerPath(params);
  return {
    taskId: params.taskId,
    async loadEvents() {
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const events: ExecutionEvent[] = [];
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          events.push(JSON.parse(trimmed) as ExecutionEvent);
        }
        return events;
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") {
          return [];
        }
        throw err;
      }
    },
    async append(event) {
      await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    },
  };
}

export async function loadFoldedLedger(
  store: ProgressLedgerStore,
): Promise<ExecutionLedger | null> {
  const events = await store.loadEvents();
  if (events.length === 0) {
    return null;
  }
  return foldEvents(events);
}
