import {
  createInitialCapabilityUpdateRecapState,
  hasVersionMarker,
  loadUpdateRecap,
  normalizeUpdateHeadline,
  normalizeUpdateRecap,
  type CapabilityUpdateRecapState,
} from "../../controllers/capability-update-recap.ts";

export const capabilityUpdateRecapCapability = {
  createInitialState: createInitialCapabilityUpdateRecapState,
  load: loadUpdateRecap,
  normalizeHeadline: normalizeUpdateHeadline,
  normalizeRecap: normalizeUpdateRecap,
  hasVersionMarker,
} as const;

export type { CapabilityUpdateRecapState };
