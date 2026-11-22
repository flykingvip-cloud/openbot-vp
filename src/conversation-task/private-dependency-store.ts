/** Durable private bot delegation records. Not group membership or shared context. */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DependencyResolution } from "../agent-runtime/policy/dependency-resolution.js";
import { withDirectoryLock, writeJsonDurable } from "../agent-runtime/state/durable-json.js";
import { resolveStateDir } from "../config/paths.js";
export type PrivateDependency = {
  id: string;
  capability: string;
  ownerId: string;
  tenantId: string;
  parent: {
    sessionKey: string;
    sessionFile: string;
    taskId: string;
    executionAttempt: string;
    focusRevision: number;
  };
  child: { agentId: string; sessionKey: string; runId: string };
  successCriteria: string;
  createdAtMs: number;
  deadlineAtMs: number;
  state: "dispatching" | "waiting" | "partial" | "completed" | "failed" | "timed_out";
  eventSeq?: number;
  resolution?: DependencyResolution;
  wakeState: "none" | "pending" | "sending" | "accepted" | "invalidated" | "needs_user";
  wakeLeaseUntilMs?: number;
  wakeAttempts?: number;
  wakeRunId: string;
  reason?: string;
};
export function privateDependencyRoot(): string {
  return path.join(resolveStateDir(), "private-dependencies");
}
function fileFor(root: string, id: string) {
  if (!/^[a-f0-9]{40}$/.test(id)) {
    throw new Error("invalid_dependency_id");
  }
  return path.join(root, `${id}.json`);
}
export function readPrivateDependency(
  id: string,
  root = privateDependencyRoot(),
): PrivateDependency | null {
  try {
    return JSON.parse(fs.readFileSync(fileFor(root, id), "utf8")) as PrivateDependency;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
export function listPrivateDependencies(root = privateDependencyRoot()): PrivateDependency[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root)
    .filter((name) => /^[a-f0-9]{40}\.json$/.test(name))
    .map((name) => readPrivateDependency(name.slice(0, -5), root))
    .filter((row): row is PrivateDependency => row !== null);
}
export async function updatePrivateDependency(
  id: string,
  update: (row: PrivateDependency) => PrivateDependency,
  root = privateDependencyRoot(),
): Promise<PrivateDependency | null> {
  return withDirectoryLock(root, id, async () => {
    const row = readPrivateDependency(id, root);
    if (!row) {
      return null;
    }
    const next = update(row);
    await writeJsonDurable(fileFor(root, id), next);
    return next;
  });
}
export async function reservePrivateDependency(
  input: Omit<
    PrivateDependency,
    "id" | "capability" | "createdAtMs" | "wakeRunId" | "state" | "wakeState"
  > & { toolCallId: string },
  root = privateDependencyRoot(),
): Promise<{ row: PrivateDependency; created: boolean }> {
  const id = createHash("sha256")
    .update(
      JSON.stringify([
        input.tenantId,
        input.ownerId,
        input.parent.sessionKey,
        input.parent.taskId,
        input.parent.executionAttempt,
        input.toolCallId,
      ]),
    )
    .digest("hex")
    .slice(0, 40);
  return withDirectoryLock(root, id, async () => {
    const previous = readPrivateDependency(id, root);
    if (previous) {
      return { row: previous, created: false };
    }
    const { toolCallId: _toolCallId, ...fields } = input;
    const row: PrivateDependency = {
      ...fields,
      id,
      capability: randomBytes(32).toString("hex"),
      createdAtMs: Date.now(),
      child: { ...input.child, runId: `dependency-child-${id}` },
      wakeRunId: `dependency-wake-${id}`,
      state: "dispatching",
      wakeState: "none",
    };
    await writeJsonDurable(fileFor(root, id), row);
    return { row, created: true };
  });
}
