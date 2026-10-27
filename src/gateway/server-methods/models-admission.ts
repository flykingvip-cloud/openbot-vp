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
import { assertValidParams } from "./validation.js";

const service = createGatewayVerificationService();

export const modelsAdmissionHandlers: GatewayRequestHandlers = {
  "models.admission.discoverCapabilities": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionDiscoverParams,
        "models.admission.discoverCapabilities",
        respond,
      )
    ) {
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
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionCreateVerificationParams,
        "models.admission.createVerificationTask",
        respond,
      )
    ) {
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
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionGetVerificationParams,
        "models.admission.getVerificationTask",
        respond,
      )
    ) {
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
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionListVerificationParams,
        "models.admission.listVerificationTasks",
        respond,
      )
    ) {
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
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionCancelVerificationParams,
        "models.admission.cancelVerificationTask",
        respond,
      )
    ) {
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
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionBatchVerificationParams,
        "models.admission.createBatchVerificationTasks",
        respond,
      )
    ) {
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
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionSetRoutingEligibilityParams,
        "models.admission.setRoutingEligibility",
        respond,
      )
    ) {
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
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionGetModelParams,
        "models.admission.getModelAdmission",
        respond,
      )
    ) {
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
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionListModelsParams,
        "models.admission.listModelAdmissions",
        respond,
      )
    ) {
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
    if (
      !assertValidParams(
        params,
        validateModelsAdmissionPreviewRoutingParams,
        "models.admission.previewRoutingDecision",
        respond,
      )
    ) {
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
