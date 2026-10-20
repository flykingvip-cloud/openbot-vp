import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logEvolutionLoop } from "./evolution-loop-log.js";
import { resolveEvolutionControlRoot } from "./persistent-store.js";

export const EVOLUTION_OBSERVATIONS_FILENAME = "evolution-observations.jsonl";

export type EvolutionObservationAudit = {
  observationId: string;
  idempotencyKey: string;
  runId: string;
  agentId: string;
  tenantId: string;
  surfaceId: string;
  source: string;
  createdAt: string;
  attribution: {
    ownershipProof: string;
    source: string;
  };
};

const memoryIndex = new Map<string, Map<string, EvolutionObservationAudit>>();

function indexKey(persistDir: string | undefined): string {
  return resolveEvolutionObservationsPath(persistDir);
}

function getMemoryIndex(persistDir: string | undefined): Map<string, EvolutionObservationAudit> {
  const key = indexKey(persistDir);
  let index = memoryIndex.get(key);
  if (!index) {
    index = new Map();
    for (const row of readEvolutionObservationAudits(persistDir)) {
      index.set(row.idempotencyKey, row);
    }
    memoryIndex.set(key, index);
  }
  return index;
}

export function buildObservationIdempotencyKey(input: {
  runId: string;
  source: string;
  surfaceId: string;
  idempotencyKey?: string | null;
  inputStructureHash?: string | null;
  outputStructureHash?: string | null;
}): string {
  if (input.idempotencyKey?.trim()) {
    return input.idempotencyKey.trim();
  }
  const contentHash =
    input.inputStructureHash && input.outputStructureHash
      ? createHash("sha256")
          .update(`${input.inputStructureHash}|${input.outputStructureHash}`)
          .digest("hex")
          .slice(0, 16)
      : "";
  return `${input.runId}|${input.source}|${input.surfaceId}|${contentHash}`;
}

export function resolveEvolutionObservationsPath(persistDir?: string): string {
  return path.join(resolveEvolutionControlRoot(persistDir), EVOLUTION_OBSERVATIONS_FILENAME);
}

export function resetEvolutionObservationIndexForTests(): void {
  memoryIndex.clear();
}

export function writeEvolutionObservationAudit(input: {
  runId?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  surfaceId?: string | null;
  source: string;
  ownershipProof: string;
  attributionSource: string;
  persistDir?: string;
  now?: string;
  idempotencyKey?: string | null;
  inputStructureHash?: string | null;
  outputStructureHash?: string | null;
}): EvolutionObservationAudit | null {
  const runId = input.runId?.trim() || "";
  const agentId = input.agentId?.trim() || "";
  const tenantId = input.tenantId?.trim() || "";
  const surfaceId = input.surfaceId?.trim() || "pattern-detection.sample";
  if (!runId) {
    logEvolutionLoop("evolution.observation.unavailable", {
      runId: null,
      agentId,
      tenantId,
      surfaceId,
      reason: "missing_run_id",
    });
    return null;
  }
  if (!tenantId || !agentId) {
    logEvolutionLoop("evolution.observation.unavailable", {
      runId,
      agentId,
      tenantId,
      surfaceId,
      reason: !tenantId ? "missing_tenant" : "missing_agent",
    });
    return null;
  }
  const idempotencyKey = buildObservationIdempotencyKey({
    runId,
    source: input.source,
    surfaceId,
    idempotencyKey: input.idempotencyKey,
    inputStructureHash: input.inputStructureHash,
    outputStructureHash: input.outputStructureHash,
  });
  const index = getMemoryIndex(input.persistDir);
  const existing = index.get(idempotencyKey);
  if (existing) {
    logEvolutionLoop("evolution.observation.idempotent", {
      runId,
      agentId,
      tenantId,
      surfaceId,
      reason: input.attributionSource,
    });
    return existing;
  }
  const record: EvolutionObservationAudit = {
    observationId: `obs_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    idempotencyKey,
    runId,
    agentId,
    tenantId,
    surfaceId,
    source: input.source,
    createdAt: input.now ?? new Date().toISOString(),
    attribution: {
      ownershipProof: input.ownershipProof,
      source: input.attributionSource,
    },
  };
  const filePath = resolveEvolutionObservationsPath(input.persistDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  index.set(idempotencyKey, record);
  logEvolutionLoop("evolution.observation.created", {
    runId,
    agentId,
    tenantId,
    surfaceId,
    reason: input.attributionSource,
  });
  return record;
}

export function readEvolutionObservationAudits(persistDir?: string): EvolutionObservationAudit[] {
  const filePath = resolveEvolutionObservationsPath(persistDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const rows: EvolutionObservationAudit[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as EvolutionObservationAudit;
      if (parsed.runId && parsed.agentId && parsed.tenantId) {
        rows.push(parsed);
      }
    } catch {
      // skip corrupt lines
    }
  }
  return rows;
}
