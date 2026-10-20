import type { SupportCaseCategory, SupportCaseStatus } from "../../shared/daibai-types.js";
import {
  closeSupportCase,
  createSupportCase,
  getSupportCase,
  listSupportCases,
  resolveSupportCase,
} from "../../support-cases/store.js";
import {
  ErrorCodes,
  errorShape,
  validateSupportCasesCloseParams,
  validateSupportCasesCreateParams,
  validateSupportCasesGetParams,
  validateSupportCasesListParams,
  validateSupportCasesResolveParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

export const supportCasesHandlers: GatewayRequestHandlers = {
  "support.cases.create": async ({ params, respond }) => {
    if (
      !assertValidParams(params, validateSupportCasesCreateParams, "support.cases.create", respond)
    ) {
      return;
    }
    const created = await createSupportCase({
      ...params,
      category: params.category as SupportCaseCategory | undefined,
    });
    respond(true, created, undefined);
  },
  "support.cases.list": async ({ params, respond }) => {
    if (!assertValidParams(params, validateSupportCasesListParams, "support.cases.list", respond)) {
      return;
    }
    const cases = await listSupportCases({
      ...params,
      status: params.status as SupportCaseStatus | undefined,
    });
    respond(true, { cases }, undefined);
  },
  "support.cases.get": async ({ params, respond }) => {
    if (!assertValidParams(params, validateSupportCasesGetParams, "support.cases.get", respond)) {
      return;
    }
    const found = await getSupportCase(params.caseId);
    if (!found) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "support case not found"));
      return;
    }
    respond(true, found, undefined);
  },
  "support.cases.resolve": async ({ params, respond }) => {
    if (
      !assertValidParams(
        params,
        validateSupportCasesResolveParams,
        "support.cases.resolve",
        respond,
      )
    ) {
      return;
    }
    const updated = await resolveSupportCase(params);
    if (!updated) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "support case not found"));
      return;
    }
    respond(true, updated, undefined);
  },
  "support.cases.close": async ({ params, respond }) => {
    if (
      !assertValidParams(params, validateSupportCasesCloseParams, "support.cases.close", respond)
    ) {
      return;
    }
    const updated = await closeSupportCase(params);
    if (!updated) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "support case not found"));
      return;
    }
    respond(true, updated, undefined);
  },
};
