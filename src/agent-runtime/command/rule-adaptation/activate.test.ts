import { expect, it } from "vitest";
import { NO_LIVE_EXECUTION_CLAIM } from "../../contracts/rule-adaptation-activation.js";
import { validateRuntimeRuleProposal } from "../../policy/rule-adaptation/index.js";
import { cloneBoardShell, readSessionTaskBoard } from "../../state/repository/task-board-file.js";
import {
  activateApprovedRuntimeRuleProposal,
  officialActivationBoardIo,
  readActivatedRuntimeRulePolicy,
  revokeActivatedRuntimeRulePolicy,
  rollbackActivatedRuntimeRulePolicy,
} from "./activate.js";
import {
  authorizedPersonalHost,
  fixtureActivationBinding,
  fixtureDeps,
  fixtureProposal,
  FIXTURE_BOARD_SCOPE,
  FIXTURE_POLICY_VERSION,
  FIXTURE_TASK_ID,
  openTempSession,
  seedFixtureBoard,
} from "./activation-test-support.js";
import { runShadowRuleAdaptation } from "./run.js";
import {
  fixtureHost,
  fixtureRequest,
  messageStep,
  proposalOutput,
  scriptedModel,
  tightenProposal,
} from "./test-support.js";

function codes(result: { reasons: Array<{ code: string }> }): string[] {
  return result.reasons.map((entry) => entry.code);
}

it("A-01 validateRuntimeRuleProposal still has activationAllowed=false and writes nothing", () => {
  const tmp = openTempSession();
  try {
    const before = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const validation = validateRuntimeRuleProposal(proposal, authorizedPersonalHost());
    expect(validation.resultKind).toBe("shadow_accepted");
    expect(validation.activationAllowed).toBe(false);
    const after = readSessionTaskBoard(tmp.sessionFile);
    expect(after.runtimeRuleAdaptationByTaskId).toBeUndefined();
    expect(after.writeEpoch).toBe(before.writeEpoch);
  } finally {
    tmp.close();
  }
});

it("A-02 runShadowRuleAdaptation still has activationAllowed=false and writes nothing", async () => {
  const tmp = openTempSession();
  try {
    const before = seedFixtureBoard(tmp.sessionFile);
    const { host, board } = fixtureHost();
    const result = await runShadowRuleAdaptation(fixtureRequest(), {
      host,
      model: scriptedModel([messageStep(proposalOutput(tightenProposal()))]),
    });
    expect(result.activationAllowed).toBe(false);
    expect(board.mutations()).toEqual([]);
    const after = readSessionTaskBoard(tmp.sessionFile);
    expect(after.runtimeRuleAdaptationByTaskId).toBeUndefined();
    expect(after.writeEpoch).toBe(before.writeEpoch);
  } finally {
    tmp.close();
  }
});

