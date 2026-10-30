/**
 * chat.checkpoints.list — checkpoint metadata listing (chat-checkpoint-rollback).
 */

import { listChatCheckpoints } from "../checkpoint-store.js";
import {
  employeeGlobalStewardTranscriptBlocked,
  resolveEmployeeScopedChatSessionKey,
} from "../employee-steward-session.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateChatCheckpointsListParams,
} from "../protocol/index.js";
import { foreignEmployeeStewardAccessDenial } from "../steward-call-authorization.js";
import type { GatewayRequestHandlers } from "./types.js";

export const chatCheckpointHandlers: GatewayRequestHandlers = {
  "chat.checkpoints.list": async ({ params, respond, client }) => {
    if (!validateChatCheckpointsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid chat.checkpoints.list params: ${formatValidationErrors(validateChatCheckpointsListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { sessionKey: string };
    const rawSessionKey = p.sessionKey;
    const sessionKey = await resolveEmployeeScopedChatSessionKey(client, rawSessionKey);
    // Phase A: list checkpoints for collab/space keys too (恢复线). Steward/authz unchanged.
    if (employeeGlobalStewardTranscriptBlocked(client, sessionKey)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "global steward history is not available for this employee session",
        ),
      );
      return;
    }
    const foreignStewardDenial = await foreignEmployeeStewardAccessDenial(client, sessionKey);
    if (foreignStewardDenial) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, foreignStewardDenial));
      return;
    }
    try {
      const checkpoints = await listChatCheckpoints(sessionKey, client, rawSessionKey);
      respond(true, { checkpoints });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `failed to list checkpoints: ${String(err)}`),
      );
    }
  },
};
