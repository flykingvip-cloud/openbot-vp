import {
  loadAssistantIdentity,
  type AssistantIdentityState,
} from "../../controllers/assistant-identity.ts";

export type AssistantIdentityCapabilityLoadState = AssistantIdentityState;

export const assistantIdentityCapability = {
  load: loadAssistantIdentity,
} as const;
