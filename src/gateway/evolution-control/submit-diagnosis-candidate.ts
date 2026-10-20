/**
 * Recoverable diagnosis candidate submit. Public fields are
 * { commandId, candidate, trustedContext, grantId } only.
 *
 * Uses explicit proposal / candidate / ledger / WAL ports.
 * Does not call registerProposal, startExperiment, or Adapter.apply.
 * Does not wire live diagnose auto-submit or client Candidate RPC.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import {
  admitDiagnosisIngest,
  assertCommandDoesNotRebindCandidate,
  assertEvolutionSubmissionRef,
  DIAGNOSIS_CANDIDATE_PUBLIC_SUBMIT_FORBIDDEN_FIELDS,
  diagnosisIngestDedupKey,
  diagnosisIngestProposalCreatedEventId,
  evaluationProducerKindFromMechanism,
  ledgerActionForWalStep,
  recoverDiagnosisIngestWal,
  skillMetricSet,
  type DiagnosisCandidateSubmitInput,
  type DiagnosisIngestWalRecord,
  type EvolutionExperiment,
  type EvolutionProposal,
  type EvolutionSubmissionRef,
  type TrustedEvolutionSubmitContext,
} from "@openbot/evolution-core";
import {
  readGrowthAssessmentSnapshot,
  type GrowthSnapshotValidation,
} from "../../diagnosis/diagnose-growth-snapshot.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import {
  skillInstallDeltaFromProposedChange,
  validateSkillInstallationCandidate,
  type SkillInstallationCandidate,
} from "../../diagnosis/skill-installation-candidate.js";
import {
  validateStructuralEvolutionCandidate,
  workingStyleDeltaFromProposedChange,
  type StructuralEvolutionCandidate,
} from "../../diagnosis/structural-evolution-candidate.js";
import type { WorkingStyle } from "../agent-growth/genome.js";
import type { SkillCandidate } from "./adapters/skill.js";
import type { WorkingDnaCandidate } from "./adapters/working-dna.js";
import { checkEvolutionAuthority } from "./authority-gate.js";
import type { GovernedCandidate } from "./candidate-store.js";
import { sealDiagnosisGovernedCandidate } from "./candidate-store.js";
import { looksLikeSkillInstallationCandidate } from "./diagnosis-ingest.js";
import type { EvolutionLedger, LedgerAppendInput } from "./evolution-ledger.js";
import { createDurableMap, resolveEvolutionControlRoot } from "./persistent-store.js";

export type DiagnosisSubmitDenialCode =
  | "grant_missing"
  | "grant_inactive"
  | "cross_tenant"
  | "unknown_target"
  | "forbidden_surface"
  | "unsupported_surface"
  | "command_rebind"
  | "candidate_invalid"
  | "snapshot_missing"
  | "snapshot_corrupt"
  | "snapshot_expired"
  | "baseline_hash_mismatch"
  | "public_field_forbidden";

export type DiagnosisSubmitOk = {
  ok: true;
  receipt: EvolutionSubmissionRef;
  writes: { proposal: boolean; candidate: boolean; ledger: boolean };
};

export type DiagnosisSubmitDenial = {
  ok: false;
  code: DiagnosisSubmitDenialCode;
  writes: readonly [];
};

export type DiagnosisSubmitResult = DiagnosisSubmitOk | DiagnosisSubmitDenial;

export type DiagnosisGrantView =
  | { status: "missing" }
  | {
      grantId: string;
      status: string;
      tenantScope: string | null;
      agentId: string;
      allowedEvidence: readonly string[];
      allowedActions: readonly string[];
      confidentialityCeiling: "personal" | "enterprise" | "platform";
      expired?: boolean;
      revoked?: boolean;
    };

export type DiagnosisSubmitCandidatePayload = WorkingDnaCandidate | SkillCandidate;

export type SkillInstallationTargetView = {
  known: boolean;
  installed: boolean;
  hash: string;
};

export type DiagnosisSubmitWritePorts = {
  putProposal(proposal: EvolutionProposal): void;
  getProposal(proposalId: string): EvolutionProposal | undefined;
  listProposals(): EvolutionProposal[];
  putCandidate(candidateRef: string, payload: DiagnosisSubmitCandidatePayload): GovernedCandidate;
  appendLedger(input: LedgerAppendInput): { eventId: string };
  hasLedgerEvent(eventId: string): boolean;
  getWal(commandId: string): DiagnosisIngestWalRecord | undefined;
  listWals(): DiagnosisIngestWalRecord[];
  putWal(record: DiagnosisIngestWalRecord): void;
};

export type DiagnosisSubmitDeps = {
  ports: DiagnosisSubmitWritePorts;
  inspectGrant: (grantId: string) => DiagnosisGrantView;
  readSnapshot: (input: { tenantId: string; snapshotId: string }) => GrowthSnapshotValidation;
  readBaseline: (agentId: string) => { style: WorkingStyle; hash: string } | null;
  readSkillTarget?: (input: {
    agentId: string;
    skillId: string;
  }) => SkillInstallationTargetView | null;
  now: () => string;
};

type ParsedDiagnosisCandidate =
  | { kind: "working-dna"; candidate: StructuralEvolutionCandidate }
  | { kind: "skill-installation"; candidate: SkillInstallationCandidate };

type ResolvedDiagnosisSubmitTarget = {
  target: EvolutionProposal["target"];
  targetKey: string;
  mapped: DiagnosisSubmitCandidatePayload;
};

const EMPTY_WRITES = [] as const;

export function workingDnaBaselineHash(style: WorkingStyle): string {
  return `style:${style.outputFormat}:${style.reportingCadence}:${style.decisionPreference}:${style.riskPreference}:${style.communicationTone}`;
}

export function createMemoryDiagnosisSubmitPorts(
  seed: {
    proposals?: EvolutionProposal[];
    wals?: DiagnosisIngestWalRecord[];
    ledgerEventIds?: string[];
  } = {},
): DiagnosisSubmitWritePorts {
  const proposals = new Map<string, EvolutionProposal>(
    (seed.proposals ?? []).map((row) => [row.proposalId, row]),
  );
  const wals = new Map<string, DiagnosisIngestWalRecord>(
    (seed.wals ?? []).map((row) => [row.commandId, row]),
  );
  const candidates = new Map<string, GovernedCandidate>();
  const ledgerIds = new Set<string>(seed.ledgerEventIds ?? []);
  return {
    putProposal(proposal) {
      proposals.set(proposal.proposalId, proposal);
    },
    getProposal(proposalId) {
      return proposals.get(proposalId);
    },
    listProposals() {
      return [...proposals.values()];
    },
    putCandidate(candidateRef, payload) {
      const sealed = sealDiagnosisGovernedCandidate(candidateRef, payload);
      candidates.set(candidateRef, sealed);
      return sealed;
    },
    appendLedger(input) {
      ledgerIds.add(input.eventId);
      return { eventId: input.eventId };
    },
    hasLedgerEvent(eventId) {
      return ledgerIds.has(eventId);
    },
    getWal(commandId) {
      return wals.get(commandId);
    },
    listWals() {
      return [...wals.values()];
    },
    putWal(record) {
      wals.set(record.commandId, record);
    },
  };
}

export type DiagnosisControlPlaneSink = {
  stageDiagnosisProposal(proposal: EvolutionProposal): void;
  getProposal(proposalId: string): EvolutionProposal | undefined;
  listProposals(): EvolutionProposal[];
  registerCandidate(
    candidateRef: string,
    payload: unknown,
    governedVersion?: string,
  ): GovernedCandidate;
  ledger: EvolutionLedger;
};

export function diagnosisIngestWalPath(persistDir?: string): string {
  return path.join(resolveEvolutionControlRoot(persistDir), "diagnosis-ingest-wal.json");
}

/** Write diagnosis submit into the live control plane and a durable WAL. Does not start an experiment. */
export function createControlPlaneDiagnosisSubmitPorts(
  plane: DiagnosisControlPlaneSink,
  walFile: string = diagnosisIngestWalPath(),
): DiagnosisSubmitWritePorts {
  const wals = createDurableMap<DiagnosisIngestWalRecord>(walFile);
  return {
    putProposal(proposal) {
      plane.stageDiagnosisProposal(proposal);
    },
    getProposal(proposalId) {
      return plane.getProposal(proposalId);
    },
    listProposals() {
      return plane.listProposals();
    },
    putCandidate(candidateRef, payload) {
      return plane.registerCandidate(candidateRef, payload, candidateRef);
    },
    appendLedger(input) {
      plane.ledger.append(input);
      return { eventId: input.eventId };
    },
    hasLedgerEvent(eventId) {
      return plane.ledger.list().some((event) => event.eventId === eventId);
    },
    getWal(commandId) {
      return wals.get(commandId);
    },
    listWals() {
      return [...wals.values()];
    },
    putWal(record) {
      wals.set(record.commandId, record);
    },
  };
}

