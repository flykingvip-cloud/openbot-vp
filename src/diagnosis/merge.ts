/**
 * Case merger — deterministic mergeKey, never model-named.
 * Scene 4 forces tool timeout + agent failure + user retry into one Case.
 */
import type { DiagnosticCase, DiagnosticFinding, DiagnosticFindingDomain } from "./types.js";

export const SCENE4_MERGE_PREDICATES = [
  "tool.timeout",
  "agent.run.failed",
  "session.user_retry",
] as const;

export type MergeKeyInput = {
  tenantId: string | null;
  sessionKeyHash: string;
  fingerprint: string;
};

export function computeMergeKey(input: MergeKeyInput): string {
  if (!input.sessionKeyHash) {
    throw new Error("mergeKey requires sessionKeyHash");
  }
  if (!input.fingerprint) {
    throw new Error("mergeKey requires fingerprint");
  }
  return [input.tenantId ?? "null", input.sessionKeyHash, input.fingerprint].join("|");
}

export function findingFingerprint(input: {
  domain: DiagnosticFindingDomain;
  code: string;
  targetType: string;
  targetId: string;
}): string {
  return `${input.domain}|${input.code}|${input.targetType}:${input.targetId}`;
}

export function casesShareMergeKey(left: string, right: string): boolean {
  return left.length > 0 && left === right;
}

export function shouldOpenNewCase(input: {
  existingMergeKey: string;
  candidateMergeKey: string;
  sameSessionKeyHash: boolean;
}): boolean {
  if (casesShareMergeKey(input.existingMergeKey, input.candidateMergeKey)) {
    return false;
  }
  // Same session, different stable fingerprint → new Finding, not swallowed.
  return true;
}

export function hasScene4MergePredicates(predicates: readonly string[]): boolean {
  return SCENE4_MERGE_PREDICATES.every((predicate) => predicates.includes(predicate));
}

export function assertSingleOpenPrimaryFinding(findings: readonly DiagnosticFinding[]): void {
  const open = findings.filter((finding) => finding.status === "open");
  if (open.length !== 1) {
    throw new Error(`scene 4 requires exactly one open primary Finding, got ${open.length}`);
  }
}

export function mergeCaseRefs(
  existing: DiagnosticCase,
  incoming: Pick<DiagnosticCase, "diagnosticRunIds" | "findingIds" | "relationIds" | "timeline">,
): DiagnosticCase {
  return {
    ...existing,
    diagnosticRunIds: unique(existing.diagnosticRunIds, incoming.diagnosticRunIds),
    findingIds: unique(existing.findingIds, incoming.findingIds),
    relationIds: unique(existing.relationIds, incoming.relationIds),
    timeline: [...existing.timeline, ...incoming.timeline].toSorted((a, b) =>
      a.at.localeCompare(b.at),
    ),
  };
}

function unique(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])];
}
