/**
 * Capability taxonomy — public surface.
 *
 * The §7 semantic capability identifiers plus the §7.6 convergence mapping, held as
 * code so both can be tested against the command surface that actually exists.
 *
 * Pure vocabulary: no IO, no authorization, no consumers required. Importing it
 * cannot change behavior. Registry row: `capability-taxonomy` in
 * `docs/design/convergence-registry.yaml`.
 */

export {
  CAPABILITY_CONVERGENCE,
  CAPABILITY_TAXONOMY_UNCOVERED_COMMANDS,
  capabilitiesForNodeCommand,
  landedNodeCommands,
  pendingNodeCommands,
  type CapabilityConvergence,
  type ConvergenceMode,
} from "./convergence.js";
export {
  ACCOUNT_CAPABILITY_IDS,
  AGENT_CAPABILITY_IDS,
  CAPABILITY_IDS,
  capabilityGroup,
  type CapabilityGroup,
  type CapabilityId,
  EXTERNAL_CAPABILITY_IDS,
  isCapabilityId,
  LOCAL_CAPABILITY_IDS,
  NETWORK_CAPABILITY_IDS,
} from "./ids.js";
