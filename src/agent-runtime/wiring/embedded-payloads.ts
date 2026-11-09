import {
  formatAssistantErrorText,
  formatRawAssistantErrorForUi,
  getApiErrorPayloadFingerprint,
  isRawApiErrorPayload,
  normalizeTextForComparison,
} from "../../agents/pi-embedded-helpers.js";
/** Fixed formatting references only. No runtime state, routing or business decisions. */
import { BILLING_ERROR_USER_MESSAGE } from "../../agents/pi-embedded-helpers/errors.js";
import {
  extractAssistantText,
  extractAssistantThinking,
  formatReasoningMessage,
} from "../../agents/pi-embedded-utils.js";
import {
  extractSandboxInfraUserFacingDetail,
  isSandboxInfraPreReplyError,
} from "../../agents/sandbox/docker-engine-client.js";
import { isLikelyMutatingToolName } from "../../agents/tool-mutation.js";
import type { EmbeddedPayloadFormatting } from "../delivery/index.js";

/**
 * Lazy accessors: the helpers barrel can still be initializing when this module
 * is first imported through a circular path (subprocess / tsx register). Reading
 * bindings at first use avoids TDZ / undefined re-export getters.
 */
export const embeddedPayloadFormatting: EmbeddedPayloadFormatting = {
  get billingErrorUserMessage() {
    return BILLING_ERROR_USER_MESSAGE;
  },
  get formatAssistantErrorText() {
    return formatAssistantErrorText;
  },
  get formatRawAssistantErrorForUi() {
    return formatRawAssistantErrorForUi;
  },
  get getApiErrorPayloadFingerprint() {
    return getApiErrorPayloadFingerprint;
  },
  get isRawApiErrorPayload() {
    return isRawApiErrorPayload;
  },
  get normalizeTextForComparison() {
    return normalizeTextForComparison;
  },
  get extractAssistantText() {
    return extractAssistantText;
  },
  get extractAssistantThinking() {
    return extractAssistantThinking;
  },
  get formatReasoningMessage() {
    return formatReasoningMessage;
  },
  get extractSandboxInfraUserFacingDetail() {
    return extractSandboxInfraUserFacingDetail;
  },
  get isSandboxInfraPreReplyError() {
    return isSandboxInfraPreReplyError;
  },
  get isLikelyMutatingToolName() {
    return isLikelyMutatingToolName;
  },
};
