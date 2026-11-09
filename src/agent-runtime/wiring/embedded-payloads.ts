/** Fixed formatting references only. No runtime state, routing or business decisions. */
import {
  BILLING_ERROR_USER_MESSAGE,
  formatAssistantErrorText,
  formatRawAssistantErrorForUi,
  getApiErrorPayloadFingerprint,
  isRawApiErrorPayload,
  normalizeTextForComparison,
} from "../../agents/pi-embedded-helpers.js";
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
export const embeddedPayloadFormatting: EmbeddedPayloadFormatting = {
  billingErrorUserMessage: BILLING_ERROR_USER_MESSAGE,
  formatAssistantErrorText,
  formatRawAssistantErrorForUi,
  getApiErrorPayloadFingerprint,
  isRawApiErrorPayload,
  normalizeTextForComparison,
  extractAssistantText,
  extractAssistantThinking,
  formatReasoningMessage,
  extractSandboxInfraUserFacingDetail,
  isSandboxInfraPreReplyError,
  isLikelyMutatingToolName,
};