it("A-03 / E-04 fixture-whitelist activate is labeled fixture, is not main-chain, and P1 stays false", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({
      proposalForHash: proposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    const result = activateApprovedRuntimeRuleProposal(
      proposal,
      binding,
      fixtureDeps(tmp.sessionFile),
    );
    expect(result.resultKind).toBe("activated");
    expect(result.snapshot?.whitelistSource).toBe("fixture");
    expect(result.snapshot?.mainChainWired).toBe(false);
    expect(result.snapshot?.effectiveNode).toBe("cas_persist_success");
    expect(result.snapshot?.writeEpoch).toBe((seeded.writeEpoch ?? 0) + 1);
    expect(result.boardWriteEpoch).toBe((seeded.writeEpoch ?? 0) + 1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(validateRuntimeRuleProposal(proposal, authorizedPersonalHost()).activationAllowed).toBe(
      false,
    );
    const read = readActivatedRuntimeRulePolicy(
      {
        fixture: true,
        identity: binding.identity,
        taskBinding: binding.taskBinding,
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(read.resultKind).toBe("found");
    expect(read.snapshot).toEqual(result.snapshot);
  } finally {
    tmp.close();
  }
});

it("C-01 CAS race: the stale second request conflicts and keeps S_A", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const firstProposal = fixtureProposal();
    const firstBinding = fixtureActivationBinding({
      proposalForHash: firstProposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    const first = activateApprovedRuntimeRuleProposal(
      firstProposal,
      firstBinding,
      fixtureDeps(tmp.sessionFile),
    );
    expect(first.resultKind).toBe("activated");
    const secondProposal = fixtureProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: 20000,
        },
      ],
    });
    const secondBinding = fixtureActivationBinding({
      proposalForHash: secondProposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    const second = activateApprovedRuntimeRuleProposal(
      secondProposal,
      secondBinding,
      fixtureDeps(tmp.sessionFile),
    );
    expect(second.resultKind).toBe("conflict");
    expect(codes(second)).toContain("write_epoch_conflict");
    expect(second.boardWriteEpoch).toBe(first.boardWriteEpoch);
    expect(second.retainedSnapshot?.items[0]?.parameter).toBe(24000);
    const read = readActivatedRuntimeRulePolicy(
      {
        fixture: true,
        identity: firstBinding.identity,
        taskBinding: firstBinding.taskBinding,
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(read.snapshot?.items[0]?.parameter).toBe(24000);
    expect(read.snapshot?.writeEpoch).toBe(first.snapshot?.writeEpoch);
  } finally {
    tmp.close();
  }
});

it("C-05 persist failure leaves the previous snapshot and epoch unchanged", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({
      proposalForHash: proposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    const failingIo = {
      ...officialActivationBoardIo,
      writeUnlocked() {
        throw new Error("injected persist failure");
      },
    };
    const result = activateApprovedRuntimeRuleProposal(
      proposal,
      binding,
      fixtureDeps(tmp.sessionFile, { boardIo: failingIo }),
    );
    expect(result.resultKind).toBe("persist_failed");
    const after = readSessionTaskBoard(tmp.sessionFile);
    expect(after.writeEpoch).toBe(seeded.writeEpoch);
    expect(after.runtimeRuleAdaptationByTaskId).toBeUndefined();
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.snapshot).toBeUndefined();
  } finally {
    tmp.close();
  }
});

it("C-09 restart read uses official persisted state, not in-memory shadow results", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({
      proposalForHash: proposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    const activated = activateApprovedRuntimeRuleProposal(
      proposal,
      binding,
      fixtureDeps(tmp.sessionFile),
    );
    expect(activated.resultKind).toBe("activated");
    // Simulate a process restart: only the official file is re-opened.
    const restarted = readSessionTaskBoard(tmp.sessionFile);
    expect(restarted.runtimeRuleAdaptationByTaskId?.[FIXTURE_TASK_ID]).toBeTruthy();
    const cloned = cloneBoardShell(restarted);
    expect(cloned.runtimeRuleAdaptationByTaskId?.[FIXTURE_TASK_ID]).toBeTruthy();
    const history = cloned.runtimeRuleAdaptationByTaskId?.[FIXTURE_TASK_ID]?.history;
    if (history) {
      history.push("mutated-by-clone-consumer");
    }
    expect(
      restarted.runtimeRuleAdaptationByTaskId?.[FIXTURE_TASK_ID]?.history.includes(
        "mutated-by-clone-consumer" as never,
      ),
    ).toBe(false);
    const read = readActivatedRuntimeRulePolicy(
      {
        fixture: true,
        identity: binding.identity,
        taskBinding: binding.taskBinding,
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(read.resultKind).toBe("found");
    expect(read.snapshot?.items[0]?.parameter).toBe(24000);
    expect(read.snapshot?.implementationVersion).toBeDefined();
    expect(read.snapshot?.catalogVersion?.startsWith("inventory:")).toBe(true);
    expect(read.snapshot?.policyHash).toBe(FIXTURE_POLICY_VERSION.policyHash);
    expect(read.snapshot?.effectiveNode).toBe("cas_persist_success");
    expect(read.snapshot?.whitelistSource).toBe("fixture");
    expect(read.snapshot?.mainChainWired).toBe(false);
  } finally {
    tmp.close();
  }
});

it("C-10 identity isolation fails closed across tenant, user, or session", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({
      proposalForHash: proposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    const first = activateApprovedRuntimeRuleProposal(
      proposal,
      binding,
      fixtureDeps(tmp.sessionFile),
    );
    expect(first.resultKind).toBe("activated");
    const foreign = readActivatedRuntimeRulePolicy(
      {
        fixture: true,
        identity: {
          principalType: "personal",
          principalId: "user:fixture-1",
          scope: { type: "personal", id: "agent:fixture-personal-1" },
        },
        taskBinding: {
          taskId: FIXTURE_TASK_ID,
          boardScope: {
            tenantId: "tenant:fixture-b",
            userId: FIXTURE_BOARD_SCOPE.userId,
            sessionId: FIXTURE_BOARD_SCOPE.sessionId,
          },
        },
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(foreign.resultKind).toBe("rejected");
    expect(codes(foreign)).toContain("identity_scope_mismatch");
    expect(foreign.snapshot).toBeUndefined();
    const still = readActivatedRuntimeRulePolicy(
      {
        fixture: true,
        identity: binding.identity,
        taskBinding: binding.taskBinding,
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(still.resultKind).toBe("found");
    expect(still.snapshot?.writeEpoch).toBe(first.snapshot?.writeEpoch);
  } finally {
    tmp.close();
  }
});

it("C-06 rollback rewrites the S1 values as a new epoch S3", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const firstProposal = fixtureProposal();
    const identity = fixtureActivationBinding().identity;
    const taskBinding = fixtureActivationBinding().taskBinding;
    const s1 = activateApprovedRuntimeRuleProposal(
      firstProposal,
      fixtureActivationBinding({
        proposalForHash: firstProposal,
        expectedVersions: {
          expectedWriteEpoch: seeded.writeEpoch,
          expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        },
      }),
      fixtureDeps(tmp.sessionFile),
    );
    expect(s1.resultKind).toBe("activated");
    const tighter = fixtureProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: 16000,
        },
      ],
    });
    const s2 = activateApprovedRuntimeRuleProposal(
      tighter,
      fixtureActivationBinding({
        proposalForHash: tighter,
        expectedVersions: {
          expectedWriteEpoch: s1.boardWriteEpoch,
          expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        },
      }),
      fixtureDeps(tmp.sessionFile),
    );
    expect(s2.resultKind).toBe("activated");
    const s3 = rollbackActivatedRuntimeRulePolicy(
      {
        fixture: true,
        authorizationReference: "authref:fixture-tune-1",
        identity,
        taskBinding,
        expectedWriteEpoch: s2.boardWriteEpoch,
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        hostActivationGate: "test_entry",
        permission: "tune",
        authorizedPermissions: ["tune"],
        authorizationStatus: "authorized",
        targetWriteEpoch: s1.snapshot?.writeEpoch,
        nowMs: 1_731_398_400_100,
        currentEffectiveValues: { "agents.defaults.contextTokens": 32000 },
        compatibilityRecord: {
          status: "approved_compatible",
          boundImplementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
          boundExpectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        },
        expectedPolicyState: "active",
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(s3.resultKind).toBe("activated");
    expect(s3.snapshot?.operation).toBe("rollback");
    expect(s3.snapshot?.items[0]?.parameter).toBe(24000);
    expect(s3.boardWriteEpoch).toBe((s2.boardWriteEpoch ?? 0) + 1);
    expect(s3.snapshot?.writeEpoch).not.toBe(s1.snapshot?.writeEpoch);
  } finally {
    tmp.close();
  }
});

it("D-01 revoke records a new epoch; later rollback of revoked rights is rejected", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({
      proposalForHash: proposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    const activated = activateApprovedRuntimeRuleProposal(
      proposal,
      binding,
      fixtureDeps(tmp.sessionFile),
    );
    expect(activated.resultKind).toBe("activated");
    const revoked = revokeActivatedRuntimeRulePolicy(
      {
        fixture: true,
        authorizationReference: binding.authorizationReference,
        identity: binding.identity,
        taskBinding: binding.taskBinding,
        expectedWriteEpoch: activated.boardWriteEpoch,
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        hostActivationGate: "explicit_approval",
        nowMs: 1_731_398_400_200,
        revokeReason: "authorization_revoked",
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(revoked.resultKind).toBe("activated");
    expect(revoked.snapshot?.status).toBe("revoked");
    expect(revoked.boardWriteEpoch).toBe((activated.boardWriteEpoch ?? 0) + 1);
    const rollback = rollbackActivatedRuntimeRulePolicy(
      {
        fixture: true,
        authorizationReference: binding.authorizationReference,
        identity: binding.identity,
        taskBinding: binding.taskBinding,
        expectedWriteEpoch: revoked.boardWriteEpoch,
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        hostActivationGate: "test_entry",
        permission: "tune",
        authorizedPermissions: ["tune"],
        authorizationStatus: "unauthorized",
        targetWriteEpoch: activated.snapshot?.writeEpoch,
        nowMs: 1_731_398_400_300,
        expectedPolicyState: "active",
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(rollback.resultKind).toBe("rejected");
    expect(codes(rollback)).toContain("authorization_revoked");
    const read = readActivatedRuntimeRulePolicy(
      {
        fixture: true,
        identity: binding.identity,
        taskBinding: binding.taskBinding,
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(read.snapshot?.status).toBe("revoked");
    expect(read.history?.some((row) => row.writeEpoch === activated.snapshot?.writeEpoch)).toBe(
      true,
    );
  } finally {
    tmp.close();
  }
});

it("C-08 rollback or activate on a tombstoned task is rejected and does not clear the tombstone", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile, {
      current: undefined,
      tombstones: [{ taskId: FIXTURE_TASK_ID, closedAtMs: 10 }],
    });
    const proposal = fixtureProposal();
    const result = activateApprovedRuntimeRuleProposal(
      proposal,
      fixtureActivationBinding({
        proposalForHash: proposal,
        expectedVersions: {
          expectedWriteEpoch: seeded.writeEpoch,
          expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        },
      }),
      fixtureDeps(tmp.sessionFile),
    );
    expect(result.resultKind).toBe("rejected");
    expect(codes(result)).toContain("cancelled_or_tombstone");
    const after = readSessionTaskBoard(tmp.sessionFile);
    expect(after.tombstones).toEqual([{ taskId: FIXTURE_TASK_ID, closedAtMs: 10 }]);
    expect(after.runtimeRuleAdaptationByTaskId).toBeUndefined();
  } finally {
    tmp.close();
  }
});

it("C-04 later rollback that depends on a taken-down rule is rejected", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const activated = activateApprovedRuntimeRuleProposal(
      proposal,
      fixtureActivationBinding({
        proposalForHash: proposal,
        expectedVersions: {
          expectedWriteEpoch: seeded.writeEpoch,
          expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        },
      }),
      fixtureDeps(tmp.sessionFile),
    );
    expect(activated.resultKind).toBe("activated");
    const rollback = rollbackActivatedRuntimeRulePolicy(
      {
        fixture: true,
        authorizationReference: "authref:fixture-tune-1",
        identity: fixtureActivationBinding().identity,
        taskBinding: fixtureActivationBinding().taskBinding,
        expectedWriteEpoch: activated.boardWriteEpoch,
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        hostActivationGate: "test_entry",
        permission: "tune",
        authorizedPermissions: ["tune"],
        authorizationStatus: "authorized",
        targetWriteEpoch: activated.snapshot?.writeEpoch,
        nowMs: 1_731_398_400_400,
        expectedPolicyState: "active",
      },
      fixtureDeps(tmp.sessionFile, { takenDownRuleIds: ["model.context_window.guard"] }),
    );
    expect(rollback.resultKind).toBe("rejected");
    expect(codes(rollback)).toContain("rule_taken_down");
    const read = readActivatedRuntimeRulePolicy(
      {
        fixture: true,
        identity: fixtureActivationBinding().identity,
        taskBinding: fixtureActivationBinding().taskBinding,
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(read.snapshot?.status).toBe("effective");
    expect(read.snapshot?.writeEpoch).toBe(activated.snapshot?.writeEpoch);
  } finally {
    tmp.close();
  }
});

it("D-02 agent unavailability keeps the still-legal snapshot and does not auto-activate", async () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({
      proposalForHash: proposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    const activated = activateApprovedRuntimeRuleProposal(
      proposal,
      binding,
      fixtureDeps(tmp.sessionFile),
    );
    expect(activated.resultKind).toBe("activated");
    const { host } = fixtureHost();
    const shadow = await runShadowRuleAdaptation(fixtureRequest(), {
      host,
      model: scriptedModel([]),
    });
    expect(shadow.activationAllowed).toBe(false);
    const read = readActivatedRuntimeRulePolicy(
      {
        fixture: true,
        identity: binding.identity,
        taskBinding: binding.taskBinding,
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(read.resultKind).toBe("found");
    expect(read.snapshot?.writeEpoch).toBe(activated.snapshot?.writeEpoch);
    expect(read.snapshot?.status).toBe("effective");
  } finally {
    tmp.close();
  }
});

it("D-03 missing required facts block the related action without writing", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({
      proposalForHash: proposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    delete binding.authorizationStatus;
    const result = activateApprovedRuntimeRuleProposal(
      proposal,
      binding,
      fixtureDeps(tmp.sessionFile),
    );
    expect(result.resultKind).toBe("rejected");
    expect(codes(result)).toContain("missing_host_fact");
    expect(readSessionTaskBoard(tmp.sessionFile).runtimeRuleAdaptationByTaskId).toBeUndefined();
  } finally {
    tmp.close();
  }
});

it("incomplete board-scope keys fail closed and do not return another tenant's snapshot", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const activated = activateApprovedRuntimeRuleProposal(
      proposal,
      fixtureActivationBinding({
        proposalForHash: proposal,
        expectedVersions: {
          expectedWriteEpoch: seeded.writeEpoch,
          expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        },
      }),
      fixtureDeps(tmp.sessionFile),
    );
    expect(activated.resultKind).toBe("activated");
    const incomplete = readActivatedRuntimeRulePolicy(
      {
        fixture: true,
        identity: fixtureActivationBinding().identity,
        taskBinding: {
          taskId: FIXTURE_TASK_ID,
          boardScope: { tenantId: "tenant:fixture-a", userId: "", sessionId: "session:fixture-a" },
        },
      },
      fixtureDeps(tmp.sessionFile),
    );
    expect(incomplete.resultKind).toBe("rejected");
    expect(codes(incomplete)).toContain("incomplete_board_scope");
    expect(incomplete.snapshot).toBeUndefined();
  } finally {
    tmp.close();
  }
});

const FOREIGN_BOARD_SCOPE_AXES = [
  {
    axis: "tenant",
    boardScope: { ...FIXTURE_BOARD_SCOPE, tenantId: "tenant:fixture-other" },
  },
  {
    axis: "user",
    boardScope: { ...FIXTURE_BOARD_SCOPE, userId: "user:fixture-other" },
  },
  {
    axis: "session",
    boardScope: { ...FIXTURE_BOARD_SCOPE, sessionId: "session:fixture-other" },
  },
] as const;

function assertNoLeakedActivationState(result: {
  resultKind: string;
  snapshot?: unknown;
  retainedSnapshot?: unknown;
  history?: unknown;
  boardWriteEpoch?: number;
}): void {
  expect(result.resultKind).toBe("rejected");
  expect(result.snapshot).toBeUndefined();
  expect(result.retainedSnapshot).toBeUndefined();
  expect(result.history).toBeUndefined();
  expect(result.boardWriteEpoch).toBeUndefined();
}

it.each(FOREIGN_BOARD_SCOPE_AXES)(
  "foreign $axis identity pointing at an existing snapshot is rejected without leaking state for activate, revoke, rollback, and read",
  ({ boardScope }) => {
    const tmp = openTempSession();
    try {
      const seeded = seedFixtureBoard(tmp.sessionFile);
      const proposal = fixtureProposal();
      const ownerBinding = fixtureActivationBinding({
        proposalForHash: proposal,
        expectedVersions: {
          expectedWriteEpoch: seeded.writeEpoch,
          expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        },
      });
      const activated = activateApprovedRuntimeRuleProposal(
        proposal,
        ownerBinding,
        fixtureDeps(tmp.sessionFile),
      );
      expect(activated.resultKind).toBe("activated");
      const before = readSessionTaskBoard(tmp.sessionFile);
      const beforeJson = JSON.stringify(before.runtimeRuleAdaptationByTaskId);
      const foreignTaskBinding = {
        taskId: FIXTURE_TASK_ID,
        boardScope,
      };
      const foreignIdentity = {
        principalType: "personal" as const,
        principalId: "user:fixture-foreign",
        scope: { type: "personal" as const, id: "agent:fixture-personal-foreign" },
      };
      const foreignActivate = activateApprovedRuntimeRuleProposal(
        proposal,
        fixtureActivationBinding({
          proposalForHash: proposal,
          identity: foreignIdentity,
          taskBinding: foreignTaskBinding,
          expectedVersions: {
            expectedWriteEpoch: activated.boardWriteEpoch,
            expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
            expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
          },
        }),
        fixtureDeps(tmp.sessionFile),
      );
      expect(codes(foreignActivate)).toContain("identity_scope_mismatch");
      assertNoLeakedActivationState(foreignActivate);

      const foreignRevoke = revokeActivatedRuntimeRulePolicy(
        {
          fixture: true,
          authorizationReference: ownerBinding.authorizationReference,
          identity: foreignIdentity,
          taskBinding: foreignTaskBinding,
          expectedWriteEpoch: activated.boardWriteEpoch,
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
          hostActivationGate: "explicit_approval",
          nowMs: 1_731_398_400_200,
          revokeReason: "authorization_revoked",
        },
        fixtureDeps(tmp.sessionFile),
      );
      expect(codes(foreignRevoke)).toContain("identity_scope_mismatch");
      assertNoLeakedActivationState(foreignRevoke);

      const foreignRollback = rollbackActivatedRuntimeRulePolicy(
        {
          fixture: true,
          authorizationReference: ownerBinding.authorizationReference,
          identity: foreignIdentity,
          taskBinding: foreignTaskBinding,
          expectedWriteEpoch: activated.boardWriteEpoch,
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
          expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          hostActivationGate: "test_entry",
          permission: "tune",
          authorizedPermissions: ["tune"],
          authorizationStatus: "authorized",
          targetWriteEpoch: activated.snapshot?.writeEpoch,
          nowMs: 1_731_398_400_300,
          currentEffectiveValues: { "agents.defaults.contextTokens": 32000 },
          compatibilityRecord: {
            status: "approved_compatible",
            boundImplementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
            boundExpectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          },
        },
        fixtureDeps(tmp.sessionFile),
      );
      expect(codes(foreignRollback)).toContain("identity_scope_mismatch");
      assertNoLeakedActivationState(foreignRollback);

      const foreignRead = readActivatedRuntimeRulePolicy(
        {
          fixture: true,
          identity: foreignIdentity,
          taskBinding: foreignTaskBinding,
        },
        fixtureDeps(tmp.sessionFile),
      );
      expect(codes(foreignRead)).toContain("identity_scope_mismatch");
      assertNoLeakedActivationState(foreignRead);

      const after = readSessionTaskBoard(tmp.sessionFile);
      expect(after.writeEpoch).toBe(before.writeEpoch);
      expect(JSON.stringify(after.runtimeRuleAdaptationByTaskId)).toBe(beforeJson);
    } finally {
      tmp.close();
    }
  },
);

it("authorized later failures may still return retained snapshot the caller is allowed to see", () => {
  const tmp = openTempSession();
  try {
    const seeded = seedFixtureBoard(tmp.sessionFile);
    const proposal = fixtureProposal();
    const firstBinding = fixtureActivationBinding({
      proposalForHash: proposal,
      expectedVersions: {
        expectedWriteEpoch: seeded.writeEpoch,
        expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
        expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
      },
    });
    const first = activateApprovedRuntimeRuleProposal(
      proposal,
      firstBinding,
      fixtureDeps(tmp.sessionFile),
    );
    expect(first.resultKind).toBe("activated");
    const stale = activateApprovedRuntimeRuleProposal(
      proposal,
      fixtureActivationBinding({
        proposalForHash: proposal,
        expectedVersions: {
          expectedWriteEpoch: seeded.writeEpoch,
          expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        },
      }),
      fixtureDeps(tmp.sessionFile),
    );
    expect(stale.resultKind).toBe("conflict");
    expect(codes(stale)).toContain("write_epoch_conflict");
    expect(stale.retainedSnapshot?.writeEpoch).toBe(first.snapshot?.writeEpoch);
    expect(stale.boardWriteEpoch).toBe(first.boardWriteEpoch);
  } finally {
    tmp.close();
  }
});
