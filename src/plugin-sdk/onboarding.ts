// Facade shim. Implementation lives in channels so core code does not depend on plugin-sdk.
export {
  promptAccountId,
  type PromptAccountIdParams,
} from "../channels/plugins/onboarding/prompt-account-id.js";
