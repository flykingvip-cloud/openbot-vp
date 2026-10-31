/**
 * Controlled discuss→formal-task: stable taskId mint.
 *
 * taskId = hash(version, tenantId, groupId, sourceMessageId, operationSlot)
 * Fields are canonically serialized (length-prefixed UTF-8), never joined with
 * a delimiter. Phase-1 uses a fixed operationSlot (one explicit task per message).
 * Model-generated intentFingerprint is intentionally excluded.
 */
import { createHash } from "node:crypto";

/** Bump only when the mint algorithm or field set changes. */
export const DISCUSS_TO_TASK_ID_VERSION = "d2t-v1";

/** Phase-1: one explicit formal task per authenticated inbound message. */
export const DISCUSS_TO_TASK_OPERATION_SLOT = "explicit_task:0";

const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Length-prefixed UTF-8 segments → unambiguous byte sequence (no delimiter join). */
export function canonicalSerializeFields(fields: readonly string[]): Buffer {
  const parts: Buffer[] = [];
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(bytes.length, 0);
    parts.push(len, bytes);
  }
  return Buffer.concat(parts);
}

export function mintDiscussToTaskId(params: {
  version?: string;
  tenantId: string;
  groupId: string;
  sourceMessageId: string;
  operationSlot?: string;
}): string {
  const version = (params.version ?? DISCUSS_TO_TASK_ID_VERSION).trim();
  const tenantId = params.tenantId.trim();
  const groupId = params.groupId.trim();
  const sourceMessageId = params.sourceMessageId.trim();
  const operationSlot = (params.operationSlot ?? DISCUSS_TO_TASK_OPERATION_SLOT).trim();
  if (!version || !tenantId || !groupId || !sourceMessageId || !operationSlot) {
    throw new Error("discuss_to_task_id_missing_fields");
  }
  const digest = createHash("sha256")
    .update(canonicalSerializeFields([version, tenantId, groupId, sourceMessageId, operationSlot]))
    .digest("hex")
    .slice(0, 24);
  const taskId = `d2t-${digest}`;
  if (!SAFE_TASK_ID.test(taskId)) {
    throw new Error("discuss_to_task_id_unsafe");
  }
  return taskId;
}

export function isSafeDiscussToTaskId(taskId: string): boolean {
  return SAFE_TASK_ID.test(taskId.trim());
}
