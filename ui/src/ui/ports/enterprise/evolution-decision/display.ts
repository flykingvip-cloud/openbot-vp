/**
 * Chinese display text for the enterprise Decision Surface.
 *
 * Every function returns admin-readable Chinese built from the maps in
 * `copy.ts`. Raw contract values never pass through: unknown values get a
 * generic Chinese fallback. Participation rows are described without any
 * evidence count, case, or control-plane id, because the row does not carry
 * them.
 */

import {
  EVOLUTION_ENTERPRISE_DECISION_ACTION_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_AUTHORITY_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_COPY,
  EVOLUTION_ENTERPRISE_DECISION_DOMAIN_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_EVIDENCE_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_REASON_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_STATUS_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_SURFACE_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_TYPE_LABELS,
  EVOLUTION_ENTERPRISE_DECISION_WOW_LABELS,
} from "./copy.ts";
import type {
  EvolutionEnterpriseDecisionRow,
  EvolutionEnterpriseDecisionStatusCounts,
  EvolutionEnterpriseDecisionSubmitReceipt,
  EvolutionEnterpriseDecisionTransition,
  EvolutionEnterpriseDecisionUiStatus,
  EvolutionEnterpriseWeekOverWeekSummary,
} from "./types.ts";

const COPY = EVOLUTION_ENTERPRISE_DECISION_COPY;

function labelFrom(map: Readonly<Record<string, string>>, key: string, fallback: string): string {
  return Object.hasOwn(map, key) ? (map[key] ?? fallback) : fallback;
}

export function enterpriseDecisionActionLabel(action: string): string {
  return labelFrom(EVOLUTION_ENTERPRISE_DECISION_ACTION_LABELS, action, COPY.fallbackAction);
}

export function enterpriseDecisionReasonLabel(code: string): string {
  return labelFrom(EVOLUTION_ENTERPRISE_DECISION_REASON_LABELS, code, COPY.fallbackReason);
}

export function enterpriseDecisionTypeLabel(decisionType: string): string {
  return labelFrom(
    EVOLUTION_ENTERPRISE_DECISION_TYPE_LABELS,
    decisionType,
    COPY.fallbackDecisionType,
  );
}

export function enterpriseDecisionAuthorityLabel(authority: string): string {
  return labelFrom(
    EVOLUTION_ENTERPRISE_DECISION_AUTHORITY_LABELS,
    authority,
    COPY.fallbackAuthority,
  );
}

export function enterpriseDecisionStatusLabel(status: string): string {
  return labelFrom(EVOLUTION_ENTERPRISE_DECISION_STATUS_LABELS, status, COPY.fallbackStatus);
}

export function enterpriseDecisionEvidenceAvailabilityLabel(availability: string): string {
  return labelFrom(
    EVOLUTION_ENTERPRISE_DECISION_EVIDENCE_LABELS,
    availability,
    COPY.fallbackEvidence,
  );
}

/** Domain and surface names only; the target key is never shown. */
export function enterpriseDecisionTargetLabel(
  target: Pick<EvolutionEnterpriseDecisionRow["impactTarget"], "domain" | "surfaceId">,
): string {
  const domain = labelFrom(
    EVOLUTION_ENTERPRISE_DECISION_DOMAIN_LABELS,
    target.domain,
    COPY.fallbackDomain,
  );
  const surface = labelFrom(
    EVOLUTION_ENTERPRISE_DECISION_SURFACE_LABELS,
    target.surfaceId,
    COPY.fallbackSurface,
  );
  return `${domain} · ${surface}`;
}

const ISO_CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

/**
 * Calendar date from the ISO prefix, as written, so the label does not shift
 * with the viewer's time zone (same rule as the employee surface).
 */
