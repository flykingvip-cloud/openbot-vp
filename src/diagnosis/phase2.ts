import type { AgentRuntimeHealthFacts } from "../gateway/agent-runtime-health.js";
import {
  evaluateChannelHealth,
  type ChannelHealthEvaluation,
  type ChannelHealthPolicy,
  type ChannelHealthSnapshot,
} from "../gateway/channel-health-policy.js";
import type { DiagnosisEvidenceAdapter, EvidenceCollectResult } from "./adapters.js";
import { getEvidenceSourceManifest } from "./catalog.js";
/**
 * Phase 2 — Runtime Health / Channel / Doctor read-only surface.
 * Doctor Evidence comes from runDoctorChecks only. This module must not
 * import the CLI doctor entry, repair executors, config writers, or channel start/stop.
 * Does not schedule these Diagnosers from QUICK.
 * 4.4 cross-target aggregation lives in cross-target.ts / graph.ts (read-only, in-process).
 */
import {
  assertDoctorCheckInputReadOnly,
  runDoctorChecks,
  type DoctorCheckInput,
  type DoctorCheckRow,
} from "./doctor-check-contract.js";
import { createAgentRuntimeHealthAdapter } from "./source-adapters.js";
import {
  validateDiagnoserManifest,
  validateDiagnoserResult,
  validateDiagnosticEvidence,
  type Diagnoser,
  type DiagnoserContext,
  type DiagnoserManifest,
  type DiagnoserResult,
  type EvidenceRequirement,
  type EvidenceSourceId,
} from "./types.js";

export const PHASE2_DIAGNOSER_IDS = [
  "runtime-health",
  "channel-delivery",
  "doctor-static",
] as const;

export type Phase2DiagnoserId = (typeof PHASE2_DIAGNOSER_IDS)[number];

export const PHASE2_READABLE_SOURCE_IDS = [
  "agent_runtime_health",
  "channel_health",
  "doctor_check",
] as const satisfies readonly EvidenceSourceId[];

export const PHASE2_FORBIDDEN_OPS = [
  "startChannel",
  "stopChannel",
  "doctor_fix",
  "repair",
  "restart_gateway",
] as const;

export function isPhase2Diagnoser(id: string): id is Phase2DiagnoserId {
  return (PHASE2_DIAGNOSER_IDS as readonly string[]).includes(id);
}

export function isPhase2Readable(id: EvidenceSourceId): boolean {
  return (PHASE2_READABLE_SOURCE_IDS as readonly string[]).includes(id);
}

function req(
  source: EvidenceRequirement["source"],
  targetType: EvidenceRequirement["targetType"],
  fields: string[],
): EvidenceRequirement {
  const evidenceType =
    source === "doctor_check"
      ? "config_check"
      : source === "channel_health"
        ? "snapshot"
        : "snapshot";
  return {
    schemaVersion: 1,
    evidenceType,
    source,
    targetType,
    fields,
    sensitivity: source === "doctor_check" ? "restricted" : "internal",
    cost: source === "doctor_check" ? "medium" : "low",
    required: true,
  };
}

const MANIFESTS: readonly DiagnoserManifest[] = [
  validateDiagnoserManifest(
    {
      schemaVersion: 1,
      id: "runtime-health",
      version: "1.0.0",
      targets: ["agent"],
      modes: ["TARGETED", "FULL"],
      evidenceRequirements: [req("agent_runtime_health", "agent", ["health"])],
      produces: ["observation"],
      cost: { cpu: "low", io: "low", modelCalls: 0 },
      permissions: ["diagnosis:read"],
      mutation: "none",
    },
    "diagnoser.runtime-health",
  ),
  validateDiagnoserManifest(
    {
      schemaVersion: 1,
      id: "channel-delivery",
      version: "1.0.0",
      targets: ["channel"],
      modes: ["TARGETED", "FULL"],
      evidenceRequirements: [req("channel_health", "channel", ["healthy", "reason"])],
      produces: ["observation"],
      cost: { cpu: "low", io: "low", modelCalls: 0 },
      permissions: ["diagnosis:read"],
      mutation: "none",
    },
    "diagnoser.channel-delivery",
  ),
  validateDiagnoserManifest(
    {
      schemaVersion: 1,
      id: "doctor-static",
      version: "1.0.0",
      targets: ["gateway", "host"],
      modes: ["TARGETED", "FULL"],
      evidenceRequirements: [req("doctor_check", "gateway", ["checkId", "verdict"])],
      produces: ["observation"],
      cost: { cpu: "low", io: "medium", modelCalls: 0 },
      permissions: ["diagnosis:read"],
      mutation: "none",
    },
    "diagnoser.doctor-static",
  ),
];

export function listPhase2DiagnoserManifests(): readonly DiagnoserManifest[] {
  return MANIFESTS;
}

export function listPhase2Diagnosers(): readonly Diagnoser[] {
  return MANIFESTS.map((manifest) => ({
    manifest,
    diagnose: (context) => diagnosePhase2(manifest, context),
  }));
}

