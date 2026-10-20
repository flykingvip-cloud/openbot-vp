import fs from "node:fs";
import path from "node:path";
import type {
  EvolutionApplication,
  EvolutionExperiment,
  EvolutionProposal,
} from "@openbot/evolution-core";
import { resolveEvolutionControlRoot } from "./persistent-store.js";

export type EvolutionOutcomeBinding = {
  experimentId: string;
  applicationId: string;
  tenantId?: string;
  cohortRef?: string;
  appliedAt?: string;
};

export type WorkingDnaTaskOutcomeBinding = EvolutionOutcomeBinding;

const LIVE_PROPOSAL_STATUSES = new Set(["CANARY", "ACTIVE", "HELD", "VERIFIED"]);

function readJsonRecord<T>(filePath: string): Record<string, T> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, T>;
  } catch {
    return {};
  }
}

function isAgentTarget(
  target: EvolutionProposal["target"],
  agentId: string,
): target is { domain: "agent"; agentId: string } {
  return target.domain === "agent" && target.agentId === agentId;
}

/**
 * Bind a live, runtime-applied Working DNA experiment to a task outcome.
 * Shadow, rolled-back, terminal, unlabeled, or ambiguous multi-experiment
 * states return undefined — never invent an ID.
 */
function resolveAppliedOutcomeBinding(input: {
  persistDir?: string;
  adapterIds: readonly string[];
  matchesProposal: (proposal: EvolutionProposal) => boolean;
  requireExperiment?: boolean;
  uniqueMatch?: boolean;
}): EvolutionOutcomeBinding | undefined {
  const root = resolveEvolutionControlRoot(input.persistDir);
  const applications = readJsonRecord<EvolutionApplication>(path.join(root, "applications.json"));
  const proposals = readJsonRecord<EvolutionProposal>(path.join(root, "proposals.json"));
  const experiments = readJsonRecord<EvolutionExperiment>(path.join(root, "experiments.json"));
  const matches: Array<EvolutionOutcomeBinding & { appliedAt: string }> = [];
  for (const application of Object.values(applications)) {
    if (!application || !input.adapterIds.includes(application.adapterId)) {
      continue;
    }
    if (!application.appliedToRuntime) {
      continue;
    }
    if (application.status !== "applied" || application.scope === "shadow") {
      continue;
    }
    const proposal = proposals[application.proposalId];
    if (!proposal || !LIVE_PROPOSAL_STATUSES.has(proposal.status)) {
      continue;
    }
    if (!input.matchesProposal(proposal)) {
      continue;
    }
    if (proposal.experimentId && proposal.experimentId !== application.experimentId) {
      continue;
    }
    const experiment = experiments[application.experimentId];
    if (input.requireExperiment && !experiment) {
      continue;
    }
    const tenantId =
      typeof proposal.tenantScope === "string" && proposal.tenantScope.trim()
        ? proposal.tenantScope
        : undefined;
    matches.push({
      experimentId: application.experimentId,
      applicationId: application.applicationId,
      ...(tenantId ? { tenantId } : {}),
      ...(experiment?.frozen.datasetOrCohortRef
        ? { cohortRef: experiment.frozen.datasetOrCohortRef }
        : {}),
      appliedAt: application.appliedAt ?? "",
    });
  }
  if (matches.length === 0) {
    return undefined;
  }
  const experimentIds = new Set(matches.map((row) => row.experimentId));
  if (input.uniqueMatch && experimentIds.size !== 1) {
    return undefined;
  }
  if (experimentIds.size > 1) {
    return undefined;
  }
  // Several applied rows in one experiment are the canary then the active
  // write. New outcomes bind to the latest row. Two experiments stay unbound.
  matches.sort((left, right) => left.appliedAt.localeCompare(right.appliedAt));
  const selected = matches[matches.length - 1];
  if (!selected) {
    return undefined;
  }
  return {
    experimentId: selected.experimentId,
    applicationId: selected.applicationId,
    ...(selected.tenantId ? { tenantId: selected.tenantId } : {}),
    ...(selected.cohortRef ? { cohortRef: selected.cohortRef } : {}),
    ...(selected.appliedAt ? { appliedAt: selected.appliedAt } : {}),
  };
}

export function resolveWorkingDnaTaskOutcomeBinding(input: {
  agentId: string;
  persistDir?: string;
}): WorkingDnaTaskOutcomeBinding | undefined {
  return resolveAppliedOutcomeBinding({
    persistDir: input.persistDir,
    adapterIds: ["working-dna"],
    matchesProposal: (proposal) => isAgentTarget(proposal.target, input.agentId),
    requireExperiment: true,
    uniqueMatch: true,
  });
}

export function resolveOrganizationTaskBinding(input: {
  groupId: string;
  persistDir?: string;
}): EvolutionOutcomeBinding | undefined {
  return resolveAppliedOutcomeBinding({
    persistDir: input.persistDir,
    adapterIds: ["organization"],
    matchesProposal: (proposal) =>
      proposal.target.domain === "organization" && proposal.target.groupId === input.groupId,
    requireExperiment: true,
    uniqueMatch: true,
  });
}

export function resolveSkillInvocationBinding(input: {
  skillId: string;
  persistDir?: string;
}): EvolutionOutcomeBinding | undefined {
  return resolveAppliedOutcomeBinding({
    persistDir: input.persistDir,
    adapterIds: ["skill", "skill-installation"],
    matchesProposal: (proposal) =>
      proposal.target.domain === "capability" && proposal.target.skillId === input.skillId,
    requireExperiment: true,
    uniqueMatch: true,
  });
}

