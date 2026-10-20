/**
 * Chinese display text for the employee Decision Surface.
 *
 * Every function returns employee-readable Chinese built from the maps in
 * `copy.ts`. Raw contract values never pass through: unknown values get a
 * generic Chinese fallback.
 */

import {
  EVOLUTION_DECISION_ACTION_LABELS,
  EVOLUTION_DECISION_AUTHORITY_LABELS,
  EVOLUTION_DECISION_COPY,
  EVOLUTION_DECISION_DOMAIN_LABELS,
  EVOLUTION_DECISION_REASON_LABELS,
  EVOLUTION_DECISION_STATUS_LABELS,
  EVOLUTION_DECISION_SURFACE_LABELS,
  EVOLUTION_DECISION_TYPE_LABELS,
} from "./copy.ts";
import type {
  EvolutionEmployeeDecisionRow,
  EvolutionEmployeeDecisionStatusCounts,
  EvolutionEmployeeDecisionSubmitReceipt,
  EvolutionEmployeeDecisionTransition,
  EvolutionEmployeeEvidenceSummary,
  EvolutionEmployeeWeekOverWeekSummary,
} from "./types.ts";

const COPY = EVOLUTION_DECISION_COPY;

function labelFrom(map: Readonly<Record<string, string>>, key: string, fallback: string): string {
  return Object.hasOwn(map, key) ? (map[key] ?? fallback) : fallback;
}

export function evolutionDecisionActionLabel(action: string): string {
  return labelFrom(EVOLUTION_DECISION_ACTION_LABELS, action, COPY.fallbackAction);
}

export function evolutionDecisionReasonLabel(code: string): string {
  return labelFrom(EVOLUTION_DECISION_REASON_LABELS, code, COPY.fallbackReason);
}

export function evolutionDecisionTypeLabel(decisionType: string): string {
  return labelFrom(EVOLUTION_DECISION_TYPE_LABELS, decisionType, COPY.fallbackDecisionType);
}

export function evolutionDecisionAuthorityLabel(authority: string): string {
  return labelFrom(EVOLUTION_DECISION_AUTHORITY_LABELS, authority, COPY.fallbackAuthority);
}

export function evolutionDecisionStatusLabel(status: string): string {
  return labelFrom(EVOLUTION_DECISION_STATUS_LABELS, status, COPY.fallbackStatus);
}

export function evolutionDecisionTargetLabel(
  target: Pick<EvolutionEmployeeDecisionRow["impactTarget"], "domain" | "surfaceId">,
): string {
  const domain = labelFrom(EVOLUTION_DECISION_DOMAIN_LABELS, target.domain, COPY.fallbackDomain);
  const surface = labelFrom(
    EVOLUTION_DECISION_SURFACE_LABELS,
    target.surfaceId,
    COPY.fallbackSurface,
  );
  return `${domain} · ${surface}`;
}

const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

/**
 * Calendar date from the ISO prefix, as written, so the label does not shift
 * with the viewer's time zone (same rule as the Perception panel).
 */
