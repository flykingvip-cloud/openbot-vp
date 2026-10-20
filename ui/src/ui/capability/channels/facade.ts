import {
  loadChannels,
  logoutWhatsApp,
  startWhatsAppLogin,
  type ChannelsLoadState,
  type ChannelsWhatsAppAuthState,
  waitWhatsAppLogin,
} from "../../controllers/channels.ts";

export type ChannelsCapabilityLoadState = ChannelsLoadState;
export type ChannelsCapabilityWhatsAppAuthState = ChannelsWhatsAppAuthState;

/**
 * Transitional capability seam for connection/channel operations.
 *
 * The first version intentionally wraps the existing controller exports so new
 * call sites stop depending on controller paths directly.
 */
export const channelsCapability = {
  load: loadChannels,
  logoutWhatsApp,
  startWhatsAppLogin,
  waitWhatsAppLogin,
} as const;