export function formatEnterpriseDecisionDate(value: string | null | undefined): string {
  const match = ISO_CALENDAR_DATE.exec((value ?? "").trim());
  if (!match) {
    return COPY.unknownDate;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function enterpriseDecisionTimesText(
  row: Pick<EvolutionEnterpriseDecisionRow, "createdAt" | "updatedAt" | "expiresAt">,
): string {
  const parts = [
    `${COPY.createdLabel} ${formatEnterpriseDecisionDate(row.createdAt)}`,
    `${COPY.updatedLabel} ${formatEnterpriseDecisionDate(row.updatedAt)}`,
  ];
  if (row.expiresAt) {
    parts.push(`${COPY.expiresLabel} ${formatEnterpriseDecisionDate(row.expiresAt)}`);
  }
  return parts.join(" · ");
}

/**
 * Evidence summary line. Enterprise-owned rows show counts only. An
 * employee's personal-asset row and a platform canary row say where the
 * evidence stays; they have no counts to show.
 */
export function enterpriseDecisionEvidenceText(
  row: Pick<
    EvolutionEnterpriseDecisionRow,
    "evidence" | "participation" | "status" | "uiStatus" | "actionReasons"
  >,
): string {
  const { evidence } = row;
  if (evidence.availability === "available") {
    return `${COPY.evidenceLabel}：${evidence.citationCount} ${COPY.citationUnit} · ${
      evidence.findingCount
    } ${COPY.findingUnit} · ${evidence.hasCase ? COPY.caseLinked : COPY.caseNone}`;
  }
  if (evidence.availability !== "withheld") {
    return `${COPY.evidenceLabel}：${enterpriseDecisionEvidenceAvailabilityLabel(
      evidence.availability,
    )}`;
  }
  if (row.participation === "employee_final_authorization") {
    return COPY.employeeEvidenceWithheld;
  }
  if (row.participation === "enterprise_canary") {
    if (row.actionReasons.participate_canary === "participation_already_satisfied") {
      return COPY.canaryConfirmed;
    }
    if (row.status === "pending" && row.uiStatus === "participate-platform-canary") {
      return COPY.canaryNeedsConfirmation;
    }
    return COPY.canaryAffects;
  }
  return `${COPY.evidenceLabel}：${enterpriseDecisionEvidenceAvailabilityLabel("withheld")}`;
}

/** Why a non-pending row has no action, as a Chinese sentence. */
export function enterpriseDecisionNotActionableText(
  row: Pick<EvolutionEnterpriseDecisionRow, "status">,
): string {
  const code = row.status === "resolved" ? "handled" : row.status;
  return `${COPY.notActionableLabel}：${enterpriseDecisionReasonLabel(code)}`;
}

/**
 * Actions a pending row lists that the D1 judge would not accept now, with
 * the Chinese reason. Actions the decision never offered are skipped.
 */
export function enterpriseDecisionUnavailableActionLines(
  row: Pick<EvolutionEnterpriseDecisionRow, "status" | "actionReasons">,
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
      text: `${COPY.unavailableActionLabel}：${enterpriseDecisionActionLabel(
        action,
      )}（${enterpriseDecisionReasonLabel(code)}）`,
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

const WOW_STATUS_ORDER: readonly EvolutionEnterpriseDecisionUiStatus[] = [
  "pending-enterprise-decision",
  "waiting-employee-authorization",
  "participate-platform-canary",
  "watching",
  "completed",
  "blocked",
  "expired",
];

function countLine(label: string, prior: number, current: number, delta: number): string {
  return `${label}：${COPY.priorWeek} ${prior} ${COPY.itemUnit}，${COPY.currentWeek} ${current} ${
    COPY.itemUnit
  }，${deltaText(delta)}`;
}

function countLineFor(
  key: keyof EvolutionEnterpriseDecisionStatusCounts,
  label: string,
  wow: Extract<EvolutionEnterpriseWeekOverWeekSummary, { availability: "available" }>,
): { key: string; text: string } {
  return { key, text: countLine(label, wow.prior[key], wow.current[key], wow.delta[key]) };
}

function transitionEnd(
  status: EvolutionEnterpriseDecisionTransition["from"],
  absent: string,
): string {
  return status === null ? absent : enterpriseDecisionStatusLabel(status);
}

export function enterpriseDecisionTransitionLine(
  transition: EvolutionEnterpriseDecisionTransition,
): string {
  return `「${enterpriseDecisionTypeLabel(transition.decisionType)}」：${transitionEnd(
    transition.from,
    COPY.absentBefore,
  )} → ${transitionEnd(transition.to, COPY.absentNow)}`;
}

/**
 * Weekly comparison as display lines. `history-unavailable` yields only the
 * fixed sentence: no period, counts, or transitions, so missing history never
 * reads as "no change".
 */
export type EnterpriseDecisionWowDisplay =
  | { availability: "history-unavailable"; message: string }
  | {
      availability: "available";
      period: string;
      counts: { key: string; text: string }[];
      transitions: string[];
    };

export function enterpriseDecisionWowDisplay(
  wow: EvolutionEnterpriseWeekOverWeekSummary,
): EnterpriseDecisionWowDisplay {
  if (wow.availability !== "available") {
    return { availability: "history-unavailable", message: COPY.historyUnavailable };
  }
  return {
    availability: "available",
    period: `${COPY.priorWeek} ${formatEnterpriseDecisionDate(wow.priorAsOf)} → ${
      COPY.currentWeek
    } ${formatEnterpriseDecisionDate(wow.currentAsOf)}`,
    counts: [
      ...WOW_STATUS_ORDER.map((status) =>
        countLineFor(status, EVOLUTION_ENTERPRISE_DECISION_WOW_LABELS[status], wow),
      ),
      countLineFor("total", COPY.wowTotalLabel, wow),
    ],
    transitions: wow.transitions.map(enterpriseDecisionTransitionLine),
  };
}

/**
 * The only receipt sentences an admin sees. An accepted receipt says the
 * request passed the rule check and has not run; nothing here claims an
 * application or a finished change.
 */
export function enterpriseDecisionReceiptText(
  receipt: Pick<EvolutionEnterpriseDecisionSubmitReceipt, "outcome" | "code">,
): string {
  if (receipt.outcome === "accepted") {
    return COPY.receiptAccepted;
  }
  if (receipt.outcome === "idempotent_replay") {
    return COPY.receiptReplay;
  }
  return `${COPY.receiptRefusedPrefix}：${enterpriseDecisionReasonLabel(receipt.code)}。${
    COPY.receiptNotExecuted
  }`;
}