function hasId(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function stripExperimentIds<
  T extends {
    experimentId?: string | null;
    applicationId?: string | null;
    cohortRef?: string | null;
  },
>(record: T): T {
  const next = { ...record };
  delete next.experimentId;
  delete next.applicationId;
  delete next.cohortRef;
  return next;
}

function applyTrustedBinding<
  T extends {
    experimentId?: string | null;
    applicationId?: string | null;
    tenantId?: string | null;
    cohortRef?: string | null;
  },
>(record: T, binding: EvolutionOutcomeBinding | undefined): T {
  const explicitExperiment = hasId(record.experimentId ?? undefined);
  const explicitApplication = hasId(record.applicationId ?? undefined);
  const explicitCohort = hasId(record.cohortRef ?? undefined);
  if (explicitExperiment !== explicitApplication) {
    return stripExperimentIds(record);
  }
  if (!binding) {
    // Experiment/application IDs are never authoritative without a live
    // binding. A standalone cohort label is an ordinary field and may stay
    // so unlabeled baseline control can keep its cohort.
    if (explicitExperiment || explicitApplication) {
      return stripExperimentIds(record);
    }
    return record;
  }
  if (record.tenantId && binding.tenantId && record.tenantId !== binding.tenantId) {
    return stripExperimentIds(record);
  }
  if (explicitCohort && record.cohortRef !== binding.cohortRef) {
    return stripExperimentIds(record);
  }
  if (
    explicitExperiment &&
    (record.experimentId !== binding.experimentId || record.applicationId !== binding.applicationId)
  ) {
    return stripExperimentIds(record);
  }
  return {
    ...record,
    experimentId: binding.experimentId,
    applicationId: binding.applicationId,
    ...(record.tenantId || binding.tenantId
      ? { tenantId: record.tenantId ?? binding.tenantId }
      : {}),
    ...(binding.cohortRef ? { cohortRef: binding.cohortRef } : {}),
  };
}

/**
 * Stamp Working DNA experiment IDs only from a unique trusted control-plane
 * binding. Caller-supplied IDs are never authoritative: they are kept only
 * when they exactly match that binding, otherwise stripped. Ordinary runtime
 * fields are always preserved.
 */
export function bindWorkingDnaTaskOutcomeRecord<
  T extends {
    agentId: string;
    experimentId?: string;
    applicationId?: string;
    tenantId?: string;
    cohortRef?: string;
  },
>(record: T, persistDir?: string): T {
  return applyTrustedBinding(
    record,
    resolveWorkingDnaTaskOutcomeBinding({
      agentId: record.agentId,
      persistDir,
    }),
  );
}

/**
 * Same anti-forgery rules as Working DNA. Caller-supplied skill experiment
 * IDs are never authoritative.
 */
export function bindOrganizationTaskRecord<
  T extends {
    organizationId: string;
    createdAt?: string;
    experimentId?: string | null;
    applicationId?: string | null;
    tenantId?: string | null;
    cohortRef?: string | null;
  },
>(record: T, persistDir?: string): T {
  const binding = resolveOrganizationTaskBinding({
    groupId: record.organizationId,
    persistDir,
  });
  const createdAt = record.createdAt ? Date.parse(record.createdAt) : Number.NaN;
  const appliedAt = binding?.appliedAt ? Date.parse(binding.appliedAt) : Number.NaN;
  if (
    binding &&
    Number.isFinite(createdAt) &&
    Number.isFinite(appliedAt) &&
    createdAt < appliedAt
  ) {
    // Canary only stamps tasks created after this application. In-flight work
    // keeps ordinary fields and must not inherit the new experiment IDs.
    return applyTrustedBinding(record, undefined);
  }
  return applyTrustedBinding(record, binding);
}

/**
 * Persist-time binder for Organization task writers. A previously stamped
 * create-time binding is kept across later complete/reject writes so a second
 * application cannot restamp in-flight work. First writes go through the
 * trusted live binding; forged IDs are stripped.
 */
export function bindOrganizationTaskForPersist<
  T extends {
    id: string;
    organizationId: string;
    createdAt?: string;
    experimentId?: string | null;
    applicationId?: string | null;
    tenantId?: string | null;
    cohortRef?: string | null;
  },
>(incoming: T, previous: T | undefined, persistDir?: string): T {
  const previousExperimentId = previous?.experimentId ?? undefined;
  const previousApplicationId = previous?.applicationId ?? undefined;
  const previousCohortRef = previous?.cohortRef ?? undefined;
  if (hasId(previousExperimentId) && hasId(previousApplicationId)) {
    return {
      ...incoming,
      experimentId: previousExperimentId,
      applicationId: previousApplicationId,
      ...(hasId(previousCohortRef) ? { cohortRef: previousCohortRef } : {}),
    };
  }
  // First persist: caller experiment fields are never authoritative.
  return bindOrganizationTaskRecord(stripExperimentIds(incoming), persistDir);
}

export function bindSkillInvocationRecord<
  T extends {
    skillId: string;
    experimentId?: string | null;
    applicationId?: string | null;
    tenantId?: string | null;
    cohortRef?: string | null;
  },
>(record: T, persistDir?: string): T {
  return applyTrustedBinding(
    record,
    resolveSkillInvocationBinding({
      skillId: record.skillId,
      persistDir,
    }),
  );
}
