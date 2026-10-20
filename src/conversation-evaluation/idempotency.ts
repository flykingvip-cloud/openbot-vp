import { createEvaluationEventId, ruleVersionRank } from "./identity.js";
import type { ConversationEvaluationRecord } from "./types.js";
import { isTerminalAssessment } from "./types.js";

export type AdmitResult =
  | { action: "append"; record: ConversationEvaluationRecord }
  | { action: "skip"; reason: "pending_over_terminal" | "older_rule_version" | "conflict_lost" };

type Slot = {
  rank: number;
  current: ConversationEvaluationRecord;
  history: ConversationEvaluationRecord[];
};

function stampTime(record: ConversationEvaluationRecord): number {
  const raw = record.assessedAt ?? record.endedAt ?? record.observedAt;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dominates(
  incoming: ConversationEvaluationRecord,
  current: ConversationEvaluationRecord,
): boolean {
  const incomingTime = stampTime(incoming);
  const currentTime = stampTime(current);
  if (incomingTime > currentTime && incoming.evidenceRefs.length >= current.evidenceRefs.length) {
    return true;
  }
  return incomingTime === currentTime && incoming.evidenceRefs.length > current.evidenceRefs.length;
}

/**
 * Key = runId + ruleVersion.
 * Pending does not replace a terminal. Older ruleVersion does not replace a newer one.
 * Reassess appends a new history line. Same-version conflicts keep the newer, more complete row.
 */
export class EvaluationIdempotency {
  private readonly runs = new Map<string, Map<string, Slot>>();

  private slotsFor(runId: string): Map<string, Slot> {
    let slots = this.runs.get(runId);
    if (!slots) {
      slots = new Map();
      this.runs.set(runId, slots);
    }
    return slots;
  }

  private newest(slots: Map<string, Slot>): Slot | null {
    let best: Slot | null = null;
    for (const slot of slots.values()) {
      if (!best || slot.rank > best.rank) {
        best = slot;
      }
    }
    return best;
  }

  current(runId: string): ConversationEvaluationRecord | null {
    const slots = this.runs.get(runId);
    if (!slots) {
      return null;
    }
    return this.newest(slots)?.current ?? null;
  }

  history(runId: string): ConversationEvaluationRecord[] {
    const slots = this.runs.get(runId);
    if (!slots) {
      return [];
    }
    const ranked = [...slots.values()].toSorted((a, b) => a.rank - b.rank);
    return ranked.flatMap((slot) => slot.history);
  }

  /** Replay persisted lines. Does not mint new rows. */
  adoptPersisted(record: ConversationEvaluationRecord): void {
    const slots = this.slotsFor(record.runId);
    const rank = ruleVersionRank(record.ruleVersion);
    const slot = slots.get(record.ruleVersion);
    if (!slot) {
      slots.set(record.ruleVersion, { rank, current: record, history: [record] });
      return;
    }
    const current = slot.current;
    const reassess = record.recordKind === "reassess";
    const incomingTerminal = isTerminalAssessment(record.assessmentStatus);
    const currentTerminal = isTerminalAssessment(current.assessmentStatus);
    if (!reassess && !incomingTerminal && currentTerminal) {
      return;
    }
    if (!reassess && incomingTerminal && currentTerminal && !dominates(record, current)) {
      slot.current = record.conflictFlag ? record : { ...current, conflictFlag: true };
      if (record.conflictFlag) {
        slot.history.push(record);
      }
      return;
    }
    const next =
      reassess && !record.supersedesEventId
        ? { ...record, supersedesEventId: current.eventId }
        : record;
    slot.current = next;
    slot.history.push(next);
  }

  /** Read-only decision. Call adoptPersisted on an append result after the write succeeds. */
  plan(record: ConversationEvaluationRecord): AdmitResult {
    const slots = this.runs.get(record.runId);
    const rank = ruleVersionRank(record.ruleVersion);
    const newest = slots ? this.newest(slots) : null;
    const reassess = record.recordKind === "reassess";
    if (!reassess && newest && rank < newest.rank) {
      return { action: "skip", reason: "older_rule_version" };
    }
    const slot = slots?.get(record.ruleVersion);
    if (!slot) {
      return { action: "append", record };
    }
    const current = slot.current;
    const incomingTerminal = isTerminalAssessment(record.assessmentStatus);
    const currentTerminal = isTerminalAssessment(current.assessmentStatus);
    if (!reassess && !incomingTerminal && currentTerminal) {
      return { action: "skip", reason: "pending_over_terminal" };
    }
    if (!reassess && incomingTerminal && currentTerminal) {
      if (!dominates(record, current)) {
        if (current.conflictFlag) {
          return { action: "skip", reason: "conflict_lost" };
        }
        return {
          action: "append",
          record: {
            ...current,
            eventId: createEvaluationEventId(),
            conflictFlag: true,
            supersedesEventId: current.eventId,
            observedAt: record.observedAt,
          },
        };
      }
      return {
        action: "append",
        record: {
          ...record,
          conflictFlag: true,
          supersedesEventId: current.eventId,
        },
      };
    }
    const next =
      reassess && !record.supersedesEventId
        ? { ...record, supersedesEventId: current.eventId }
        : record;
    return { action: "append", record: next };
  }

  admit(record: ConversationEvaluationRecord): AdmitResult {
    const planned = this.plan(record);
    if (planned.action === "append") {
      this.adoptPersisted(planned.record);
    }
    return planned;
  }
}

export function foldEvaluationRecords(
  lines: ConversationEvaluationRecord[],
): ConversationEvaluationRecord | null {
  if (lines.length === 0) {
    return null;
  }
  const index = new EvaluationIdempotency();
  for (const line of lines) {
    index.adoptPersisted(line);
  }
  return index.current(lines[0]?.runId ?? "");
}
