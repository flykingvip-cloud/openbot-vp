/**
 * Gateway observer for Track A's DiagnosisRecheckPort.
 * Reads live Working DNA / skill stores and optional Application
 * targetVersionAfter. Does not Apply, write a Ledger, or decide Promote.
 *
 * Expected hashes come from the control-plane Application / candidate via
 * `resolveExpectation`, or from Track A's `readApplication` view — never from
 * a control-plane VERIFIED status. This file stays a read-only observer + DI
 * helper: it must not edit WAL or the submit path.
 */
import type {
  DiagnosisRecheckRequest,
  EvolutionApplication,
  EvolutionProposal,
} from "@openbot/evolution-core";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import {
  createDiagnosisRecheckPort,
  type DiagnosisRecheckObserver,
} from "../../diagnosis/diagnose-evolution-recheck.js";
import { skillInstallationBaselineHash } from "../../diagnosis/skill-installation-candidate.js";
import { DEFAULT_WORKING_STYLE, type WorkingStyle } from "../agent-growth/genome.js";
import { readRobotWorkingStyleOrDefault } from "../agent-growth/working-style-store.js";
import { isRecord } from "../records.js";
import { createDefaultSkillLifecyclePort, type SkillLifecyclePort } from "./adapters/skill.js";
import { skillAgentIdFromCandidate } from "./authority-recheck.js";
import type { GovernedCandidate } from "./candidate-store.js";
import { workingDnaBaselineHash } from "./submit-diagnosis-candidate.js";

export type DiagnosisRecheckApplicationView = {
  targetVersionBefore: string;
  targetVersionAfter: string;
  tenantScope?: string | null;
  agentId?: string | null;
  effectWindowRef?: string | null;
};

export type DiagnosisRecheckExpectation = {
  baselineHash?: string | null;
  expectedHash?: string | null;
  expectedAgentId?: string;
  expectedSkillVersion?: string;
  expectedEnabled?: boolean;
  expectedDeltaKeys?: readonly string[];
};

export type DiagnosisRecheckExpectationReader = (
  request: DiagnosisRecheckRequest,
) => DiagnosisRecheckExpectation | undefined | Promise<DiagnosisRecheckExpectation | undefined>;

export type LiveDiagnosisRecheckObserverOptions = {
  cfg?: OpenBotConfig;
  skillPort?: SkillLifecyclePort;
  readApplication?: (applicationId: string) => Promise<DiagnosisRecheckApplicationView | null>;
  resolveExpectation?: DiagnosisRecheckExpectationReader;
};

export function skillInstallationRelationHash(input: {
  skillId: string;
  agentId: string;
  installed: boolean;
  version?: string;
  enabled?: boolean;
}): string {
  return [
    "skill-relation",
    input.skillId.trim(),
    input.agentId.trim(),
    input.installed ? "1" : "0",
    (input.version ?? "").trim(),
    input.enabled === false ? "0" : input.installed ? "1" : "",
  ].join(":");
}

export function expectationFromControlPlane(
  plane: {
    getProposal(proposalId: string): EvolutionProposal | undefined;
    getApplication(applicationId: string): EvolutionApplication | undefined;
    getCandidate(candidateRef: string): GovernedCandidate | undefined;
  },
  request: DiagnosisRecheckRequest,
): DiagnosisRecheckExpectation | undefined {
  const proposal = plane.getProposal(request.verificationRef.proposalId);
  const application = plane.getApplication(request.verificationRef.applicationId);
  const stored = proposal ? plane.getCandidate(proposal.candidateRef) : undefined;
  const payload = stored?.payload;
  const expectedAgentId =
    request.target.domain === "agent" ? request.target.agentId : skillAgentIdFromCandidate(payload);
  const delta =
    payload && typeof payload === "object" && "delta" in payload
      ? (payload as { delta?: Record<string, unknown> }).delta
      : undefined;
  const expectedSkillVersion =
    payload && typeof payload === "object" && "candidateVersion" in payload
      ? String((payload as { candidateVersion?: string }).candidateVersion ?? "")
      : undefined;
  return {
    ...(application?.targetVersionBefore ? { baselineHash: application.targetVersionBefore } : {}),
    ...(application?.targetVersionAfter ? { expectedHash: application.targetVersionAfter } : {}),
    ...(expectedAgentId ? { expectedAgentId } : {}),
    ...(expectedSkillVersion ? { expectedSkillVersion } : {}),
    expectedEnabled: true,
    ...(delta ? { expectedDeltaKeys: Object.keys(delta) } : {}),
  };
}