function storedContentVersion(stored: GovernedCandidate | undefined): string {
  const payload = stored?.payload;
  if (!payload || typeof payload !== "object" || !("candidateVersion" in payload)) {
    return "";
  }
  const version = payload.candidateVersion;
  return typeof version === "string" ? version : "";
}

function storedBaselineVersion(stored: GovernedCandidate | undefined): string {
  const payload = stored?.payload;
  if (payload && typeof payload === "object" && "baselineStyle" in payload) {
    const style = payload.baselineStyle;
    if (style && typeof style === "object") {
      return workingDnaBaselineHash(style as WorkingStyle);
    }
  }
  return storedContentVersion(stored);
}

/** Freeze a diagnosis-origin proposal from the Candidate Store row. Null for other producers. */
export function diagnosisExperimentFreeze(
  proposal: EvolutionProposal,
  stored: GovernedCandidate | undefined,
): EvolutionExperiment["frozen"] | null {
  if (evaluationProducerKindFromMechanism(proposal.sourceMechanismRef) !== "diagnosis-origin") {
    return null;
  }
  if (!stored || stored.candidateRef !== proposal.candidateRef) {
    return null;
  }
  const contentVersion = storedContentVersion(stored) || proposal.candidateRef;
  return {
    baselineVersion: storedBaselineVersion(stored) || contentVersion,
    candidateVersion: proposal.candidateRef,
    codeSha: contentVersion,
    modelRef: proposal.sourceMechanismRef,
    providerVersion: "diagnosis-submit",
    configSnapshotRef: proposal.proposalId,
    datasetOrCohortRef: proposal.sourceEvidenceRefs[0] ?? proposal.proposalId,
    tenantScope: proposal.tenantScope,
    confidentialityScope: proposal.confidentialityScope,
    expiresAt: proposal.expiresAt,
    maxResourceBudget: 1,
  };
}

