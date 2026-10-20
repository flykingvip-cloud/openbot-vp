/**
 * DI boundary for CQ-O0 health probe.
 * CLI and gateway callers must import from this module only.
 */
export {
  createMemoryHealthProbe,
  listAgentProbeWatchPaths,
  probeAgentReadOnly,
  probeModuleShaFromSource,
  type MemoryHealthProbe,
  type MemoryHealthProbeAgentInput,
  type MemoryHealthProbeResult,
} from "./health-probe.js";
