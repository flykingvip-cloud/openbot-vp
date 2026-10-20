import type { MemoryAtom, Scope } from "../../packages/cogniweave-sdk/src/index.js";

/**
 * CW2-P6 Memory Center atom row — safe for UI / data.memory.list.
 * Must not include provenance, journal, embeddings, evidence refs, or store paths.
 */
export type MemoryCenterAtomRow = {
  id: string;
  summary: string;
  atomType: string;
  whyHint?: string;
  scope: {
    kind: "agent" | "space" | "group";
    visibility: "private" | "shared";
    agentId?: string;
    spaceId?: string;
    groupKey?: string;
  };
  botId: string;
  privacyLevel?: "private" | "shared" | "org" | "public";
  syncEligible: boolean;
  shared: boolean;
  status: string;
  updatedAtMs: number;
  confidence?: number;
};

function parseIsoMs(value?: string): number {
  if (!value?.trim()) {
    return 0;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function parseMemoryCenterScopeKind(scope: Scope): MemoryCenterAtomRow["scope"] {
  const visibility = scope.visibility === "shared" ? "shared" : "private";
  const projectId = scope.projectId?.trim() ?? "";
  if (projectId.startsWith("space:")) {
    return {
      kind: "space",
      visibility,
      spaceId: projectId.slice("space:".length) || undefined,
      agentId: scope.agentId,
    };
  }
  if (projectId.startsWith("chat:")) {
    return {
      kind: "group",
      visibility,
      groupKey: projectId.slice("chat:".length) || undefined,
      agentId: scope.agentId,
    };
  }
  return {
    kind: "agent",
    visibility,
    agentId: scope.agentId,
  };
}

export function mapAtomToMemoryCenterRow(atom: MemoryAtom): MemoryCenterAtomRow {
  const scope = parseMemoryCenterScopeKind(atom.scope);
  const whyParts = [
    ...(atom.trigger?.conditions ?? []).slice(0, 2),
    ...(atom.applicability?.include ?? []).slice(0, 1),
  ]
    .map((part) => part.trim())
    .filter(Boolean);
  const privacyLevel = atom.privacy?.privacyLevel;
  const syncEligibility = atom.privacy?.syncEligibility;
  const updatedAtMs =
    parseIsoMs(atom.lifecycle?.lastRetrievedAt) || parseIsoMs(atom.lifecycle?.admittedAt) || 0;
  return {
    id: atom.id,
    summary: atom.claim?.statement?.trim() || atom.atomType || atom.id,
    atomType: atom.atomType,
    ...(whyParts.length > 0 ? { whyHint: whyParts.join(" · ") } : {}),
    scope,
    botId: atom.scope.agentId || "shared",
    ...(privacyLevel ? { privacyLevel } : {}),
    syncEligible: syncEligibility === "eligible" || syncEligibility === "promoted",
    shared: scope.visibility === "shared",
    status: atom.state?.status ?? "active",
    updatedAtMs,
    ...(typeof atom.metrics?.confidence === "number"
      ? { confidence: atom.metrics.confidence }
      : {}),
  };
}