/**
 * Keep a client freeze when it names the stored diagnosis candidate.
 * Missing freeze uses the Candidate Store. Other producers are unchanged.
 */
export function alignDiagnosisExperimentFreeze(
  proposal: EvolutionProposal,
  stored: GovernedCandidate | undefined,
  freeze: EvolutionExperiment["frozen"] | null,
): EvolutionExperiment["frozen"] | null {
  const synthesized = diagnosisExperimentFreeze(proposal, stored);
  if (!freeze) {
    return synthesized;
  }
  if (!synthesized) {
    return freeze;
  }
  const contentVersion = storedContentVersion(stored);
  if (
    freeze.candidateVersion === proposal.candidateRef ||
    (contentVersion !== "" && freeze.candidateVersion === contentVersion)
  ) {
    return { ...freeze, candidateVersion: proposal.candidateRef };
  }
  return freeze;
}

export function defaultSnapshotReader(configDir: string, nowMs?: number) {
  return (input: { tenantId: string; snapshotId: string }): GrowthSnapshotValidation =>
    readGrowthAssessmentSnapshot({
      tenantId: input.tenantId,
      snapshotId: input.snapshotId,
      configDir,
      nowMs,
    });
}

export function createDiagnosisCandidateSubmitter(deps: DiagnosisSubmitDeps) {
  const tails = new Map<string, Promise<unknown>>();
  return {
    submit(input: DiagnosisCandidateSubmitInput<unknown>): Promise<DiagnosisSubmitResult> {
      const previous = tails.get(input.commandId) ?? Promise.resolve();
      const run = previous.then(
        () => submitDiagnosisCandidate(input, deps),
        () => submitDiagnosisCandidate(input, deps),
      );
      tails.set(
        input.commandId,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
    },
  };
}

export async function submitDiagnosisCandidate(
  input: DiagnosisCandidateSubmitInput<unknown>,
  deps: DiagnosisSubmitDeps,
): Promise<DiagnosisSubmitResult> {
  const denied = denyIfPublicShapeInvalid(input);
  if (denied) {
    return denied;
  }
  if (!input.commandId.trim() || !input.grantId.trim()) {
    return deny(input.grantId.trim() ? "candidate_invalid" : "grant_missing");
  }
  const parsed = parseDiagnosisSubmitCandidate(input.candidate);
  if (!parsed) {
    return deny("candidate_invalid");
  }
  const candidate = parsed.candidate;
  const trusted = input.trustedContext;
  const grant = deps.inspectGrant(input.grantId);
  if (grant.status === "missing" || !("grantId" in grant)) {
    return deny("grant_missing");
  }
  if (grant.expired || grant.revoked || grant.status !== "APPROVED") {
    return deny("grant_inactive");
  }
  const agentId = trusted.agentId.trim();
  if (!agentId || !grant.agentId.trim()) {
    return deny("unknown_target");
  }
  if (grant.agentId !== agentId) {
    return deny("unknown_target");
  }
  if (!trusted.tenantId.trim()) {
    return deny("cross_tenant");
  }
  if (grant.tenantScope !== trusted.tenantId) {
    return deny("cross_tenant");
  }

  const snapshot = deps.readSnapshot({
    tenantId: trusted.tenantId,
    snapshotId: candidate.snapshotRef,
  });
  const snapshotCode = snapshotFailCode(snapshot);
  if (snapshotCode) {
    return deny(snapshotCode);
  }
  if (!snapshot.ok) {
    return deny("snapshot_corrupt");
  }
  if (snapshot.snapshot.tenantId !== trusted.tenantId) {
    return deny("cross_tenant");
  }
  if (snapshot.snapshot.agentId !== agentId) {
    return deny("unknown_target");
  }

  const resolved = resolveDiagnosisSubmitTarget(parsed, deps, agentId);
  if (!resolved.ok) {
    return deny(resolved.code);
  }

  const admit = admitDiagnosisIngest({
    commandId: input.commandId,
    grantId: input.grantId,
    grantActive: true,
    trustedTenantId: trusted.tenantId,
    surfaceId: candidate.surfaceId,
    targetKey: resolved.targetKey,
    targetKnown: true,
    mechanism: candidate.mechanismRef,
    candidateVersion: candidate.candidateVersion,
    contentHash: candidate.candidatePayloadHash,
  });
  if (!admit.ok) {
    return deny(admit.code);
  }

  const inspector = grantInspector(grant);
  const authority = checkEvolutionAuthority(inspector, {
    surfaceId: candidate.surfaceId,
    grantId: input.grantId,
    tenantScope: trusted.tenantId,
    trustedTenantId: trusted.tenantId,
    requestedAction: "suggest",
    evidenceRefs: candidate.evidenceRefs,
    confidentialityScope: "enterprise",
  });
  if (!authority.ok) {
    return deny(authority.code === "authorization_required" ? "grant_missing" : "grant_inactive");
  }

  const existingCommand = deps.ports.getWal(input.commandId);
  if (existingCommand) {
    const rebind = assertCommandDoesNotRebindCandidate({
      existing: existingCommand,
      commandId: input.commandId,
      contentHash: candidate.candidatePayloadHash,
      candidateRef: existingCommand.candidateRef,
    });
    if (!rebind.ok) {
      return deny("command_rebind");
    }
    return finishExisting(existingCommand, input, parsed, resolved, deps, trusted);
  }

  const duplicate = deps.ports
    .listWals()
    .find(
      (row) => diagnosisIngestDedupKey(row) === admit.dedupKey && row.commandId !== input.commandId,
    );
  if (duplicate) {
    return reuseExistingProposal(duplicate, input, deps);
  }

  return commitNew(input, parsed, resolved, admit.dedupKey, deps, trusted);
}

function deny(code: DiagnosisSubmitDenialCode): DiagnosisSubmitDenial {
  return { ok: false, code, writes: EMPTY_WRITES };
}

function denyIfPublicShapeInvalid(
  input: DiagnosisCandidateSubmitInput<unknown>,
): DiagnosisSubmitDenial | null {
  for (const field of DIAGNOSIS_CANDIDATE_PUBLIC_SUBMIT_FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      return deny("public_field_forbidden");
    }
  }
  return null;
}

