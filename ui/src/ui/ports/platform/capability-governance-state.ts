// Per-port module-scoped governance view-state holder.
//
// The platform port is a long-lived Lit surface and user actions
// (approve/reject/promote) must persist across re-renders while the
// gateway hasn't yet written them through. A single module-level
// instance is enough — the platform UI is single-operator at a time.

import {
  createCapabilityGovernanceViewState,
  type CapabilityGovernanceViewState,
} from "../../capability/capability-governance/facade.ts";

let instance: CapabilityGovernanceViewState | null = null;

export function getOrCreateCapabilityGovernanceViewState(): CapabilityGovernanceViewState {
  if (instance === null) {
    instance = createCapabilityGovernanceViewState();
  }
  return instance;
}

// Exported for tests.
export function __resetCapabilityGovernanceViewStateForTest(): void {
  instance = null;
}
