import { createHash, randomUUID } from "node:crypto";
import type { IngestInput } from "./contracts.js";
import type {
  EntityRecord,
  MemoryAtom,
  MemoryPartitionKeyV1,
  ProblemRecord,
  ScenarioRecord,
  Scope,
  SourceType,
} from "./models.js";

/** Independent of DB schemaVersion — bump only when op-key contract intentionally breaks. */
export const OPERATION_KEY_VERSION = "opk/1";

/** Partition key shape version; must not change for P3 ACL additions. */
export const PARTITION_KEY_VERSION = 1 as const;

/** Metadata keys allowed inside contentChecksum / writeOperationKey. */
export const STABLE_CHECKSUM_METADATA_KEYS = [
  "openbotPath",
  "openbotSessionKey",
  "openbotSource",
  "contentRevision",
] as const;

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function hashParts(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeToken(value)).filter(Boolean))].sort();
}

export function normalizeClaim(statement: string): string {
  return normalizeToken(statement);
}

export function normalizeTrigger(trigger: MemoryAtom["trigger"]): string[] {
  return normalizeList([...trigger.conditions, ...trigger.contextTags]);
}

export function serializeScope(scope: Scope): string {
  return stableSerialize(scope);
}

/**
 * Scope fingerprint for MemoryPartitionKeyV1 — trimmed Scope fields only,
 * stable ordered serialization. Must not include P3 MemorySubject fields.
 */
export function computeScopeFingerprint(scope: Scope): string {
  return hashParts([
    scope.workspaceId.trim(),
    scope.projectId.trim(),
    scope.agentId.trim(),
    scope.visibility.trim(),
  ]);
}

export function createMemoryPartitionKeyV1(
  dataPlaneId: string,
  scope: Scope,
): MemoryPartitionKeyV1 {
  return {
    partitionKeyVersion: PARTITION_KEY_VERSION,
    dataPlaneId: dataPlaneId.trim(),
    scopeFingerprint: computeScopeFingerprint(scope),
  };
}

/**
 * Whitelist metadata for contentChecksum. Drops syncReason, timestamps,
 * hostnames, request ids, and other non-content diagnostics.
 */
export function stableMetadataForChecksum(
  metadata?: Record<string, string>,
): Record<string, string> {
  if (!metadata) {
    return {};
  }
  const allowed = new Set<string>(STABLE_CHECKSUM_METADATA_KEYS);
  const out: Record<string, string> = {};
  for (const key of [...allowed].sort()) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

export function computeIngestionChecksum(
  rawInput: string | Record<string, unknown>,
  metadata?: Record<string, string>,
): string {
  return hashParts([
    stableSerialize(rawInput),
    stableSerialize(stableMetadataForChecksum(metadata)),
  ]);
}

export function resolveSourceLocatorForOperationKey(input: {
  sourceSessionId?: string;
  sourceTurnRange?: [number, number];
  metadata?: Record<string, string>;
}): string {
  const stable = stableMetadataForChecksum(input.metadata);
  if (stable.openbotPath) {
    return stable.openbotPath;
  }
  if (input.sourceSessionId?.trim()) {
    const range = input.sourceTurnRange
      ? `${input.sourceTurnRange[0]}-${input.sourceTurnRange[1]}`
      : "";
    return `session:${input.sourceSessionId.trim()}:${range}`;
  }
  return "";
}

export function computeWriteOperationKey(input: {
  partition: MemoryPartitionKeyV1;
  sourceType: SourceType;
  sourceLocator: string;
  contentChecksum: string;
  operationKeyVersion?: string;
}): string {
  return hashParts([
    input.operationKeyVersion ?? OPERATION_KEY_VERSION,
    String(input.partition.partitionKeyVersion),
    input.partition.dataPlaneId,
    input.partition.scopeFingerprint,
    input.sourceType,
    input.sourceLocator,
    input.contentChecksum,
  ]);
}

export function computeEventKey(input: IngestInput): string {
  const turnRange = input.sourceTurnRange
    ? `${input.sourceTurnRange[0]}-${input.sourceTurnRange[1]}`
    : "";
  const fingerprint = computeIngestionChecksum(input.rawInput, input.metadata);
  return hashParts([
    input.scope.workspaceId,
    input.scope.projectId,
    input.scope.agentId,
    input.sourceType,
    input.sourceSessionId ?? "",
    turnRange,
    fingerprint,
  ]);
}

export function computeDedupKey(atom: MemoryAtom): string {
  return hashParts([
    atom.atomType,
    normalizeClaim(atom.claim.statement),
    stableSerialize(normalizeTrigger(atom.trigger)),
    serializeScope(atom.scope),
  ]);
}

export function computeEntityKey(entity: EntityRecord): string {
  return hashParts([entity.entityType, normalizeToken(entity.name), serializeScope(entity.scope)]);
}

export function computeScenarioKey(scenario: ScenarioRecord): string {
  return hashParts([
    normalizeToken(scenario.name),
    stableSerialize(normalizeList(scenario.tags)),
    serializeScope(scenario.scope),
  ]);
}

export function computeProblemKey(problem: ProblemRecord): string {
  return hashParts([normalizeClaim(problem.normalizedStatement), serializeScope(problem.scope)]);
}

/** Generate a new durable dataPlaneId (UUID). */
export function createDataPlaneId(): string {
  return randomUUID();
}
