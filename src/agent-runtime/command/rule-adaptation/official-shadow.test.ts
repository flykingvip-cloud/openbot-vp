import { expect, it, vi } from "vitest";
import { resolveEmbeddedModelGovernance } from "../../../agents/embedded-model-governance.js";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../../contracts/rule-adaptation-activation.js";
import { createAuthorizedModelSession, type ModelSessionPorts } from "../../model/index.js";
import { validateRuntimeRuleProposal } from "../../policy/rule-adaptation/index.js";
import * as activate from "./activate.js";
import { runOfficialShadowRuleAdaptation } from "./official-shadow.js";
import {
  fixtureHost,
  fixtureRequest,
  limitedPersonalView,
  messageStep,
  proposalOutput,
  tightenProposal,
} from "./test-support.js";

function stubPorts(): ModelSessionPorts {
  return {
    accounting: { recordCreditUsage: vi.fn(async () => undefined) },
    admission: {
      tryAcquireEnterpriseAgentRun: vi.fn(async () => ({
        acquired: false as const,
        skipped: true as const,
      })),
      releaseEnterpriseAgentRun: vi.fn(async () => {}),
    },
    model: {
      resolveEmbeddedModelGovernance,
      buildRunModelSetSnapshot: vi.fn(() => undefined),
      forgetRunModelSet: vi.fn(),
      rememberRunModelSet: vi.fn(),
      snapshotCreditReportingFromGate: vi.fn(() => undefined),
      resolvePlatformModelsMode: vi.fn(() => "default"),
      runWithModelFallback: vi.fn(
        async (options: {
          run: (provider: string, model: string, extra?: unknown) => Promise<unknown>;
        }) => ({
          result: await options.run("shadow-fixture", "shadow-fixture"),
          provider: "shadow-fixture",
          model: "shadow-fixture",
          attempts: [],
        }),
      ),
    },
  } as unknown as ModelSessionPorts;
}

it("official entry is callable, returns advice, runs the validator, and does not activate or persist", async () => {
  const { host, board } = fixtureHost();
  const validate = vi.fn(validateRuntimeRuleProposal);
  const activateSpy = vi.spyOn(activate, "activateApprovedRuntimeRuleProposal");
  const revokeSpy = vi.spyOn(activate, "revokeActivatedRuntimeRulePolicy");
  const rollbackSpy = vi.spyOn(activate, "rollbackActivatedRuntimeRulePolicy");
  const config = Object.freeze({});
  const env = Object.freeze({});
  const complete = vi.fn(async () => messageStep(proposalOutput(tightenProposal(24000))));

  const result = await runOfficialShadowRuleAdaptation(fixtureRequest(), {
    view: host.view,
    controlBoard: host.controlBoard,
    now: host.now,
    validate,
    model: {
      runId: "official-shadow-fixture-1",
      sessionPorts: stubPorts(),
      createSession: createAuthorizedModelSession,
      config,
      env,
      complete,
    },
  });

  expect(complete).toHaveBeenCalled();
  expect(validate).toHaveBeenCalledTimes(1);
  expect(validate.mock.calls[0]?.[0]).toMatchObject({
    kind: "policy_proposal",
    items: [
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        action: "tune",
        proposedValue: 24000,
      },
    ],
  });
  expect(validate.mock.calls[0]?.[1]).toBe(host.view.hostFacts);
  expect(result.outcomeCode).toBe("shadow_recorded");
  expect(result.validation?.resultKind).toBe("shadow_accepted");
  expect(result.validation?.activationAllowed).toBe(false);
  expect(result.activationAllowed).toBe(false);
  expect(result.claimedEffective).toBe(false);
  expect(result.executionModeOpened).toBe(false);
  expect(result.commitment).toBe("none");
  expect(result.candidatePersisted).toBe(false);
  expect(result.candidateActivated).toBe(false);
  expect(result.candidatePublished).toBe(false);
  expect(result.controlUnchanged).toBe(true);
  expect(result.controlSnapshotAfter).toEqual(result.controlSnapshotBefore);
  expect(board.mutations()).toEqual([]);
  expect(activateSpy).not.toHaveBeenCalled();
  expect(revokeSpy).not.toHaveBeenCalled();
  expect(rollbackSpy).not.toHaveBeenCalled();
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
  expect(config).toEqual({});
  expect(env).toEqual({});
});

it("uses the injected host view and does not invent a second rule catalog", async () => {
  const emptyView = limitedPersonalView({
    rules: [],
    effectivePolicy: [],
    hostFacts: {
      fixture: true,
      identity: {
        principalType: "personal",
        principalId: "user:fixture-1",
        scope: { type: "personal", id: "agent:fixture-personal-1" },
      },
    },
  });
  const { host, board } = fixtureHost(emptyView);
  const validate = vi.fn(validateRuntimeRuleProposal);
  const result = await runOfficialShadowRuleAdaptation(fixtureRequest(), {
    view: host.view,
    controlBoard: host.controlBoard,
    now: host.now,
    validate,
    model: {
      runId: "official-shadow-fixture-2",
      sessionPorts: stubPorts(),
      config: {},
      env: {},
      complete: async () => messageStep(proposalOutput(tightenProposal(24000))),
    },
  });
  expect(validate).toHaveBeenCalledTimes(1);
  expect(validate.mock.calls[0]?.[1]).toBe(emptyView.hostFacts);
  expect(result.outcomeCode).toBe("insufficient_sources");
  expect(result.validation?.resultKind).toBe("needs_information");
  expect(result.activationAllowed).toBe(false);
  expect(result.claimedEffective).toBe(false);
  expect(result.commitment).toBe("none");
  expect(result.executionModeOpened).toBe(false);
  expect(result.controlUnchanged).toBe(true);
  expect(board.mutations()).toEqual([]);
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
});
