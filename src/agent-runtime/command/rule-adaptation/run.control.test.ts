import { expect, it } from "vitest";
import { runShadowRuleAdaptation } from "./run.js";
import {
  fixtureHost,
  fixtureRequest,
  messageStep,
  noChangeOutput,
  proposalOutput,
  scriptedModel,
  toolStep,
  tightenProposal,
} from "./test-support.js";

it("does not escalate task, claim, plan, todo, or task-control during a shadow run", async () => {
  const { host, board } = fixtureHost();
  const before = board.snapshot();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("searchRules", { query: "contextTokens" }),
      toolStep("createTask", { title: "do it live" }),
      toolStep("activatePolicy", { now: true }),
      messageStep(proposalOutput(tightenProposal(24000))),
    ]),
  });
  const after = board.snapshot();
  expect(result.outcomeCode).toBe("shadow_recorded");
  expect(result.controlUnchanged).toBe(true);
  expect(result.controlSnapshotBefore).toEqual(before);
  expect(result.controlSnapshotAfter).toEqual(before);
  expect(after).toEqual(before);
  expect(board.mutations()).toEqual([]);
  expect(result.executionModeOpened).toBe(false);
  expect(result.businessToolsExecuted).toEqual([]);
  expect(result.businessToolsInvoked).toEqual(["createTask", "activatePolicy"]);
  expect(result.readOnlyProof.rejectedTools.map((entry) => entry.name)).toEqual([
    "createTask",
    "activatePolicy",
  ]);
  expect(
    result.readOnlyProof.rejectedTools.every((entry) => entry.code === "tool_not_permitted"),
  ).toBe(true);
  expect(result.readOnlyProof.policyActivated).toBe(false);
  expect(result.readOnlyProof.configWritten).toBe(false);
});

it("returns cancelled before start without throwing or promising work", async () => {
  const { host, board } = fixtureHost();
  const signal = AbortSignal.abort("owner_cancel");
  const result = await runShadowRuleAdaptation(fixtureRequest({ signal }), {
    host,
    model: scriptedModel([messageStep(noChangeOutput())]),
  });
  expect(result.outcomeCode).toBe("cancelled");
  expect(result.cancelled).toBe(true);
  expect(result.usage.cancelled).toBe(true);
  expect(result.commitment).toBe("none");
  expect(result.claimedEffective).toBe(false);
  expect(result.activationAllowed).toBe(false);
  expect(
    result.reasons.some((entry) => entry.code === "cancelled" && entry.path === "run.signal"),
  ).toBe(true);
  expect(board.mutations()).toEqual([]);
  expect(result.controlUnchanged).toBe(true);
});

it("returns cancelled when the model port reports cancellation mid-run", async () => {
  const { host, board } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("searchRules", { query: "context" }),
      {
        kind: "cancelled",
        usage: { inputTokens: 3, outputTokens: 0, cost: 0 },
        reason: "owner_cancel",
      },
    ]),
  });
  expect(result.outcomeCode).toBe("cancelled");
  expect(result.cancelled).toBe(true);
  expect(result.commitment).toBe("none");
  expect(result.claimedEffective).toBe(false);
  expect(result.controlUnchanged).toBe(true);
  expect(board.mutations()).toEqual([]);
});

it("maps model prose and invalid JSON to protocol_failure without a false start promise", async () => {
  const { host } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest({ budget: { maxRevisions: 0 } }), {
    host,
    model: scriptedModel([
      messageStep("I have started adapting the live policy and the changes are now in effect."),
    ]),
  });
  expect(result.outcomeCode).toBe("protocol_failure");
  expect(
    result.reasons.some(
      (entry) => entry.code === "protocol_failure" && entry.path === "model.output",
    ),
  ).toBe(true);
  expect(result.commitment).toBe("none");
  expect(result.claimedEffective).toBe(false);
  expect(result.limitProof.threwToCaller).toBe(false);
  expect(result.limitProof.protocolFailed).toBe(true);
});

it("maps a model-port protocol failure to a safe result and does not throw", async () => {
  const { host, board } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      {
        kind: "protocol_failure",
        usage: { inputTokens: 1, outputTokens: 0, cost: 0 },
        detail: "bad_handshake",
      },
    ]),
  });
  expect(result.outcomeCode).toBe("protocol_failure");
  expect(
    result.reasons.some(
      (entry) => entry.code === "protocol_failure" && entry.path === "model.port",
    ),
  ).toBe(true);
  expect(result.commitment).toBe("none");
  expect(result.controlUnchanged).toBe(true);
  expect(board.mutations()).toEqual([]);
});

it("swallows a thrown model port error and returns protocol_failure", async () => {
  const { host } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: {
      async complete() {
        throw new Error("socket exploded");
      },
    },
  });
  expect(result.outcomeCode).toBe("protocol_failure");
  expect(result.limitProof.threwToCaller).toBe(false);
  expect(result.claimedEffective).toBe(false);
  expect(result.commitment).toBe("none");
});

it("allows one revision after bad JSON and then accepts structured output", async () => {
  const { host } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest({ budget: { maxRevisions: 1 } }), {
    host,
    model: scriptedModel([messageStep("please tighten it somehow"), messageStep(noChangeOutput())]),
  });
  expect(result.outcomeCode).toBe("no_change_needed");
  expect(result.usage.revisions).toBe(1);
  expect(result.usage.modelCalls).toBe(2);
});

it("diagnoses before retrieval is enabled", async () => {
  const { host } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("searchRules", { query: "context" }),
      messageStep(noChangeOutput()),
    ]),
  });
  expect(result.diagnosedBeforeRetrieval).toBe(true);
  expect(result.toolsInvoked[0]?.name).toBe("searchRules");
  expect(result.toolsInvoked[0]?.status).toBe("ok");
});