async function diagnosePhase2(
  manifest: DiagnoserManifest,
  context: DiagnoserContext,
): Promise<DiagnoserResult> {
  const sources = new Set(manifest.evidenceRequirements.map((req) => req.source));
  const evidences = context.evidence.filter((evidence) => sources.has(evidence.source));
  const observations = evidences.map((evidence, index) => {
    const predicate = manifest.evidenceRequirements[0]?.fields[0] ?? "observed";
    const raw = evidence.summary[predicate];
    const value =
      typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" || raw === null
        ? raw
        : null;
    return {
      schemaVersion: 1 as const,
      observationId: `obs-${manifest.id}-${evidence.evidenceId || index}`,
      target: evidence.target,
      predicate,
      value,
      evidenceIds: [evidence.evidenceId],
      observedAt: evidence.observedAt,
    };
  });
  const nextEvidenceRequests =
    evidences.length > 0 ? [] : manifest.evidenceRequirements.filter((req) => req.required);
  return validateDiagnoserResult(
    {
      schemaVersion: 1,
      observations,
      assessments: [],
      attributions: [],
      hypotheses: [],
      findingDrafts: [],
      relationCandidates: [],
      nextEvidenceRequests,
    },
    context.trusted,
  );
}

export function createRuntimeHealthReadAdapter(
  facts: AgentRuntimeHealthFacts | undefined,
): DiagnosisEvidenceAdapter {
  return createAgentRuntimeHealthAdapter(facts);
}

export type ChannelHealthReadInput = {
  channelId: string;
  accountId: string;
  snapshot: ChannelHealthSnapshot;
  policy: ChannelHealthPolicy;
};

export function evaluateChannelHealthReadOnly(
  input: ChannelHealthReadInput,
): ChannelHealthEvaluation {
  return evaluateChannelHealth(input.snapshot, input.policy);
}

export function createChannelHealthReadAdapter(
  input: ChannelHealthReadInput | undefined,
): DiagnosisEvidenceAdapter {
  const manifest = getEvidenceSourceManifest("channel_health");
  return {
    id: manifest.id,
    authority: manifest.authority,
    phase1Safe: false,
    collect(request, ctx): Promise<EvidenceCollectResult> {
      if (request.source !== "channel_health") {
        return Promise.resolve({ evidences: [], missing: [] });
      }
      if (!input) {
        return Promise.resolve({ evidences: [], missing: request.required ? [request] : [] });
      }
      const evaluation = evaluateChannelHealthReadOnly(input);
      const evidence = validateDiagnosticEvidence(
        {
          schemaVersion: 1,
          evidenceId: `ev-channel-${input.channelId}`,
          evidenceType: "snapshot",
          source: "channel_health",
          authority: manifest.authority,
          authorityRecordId: `channel-health:${input.channelId}:${input.accountId}`,
          observedAt: new Date(input.policy.now).toISOString(),
          target: {
            schemaVersion: 1,
            targetType: "channel",
            targetId: input.channelId,
            tenantId: ctx.tenantId,
            authority: manifest.authority,
            scope: {},
          },
          summary: {
            channelId: input.channelId,
            accountId: input.accountId,
            healthy: evaluation.healthy,
            reason: evaluation.reason,
            snapshotMissing: false,
          },
          collection: {
            method: "snapshot",
            completeness: "partial",
            attributionResolution: "not_applicable",
          },
          privacy: { classification: "internal", redacted: true },
        },
        ctx,
      );
      return Promise.resolve({ evidences: [evidence], missing: [] });
    },
  };
}

export type { DoctorCheckInput, DoctorCheckRow };

export function createDoctorCheckReadAdapter(
  checks: readonly DoctorCheckRow[] = [],
): DiagnosisEvidenceAdapter {
  const manifest = getEvidenceSourceManifest("doctor_check");
  return {
    id: manifest.id,
    authority: manifest.authority,
    phase1Safe: false,
    collect(request, ctx): Promise<EvidenceCollectResult> {
      if (request.source !== "doctor_check") {
        return Promise.resolve({ evidences: [], missing: [] });
      }
      if (checks.length === 0) {
        return Promise.resolve({ evidences: [], missing: request.required ? [request] : [] });
      }
      const evidences = checks.map((check) =>
        validateDiagnosticEvidence(
          {
            schemaVersion: 1,
            evidenceId: `ev-doctor-${check.checkId}`,
            evidenceType: "config_check",
            source: "doctor_check",
            authority: manifest.authority,
            authorityRecordId: `doctor-check:${check.checkId}`,
            observedAt: new Date(0).toISOString(),
            target: {
              schemaVersion: 1,
              targetType: "gateway",
              targetId: "gateway",
              tenantId: ctx.tenantId,
              authority: manifest.authority,
              scope: {},
            },
            summary: {
              checkId: check.checkId,
              verdict: check.verdict,
              pathLabel: check.pathLabel,
            },
            collection: {
              method: "query",
              completeness: "partial",
              attributionResolution: "not_applicable",
            },
            privacy: { classification: "restricted", redacted: true },
          },
          ctx,
        ),
      );
      return Promise.resolve({ evidences, missing: [] });
    },
  };
}

export function createDoctorCheckContractAdapter(
  input: DoctorCheckInput,
  flags: { repair?: boolean; fix?: boolean; yes?: boolean } = {},
): DiagnosisEvidenceAdapter {
  assertDoctorCheckNotRepair(flags);
  assertDoctorCheckInputReadOnly(input);
  return createDoctorCheckReadAdapter(runDoctorChecks(input));
}

export function assertDoctorCheckNotRepair(options: {
  repair?: boolean;
  fix?: boolean;
  yes?: boolean;
}): void {
  if (options.repair || options.fix || options.yes) {
    throw new Error("Phase 2 doctor adapter refuses repair/fix/yes — read-only checks only");
  }
}
