// Facade shim. Implementation lives in channels so core code does not depend on plugin-sdk.
export {
  formatAllowFromLowercase,
  formatNormalizedAllowFromEntries,
  isAllowedParsedChatSender,
  isNormalizedSenderAllowed,
} from "../channels/plugins/allow-from.js";
