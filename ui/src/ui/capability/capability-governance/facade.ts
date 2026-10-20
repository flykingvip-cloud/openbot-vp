// Capability governance capability-facade.
//
// Thin layer above the normalizer. Today it derives the snapshot from
// whatever skill report the runtime already fetched; tomorrow the
// `approveProposal` / `rejectProposal` / etc. functions will call
// gateway methods to persist state in the platform DB. The shape is
// designed so the UI plane stays stable when that happens.
//
// Intentionally stateless: actions currently record intent against an
// in-memory override map keyed by proposalId/manifestId so the UI can
// reflect optimistic updates before backend wiring exists.

import type { SkillStatusReport } from "../../types.ts";
import type { RuntimeCapabilityBinding } from "../runtime-canonical/index.ts";
import { normalizeSkillReport } from "./normalizer.ts";
import type {
  CapabilityEmployeeVisibilityMode,
  CapabilityDistributionScope,
  CapabilityGovernanceSnapshot,
  CapabilityProposal,
  CapabilityRegistryEntry,
} from "./types.ts";

// Optimistic-update overrides applied after a user action but before the
// backend confirms. Keyed by proposalId.
type ProposalOverride = {
  status: CapabilityProposal["status"];
  reviewer?: CapabilityProposal["reviewer"];
};
type RegistryOverride = {
  lifecycleState?: CapabilityRegistryEntry["lifecycleState"];
  distribution?: Partial<CapabilityRegistryEntry["distribution"]>;
};

export type CapabilityGovernanceViewState = {
  proposalOverrides: Map<string, ProposalOverride>;
  registryOverrides: Map<string, RegistryOverride>;
};

export function createCapabilityGovernanceViewState(): CapabilityGovernanceViewState {
  return {
    proposalOverrides: new Map(),
    registryOverrides: new Map(),
  };
}

export type CapabilityGovernanceSelectArgs = {
  skillsReport: SkillStatusReport | null;
  runtimeBindings?: readonly RuntimeCapabilityBinding[];
  state: CapabilityGovernanceViewState;
  now?: () => string;
};

export function applyCapabilityGovernanceViewState(
  snapshot: CapabilityGovernanceSnapshot,
  state: CapabilityGovernanceViewState,
): CapabilityGovernanceSnapshot {
  if (state.proposalOverrides.size === 0 && state.registryOverrides.size === 0) {
    return snapshot;
  }
  return {
    proposals: snapshot.proposals.map((proposal) => {
      const override = state.proposalOverrides.get(proposal.proposalId);
      if (!override) {
        return proposal;
      }
      return {
        ...proposal,
        status: override.status,
        reviewer: override.reviewer ?? proposal.reviewer,
      };
    }),
    registry: snapshot.registry.map((entry) => {
      const override = state.registryOverrides.get(entry.manifest.id);
      if (!override) {
        return entry;
      }
      return {
        ...entry,
        lifecycleState: override.lifecycleState ?? entry.lifecycleState,
        distribution: override.distribution
          ? { ...entry.distribution, ...override.distribution }
          : entry.distribution,
      };
    }),
    metrics: snapshot.metrics,
  };
}

export function selectCapabilityGovernanceSnapshot({
  skillsReport,
  runtimeBindings,
  state,
  now,
}: CapabilityGovernanceSelectArgs): CapabilityGovernanceSnapshot {
  const base = normalizeSkillReport(skillsReport, { now, runtimeBindings });
  return applyCapabilityGovernanceViewState(base, state);
}

// --- action helpers ----------------------------------------------------
// These are pure state mutations today. A later phase wires them to
// gateway methods (e.g. `platform.capabilities.approveProposal`).

export function approveProposal(
  state: CapabilityGovernanceViewState,
  proposalId: string,
  reviewerId: string,
  at: string = new Date().toISOString(),
): void {
  state.proposalOverrides.set(proposalId, {
    status: "approved",
    reviewer: { id: reviewerId, at },
  });
}

export function rejectProposal(
  state: CapabilityGovernanceViewState,
  proposalId: string,
  reviewerId: string,
  note: string,
  at: string = new Date().toISOString(),
): void {
  state.proposalOverrides.set(proposalId, {
    status: "rejected",
    reviewer: { id: reviewerId, at, note },
  });
}

export function promoteDistribution(
  state: CapabilityGovernanceViewState,
  manifestId: string,
  scope: CapabilityDistributionScope,
  employeeVisibilityMode: CapabilityEmployeeVisibilityMode,
  updatedBy: string,
  at: string = new Date().toISOString(),
): void {
  const prev = state.registryOverrides.get(manifestId) ?? {};
  state.registryOverrides.set(manifestId, {
    ...prev,
    distribution: {
      capabilityId: manifestId,
      scope,
      defaultEnabled: prev.distribution?.defaultEnabled ?? true,
      employeeVisibilityMode: prev.distribution?.employeeVisibilityMode ?? employeeVisibilityMode,
      updatedAt: at,
      updatedBy,
    },
  });
}

export function revokeDistribution(
  state: CapabilityGovernanceViewState,
  manifestId: string,
  updatedBy: string,
  at: string = new Date().toISOString(),
): void {
  const prev = state.registryOverrides.get(manifestId) ?? {};
  state.registryOverrides.set(manifestId, {
    ...prev,
    distribution: {
      capabilityId: manifestId,
      scope: {},
      defaultEnabled: false,
      employeeVisibilityMode: "enterprise_review_required",
      updatedAt: at,
      updatedBy,
    },
  });
}

export function deprecate(state: CapabilityGovernanceViewState, manifestId: string): void {
  const prev = state.registryOverrides.get(manifestId) ?? {};
  state.registryOverrides.set(manifestId, {
    ...prev,
    lifecycleState: "deprecated",
  });
}

export function retire(state: CapabilityGovernanceViewState, manifestId: string): void {
  const prev = state.registryOverrides.get(manifestId) ?? {};
  state.registryOverrides.set(manifestId, {
    ...prev,
    lifecycleState: "retired",
  });
}
