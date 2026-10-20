import {
  callDebugMethod,
  loadDebug,
  probeModels,
  type DebugCallState,
  type DebugLoadState,
  type DebugProbeModelsState,
} from "../../controllers/debug.ts";

export type DebugCapabilityLoadState = DebugLoadState;
export type DebugCapabilityCallState = DebugCallState;
export type DebugCapabilityProbeModelsState = DebugProbeModelsState;

export const debugCapability = {
  load: loadDebug,
  callMethod: callDebugMethod,
  probeModels,
} as const;
