import type { KnowledgeLineageRecord } from "../knowledge-lineage-store.js";

/** A downstream deliverable that consumed this deliverable's archived knowledge. */
export type DownstreamDeliverableLink = {
  deliverableId: string;
  agentId: string | null;
  atMs?: number;
};

/**
 * Pure resolver for the downstream 成果↔成果 edges of the Work Memory Network.
 *
 * Input is the *generation* lineage rows that consumed this deliverable's archive KB
 * (from `listGenerationLineageForKnowledgeBase(kbD)`) — i.e. later agent runs that
 * retrieved from the knowledge this deliverable was archived into. Generation rows carry
 * no `deliverableId` (they predate the deliverable being created), so the deliverable a
 * downstream run eventually produced is resolved via the `commit`-kind sibling sharing the
 * same `lineageId` — that commit row is written at archive time and does carry the
 * `deliverableId` (see `writeCommitLineage`).
 *
 * Kept DB-free (the commit lookup is injected) so the dedupe / self-exclusion / ordering
 * logic is unit-testable independently of sqlite. A downstream generation that was never
 * archived has no committed deliverable and is skipped — we only surface materialized
 * 成果↔成果 links, not un-archived consumption.
 */
export function resolveDownstreamDeliverableLinks(params: {
  currentDeliverableId: string;
  downstreamGenerations: KnowledgeLineageRecord[];
  resolveCommittedDeliverable: (
    lineageId: string,
  ) => { deliverableId: string; agentId: string | null; atMs?: number } | null;
}): DownstreamDeliverableLink[] {
  const current = params.currentDeliverableId.trim();
  const seen = new Set<string>();
  const links: DownstreamDeliverableLink[] = [];
  for (const generation of params.downstreamGenerations) {
    const committed = params.resolveCommittedDeliverable(generation.lineageId);
    const deliverableId = committed?.deliverableId.trim();
    if (!deliverableId || deliverableId === current || seen.has(deliverableId)) {
      continue;
    }
    seen.add(deliverableId);
    links.push({
      deliverableId,
      agentId: committed?.agentId ?? generation.agentId ?? null,
      atMs: committed?.atMs ?? generation.updatedAt,
    });
  }
  return links.toSorted((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0));
}
