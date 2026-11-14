import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  NO_LIVE_EXECUTION_CLAIM,
  RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
  type RuntimeRuleWhitelistEntry,
} from "../../contracts/rule-adaptation-activation.js";
import type { RuntimeRuleAdaptationExpectedPolicyVersion } from "../../contracts/rule-adaptation.js";
import type { SessionTaskBoard } from "../../contracts/task.js";
import { hashCanonicalJson } from "../../policy/rule-adaptation/index.js";
import {
  legalPersonalHost,
  legalPersonalProposal,
} from "../../policy/rule-adaptation/validate.test-support.js";
import {
  seedSessionTaskBoard,
  readSessionTaskBoard,
} from "../../state/repository/task-board-file.js";
import { officialActivationBoardIo, type ActivationHostDependencies } from "./activate.js";

export const FIXTURE_TASK_ID = "task:fixture-adaptation-1";
export const FIXTURE_BOARD_SCOPE = {
  tenantId: "tenant:fixture-a",
  userId: "user:fixture-a",
  sessionId: "session:fixture-a",
};
export const FIXTURE_POLICY_VERSION: RuntimeRuleAdaptationExpectedPolicyVersion = {
  policyHash: "fixture-policy-hash-aaaa",
  protocolVersion: "1.1",
  compilerRevision: "1.2.0",
};
export const FIXTURE_NOW_MS = 1_731_398_400_000;
export const FIXTURE_AUTH_REF = "authref:fixture-tune-1";

export const FIXTURE_WHITELIST: readonly RuntimeRuleWhitelistEntry[] = [
  {
    ruleId: "model.context_window.guard",
    field: "agents.defaults.contextTokens",
    action: "tune",
  },
];

export function fixtureProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return legalPersonalProposal(overrides);
}

export function fixtureProposalHash(proposal: unknown = fixtureProposal()): string {
  return hashCanonicalJson(proposal);
}

export function fixtureActivationBinding(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const proposal = overrides.proposalForHash ?? fixtureProposal();
  const { proposalForHash: _ignored, ...rest } = overrides;
  void _ignored;
  return {
    fixture: true,
    authorizationReference: FIXTURE_AUTH_REF,
    identity: {
      principalType: "personal",
      principalId: "user:fixture-1",
      scope: { type: "personal", id: "agent:fixture-personal-1" },
    },
    taskBinding: {
      taskId: FIXTURE_TASK_ID,
      boardScope: { ...FIXTURE_BOARD_SCOPE },
    },
    expectedVersions: {
      expectedWriteEpoch: 1,
      expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
      expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
    },
    approvedCandidateIdentity: {
      proposalHash: fixtureProposalHash(proposal),
      resultKind: "shadow_accepted",
      validatorImplementationVersion: RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
    },
    hostActivationGate: "test_entry",
    permission: "tune",
    authorizedPermissions: ["tune"],
    authorizationStatus: "authorized",
    expectedPolicyState: "active",
    currentEffectiveValues: { "agents.defaults.contextTokens": 32000 },
    compatibilityRecord: {
      status: "approved_compatible",
      boundImplementationVersion: RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
      boundExpectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
    },
    nowMs: FIXTURE_NOW_MS,
    ...rest,
  };
}

export function fixtureDeps(
  sessionFile: string,
  overrides: Partial<ActivationHostDependencies> = {},
): ActivationHostDependencies {
  return {
    sessionFile,
    fixtureWhitelist: FIXTURE_WHITELIST,
    currentImplementationVersion: RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
    currentExpectedPolicyVersion: FIXTURE_POLICY_VERSION,
    boardIo: officialActivationBoardIo,
    ...overrides,
  };
}

export function fixtureBoard(overrides: Partial<SessionTaskBoard> = {}): SessionTaskBoard {
  return {
    current: {
      taskId: FIXTURE_TASK_ID,
      title: "Fixture adaptation task",
      goalText: "Demonstrate the test activation path only.",
      unfinished: true,
      stop: { summary: "stop", workspacePaths: [] },
      createdAtMs: FIXTURE_NOW_MS,
      admittedGeneration: 1,
    },
    parked: [],
    focusRevision: 1,
    writeEpoch: 0,
    resetGeneration: 1,
    scope: { ...FIXTURE_BOARD_SCOPE },
    ...overrides,
  };
}

export function openTempSession(): { dir: string; sessionFile: string; close: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-rule-adaptation-p3-"));
  const sessionFile = path.join(dir, "session.jsonl");
  fs.writeFileSync(sessionFile, "", "utf8");
  return {
    dir,
    sessionFile,
    close: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function seedFixtureBoard(
  sessionFile: string,
  overrides: Partial<SessionTaskBoard> = {},
): SessionTaskBoard {
  seedSessionTaskBoard(sessionFile, fixtureBoard(overrides));
  return readSessionTaskBoard(sessionFile);
}

/** Host facts used only to confirm the P1 validator still returns activationAllowed=false. */
export function authorizedPersonalHost(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return legalPersonalHost({
    authorizationStatus: "authorized",
    expectedPolicyState: "active",
    ...overrides,
  });
}
