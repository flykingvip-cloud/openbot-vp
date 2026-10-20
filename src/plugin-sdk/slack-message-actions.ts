// Facade shim. Implementation lives in channels so core code does not depend on plugin-sdk.
export { handleSlackMessageAction } from "../channels/plugins/slack-message-actions.js";
