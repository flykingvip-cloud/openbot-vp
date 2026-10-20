// Facade shim. Generic helpers live in channels; channel-specific resolvers
// live next to their account modules. plugin-sdk only re-exports them.
export {
  createScopedAccountConfigAccessors,
  createScopedChannelConfigBase,
  createScopedDmSecurityResolver,
  formatTrimmedAllowFromEntries,
  mapAllowFromEntries,
  resolveOptionalConfigString,
} from "../channels/plugins/channel-config-helpers.js";
export {
  resolveIMessageConfigAllowFrom,
  resolveIMessageConfigDefaultTo,
} from "../imessage/channel-config.js";
export {
  formatWhatsAppConfigAllowFromEntries,
  resolveWhatsAppConfigAllowFrom,
  resolveWhatsAppConfigDefaultTo,
} from "../web/channel-config.js";
