/**
 * Correction notice for one already-landed correction version.
 * Automatic delivery is off. This is not a queue and does not use
 * pending-delivery or the TaskOutcome outbox.
 * A missing verified platform user fails closed. No session-key fallback.
 */
export const CORRECTION_NOTIFY_ENABLED = false;

const FORBIDDEN_RECIPIENTS = new Set(["agent:main:main", "diagnosis:canary:daibai"]);

export type CorrectionNotifySend = (input: { platformUserId: string; text: string }) => {
  accepted: boolean;
};

export type CorrectionNotifyResult =
  | {
      ok: true;
      replayed: boolean;
      accepted: boolean;
      read: false;
      text: string;
    }
  | { ok: false; code: "not_enabled" | "not_a_correction" | "recipient_unresolved" };

type Receipt = {
  taskId: string;
  outcomeVersion: number;
  platformUserId: string;
};

const receipts: Receipt[] = [];

export function resetCorrectionNotifyReceiptsForTests(): void {
  receipts.splice(0, receipts.length);
}

export function correctionNotifyText(input: {
  taskId: string;
  negatedOutcomeVersion: number;
  correctionOutcomeVersion: number;
  judgement: string;
}): string {
  return [
    `任务 ${input.taskId}`,
    `被否定版本 ${input.negatedOutcomeVersion}`,
    `纠正版本 ${input.correctionOutcomeVersion}`,
    `判定 ${input.judgement}`,
    "这是纠正记录，不是重新执行。",
  ].join("\n");
}

function sameReceipt(row: Receipt, next: Receipt): boolean {
  return (
    row.taskId === next.taskId &&
    row.outcomeVersion === next.outcomeVersion &&
    row.platformUserId === next.platformUserId
  );
}

export function deliverCorrectionNotice(input: {
  enabled?: boolean;
  taskId: string;
  negatedOutcomeVersion: number;
  correctionOutcomeVersion: number;
  judgement: string;
  revisionKind?: string;
  subjectRef?: string;
  verifiedPlatformUserId?: string;
  mappingVerified?: boolean;
  send?: CorrectionNotifySend;
}): CorrectionNotifyResult {
  const enabled = input.enabled ?? CORRECTION_NOTIFY_ENABLED;
  if (!enabled) {
    return { ok: false, code: "not_enabled" };
  }
  if (input.revisionKind !== "correction") {
    return { ok: false, code: "not_a_correction" };
  }
  const platformUserId = input.verifiedPlatformUserId?.trim() ?? "";
  if (!input.mappingVerified || !platformUserId || FORBIDDEN_RECIPIENTS.has(platformUserId)) {
    return { ok: false, code: "recipient_unresolved" };
  }
  const taskId = input.taskId.trim();
  if (!taskId) {
    return { ok: false, code: "recipient_unresolved" };
  }
  const receipt = {
    taskId,
    outcomeVersion: input.correctionOutcomeVersion,
    platformUserId,
  };
  if (receipts.some((row) => sameReceipt(row, receipt))) {
    return {
      ok: true,
      replayed: true,
      accepted: true,
      read: false,
      text: correctionNotifyText({
        taskId,
        negatedOutcomeVersion: input.negatedOutcomeVersion,
        correctionOutcomeVersion: input.correctionOutcomeVersion,
        judgement: input.judgement,
      }),
    };
  }
  const text = correctionNotifyText({
    taskId,
    negatedOutcomeVersion: input.negatedOutcomeVersion,
    correctionOutcomeVersion: input.correctionOutcomeVersion,
    judgement: input.judgement,
  });
  const accepted = input.send?.({ platformUserId, text }).accepted === true;
  if (accepted) {
    receipts.push(receipt);
  }
  return { ok: true, replayed: false, accepted, read: false, text };
}

/** Automatic path. Stays off until CORRECTION_NOTIFY_ENABLED is changed. */
export function maybeNotifyLandedCorrection(
  input: Omit<Parameters<typeof deliverCorrectionNotice>[0], "enabled">,
): CorrectionNotifyResult {
  return deliverCorrectionNotice({ ...input, enabled: CORRECTION_NOTIFY_ENABLED });
}
