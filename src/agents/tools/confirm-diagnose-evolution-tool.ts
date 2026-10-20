/**
 * Confirm one stored diagnose prescription.
 * Canonical user-facing name: confirm_diagnose_prescription.
 * confirm_diagnose_evolution is the same handler alias — one store, one audit,
 * one idempotency key. The gray gate stays closed.
 */
import { Type } from "@sinclair/typebox";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "../../diagnosis/diagnose-professional-protocol.js";
import { confirmDiagnoseEvolutionPrescription } from "../../diagnosis/diagnose-self-evolution.js";
import { jsonResult, type AnyAgentTool } from "./common.js";

const ConfirmSchema = Type.Object({
  prescriptionId: Type.String({
    description:
      "Stored prescription id. Target, schedule, and wake text are not accepted from the model.",
  }),
  professionalReportId: Type.String({
    description: "Request-level professional report id that owns the prescription.",
  }),
  prescriptionContentHash: Type.Optional(
    Type.String({
      description:
        "sha256 content fingerprint of the stored prescription. Required once confirm is enabled; a mismatch is rejected.",
    }),
  ),
});

export type ConfirmDiagnosePrescriptionToolOptions = {
  tenantId?: string;
  callerUserId?: string;
};

export async function executeConfirmDiagnosePrescription(
  args: unknown,
  options?: ConfirmDiagnosePrescriptionToolOptions,
): Promise<ReturnType<typeof jsonResult>> {
  if (!DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED) {
    return jsonResult({ ok: false, reason: "confirm_not_enabled" });
  }
  const params = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const prescriptionId =
    typeof params.prescriptionId === "string" ? params.prescriptionId.trim() : "";
  const professionalReportId =
    typeof params.professionalReportId === "string" ? params.professionalReportId.trim() : "";
  const prescriptionContentHash =
    typeof params.prescriptionContentHash === "string" ? params.prescriptionContentHash.trim() : "";
  if (!prescriptionId || !professionalReportId || !options?.tenantId) {
    return jsonResult({ ok: false, reason: "prescription_required" });
  }
  const result = await confirmDiagnoseEvolutionPrescription({
    prescriptionId,
    professionalReportId,
    tenantId: options.tenantId,
    callerUserId: options.callerUserId,
    ...(prescriptionContentHash ? { prescriptionContentHash } : {}),
    enabled: true,
  });
  if (!result.ok) {
    return jsonResult({ ok: false, reason: result.reason });
  }
  return jsonResult({
    ok: true,
    already: result.already,
    jobId: result.jobId,
    prescriptionId: result.prescription.prescriptionId,
    kind: result.prescription.kind,
  });
}

function createConfirmTool(
  name: "confirm_diagnose_prescription" | "confirm_diagnose_evolution",
  options?: ConfirmDiagnosePrescriptionToolOptions,
): AnyAgentTool {
  return {
    name,
    label:
      name === "confirm_diagnose_prescription"
        ? "Confirm diagnose prescription"
        : "Confirm diagnose evolution",
    description:
      "Confirm one stored diagnose prescription. Disabled until the confirm-write gray gate opens. Does not submit structural evolution candidates. Idempotent when enabled.",
    parameters: ConfirmSchema,
    execute: async (_toolCallId, args) => executeConfirmDiagnosePrescription(args, options),
  };
}

export function createConfirmDiagnosePrescriptionTool(
  options?: ConfirmDiagnosePrescriptionToolOptions,
): AnyAgentTool {
  return createConfirmTool("confirm_diagnose_prescription", options);
}

/** Compatibility alias. Same handler, store, audit, and idempotency key. */
export function createConfirmDiagnoseEvolutionTool(
  options?: ConfirmDiagnosePrescriptionToolOptions,
): AnyAgentTool {
  return createConfirmTool("confirm_diagnose_evolution", options);
}
