import type { DeliveryEvidence, DeliveryValidatorReceipt, ExecutionPreflight } from "./types.js";

/** Trusted delivery evidence copied from one attempt. No file body and no secrets. */
export type HookDeliveryResult = {
  taskId: string;
  attemptNumber: number;
  validatorsRequired: boolean;
  decisionCode:
    | "delivery_receipt_verified"
    | "delivery_blocked"
    | "artifact_changed"
    | "validator_unavailable"
    | "validation_failed"
    | "not_required";
  allowedToDeliver: boolean;
  validatorReceipts?: DeliveryValidatorReceipt[];
};

function validatorsRequired(preflight: ExecutionPreflight): boolean {
  return (
    Boolean(preflight.deliveryBlockedUntil?.trim()) ||
    preflight.requiredValidators.length > 0 ||
    preflight.decisionCode === "validator_unavailable"
  );
}

/** Map one attempt's gate evidence onto the hook surface admission code. */
export function toHookDeliveryResult(params: {
  preflight: ExecutionPreflight;
  evidence: DeliveryEvidence;
}): HookDeliveryResult {
  const required = validatorsRequired(params.preflight);
  const receipts = params.evidence.gateInput.validatorReceipts?.map((receipt) => ({
    validatorId: receipt.validatorId,
    ...(receipt.validatorVersion ? { validatorVersion: receipt.validatorVersion } : {}),
    artifactPath: receipt.artifactPath,
    ...(receipt.artifactSha256 ? { artifactSha256: receipt.artifactSha256 } : {}),
    validationResult: receipt.validationResult,
  }));
  if (!required) {
    return {
      taskId: params.preflight.taskId,
      attemptNumber: params.preflight.attemptNumber,
      validatorsRequired: false,
      decisionCode: "not_required",
      allowedToDeliver: true,
      ...(receipts && receipts.length > 0 ? { validatorReceipts: receipts } : {}),
    };
  }
  let decisionCode: HookDeliveryResult["decisionCode"] = "delivery_blocked";
  if (params.evidence.decisionCode === "artifact_changed") {
    decisionCode = "artifact_changed";
  } else if (params.evidence.decisionCode === "validator_unavailable") {
    decisionCode = "validator_unavailable";
  } else if (
    params.evidence.allowedToDeliver &&
    params.evidence.decisionCode === "delivery_allowed"
  ) {
    decisionCode = "delivery_receipt_verified";
  } else if (params.evidence.gateInput.validationResult === "failed") {
    decisionCode = "validation_failed";
  }
  return {
    taskId: params.preflight.taskId,
    attemptNumber: params.preflight.attemptNumber,
    validatorsRequired: true,
    decisionCode,
    allowedToDeliver: decisionCode === "delivery_receipt_verified",
    ...(receipts && receipts.length > 0 ? { validatorReceipts: receipts } : {}),
  };
}
