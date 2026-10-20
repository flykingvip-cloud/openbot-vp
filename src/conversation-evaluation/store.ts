import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeRunFileName, tenantHash16 } from "./identity.js";
import type { ConversationEvaluationRecord } from "./types.js";

export const CONVERSATION_EVALUATIONS_DIR = "conversation-evaluations";

const FORBIDDEN_DIR_NAMES = new Set([
  "diagnosis-schedules",
  "diagnosis-projections",
  "diagnosis-evolution-prescriptions",
]);

export function assertEvaluationPathAllowed(filePath: string): void {
  const parts = filePath.split(/[/\\]/);
  for (const part of parts) {
    if (FORBIDDEN_DIR_NAMES.has(part)) {
      throw new Error(`conversation evaluation refused path segment ${part}`);
    }
  }
}

export function evaluationFilePath(input: {
  configDir: string;
  tenantId: string;
  runId: string;
  at: Date;
}): string {
  const yyyy = String(input.at.getUTCFullYear());
  const mm = String(input.at.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(input.at.getUTCDate()).padStart(2, "0");
  const filePath = path.join(
    input.configDir,
    CONVERSATION_EVALUATIONS_DIR,
    tenantHash16(input.tenantId),
    yyyy,
    mm,
    dd,
    `${safeRunFileName(input.runId)}.jsonl`,
  );
  assertEvaluationPathAllowed(filePath);
  return filePath;
}

export function denominatorFilePath(configDir: string, tenantId: string): string {
  const filePath = path.join(
    configDir,
    CONVERSATION_EVALUATIONS_DIR,
    tenantHash16(tenantId),
    "lifecycle-denominator.jsonl",
  );
  assertEvaluationPathAllowed(filePath);
  return filePath;
}

export function trustedTenantMatches(recordTenantId: string, trustedTenantId: string): boolean {
  return recordTenantId.trim().toLowerCase() === trustedTenantId.trim().toLowerCase();
}

export async function appendJsonlLine(filePath: string, line: string): Promise<void> {
  assertEvaluationPathAllowed(filePath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.appendFile(filePath, line, "utf8");
}

export function readJsonlObjects<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const rows: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    rows.push(JSON.parse(line) as T);
  }
  return rows;
}

export function serializeRecord(record: ConversationEvaluationRecord): string {
  return `${JSON.stringify(record)}\n`;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("evaluation_write_timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export function fnvByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function hashTenantForTest(tenantId: string): string {
  return createHash("sha256").update(tenantId).digest("hex").slice(0, 16);
}