export function createLiveDiagnosisRecheckObserver(
  options?: LiveDiagnosisRecheckObserverOptions,
): DiagnosisRecheckObserver {
  const cfg = options?.cfg ?? loadConfig();
  const skillPort = options?.skillPort ?? createDefaultSkillLifecyclePort();
  return {
    async observe(request) {
      const application = request.verificationRef.applicationId.trim()
        ? ((await options?.readApplication?.(request.verificationRef.applicationId.trim())) ?? null)
        : null;
      const resolved = (await options?.resolveExpectation?.(request)) ?? {};
      const expectation: DiagnosisRecheckExpectation = {
        ...resolved,
        baselineHash: resolved.baselineHash ?? application?.targetVersionBefore,
        expectedHash: resolved.expectedHash ?? application?.targetVersionAfter,
        expectedAgentId: resolved.expectedAgentId ?? application?.agentId ?? undefined,
      };
      if (request.surfaceId === "capability.skill-installation") {
        if (application && options?.resolveExpectation === undefined) {
          return observeSkillFromApplication(request, skillPort, application);
        }
        return withApplicationView(
          observeSkillInstallation(request, skillPort, expectation),
          application,
        );
      }
      if (request.surfaceId === "agent.working-dna") {
        const observation = await observeWorkingDna(request, cfg, expectation);
        return withApplicationView(
          {
            ...observation,
            effectWindowRef:
              application?.effectWindowRef?.trim() ||
              (request.verificationRef.applicationId.trim()
                ? `obs:window:${request.verificationRef.applicationId.trim()}`
                : null),
          },
          application,
        );
      }
      return { status: "unreadable", observedHash: null, baselineHash: null, expectedHash: null };
    },
  };
}

export function createLiveDiagnosisRecheckPort(options?: LiveDiagnosisRecheckObserverOptions) {
  return createDiagnosisRecheckPort(createLiveDiagnosisRecheckObserver(options));
}

function withApplicationView<T extends Record<string, unknown>>(
  observation: T,
  application: DiagnosisRecheckApplicationView | null,
): T & {
  effectWindowRef?: string | null;
  observedTenantScope?: string | null;
} {
  if (!application) {
    return observation;
  }
  return {
    ...observation,
    effectWindowRef:
      application.effectWindowRef ??
      (observation as { effectWindowRef?: string | null }).effectWindowRef ??
      null,
    observedTenantScope: application.tenantScope ?? null,
  };
}

function observeSkillFromApplication(
  request: DiagnosisRecheckRequest,
  skillPort: SkillLifecyclePort,
  application: DiagnosisRecheckApplicationView,
): Awaited<ReturnType<DiagnosisRecheckObserver["observe"]>> {
  const skillId = request.target.domain === "capability" ? request.target.skillId.trim() : "";
  if (!skillId) {
    return { status: "missing", observedHash: null, baselineHash: null, expectedHash: null };
  }
  const record = skillPort.get(skillId);
  if (!record) {
    return { status: "missing", observedHash: null, baselineHash: null, expectedHash: null };
  }
  const expectedAgentId = application.agentId?.trim() ?? "";
  const snap = expectedAgentId
    ? skillPort.installation(expectedAgentId, skillId)
    : Object.values(record.installations).find((row) => row.installed);
  const installed = Boolean(snap?.installed);
  const enabled = installed && snap?.enabled !== false;
  const version = (snap?.installedVersion ?? record.version).trim();
  const relation = `skill:${record.lifecycle}:${version}:${installed && enabled ? "installed" : "missing"}`;
  return {
    status: "ok",
    observedHash: relation,
    baselineHash: application.targetVersionBefore,
    expectedHash: application.targetVersionAfter,
    effectWindowRef: application.effectWindowRef ?? null,
    observedTenantScope: application.tenantScope ?? null,
    agentMatched: expectedAgentId ? Boolean(snap) : true,
    versionMatched: application.targetVersionAfter.includes(version),
    enabled: installed ? enabled : false,
  };
}

