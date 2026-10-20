import { isDigest16 } from "./digest.ts";
import { TASK_CLASSES, type TaskEnvelope } from "./types.ts";

const RISK = new Set(["read_only", "side_effect", "unknown"]);
const CHANNEL = new Set(["internal", "external", "unknown"]);

export function parseTaskEnvelope(value: unknown): TaskEnvelope {
  if (!value || typeof value !== "object") {
    throw new Error("envelope must be an object");
  }
  const row = value as Record<string, unknown>;
  if (row.schema !== "openbot.execution-router.task-envelope.v1") {
    throw new Error("envelope schema mismatch");
  }
  if (!TASK_CLASSES.includes(row.taskClass as TaskEnvelope["taskClass"])) {
    throw new Error("envelope taskClass invalid");
  }
  if (typeof row.riskClass !== "string" || !RISK.has(row.riskClass)) {
    throw new Error("envelope riskClass invalid");
  }
  if (typeof row.channelKind !== "string" || !CHANNEL.has(row.channelKind)) {
    throw new Error("envelope channelKind invalid");
  }
  if (typeof row.textDigest !== "string" || !isDigest16(row.textDigest)) {
    throw new Error("envelope textDigest invalid");
  }
  const optionalLists = ["tagDigests", "requiredSkillDigests", "requiredToolDigests"] as const;
  for (const key of optionalLists) {
    const list = row[key];
    if (list === undefined) {
      continue;
    }
    if (
      !Array.isArray(list) ||
      list.some((item) => typeof item !== "string" || !isDigest16(item))
    ) {
      throw new Error(`envelope ${key} invalid`);
    }
  }
  return row as TaskEnvelope;
}