function snapshotFailCode(snapshot: GrowthSnapshotValidation): DiagnosisSubmitDenialCode | null {
  if (snapshot.ok) {
    return null;
  }
  if (snapshot.reason === "snapshot_missing") {
    return "snapshot_missing";
  }
  if (snapshot.reason === "expired") {
    return "snapshot_expired";
  }
  return "snapshot_corrupt";
}

function grantInspector(
  grant: Exclude<DiagnosisGrantView, { status: "missing" }>,
): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: grant.grantId,
      status: grant.status,
      tenantScope: grant.tenantScope,
      allowedEvidence: [...grant.allowedEvidence],
      allowedActions: [...grant.allowedActions],
      confidentialityCeiling: grant.confidentialityCeiling,
      ...(grant.expired ? { expired: true } : {}),
      ...(grant.revoked ? { revoked: true } : {}),
    }),
  };
}

function allocateProposalId(dedupKey: string): string {
  return `evo:diag:${createHash("sha256").update(dedupKey).digest("hex").slice(0, 16)}`;
}

function allocateCandidateRef(candidateVersion: string): string {
  return `cand:diag:${candidateVersion.slice(0, 32)}`;
}

function parseDiagnosisSubmitCandidate(input: unknown): ParsedDiagnosisCandidate | null {
  if (looksLikeSkillInstallationCandidate(input)) {
    const validated = validateSkillInstallationCandidate(input);
    if (!validated.ok) {
      return null;
    }
    return { kind: "skill-installation", candidate: validated.candidate };
  }
  const validated = validateStructuralEvolutionCandidate(input);
  if (!validated.ok) {
    return null;
  }
  return { kind: "working-dna", candidate: validated.candidate };
}

