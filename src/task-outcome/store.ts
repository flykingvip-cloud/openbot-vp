import fs from "node:fs";
import path from "node:path";
import type { OutcomeOutboxEvent, TaskOutcomeRecord } from "./types.js";

export type TaskOutcomeStorePaths = {
  rootDir: string;
};

function tasksDir(root: string): string {
  return path.join(root, "tasks");
}
function outboxDir(root: string): string {
  return path.join(root, "outbox");
}
function consumerDir(root: string): string {
  return path.join(root, "consumers");
}
function contribDir(root: string): string {
  return path.join(root, "contributions");
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function readJson<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export class DurableTaskOutcomeStore {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    fs.mkdirSync(tasksDir(rootDir), { recursive: true });
    fs.mkdirSync(outboxDir(rootDir), { recursive: true });
    fs.mkdirSync(consumerDir(rootDir), { recursive: true });
    fs.mkdirSync(contribDir(rootDir), { recursive: true });
  }

  /** Close handles conceptually — reopen by constructing a new store on same root. */
  close(): void {
    // File-backed; nothing to flush beyond fsync already done in rename.
  }

  taskPath(taskId: string): string {
    return path.join(tasksDir(this.rootDir), `${encodeURIComponent(taskId)}.json`);
  }

  loadTask(taskId: string): TaskOutcomeRecord | undefined {
    return readJson<TaskOutcomeRecord>(this.taskPath(taskId));
  }

  saveTask(record: TaskOutcomeRecord): void {
    atomicWriteJson(this.taskPath(record.taskId), record);
  }

  listTaskIds(): string[] {
    return fs
      .readdirSync(tasksDir(this.rootDir))
      .filter((n) => n.endsWith(".json"))
      .map((n) => decodeURIComponent(n.replace(/\.json$/, "")));
  }

  appendOutbox(event: OutcomeOutboxEvent): void {
    const file = path.join(outboxDir(this.rootDir), `${event.eventId}.json`);
    atomicWriteJson(file, { ...event, processingStatus: "pending", attempts: 0 });
  }

  listPendingOutbox(): Array<OutcomeOutboxEvent & { processingStatus: string; attempts: number }> {
    return fs
      .readdirSync(outboxDir(this.rootDir))
      .filter((n) => n.endsWith(".json"))
      .map(
        (n) =>
          readJson<OutcomeOutboxEvent & { processingStatus: string; attempts: number }>(
            path.join(outboxDir(this.rootDir), n),
          )!,
      )
      .filter((e) => e && e.processingStatus === "pending")
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  markOutboxDone(eventId: string): void {
    const file = path.join(outboxDir(this.rootDir), `${eventId}.json`);
    const cur = readJson<Record<string, unknown>>(file);
    if (!cur) {
      return;
    }
    atomicWriteJson(file, { ...cur, processingStatus: "done" });
  }

  consumerKey(consumerId: string, eventId: string): string {
    return path.join(
      consumerDir(this.rootDir),
      `${encodeURIComponent(consumerId)}__${encodeURIComponent(eventId)}.json`,
    );
  }

  hasConsumed(consumerId: string, eventId: string): boolean {
    return fs.existsSync(this.consumerKey(consumerId, eventId));
  }

  markConsumed(consumerId: string, eventId: string, meta: Record<string, unknown>): void {
    atomicWriteJson(this.consumerKey(consumerId, eventId), {
      consumerId,
      eventId,
      ...meta,
      consumedAt: new Date().toISOString(),
    });
  }

  contributionPath(scopeId: string, taskId: string): string {
    return path.join(
      contribDir(this.rootDir),
      `${encodeURIComponent(scopeId)}__${encodeURIComponent(taskId)}.json`,
    );
  }

  loadContribution(
    scopeId: string,
    taskId: string,
  ):
    | {
        outcomeVersion: number;
        judgement: string;
        eligibilityAttribution: string;
      }
    | undefined {
    return readJson(this.contributionPath(scopeId, taskId));
  }

  saveContribution(
    scopeId: string,
    taskId: string,
    value: { outcomeVersion: number; judgement: string; eligibilityAttribution: string },
  ): void {
    atomicWriteJson(this.contributionPath(scopeId, taskId), value);
  }
}
