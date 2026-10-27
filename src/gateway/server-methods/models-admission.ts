/**
 * Platform model capability admission RPC.
 * Formal verification + routing eligibility + decision preview.
 * Default runner does not call paid generation APIs.
 */

import {
  createGatewayVerificationService,
  listModelAdmissions,
  previewRoutingDecision,
} from "../models/capability-admission/index.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsAdmissionBatchVerificationParams,
  validateModelsAdmissionCancelVerificationParams,
  validateModelsAdmissionCreateVerificationParams,
  validateModelsAdmissionDiscoverParams,
  validateModelsAdmissionGetModelParams,
  validateModelsAdmissionGetVerificationParams,
  validateModelsAdmissionListModelsParams,
  validateModelsAdmissionListVerificationParams,
  validateModelsAdmissionPreviewRoutingParams,
  validateModelsAdmissionSetRoutingEligibilityParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const service = createGatewayVerificationService();

function invalid(
  respond: (ok: false, _p: undefined, err: unknown) => void,
  method: string,
  errors: unknown,
) {
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid ${method} params: ${formatValidationErrors(errors)}`,
    ),
  );
}

export const modelsAdmissionHandlers: GatewayRequestHandlers = {
  "models.admission.discoverCapabilities": async ({ params, respond }) => {
    if (!validateModelsAdmissionDiscoverParams(params)) {
      invalid(
        respond,
        "models.admission.discoverCapabilities",
        validateModelsAdmissionDiscoverParams.errors,
      );
      return;
    }
    try {
      const result = await service.discoverCapabilities({
        modelRef: params.modelRef,
        declaredCapabilities: params.declaredCapabilities,
        callType: params.callType,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.admission.createVerificationTask": async ({ params, respond }) => {
    if (!validateModelsAdmissionCreateVerificationParams(params)) {
      invalid(
        respond,
        "models.admission.createVerificationTask",
        validateModelsAdmissionCreateVerificationParams.errors,
      );
      return;
    }
    try {
      const result = await service.createVerificationTask({
        modelRef: params.modelRef,
        capabilityIds: params.capabilityIds,
        mode: params.mode,
        configFingerprint: params.configFingerprint,
        estimatedCalls: params.estimatedCalls,
        connectionOk: params.connectionOk,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.admission.getVerificationTask": async ({ params, respond }) => {
    if (!validateModelsAdmissionGetVerificationParams(params)) {
      invalid(
        respond,
        "models.admission.getVerificationTask",
        validateModelsAdmissionGetVerificationParams.errors,
      );
      return;
    }
    try {
      const task = await service.getVerificationTask(params.taskId);
      respond(true, { task }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.admission.listVerificationTasks": async ({ params, respond }) => {
    if (!validateModelsAdmissionListVerificationParams(params)) {
      invalid(
        respond,
        "models.admission.listVerificationTasks",
        validateModelsAdmissionListVerificationParams.errors,
      );
      return;
    }
    try {
      const tasks = await service.listVerificationTasks(params.modelRef);
      respond(true, { tasks }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.admission.cancelVerificationTask": async ({ params, respond }) => {
    if (!validateModelsAdmissionCancelVerificationParams(params)) {
      invalid(
        respond,
        "models.admission.cancelVerificationTask",
        validateModelsAdmissionCancelVerificationParams.errors,
      );
      return;
    }
    try {
      const task = await service.cancelVerificationTask(params.taskId);
      respond(true, { task }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.admission.createBatchVerificationTasks": async ({ params, respond }) => {
    if (!validateModelsAdmissionBatchVerificationParams(params)) {
      invalid(
        respond,
        "models.admission.createBatchVerificationTasks",
        validateModelsAdmissionBatchVerificationParams.errors,
      );
      return;
    }
    try {
      const result = await service.createBatchVerificationTasks(params.items);
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.admission.setRoutingEligibility": async ({ params, respond }) => {
    if (!validateModelsAdmissionSetRoutingEligibilityParams(params)) {
      invalid(
        respond,
        "models.admission.setRoutingEligibility",
        validateModelsAdmissionSetRoutingEligibilityParams.errors,
      );
      return;
    }
    try {
      const result = await service.setRoutingEligibility({
        modelRef: params.modelRef,
        autoRouting: params.autoRouting,
        reason: params.reason,
        taskCategories: params.taskCategories,
        tenantSelectable: params.tenantSelectable,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.admission.getModelAdmission": async ({ params, respond }) => {
    if (!validateModelsAdmissionGetModelParams(params)) {
      invalid(
        respond,
        "models.admission.getModelAdmission",
        validateModelsAdmissionGetModelParams.errors,
      );
      return;
    }
    try {
      const admission = await service.getModelAdmission(params.modelRef);
      respond(true, { admission }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.admission.listModelAdmissions": async ({ params, respond }) => {
    if (!validateModelsAdmissionListModelsParams(params)) {
      invalid(
        respond,
        "models.admission.listModelAdmissions",
        validateModelsAdmissionListModelsParams.errors,
      );
      return;
    }
    try {
      const admissions = await listModelAdmissions();
      respond(true, { admissions }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "models.admission.previewRoutingDecision": async ({ params, respond }) => {
    if (!validateModelsAdmissionPreviewRoutingParams(params)) {
      invalid(
        respond,
        "models.admission.previewRoutingDecision",
        validateModelsAdmissionPreviewRoutingParams.errors,
      );
      return;
    }
    try {
      const preview = await previewRoutingDecision({
        request: params.request,
        candidates: params.candidates,
      });
      respond(true, { preview }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
