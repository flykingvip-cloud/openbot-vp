/**
 * Durable parent/child execution handoff (v4.1 §9 gate 3).
 *
 * This is the existing spawn-snapshot handoff domain, persisted. It is not an
 * approval center. Restart resumes a live record or marks it failed. A missing
 * record is a failure, never an allow.
 */

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomicSync } from "../../infra/json-files.js";
import { CONFIG_DIR } from "../../utils.js";

export const ACCOUNT_SPAWN_HANDOFF_DEFAULT_TTL_MS = 15 * 60 * 1000;

export const ACCOUNT_HANDOFF_STATES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type AccountHandoffState = (typeof ACCOUNT_HANDOFF_STATES)[number];

export type AccountSpawnHandoff = {
  handoffId: string;
  parentExecutionId: string;
  childExecutionId: string;
  decisionId: string;
  snapshotVersion: number;
  state: AccountHandoffState;
  expiresAt: string;
};

export type AccountHandoffWriteResult = {
  record: AccountSpawnHandoff;
  accepted: boolean;
};

export type AccountHandoffAdmitResult = {
  disposition: "resume" | "fail" | "already-completed";
  state: AccountHandoffState;
  record: AccountSpawnHandoff | null;
};

export type AccountHandoffRecoverResult = {
  resumed: AccountSpawnHandoff[];
  failed: AccountSpawnHandoff[];
};

type HandoffFile = {
  version: 1;
  records: Record<string, AccountSpawnHandoff>;
};

const TERMINAL: ReadonlySet<AccountHandoffState> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
]);

function emptyFile(): HandoffFile {
  return { version: 1, records: {} };
}

export function handoffAllowsExecution(result: AccountHandoffAdmitResult): boolean {
  return result.disposition === "resume";
}

/** Shared-gateway handoff file. Not copied into a worker and not a billing ledger. */
export function resolveAccountSpawnHandoffPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENBOT_ACCOUNT_SPAWN_HANDOFF?.trim();
  if (override) {
    return override;
  }
  return path.join(CONFIG_DIR, "account-spawn-handoff.json");
}

export class AccountSpawnHandoffStore {
  constructor(private readonly filePath: string) {}

  putPending(input: {
    handoffId: string;
    parentExecutionId: string;
    childExecutionId: string;
    decisionId: string;
    snapshotVersion: number;
    expiresAt: string;
  }): AccountHandoffWriteResult {
    const record = normalizePending(input);
    const file = this.read();
    const existing = file.records[record.handoffId];
    if (existing) {
      if (sameIdentity(existing, record)) {
        return { record: existing, accepted: true };
      }
      return { record: existing, accepted: false };
    }
    file.records[record.handoffId] = record;
    this.write(file);
    return { record, accepted: true };
  }

  markRunning(handoffId: string): AccountHandoffWriteResult | null {
    return this.transition(handoffId, "RUNNING", new Set(["PENDING", "RUNNING"]));
  }

  complete(handoffId: string): AccountHandoffWriteResult | null {
    return this.transition(handoffId, "COMPLETED", new Set(["RUNNING", "COMPLETED"]));
  }

  fail(handoffId: string): AccountHandoffWriteResult | null {
    return this.transition(handoffId, "FAILED", new Set(["PENDING", "RUNNING", "FAILED"]));
  }

  cancel(handoffId: string): AccountHandoffWriteResult | null {
    return this.transition(handoffId, "CANCELLED", new Set(["PENDING", "RUNNING", "CANCELLED"]));
  }

  recover(nowMs: number): AccountHandoffRecoverResult {
    const file = this.read();
    const resumed: AccountSpawnHandoff[] = [];
    const failed: AccountSpawnHandoff[] = [];
    let changed = false;
    for (const record of Object.values(file.records)) {
      if (!isOpen(record.state)) {
        if (record.state !== "COMPLETED") {
          failed.push(record);
        }
        continue;
      }
      if (isExpired(record, nowMs)) {
        record.state = "EXPIRED";
        changed = true;
        failed.push(record);
        continue;
      }
      resumed.push(record);
    }
    if (changed) {
      this.write(file);
    }
    return { resumed, failed };
  }

