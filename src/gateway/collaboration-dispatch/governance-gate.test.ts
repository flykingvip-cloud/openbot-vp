import { describe, expect, it } from "vitest";
import { classifyGovernanceActor, evaluateGovernanceGate } from "./governance-gate.js";
import { compileEffectiveCollaborationPolicy } from "./policy-compiler.js";

const humanRequired = compileEffectiveCollaborationPolicy({
  finalDecisionMode: "human_required",
  allowAgentPublishProposal: true,
});
const delegated = compileEffectiveCollaborationPolicy({
  finalDecisionMode: "delegated_low_risk",
  allowAgentPublishProposal: true,
});

describe("evaluateGovernanceGate", () => {
  it("blocks a bot from finalizing when humans must confirm", () => {
    const result = evaluateGovernanceGate({
      action: "finalize_decision",
      actor: { type: "bot", id: "bot:reviewer" },
      effective: humanRequired,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("human_override_required");
  });

  it("allows a human to finalize under human_required", () => {
    const result = evaluateGovernanceGate({
      action: "finalize_decision",
      actor: { type: "human", id: "user-1" },
      effective: humanRequired,
    });
    expect(result.allowed).toBe(true);
  });

  it("blocks observers from approving", () => {
    const result = evaluateGovernanceGate({
      action: "finalize_decision",
      actor: { type: "human", id: "user-obs", governanceRole: "observer" },
      effective: delegated,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("observer_cannot_approve");
  });

  it("blocks bot proposals unless the group is delegated and explicitly allows them", () => {
    const denied = evaluateGovernanceGate({
      action: "publish_proposal",
      actor: { type: "bot", id: "bot:owner" },
      effective: humanRequired,
    });
    expect(denied.allowed).toBe(false);
    const allowed = evaluateGovernanceGate({
      action: "publish_proposal",
      actor: { type: "bot", id: "bot:owner" },
      effective: delegated,
    });
    expect(allowed.allowed).toBe(true);
  });
});

describe("classifyGovernanceActor", () => {
  it("classifies bot: prefixes and memberRoleMap bots", () => {
    expect(classifyGovernanceActor("bot:alpha").type).toBe("bot");
    expect(
      classifyGovernanceActor("alpha", [
        { memberId: "bot:alpha", memberKind: "bot", governanceRole: "member" },
      ]).type,
    ).toBe("bot");
  });

  it("classifies human members including observer role", () => {
    const actor = classifyGovernanceActor("user-1", [
      { memberId: "human:user-1", memberKind: "human", governanceRole: "observer" },
    ]);
    expect(actor).toEqual({
      type: "human",
      id: "user-1",
      governanceRole: "observer",
    });
  });
});

describe("evaluateGovernanceGate self_advance", () => {
  it("blocks bot when botMaySelfAdvanceWithoutHuman is false (platform default)", () => {
    const result = evaluateGovernanceGate({
      action: "self_advance",
      actor: { type: "bot", id: "bot:worker" },
      effective: humanRequired,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("bot_self_advance_disabled");
  });

  it("allows bot when L2 botMaySelfAdvanceWithoutHuman is true", () => {
    const enabled = compileEffectiveCollaborationPolicy({
      finalDecisionMode: "human_required",
      allowAgentPublishProposal: true,
      botMaySelfAdvanceWithoutHuman: true,
    });
    const result = evaluateGovernanceGate({
      action: "self_advance",
      actor: { type: "bot", id: "bot:worker" },
      effective: enabled,
    });
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("self_advance_allowed");
  });
});
