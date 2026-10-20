import { loadPresence, type PresenceState } from "../../controllers/presence.ts";

export type PresenceCapabilityLoadState = PresenceState;

export const presenceCapability = {
  load: loadPresence,
} as const;