  /**
   * After a Gateway or Worker restart. Missing, expired, and terminal failures
   * do not allow execution. COMPLETED is idempotent and does not start again.
   */
  admit(handoffId: string, nowMs: number): AccountHandoffAdmitResult {
    const id = handoffId.trim();
    if (!id) {
      return { disposition: "fail", state: "FAILED", record: null };
    }
    const file = this.read();
    const record = file.records[id];
    if (!record) {
      return { disposition: "fail", state: "FAILED", record: null };
    }
    if (isOpen(record.state) && isExpired(record, nowMs)) {
      record.state = "EXPIRED";
      this.write(file);
      return { disposition: "fail", state: "EXPIRED", record };
    }
    if (record.state === "PENDING" || record.state === "RUNNING") {
      return { disposition: "resume", state: record.state, record };
    }
    if (record.state === "COMPLETED") {
      return { disposition: "already-completed", state: "COMPLETED", record };
    }
    return { disposition: "fail", state: record.state, record };
  }

  get(handoffId: string): AccountSpawnHandoff | null {
    return this.read().records[handoffId.trim()] ?? null;
  }

  private transition(
    handoffId: string,
    next: AccountHandoffState,
    from: ReadonlySet<AccountHandoffState>,
  ): AccountHandoffWriteResult | null {
    const id = handoffId.trim();
    if (!id) {
      return null;
    }
    const file = this.read();
    const existing = file.records[id];
    if (!existing) {
      return null;
    }
    if (existing.state === next) {
      return { record: existing, accepted: true };
    }
    if (!from.has(existing.state) || TERMINAL.has(existing.state)) {
      return { record: existing, accepted: false };
    }
    existing.state = next;
    this.write(file);
    return { record: existing, accepted: true };
  }

  private read(): HandoffFile {
    if (!fs.existsSync(this.filePath)) {
      return emptyFile();
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`spawn handoff store is unreadable: ${this.filePath}`);
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as HandoffFile).version !== 1 ||
      typeof (parsed as HandoffFile).records !== "object" ||
      (parsed as HandoffFile).records === null
    ) {
      throw new Error(`spawn handoff store is unreadable: ${this.filePath}`);
    }
    return parsed as HandoffFile;
  }

  private write(file: HandoffFile): void {
    writeJsonAtomicSync(this.filePath, file);
  }
}

function isOpen(state: AccountHandoffState): boolean {
  return state === "PENDING" || state === "RUNNING";
}

function isExpired(record: AccountSpawnHandoff, nowMs: number): boolean {
  const expiresAt = Date.parse(record.expiresAt);
  return !Number.isFinite(expiresAt) || nowMs >= expiresAt;
}

function sameIdentity(left: AccountSpawnHandoff, right: AccountSpawnHandoff): boolean {
  return (
    left.parentExecutionId === right.parentExecutionId &&
    left.childExecutionId === right.childExecutionId &&
    left.decisionId === right.decisionId &&
    left.snapshotVersion === right.snapshotVersion
  );
}

function normalizePending(input: {
  handoffId: string;
  parentExecutionId: string;
  childExecutionId: string;
  decisionId: string;
  snapshotVersion: number;
  expiresAt: string;
}): AccountSpawnHandoff {
  const handoffId = input.handoffId.trim();
  const parentExecutionId = input.parentExecutionId.trim();
  const childExecutionId = input.childExecutionId.trim();
  const decisionId = input.decisionId.trim();
  const expiresAt = input.expiresAt.trim();
  if (!handoffId || !parentExecutionId || !childExecutionId) {
    throw new Error("handoff execution ids are required");
  }
  if (!decisionId.startsWith("gd-") || decisionId.length <= "gd-".length) {
    throw new Error("handoff decisionId must be a gd- governance decision id");
  }
  if (!Number.isInteger(input.snapshotVersion) || input.snapshotVersion < 1) {
    throw new Error("handoff snapshotVersion must be a positive integer");
  }
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("handoff expiresAt must be a timestamp");
  }
  return {
    handoffId,
    parentExecutionId,
    childExecutionId,
    decisionId,
    snapshotVersion: input.snapshotVersion,
    state: "PENDING",
    expiresAt,
  };
}
