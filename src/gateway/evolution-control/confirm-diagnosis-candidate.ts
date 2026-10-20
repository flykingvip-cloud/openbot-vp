/**
 * A2: confirm a persisted diagnosis preview, then submit.
 * Clients cannot send a candidate payload. Diagnose never auto-submits.
 */
import fs from "node:fs";
import { loadConfig } from "../../config/config.js";
import type { AuthorizationGrant } from "../../diagnosis/delegation.js";
import {
  readDiagnosisEvolutionPreview,
  type DiagnosisEvolutionPreviewCandidate,
} from "../../diagnosis/diagnose-evolution-preview-store.js";
import { readGrowthAssessmentSnapshot } from "../../diagnosis/diagnose-growth-snapshot.js";
import { skillInstallationBaselineHash } from "../../diagnosis/skill-installation-candidate.js";
import { CONFIG_DIR } from "../../utils.js";
import { DEFAULT_WORKING_STYLE, type WorkingStyle } from "../agent-growth/genome.js";
import { resolveRobotWorkingStylePath } from "../agent-growth/working-style-store.js";
import { createDefaultSkillLifecyclePort } from "./adapters/skill.js";
import { ensureEvolutionControlPlaneStarted } from "./bootstrap.js";
import { getSharedDiagnosisDelegationMachine } from "./delegation-service.js";
import { parseEvolutionGrantPurpose } from "./evolution-grant.js";
import {
  createControlPlaneDiagnosisSubmitPorts,
  defaultSnapshotReader,
  diagnosisIngestWalPath,
  submitDiagnosisCandidate,
  workingDnaBaselineHash,
  type DiagnosisGrantView,
  type DiagnosisSubmitDeps,
  type DiagnosisSubmitResult,
} from "./submit-diagnosis-candidate.js";

let confirmDepsOverride: DiagnosisSubmitDeps | undefined;

export function setDiagnosisCandidateConfirmDepsForTests(deps?: DiagnosisSubmitDeps): void {
  confirmDepsOverride = deps;
}

export function resolveDiagnosisCandidateConfirmDeps(
  configDir: string = CONFIG_DIR,
): DiagnosisSubmitDeps {
  if (confirmDepsOverride) {
    return confirmDepsOverride;
  }
  const plane = ensureEvolutionControlPlaneStarted();
  return {
    ports: createControlPlaneDiagnosisSubmitPorts(plane, diagnosisIngestWalPath()),
    inspectGrant: (grantId) =>
      diagnosisGrantViewFromAuthorization(getSharedDiagnosisDelegationMachine().getGrant(grantId)),
    readSnapshot: defaultSnapshotReader(configDir),
    readBaseline: (agentId: string) => {
      // Align with structural preview: hash the live robot working-style, not DEFAULT.
      try {
        const cfg = loadConfig();
        const stylePath = resolveRobotWorkingStylePath(cfg, agentId);
        if (fs.existsSync(stylePath)) {
          const stored = JSON.parse(fs.readFileSync(stylePath, "utf8")) as Partial<WorkingStyle>;
          const style = { ...DEFAULT_WORKING_STYLE, ...stored };
          return { style, hash: workingDnaBaselineHash(style) };
        }
      } catch {
        // fall through to DEFAULT
      }
      return {
        style: DEFAULT_WORKING_STYLE,
        hash: workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
      };
    },
    readSkillTarget: ({ agentId, skillId }) => {
      const port = createDefaultSkillLifecyclePort();
      const record = port.get(skillId);
      const installed = Boolean(port.installation(agentId, skillId)?.installed);
      return {
        known: Boolean(record),
        installed,
        hash: skillInstallationBaselineHash(skillId, installed),
      };
    },
    now: () => new Date().toISOString(),
  };
}

export type ConfirmDiagnosisCandidateInput = {
  commandId: string;
  grantId: string;
  candidateVersion: string;
  tenantId: string;
  principalRef: string;
  confirmedByUser: boolean;
  configDir: string;
  nowMs?: number;
  clientParams?: Record<string, unknown>;
  deps: DiagnosisSubmitDeps;
};

export type ConfirmDiagnosisCandidateDenialCode =
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
  | "public_field_forbidden"
  | "preview_missing"
  | "confirm_required"
  | "client_candidate_forbidden"
  | "snapshot_agent_missing";

export type ConfirmDiagnosisCandidateResult =
  | Extract<DiagnosisSubmitResult, { ok: true }>
  | { ok: false; code: ConfirmDiagnosisCandidateDenialCode; writes: readonly [] };

const EMPTY_WRITES = [] as const;

export async function confirmDiagnosisCandidatePreview(
  input: ConfirmDiagnosisCandidateInput,
): Promise<ConfirmDiagnosisCandidateResult> {
  if (input.clientParams && "candidate" in input.clientParams) {
    return deny("client_candidate_forbidden");
  }
  if (!input.confirmedByUser) {
    return deny("confirm_required");
  }
  const preview = readDiagnosisEvolutionPreview({
    tenantId: input.tenantId,
    candidateVersion: input.candidateVersion,
    configDir: input.configDir,
    nowMs: input.nowMs,
  });
  if (!preview.ok) {
    return deny(preview.reason === "expired" ? "snapshot_expired" : "preview_missing");
  }
  const agentId = agentIdFromPreview(preview.record.candidate, input);
  if (!agentId) {
    return deny("snapshot_agent_missing");
  }
  return submitDiagnosisCandidate(
    {
      commandId: input.commandId,
      candidate: preview.record.candidate,
      trustedContext: {
        tenantId: input.tenantId,
        principalRef: input.principalRef,
        agentId,
        confirmedByUser: true,
      },
      grantId: input.grantId,
    },
    input.deps,
  );
}

export function diagnosisGrantViewFromAuthorization(
  grant: AuthorizationGrant | null | undefined,
  nowMs: number = Date.now(),
): DiagnosisGrantView {
  if (!grant) {
    return { status: "missing" };
  }
  const metadata = parseEvolutionGrantPurpose(grant.purpose);
  const expired = Date.parse(grant.expiresAt) <= nowMs;
  return {
    grantId: grant.grantId,
    status: grant.status,
    tenantScope: grant.targetTenant,
    agentId: metadata?.agentId ?? grant.targetScope.targetId ?? "",
    allowedEvidence: [...grant.allowedEvidence],
    allowedActions: [...grant.allowedActions],
    confidentialityCeiling: "enterprise",
    ...(expired ? { expired: true } : {}),
    ...(grant.status === "REVOKED" ? { revoked: true } : {}),
  };
}

function agentIdFromPreview(
  candidate: DiagnosisEvolutionPreviewCandidate,
  input: ConfirmDiagnosisCandidateInput,
): string | null {
  const snapshot = readGrowthAssessmentSnapshot({
    tenantId: input.tenantId,
    snapshotId: candidate.snapshotRef,
    configDir: input.configDir,
    nowMs: input.nowMs,
  });
  if (!snapshot.ok) {
    return null;
  }
  const agentId = snapshot.snapshot.agentId.trim();
  return agentId || null;
}

function deny(code: ConfirmDiagnosisCandidateDenialCode): ConfirmDiagnosisCandidateResult {
  return { ok: false, code, writes: EMPTY_WRITES };
}