function resolveDiagnosisSubmitTarget(
  parsed: ParsedDiagnosisCandidate,
  deps: DiagnosisSubmitDeps,
  agentId: string,
): ({ ok: true } & ResolvedDiagnosisSubmitTarget) | { ok: false; code: DiagnosisSubmitDenialCode } {
  if (parsed.kind === "working-dna") {
    const baseline = deps.readBaseline(agentId);
    if (!baseline || baseline.hash !== parsed.candidate.baselineHash) {
      return { ok: false, code: "baseline_hash_mismatch" };
    }
    return {
      ok: true,
      target: { domain: "agent", agentId },
      targetKey: `agent:${agentId}`,
      mapped: mappedWorkingDna(agentId, parsed.candidate, baseline.style),
    };
  }
  const skillId = parsed.candidate.proposedChange.skillId.trim();
  if (!skillId) {
    return { ok: false, code: "unknown_target" };
  }
  const view = deps.readSkillTarget?.({ agentId, skillId }) ?? null;
  if (!view || !view.known) {
    return { ok: false, code: "unknown_target" };
  }
  if (view.installed) {
    return { ok: false, code: "candidate_invalid" };
  }
  if (view.hash !== parsed.candidate.baselineHash) {
    return { ok: false, code: "baseline_hash_mismatch" };
  }
  return {
    ok: true,
    target: { domain: "capability", skillId },
    targetKey: `capability:${skillId}:agent:${agentId}`,
    mapped: mappedSkillInstall(agentId, parsed.candidate),
  };
}

