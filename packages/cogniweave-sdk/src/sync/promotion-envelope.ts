import { ATOM_IDENTITY_BOUNDARY_KEYS, stripAtomIdentityBoundary } from "../domain/atom-v2.js";
import type { MemoryAtom, MemoryAtomClaim, Scope } from "../models.js";

/**
 * CW2-P5-01 safe cloud promotion envelope — denylist of raw source content (plan §10.3).
 */

export const PROMOTION_CLAIM_STATEMENT_MAX_CHARS = 512;

export type CloudPromotionEnvelope = {
  envelopeVersion: 1;
  atomId: string;
  atomType: string;
  scope: Pick<Scope, "workspaceId" | "projectId" | "agentId" | "visibility">;
  claim: { type: MemoryAtomClaim["type"]; statement: string };
  trigger: { contextTags: string[]; conditionCount: number };
  metrics: { confidence: number };
  governance: { promotionScore?: number; scoreVersion?: 1 };
  provenance: { sourceEventIdCount: number };
  privacy: {
    privacyLevel: NonNullable<MemoryAtom["privacy"]>["privacyLevel"];
    syncEligibility: NonNullable<MemoryAtom["privacy"]>["syncEligibility"];
  };
  versioning: { version: number };
};

export const PROMOTION_ENVELOPE_DENYLIST = [
  "action",
  "provenance.evidenceRefs",
  "transcript",
  "document",
  "toolOutput",
  "credential",
  "snippet",
  ...ATOM_IDENTITY_BOUNDARY_KEYS,
] as const;

function sanitizeClaimStatement(statement: string): string {
  const trimmed = statement.trim().replace(/\s+/g, " ");
  if (trimmed.length <= PROMOTION_CLAIM_STATEMENT_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, PROMOTION_CLAIM_STATEMENT_MAX_CHARS - 1)}…`;
}

export function buildPromotionEnvelope(atom: MemoryAtom): CloudPromotionEnvelope {
  const sanitized = stripAtomIdentityBoundary(
    atom as MemoryAtom & Record<string, unknown>,
  ) as MemoryAtom;
  const privacy = sanitized.privacy ?? {
    privacyLevel: "private" as const,
    syncEligibility: "blocked" as const,
  };
  return {
    envelopeVersion: 1,
    atomId: sanitized.id,
    atomType: sanitized.atomType,
    scope: {
      workspaceId: sanitized.scope.workspaceId,
      projectId: sanitized.scope.projectId,
      agentId: sanitized.scope.agentId,
      visibility: sanitized.scope.visibility,
    },
    claim: {
      type: sanitized.claim.type,
      statement: sanitizeClaimStatement(sanitized.claim.statement),
    },
    trigger: {
      contextTags: [...sanitized.trigger.contextTags],
      conditionCount: sanitized.trigger.conditions.length,
    },
    metrics: { confidence: sanitized.metrics.confidence },
    governance: {
      promotionScore: sanitized.governance?.promotionScore,
      scoreVersion: sanitized.governance?.scoreVersion,
    },
    provenance: {
      sourceEventIdCount: sanitized.provenance.sourceEventIds.length,
    },
    privacy: {
      privacyLevel: privacy.privacyLevel,
      syncEligibility: privacy.syncEligibility,
    },
    versioning: { version: sanitized.versioning.version },
  };
}

/** Returns hygiene violation paths (empty = clean). */
export function assertPromotionEnvelopeHygiene(envelope: unknown): string[] {
  const violations: string[] = [];
  if (!envelope || typeof envelope !== "object") {
    return ["envelope"];
  }
  const row = envelope as Record<string, unknown>;
  for (const key of ATOM_IDENTITY_BOUNDARY_KEYS) {
    if (key in row && row[key] !== undefined) {
      violations.push(key);
    }
  }
  for (const forbidden of [
    "action",
    "transcript",
    "document",
    "toolOutput",
    "credential",
    "snippet",
    "evidenceRefs",
  ]) {
    if (forbidden in row && row[forbidden] !== undefined) {
      violations.push(forbidden);
    }
  }
  const provenance = row.provenance;
  if (provenance && typeof provenance === "object") {
    const prov = provenance as Record<string, unknown>;
    if ("evidenceRefs" in prov) {
      violations.push("provenance.evidenceRefs");
    }
    if (Array.isArray(prov.sourceEventIds)) {
      violations.push("provenance.sourceEventIds");
    }
  }
  const trigger = row.trigger;
  if (trigger && typeof trigger === "object") {
    const trig = trigger as Record<string, unknown>;
    if (Array.isArray(trig.conditions)) {
      violations.push("trigger.conditions");
    }
  }
  return violations;
}