export function formatEvolutionDecisionDate(value: string | null | undefined): string {
  const match = ISO_CALENDAR_DATE.exec((value ?? "").trim());
  if (!match) {
    return COPY.unknownDate;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function evolutionDecisionTimesText(
  row: Pick<EvolutionEmployeeDecisionRow, "createdAt" | "updatedAt" | "expiresAt">,
): string {
  const parts = [
    `${COPY.createdLabel} ${formatEvolutionDecisionDate(row.createdAt)}`,
    `${COPY.updatedLabel} ${formatEvolutionDecisionDate(row.updatedAt)}`,
  ];
  if (row.expiresAt) {
    parts.push(`${COPY.expiresLabel} ${formatEvolutionDecisionDate(row.expiresAt)}`);
  }
  return parts.join(" · ");
}

export function evolutionDecisionEvidenceText(evidence: EvolutionEmployeeEvidenceSummary): string {
  if (evidence.availability === "withheld") {
    return `${COPY.evidenceLabel}：${COPY.evidenceWithheld}`;
  }
  if (evidence.availability === "unavailable") {
    return `${COPY.evidenceLabel}：${COPY.evidenceRowUnavailable}`;
  }
  return `${COPY.evidenceLabel}：${evidence.citationCount} ${COPY.citationUnit} · ${
    evidence.findingCount
  } ${COPY.findingUnit} · ${evidence.hasCase ? COPY.caseLinked : COPY.caseNone}`;
}

/** Why a non-pending row has no action, as a Chinese sentence. */
export function evolutionDecisionNotActionableText(
  row: Pick<EvolutionEmployeeDecisionRow, "status">,
): string {
  const code = row.status === "resolved" ? "handled" : row.status;
  return `${COPY.notActionableLabel}：${evolutionDecisionReasonLabel(code)}`;
}

/**
 * Actions listed on a pending row that this employee still cannot submit,
 * with the Chinese reason. Actions the decision never offered are skipped.
 */
export function evolutionDecisionUnavailableActionLines(
  row: Pick<EvolutionEmployeeDecisionRow, "status" | "actionReasons">,
): { action: string; code: string; text: string }[] {
  if (row.status !== "pending") {
    return [];
  }
  const lines: { action: string; code: string; text: string }[] = [];
  for (const [action, code] of Object.entries(row.actionReasons)) {
    if (!code || code === "action_not_on_item") {
      continue;
    }
    lines.push({
      action,
      code,
      text: `${COPY.unavailableActionLabel}：${evolutionDecisionActionLabel(
        action,
      )}（${evolutionDecisionReasonLabel(code)}）`,
    });
  }
  return lines;
}

function deltaText(delta: number): string {
  if (delta > 0) {
    return `${COPY.increased} ${delta} ${COPY.itemUnit}`;
  }
  if (delta < 0) {
    return `${COPY.decreased} ${-delta} ${COPY.itemUnit}`;
  }
  return COPY.unchanged;
}

function countLine(label: string, prior: number, current: number, delta: number): string {
  return `${label}：${COPY.priorWeek} ${prior} ${COPY.itemUnit}，${COPY.currentWeek} ${current} ${
    COPY.itemUnit
  }，${deltaText(delta)}`;
}

const COUNT_ROWS: readonly {
  key: keyof EvolutionEmployeeDecisionStatusCounts;
  label: string;
}[] = [
  { key: "pendingMyConfirm", label: EVOLUTION_DECISION_STATUS_LABELS["pending-my-confirm"] },
  { key: "systemDone", label: EVOLUTION_DECISION_STATUS_LABELS["system-done"] },
  { key: "watching", label: EVOLUTION_DECISION_STATUS_LABELS.watching },
  { key: "needsAdmin", label: EVOLUTION_DECISION_STATUS_LABELS["needs-admin"] },
  { key: "total", label: COPY.wowTotalLabel },
];

function transitionEnd(
  status: EvolutionEmployeeDecisionTransition["from"],
  absent: string,
): string {
  return status === null ? absent : evolutionDecisionStatusLabel(status);
}

export function evolutionDecisionTransitionLine(
  transition: EvolutionEmployeeDecisionTransition,
): string {
  return `「${evolutionDecisionTypeLabel(transition.decisionType)}」：${transitionEnd(
    transition.from,
    COPY.absentBefore,
  )} → ${transitionEnd(transition.to, COPY.absentNow)}`;
}

/**
 * Weekly comparison lines. `history-unavailable` yields only the fixed
 * sentence: no counts, so missing history never reads as "no change".
 */
export function evolutionDecisionWowLines(wow: EvolutionEmployeeWeekOverWeekSummary): string[] {
  if (wow.availability !== "available") {
    return [COPY.historyUnavailable];
  }
  const lines = [
    `${COPY.priorWeek} ${formatEvolutionDecisionDate(wow.priorAsOf)} → ${COPY.currentWeek} ${formatEvolutionDecisionDate(
      wow.currentAsOf,
    )}`,
  ];
  for (const row of COUNT_ROWS) {
    lines.push(countLine(row.label, wow.prior[row.key], wow.current[row.key], wow.delta[row.key]));
  }
  for (const transition of wow.transitions) {
    lines.push(evolutionDecisionTransitionLine(transition));
  }
  return lines;
}

/**
 * The only receipt sentences an employee sees. An accepted receipt says the
 * request passed the rule check and has not run; nothing here claims an
 * application or a finished change.
 */
export function evolutionDecisionReceiptText(
  receipt: Pick<EvolutionEmployeeDecisionSubmitReceipt, "outcome" | "code">,
): string {
  if (receipt.outcome === "accepted") {
    return COPY.receiptAccepted;
  }
  if (receipt.outcome === "idempotent_replay") {
    return COPY.receiptReplay;
  }
  return `${COPY.receiptRefusedPrefix}：${evolutionDecisionReasonLabel(receipt.code)}。${
    COPY.receiptNotExecuted
  }`;
}