function mappedWorkingDna(
  agentId: string,
  candidate: StructuralEvolutionCandidate,
  baselineStyle: WorkingStyle,
): WorkingDnaCandidate {
  return {
    agentId,
    delta: workingStyleDeltaFromProposedChange(candidate.proposedChange),
    baselineStyle,
    candidateVersion: candidate.candidateVersion,
  };
}

function mappedSkillInstall(
  agentId: string,
  candidate: SkillInstallationCandidate,
): SkillCandidate {
  const delta = skillInstallDeltaFromProposedChange(candidate.proposedChange);
  return {
    skillId: delta.skillId,
    operation: delta.operation,
    agentId,
    candidateVersion: candidate.candidateVersion,
  };
}

function receiptFor(commandId: string, wal: DiagnosisIngestWalRecord): EvolutionSubmissionRef {
  return assertEvolutionSubmissionRef({
    schemaVersion: 1,
    commandId,
    proposalId: wal.proposalId,
    candidateRef: wal.candidateRef,
    surfaceId: wal.surfaceId,
    contentHash: wal.contentHash,
  });
}

async function finishExisting(
  existing: DiagnosisIngestWalRecord,
  input: DiagnosisCandidateSubmitInput<unknown>,
  parsed: ParsedDiagnosisCandidate,
  resolved: ResolvedDiagnosisSubmitTarget,
  deps: DiagnosisSubmitDeps,
  trusted: TrustedEvolutionSubmitContext,
): Promise<DiagnosisSubmitResult> {
  const proposal =
    deps.ports.getProposal(existing.proposalId) ??
    buildProposal(existing, parsed, trusted, deps.now(), input.grantId, resolved.target);
  return applyMissingSteps({
    wal: existing,
    proposal,
    mapped: resolved.mapped,
    input,
    deps,
  });
}

function reuseExistingProposal(
  duplicate: DiagnosisIngestWalRecord,
  input: DiagnosisCandidateSubmitInput<unknown>,
  deps: DiagnosisSubmitDeps,
): DiagnosisSubmitResult {
  const wal: DiagnosisIngestWalRecord = {
    ...duplicate,
    commandId: input.commandId,
    state: "committed",
    ledgerEventIds: [...duplicate.ledgerEventIds],
  };
  deps.ports.putWal(wal);
  return {
    ok: true,
    receipt: receiptFor(input.commandId, wal),
    writes: { proposal: false, candidate: false, ledger: false },
  };
}

async function commitNew(
  input: DiagnosisCandidateSubmitInput<unknown>,
  parsed: ParsedDiagnosisCandidate,
  resolved: ResolvedDiagnosisSubmitTarget,
  dedupKey: string,
  deps: DiagnosisSubmitDeps,
  trusted: TrustedEvolutionSubmitContext,
): Promise<DiagnosisSubmitResult> {
  const candidate = parsed.candidate;
  const proposalId = allocateProposalId(dedupKey);
  const candidateRef = allocateCandidateRef(candidate.candidateVersion);
  const wal: DiagnosisIngestWalRecord = {
    commandId: input.commandId,
    proposalId,
    candidateRef,
    surfaceId: candidate.surfaceId,
    contentHash: candidate.candidatePayloadHash,
    tenantScope: trusted.tenantId,
    targetKey: resolved.targetKey,
    mechanism: candidate.mechanismRef,
    candidateVersion: candidate.candidateVersion,
    grantId: input.grantId,
    state: "pending",
    ledgerEventIds: [],
  };
  deps.ports.putWal(wal);
  const proposal = buildProposal(wal, parsed, trusted, deps.now(), input.grantId, resolved.target);
  return applyMissingSteps({
    wal,
    proposal,
    mapped: resolved.mapped,
    input,
    deps,
  });
}

