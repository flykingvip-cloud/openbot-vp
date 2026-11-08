import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withFileLockSync, SESSION_TASK_BOARD_LOCK_OPTIONS } from "../../../infra/file-lock.js";
import type { TaskStopRecord, TaskStopScope } from "../../contracts/task-stop.js";

type StoredStop = { version: 1; token: string; key: string; entry: TaskStopRecord };
function keyFor(scope: TaskStopScope, taskId: string): string {
  return createHash("sha256")
    .update(JSON.stringify([scope.kind, scope.tenantId, scope.userId, scope.sessionKey, taskId]))
    .digest("hex");
}
function validEntry(value: unknown): value is TaskStopRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as Partial<TaskStopRecord>;
  return (
    ["managed", "personal", "internal"].includes(row.kind ?? "") &&
    [row.tenantId, row.userId, row.sessionKey, row.taskId].every(
      (part) => typeof part === "string" && part.trim().length > 0,
    ) &&
    typeof row.stoppedAtMs === "number" &&
    Number.isFinite(row.stoppedAtMs) &&
    (row.reason === undefined || typeof row.reason === "string")
  );
}

/** Sole durable stop store. Atomic records and scoped CAS deletion, no in-memory authority. */
export function createTaskStopRepository(rootDir: string) {
  if (!rootDir.trim()) {
    throw new Error("Task stop storage root is required");
  }
  const root = path.resolve(rootDir);
  const fileFor = (scope: TaskStopScope, taskId: string) =>
    path.join(root, keyFor(scope, taskId) + ".json");
  const read = (scope: TaskStopScope, taskId: string): StoredStop | undefined => {
    let text: string;
    try {
      text = fs.readFileSync(fileFor(scope, taskId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    const row = JSON.parse(text) as Partial<StoredStop>;
    if (
      row.version !== 1 ||
      typeof row.token !== "string" ||
      !row.token ||
      row.key !== keyFor(scope, taskId) ||
      !validEntry(row.entry) ||
      keyFor(row.entry, row.entry.taskId) !== row.key
    ) {
      throw new Error("Task stop record is invalid");
    }
    return row as StoredStop;
  };
  const locked = <T>(scope: TaskStopScope, taskId: string, run: () => T) => {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    return withFileLockSync(fileFor(scope, taskId), SESSION_TASK_BOARD_LOCK_OPTIONS, run);
  };
  return {
    read,
    record(entry: TaskStopRecord) {
      if (!validEntry(entry)) {
        throw new Error("Task stop facts are invalid");
      }
      return locked(entry, entry.taskId, () => {
        const row: StoredStop = {
          version: 1,
          token: randomUUID(),
          key: keyFor(entry, entry.taskId),
          entry: { ...entry },
        };
        const file = fileFor(entry, entry.taskId);
        const temporary = file + "." + randomUUID() + ".tmp";
        try {
          fs.writeFileSync(temporary, JSON.stringify(row), { encoding: "utf8", mode: 0o600 });
          fs.renameSync(temporary, file);
        } catch (error) {
          try {
            fs.unlinkSync(temporary);
          } catch {
            // Preserve the original write failure if temporary cleanup also fails.
          }
          throw error;
        }
        return row;
      });
    },
    clear(scope: TaskStopScope, taskId: string, expected?: { token: string | null }) {
      return locked(scope, taskId, () => {
        const current = read(scope, taskId);
        if (!current || (expected && current.token !== expected.token)) {
          return false;
        }
        fs.unlinkSync(fileFor(scope, taskId));
        return true;
      });
    },
  };
}
