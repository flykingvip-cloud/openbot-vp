/**
 * Persist capability-gap events as real evidence records under the evolution-control root.
 * Evidence ids are referenced from proposals.sourceEvidenceRefs and grant.allowedEvidence.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { createDurableMap, resolveEvolutionControlRoot } from "./persistent-store.js";

export type CapabilityGapEvidenceRecord = {
  evidenceId: string;
  schemaVersion: 1;
  kind: "capability-gap";
  category: string;
  reason: string;
  detail: string | null;
  tenantId: string | null;
  agentId: string | null;
  sessionKey: string | null;
  runId: string | null;
  sourceKind: string;
  explicitMarker: boolean;
  createdAt: string;
};

const FILENAME = "capability-gap-evidence.json";

function storeFor(persistDir?: string): Map<string, CapabilityGapEvidenceRecord> {
  const root = resolveEvolutionControlRoot(persistDir);
  return createDurableMap<CapabilityGapEvidenceRecord>(path.join(root, FILENAME));
}

export function capabilityGapEvidenceId(parts: {
  tenantId?: string | null;
  category: string;
  reason: string;
  runId?: string | null;
  sessionKey?: string | null;
  nowMs?: number;
}): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        tenantId: parts.tenantId?.trim() || null,
        category: parts.category,
        reason: parts.reason,
        runId: parts.runId?.trim() || null,
        sessionKey: parts.sessionKey?.trim() || null,
        at: parts.nowMs ?? Date.now(),
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `evidence:capability-gap:${digest}`;
}

/** Persist one gap event as an evidence record; returns the evidence id. */
export function persistCapabilityGapEvidence(
  input: {
    category: string;
    reason: string;
    detail?: string | null;
    tenantId?: string | null;
    agentId?: string | null;
    sessionKey?: string | null;
    runId?: string | null;
    sourceKind?: string;
    explicitMarker?: boolean;
    nowMs?: number;
  },
  persistDir?: string,
): CapabilityGapEvidenceRecord {
  const createdAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const evidenceId = capabilityGapEvidenceId({
    tenantId: input.tenantId,
    category: input.category,
    reason: input.reason,
    runId: input.runId,
    sessionKey: input.sessionKey,
    nowMs: input.nowMs,
  });
  const record: CapabilityGapEvidenceRecord = {
    evidenceId,
    schemaVersion: 1,
    kind: "capability-gap",
    category: input.category,
    reason: input.reason,
    detail: input.detail?.trim() || null,
    tenantId: input.tenantId?.trim() || null,
    agentId: input.agentId?.trim() || null,
    sessionKey: input.sessionKey?.trim() || null,
    runId: input.runId?.trim() || null,
    sourceKind: input.sourceKind ?? "other",
    explicitMarker: Boolean(input.explicitMarker),
    createdAt,
  };
  const store = storeFor(persistDir);
  store.set(evidenceId, record);
  return record;
}

export function getCapabilityGapEvidence(
  evidenceId: string,
  persistDir?: string,
): CapabilityGapEvidenceRecord | undefined {
  return storeFor(persistDir).get(evidenceId);
}

export function listCapabilityGapEvidence(persistDir?: string): CapabilityGapEvidenceRecord[] {
  return [...storeFor(persistDir).values()];
}