function buildProposal(
  wal: DiagnosisIngestWalRecord,
  parsed: ParsedDiagnosisCandidate,
  trusted: TrustedEvolutionSubmitContext,
  now: string,
  grantId: string,
  target: EvolutionProposal["target"],
): EvolutionProposal {
  const candidate = parsed.candidate;
  const expectedEffects =
    parsed.kind === "skill-installation"
      ? [skillMetricSet().primary]
      : [
          {
            metricId: "task_success_rate" as const,
            improveWhen: "increase" as const,
            minimumEffect: 0.02,
          },
        ];
  return {
    schemaVersion: 2,
    proposalId: wal.proposalId,
    sourceEvidenceRefs: [...candidate.evidenceRefs],
    sourceMechanismRef: candidate.mechanismRef,
    target,
    candidateRef: wal.candidateRef,
    surfaceId: candidate.surfaceId,
    expectedEffects,
    riskLevel: "medium",
    confidentialityScope: "enterprise",
    tenantScope: trusted.tenantId,
    grantId,
    status: "APPROVED_FOR_EXPERIMENT",
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function applyMissingSteps(input: {
  wal: DiagnosisIngestWalRecord;
  proposal: EvolutionProposal;
  mapped: DiagnosisSubmitCandidatePayload;
  input: DiagnosisCandidateSubmitInput<unknown>;
  deps: DiagnosisSubmitDeps;
}): Promise<DiagnosisSubmitResult> {
  const recovery = recoverDiagnosisIngestWal(input.wal);
  let wal = { ...input.wal, ledgerEventIds: [...input.wal.ledgerEventIds] };
  const writes = { proposal: false, candidate: false, ledger: false };
  const existingEventIds = [
    ...wal.ledgerEventIds,
    ...[...input.deps.ports.listWals()].flatMap((row) => row.ledgerEventIds),
  ];
  for (const step of recovery.stepsToApply) {
    if (step === "proposal_written") {
      input.deps.ports.putProposal(input.proposal);
      wal = { ...wal, state: "proposal_written" };
      writes.proposal = true;
      input.deps.ports.putWal(wal);
      continue;
    }
    if (step === "candidate_written") {
      input.deps.ports.putCandidate(wal.candidateRef, input.mapped);
      wal = { ...wal, state: "candidate_written" };
      writes.candidate = true;
      input.deps.ports.putWal(wal);
      continue;
    }
    if (step === "ledger_written") {
      const action = ledgerActionForWalStep({
        commandId: wal.commandId,
        step,
        existingEventIds: [
          ...existingEventIds,
          ...wal.ledgerEventIds,
          ...(input.deps.ports.hasLedgerEvent(diagnosisIngestProposalCreatedEventId(wal.commandId))
            ? [diagnosisIngestProposalCreatedEventId(wal.commandId)]
            : []),
        ],
      });
      const eventId = action.appendEventIds[0];
      if (eventId) {
        input.deps.ports.appendLedger({
          eventId,
          type: "proposal.created",
          timestamp: input.deps.now(),
          proposalId: wal.proposalId,
          target: input.proposal.target,
          surfaceId: wal.surfaceId,
          tenantScope: wal.tenantScope,
          principalRef: input.input.trustedContext.principalRef,
          grantId: wal.grantId,
          evidenceRefs: input.proposal.sourceEvidenceRefs,
        });
        wal = {
          ...wal,
          state: "ledger_written",
          ledgerEventIds: [...wal.ledgerEventIds, ...action.appendEventIds],
        };
        writes.ledger = true;
      } else {
        wal = { ...wal, state: "ledger_written" };
      }
      input.deps.ports.putWal(wal);
      continue;
    }
    wal = { ...wal, state: "committed" };
    input.deps.ports.putWal(wal);
  }
  return {
    ok: true,
    receipt: receiptFor(input.input.commandId, wal),
    writes,
  };
}
