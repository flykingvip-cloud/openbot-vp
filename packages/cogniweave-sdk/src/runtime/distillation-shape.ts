import type { DistillationQuality, DistillationResult } from "../models.js";
import { isRecord, nonEmptyString } from "./json-values.js";

/**
 * Minimum shape shared by HTTP distillation responses and replay snapshots.
 * Nested objects are not rebuilt field-by-field. This is the single gate that
 * used to be copied, then forced through `as unknown as DistillationResult`.
 */
function isDistillationResultShape(value: unknown): value is DistillationResult {
  if (!isRecord(value)) {
    return false;
  }
  if (!isRecord(value.event) || !isRecord(value.keys) || !isRecord(value.writePlan)) {
    return false;
  }
  if (
    !Array.isArray(value.atoms) ||
    !Array.isArray(value.entities) ||
    !Array.isArray(value.scenarios) ||
    !Array.isArray(value.problems) ||
    !Array.isArray(value.relations) ||
    !Array.isArray(value.evidence)
  ) {
    return false;
  }
  return (
    typeof value.event.id === "string" &&
    typeof value.keys.eventKey === "string" &&
    Array.isArray(value.writePlan.graphNodeIds) &&
    Array.isArray(value.writePlan.vectorDocumentIds)
  );
}

export function readDistillationResult(raw: unknown): DistillationResult | null {
  const payload = isRecord(raw) && isRecord(raw.distillationResult) ? raw.distillationResult : raw;
  return isDistillationResultShape(payload) ? payload : null;
}

function preferString(
  current: string | undefined,
  incoming: string | undefined,
): string | undefined {
  return nonEmptyString(incoming) ? incoming : current;
}

function preferList<T>(current: T[], incoming: T[]): T[] {
  return incoming.length > 0 ? incoming : current;
}

/**
 * Filled-field merge shared by multi-call HTTP distillation and replay snapshots.
 * Callers pass `quality` because the two sites score stage decisions differently.
 */
export function mergePreferFilledDistillation(
  current: DistillationResult,
  incoming: DistillationResult,
  quality: DistillationQuality,
): DistillationResult {
  return {
    ...current,
    ...incoming,
    event: {
      ...current.event,
      ...incoming.event,
      goal: preferString(current.event.goal, incoming.event.goal) ?? current.event.goal,
      context: preferString(current.event.context, incoming.event.context) ?? current.event.context,
      constraints: preferList(current.event.constraints, incoming.event.constraints),
      decisions: preferList(current.event.decisions, incoming.event.decisions),
      turningPoints: preferList(current.event.turningPoints, incoming.event.turningPoints),
      outcome: preferString(current.event.outcome, incoming.event.outcome),
      linkedAtoms: preferList(current.event.linkedAtoms, incoming.event.linkedAtoms),
      evidenceRefs: preferList(current.event.evidenceRefs, incoming.event.evidenceRefs),
      eventKey: preferString(current.event.eventKey, incoming.event.eventKey),
    },
    atoms: preferList(current.atoms, incoming.atoms),
    entities: preferList(current.entities, incoming.entities),
    scenarios: preferList(current.scenarios, incoming.scenarios),
    problems: preferList(current.problems, incoming.problems),
    relations: preferList(current.relations, incoming.relations),
    evidence: preferList(current.evidence, incoming.evidence),
    keys: {
      ingestionChecksum:
        preferString(current.keys.ingestionChecksum, incoming.keys.ingestionChecksum) ??
        current.keys.ingestionChecksum,
      eventKey:
        preferString(current.keys.eventKey, incoming.keys.eventKey) ?? current.keys.eventKey,
      atomDedupKeys: preferList(current.keys.atomDedupKeys, incoming.keys.atomDedupKeys),
      entityKeys: preferList(current.keys.entityKeys, incoming.keys.entityKeys),
      scenarioKeys: preferList(current.keys.scenarioKeys, incoming.keys.scenarioKeys),
      problemKeys: preferList(current.keys.problemKeys, incoming.keys.problemKeys),
    },
    writePlan: {
      canonicalObjectTypes: preferList(
        current.writePlan.canonicalObjectTypes,
        incoming.writePlan.canonicalObjectTypes,
      ),
      relationIds: preferList(current.writePlan.relationIds, incoming.writePlan.relationIds),
      graphNodeIds: preferList(current.writePlan.graphNodeIds, incoming.writePlan.graphNodeIds),
      graphEdgeIds: preferList(current.writePlan.graphEdgeIds, incoming.writePlan.graphEdgeIds),
      vectorDocumentIds: preferList(
        current.writePlan.vectorDocumentIds,
        incoming.writePlan.vectorDocumentIds,
      ),
    },
    quality,
  };
}