function observeSkillInstallation(
  request: DiagnosisRecheckRequest,
  skillPort: SkillLifecyclePort,
  expectation: DiagnosisRecheckExpectation,
): {
  status: "ok" | "missing" | "unreadable";
  observedHash: string | null;
  baselineHash: string | null;
  expectedHash: string | null;
} {
  const skillId = request.target.domain === "capability" ? request.target.skillId.trim() : "";
  if (!skillId) {
    return { status: "missing", observedHash: null, baselineHash: null, expectedHash: null };
  }
  try {
    const record = skillPort.get(skillId);
    if (!record) {
      return { status: "missing", observedHash: null, baselineHash: null, expectedHash: null };
    }
    const agentId = expectation.expectedAgentId?.trim() ?? "";
    if (!agentId) {
      const installed = Object.values(record.installations).some((row) => row.installed);
      return {
        status: "ok",
        observedHash: skillInstallationBaselineHash(skillId, installed),
        baselineHash: expectation.baselineHash ?? skillInstallationBaselineHash(skillId, false),
        expectedHash: expectation.expectedHash ?? skillInstallationBaselineHash(skillId, true),
      };
    }
    const installation = skillPort.installation(agentId, skillId);
    const installed = installation?.installed === true;
    const version = installation?.installedVersion ?? "";
    const enabled = installation?.enabled;
    return {
      status: "ok",
      observedHash: skillInstallationRelationHash({
        skillId,
        agentId,
        installed,
        version,
        enabled,
      }),
      baselineHash:
        expectation.baselineHash ??
        skillInstallationRelationHash({ skillId, agentId, installed: false }),
      expectedHash:
        expectation.expectedHash ??
        skillInstallationRelationHash({
          skillId,
          agentId,
          installed: true,
          version: expectation.expectedSkillVersion?.trim() || record.version,
          enabled: expectation.expectedEnabled !== false,
        }),
    };
  } catch {
    return { status: "unreadable", observedHash: null, baselineHash: null, expectedHash: null };
  }
}

async function observeWorkingDna(
  request: DiagnosisRecheckRequest,
  cfg: OpenBotConfig,
  expectation: DiagnosisRecheckExpectation,
): Promise<{
  status: "ok" | "missing" | "unreadable";
  observedHash: string | null;
  baselineHash: string | null;
  expectedHash: string | null;
}> {
  const agentId = request.target.domain === "agent" ? request.target.agentId.trim() : "";
  if (!agentId) {
    return { status: "missing", observedHash: null, baselineHash: null, expectedHash: null };
  }
  if (expectation.expectedAgentId && expectation.expectedAgentId.trim() !== agentId) {
    return { status: "missing", observedHash: null, baselineHash: null, expectedHash: null };
  }
  try {
    const style = await readRobotWorkingStyleOrDefault(cfg, agentId);
    if (!expectedDeltaPresent(style, expectation.expectedDeltaKeys)) {
      return {
        status: "ok",
        observedHash: workingDnaBaselineHash(style),
        baselineHash: expectation.baselineHash ?? workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
        expectedHash: expectation.expectedHash ?? "style:delta-missing",
      };
    }
    return {
      status: "ok",
      observedHash: workingDnaBaselineHash(style),
      baselineHash: expectation.baselineHash ?? workingDnaBaselineHash(DEFAULT_WORKING_STYLE),
      expectedHash: expectation.expectedHash ?? null,
    };
  } catch {
    return { status: "unreadable", observedHash: null, baselineHash: null, expectedHash: null };
  }
}

function expectedDeltaPresent(style: WorkingStyle, keys: readonly string[] | undefined): boolean {
  if (!keys?.length) {
    return true;
  }
  if (!isRecord(style)) {
    return false;
  }
  return keys.every((key) => {
    const value = style[key];
    return typeof value === "string" ? value.trim() !== "" : value != null;
  });
}
