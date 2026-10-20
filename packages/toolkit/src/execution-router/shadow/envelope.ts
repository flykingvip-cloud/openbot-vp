import { isForbiddenObservationKey } from "../privacy.js";
import { isDigest16 } from "./digest.js";
import {
  TASK_CLASSES,
  TASK_ENVELOPE_SCHEMA,
  type ChannelKind,
  type RiskClass,
  type ShadowTaskEnvelope,
  type TaskClass,
} from "./types.js";

const RISK = new Set<RiskClass>(["read_only", "side_effect", "unknown"]);
const CHANNEL = new Set<ChannelKind>(["internal", "external", "unknown"]);
const ALLOWED_KEYS = new Set([
  "schema",
  "taskClass",
  "riskClass",
  "channelKind",
  "textDigest",
  "tagDigests",
  "requiredSkillDigests",
  "requiredToolDigests",
]);
const OPTIONAL_LISTS = ["tagDigests", "requiredSkillDigests", "requiredToolDigests"] as const;
const LIST_LIMITS = {
  tagDigests: 16,
  requiredSkillDigests: 32,
  requiredToolDigests: 32,
} as const;

function rejectSensitiveKeys(value: unknown, seen: WeakSet<object>): void {
  if (value == null || typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      rejectSensitiveKeys(item, seen);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      isForbiddenObservationKey(key) ||
      key === "name" ||
      key === "skillName" ||
      key === "toolName"
    ) {
      throw new Error(`envelope sensitive field rejected: ${key}`);
    }
    rejectSensitiveKeys(child, seen);
  }
}

function parseDigestList(key: (typeof OPTIONAL_LISTS)[number], list: unknown): string[] {
  if (!Array.isArray(list)) {
    throw new Error(`envelope ${key} invalid`);
  }
  if (list.length > LIST_LIMITS[key]) {
    throw new Error(`envelope ${key} too long`);
  }
  if (list.some((item) => typeof item !== "string" || !isDigest16(item))) {
    throw new Error(`envelope ${key} invalid`);
  }
  return list as string[];
}

export function parseShadowTaskEnvelope(value: unknown): ShadowTaskEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("envelope must be an object");
  }
  rejectSensitiveKeys(value, new WeakSet<object>());
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`envelope unknown field: ${key}`);
    }
  }
  if (row.schema !== TASK_ENVELOPE_SCHEMA) {
    throw new Error("envelope schema mismatch");
  }
  if (!TASK_CLASSES.includes(row.taskClass as TaskClass)) {
    throw new Error("envelope taskClass invalid");
  }
  if (typeof row.riskClass !== "string" || !RISK.has(row.riskClass as RiskClass)) {
    throw new Error("envelope riskClass invalid");
  }
  if (typeof row.channelKind !== "string" || !CHANNEL.has(row.channelKind as ChannelKind)) {
    throw new Error("envelope channelKind invalid");
  }
  if (typeof row.textDigest !== "string" || !isDigest16(row.textDigest)) {
    throw new Error("envelope textDigest invalid");
  }
  const parsed: ShadowTaskEnvelope = {
    schema: TASK_ENVELOPE_SCHEMA,
    taskClass: row.taskClass as TaskClass,
    riskClass: row.riskClass as RiskClass,
    channelKind: row.channelKind as ChannelKind,
    textDigest: row.textDigest,
  };
  for (const key of OPTIONAL_LISTS) {
    if (row[key] === undefined) {
      continue;
    }
    parsed[key] = parseDigestList(key, row[key]);
  }
  return parsed;
}

export function isEmptyEnvelope(envelope: ShadowTaskEnvelope): boolean {
  return envelope.taskClass === "unknown" && envelope.riskClass === "unknown";
}
