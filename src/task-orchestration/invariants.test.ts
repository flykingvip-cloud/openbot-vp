import { describe, expect, it } from "vitest";
import type { ConversationTask } from "../conversation-task/types.js";
import { considerDispatch } from "./dispatch.js";
import {
  assertActivationIsNotOrchestrationEnable,
  assertDormantIsIdle,
  assertGrayscaleBindingDoesNotInvoke,
  assertLedgerBridgeHonorsI1,
  assertMasterSwitchesHonored,
  assertNeverInvoke,
  assertNoMissionKind,
  assertNoSkipAhead,
  assertNodeBindingNotOnTask,
  assertPersonalSubagentIsNotMission,
  assertSandboxIsNotNode,
  assertSkillExpandIsNotEvidence,
} from "./invariants.js";
import { ackLedgerIntent, toolResultLedgerIntent } from "./ledger-bridge.js";
import { bindSkillToStepDraft } from "./skill-binder.js";
import { routeStep } from "./surface-router.js";
import {
  PERSONAL_SUBAGENT_MAX_DEPTH,
  emptyOrchestrationFlags,
  shadowOrchestrationFlags,
} from "./types.js";

const cleanTask: ConversationTask = {
  id: "t1",
  conversationId: "conv1",
  requesterId: "u1",
  goal: "monitor competitor pricing",
  acceptanceRules: [],
  lifecycle: "active",
  createdAtMs: 0,
  updatedAtMs: 0,
};

describe("ORCH1 no skip-ahead", () => {
  it("accepts connector over browser", () => {
    const input = {
      intent: "interact_web" as const,
      connectedConnectorIds: ["gmail"] as const,
      flags: shadowOrchestrationFlags({ browserEnabled: true }),
    };
    const decision = routeStep(input);
    expect(() => assertNoSkipAhead(input, decision)).not.toThrow();
  });

  it("rejects a browser decision when a connector is available", () => {
    expect(() =>
      assertNoSkipAhead(
        {
          intent: "interact_web",
          connectedConnectorIds: ["gmail"],
          flags: shadowOrchestrationFlags({ browserEnabled: true }),
        },
        { kind: "selected", surface: "browser", reasonCodes: [], enqueue: false, invoke: false },
      ),
    ).toThrowError(/ORCH1/);
  });
});

describe("ORCH2 sandbox is not node", () => {
  it("accepts memory for a workspace path", () => {
    const input = {
      intent: "read_user_machine" as const,
      pathKind: "workspace" as const,
      flags: shadowOrchestrationFlags({ nodeEnabled: true }),
      nodeInventory: { boundNodeIds: ["n1"], unboundCount: 0 },
    };
    const decision = routeStep(input);
    expect(() => assertSandboxIsNotNode(input, decision)).not.toThrow();
  });

  it("rejects node_fs_read on a workspace path", () => {
    expect(() =>
      assertSandboxIsNotNode(
        { intent: "read_user_machine", pathKind: "workspace", flags: shadowOrchestrationFlags() },
        {
          kind: "selected",
          surface: "node_fs_read",
          reasonCodes: [],
          enqueue: false,
          invoke: false,
        },
      ),
    ).toThrowError(/ORCH2/);
  });

  it("rejects nodeId on a ConversationTask row", () => {
    expect(() => assertNodeBindingNotOnTask(cleanTask)).not.toThrow();
    const tainted = { ...cleanTask, nodeId: "node-1" } as unknown as ConversationTask;
    expect(() => assertNodeBindingNotOnTask(tainted)).toThrowError(/ORCH2/);
  });
});

describe("ORCH3 master switches", () => {
  it("rejects a selected node surface when nodeEnabled is off", () => {
    expect(() =>
      assertMasterSwitchesHonored(shadowOrchestrationFlags({ nodeEnabled: false }), {
        kind: "selected",
        surface: "node_exec",
        reasonCodes: [],
        enqueue: false,
        invoke: false,
      }),
    ).toThrowError(/ORCH3/);
  });

  it("still honors nodeEnabled even if dispatchEnabled is on", () => {
    const flags = shadowOrchestrationFlags({ dispatchEnabled: true, nodeEnabled: false });
    const decision = routeStep({
      intent: "exec_user_machine",
      flags,
      nodeInventory: { boundNodeIds: ["n1"], unboundCount: 0 },
    });
    expect(decision.kind).not.toBe("selected");
    expect(() => assertMasterSwitchesHonored(flags, decision)).not.toThrow();
  });
});

describe("ORCH4 / ORCH5 dormant and CTR shadow-only", () => {
  it("dormant dispatch stays idle", () => {
    const flags = emptyOrchestrationFlags();
    const result = considerDispatch({
      intent: "read_web",
      flags,
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(() => assertDormantIsIdle(flags, result)).not.toThrow();
    expect(() => assertNeverInvoke(result.decision, result)).not.toThrow();
    expect(() => assertActivationIsNotOrchestrationEnable(flags, true, result)).not.toThrow();
    expect(() => assertGrayscaleBindingDoesNotInvoke(result.surfaceBindings, result)).not.toThrow();
    expect(result.surfaceBindings).toEqual([]);
  });

  it("dispatchEnabled cannot create tasks while CTR activation is off", () => {
    const flags = shadowOrchestrationFlags({ dispatchEnabled: true });
    const result = considerDispatch({
      intent: "read_web",
      flags,
      ctrActivationEnabled: false,
      allowlistEmpty: false,
    });
    expect(() => assertActivationIsNotOrchestrationEnable(flags, false, result)).not.toThrow();
    expect(result.createdConversationTask).toBe(false);
    expect(result.invokedTool).toBe(false);
  });
});

describe("ORCH6 personal subagent is not Mission", () => {
  it("accepts a depth-capped personal helper", () => {
    expect(() =>
      assertPersonalSubagentIsNotMission({
        kind: "personal_subagent",
        notMission: true,
        depth: PERSONAL_SUBAGENT_MAX_DEPTH,
      }),
    ).not.toThrow();
    expect(() => assertNoMissionKind("personal_subagent")).not.toThrow();
  });

  it("rejects Mission minting and over-depth spawn", () => {
    expect(() => assertNoMissionKind("mission")).toThrowError(/ORCH6/);
    expect(() =>
      assertPersonalSubagentIsNotMission({
        kind: "personal_subagent",
        notMission: true,
        depth: PERSONAL_SUBAGENT_MAX_DEPTH + 1,
      }),
    ).toThrowError(/ORCH6/);
  });
});

describe("ORCH7 / ORCH8 ledger and skill recipe", () => {
  it("allows tool_result intents and rejects ack-as-completion via the bridge helper", () => {
    expect(() => assertLedgerBridgeHonorsI1(toolResultLedgerIntent("web_search"))).not.toThrow();
    expect(() => assertLedgerBridgeHonorsI1(ackLedgerIntent())).not.toThrow();
    expect(() =>
      assertLedgerBridgeHonorsI1({ eventType: "STEP_COMPLETED", ackOnly: true }),
    ).toThrowError(/ORCH7/);
  });

  it("marks skill expand as not evidence", () => {
    const draft = bindSkillToStepDraft({ skillId: "weekly-report" });
    expect(() => assertSkillExpandIsNotEvidence(draft)).not.toThrow();
  });
});

describe("ORCH4 grayscale binding does not invoke", () => {
  it("accepts name-only web_read bindings", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(() => assertGrayscaleBindingDoesNotInvoke(result.surfaceBindings, result)).not.toThrow();
    expect(() => assertNeverInvoke(result.decision, result)).not.toThrow();
  });

  it("accepts name-only browser bindings", () => {
    const result = considerDispatch({
      intent: "interact_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, browserEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(result.decision.surface).toBe("browser");
    expect(() => assertGrayscaleBindingDoesNotInvoke(result.surfaceBindings, result)).not.toThrow();
    expect(() => assertNeverInvoke(result.decision, result)).not.toThrow();
  });

  it("accepts name-only node_fs_read bindings without invoke", () => {
    const result = considerDispatch({
      intent: "read_user_machine",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, nodeEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
      pathKind: "node",
      nodeInventory: { boundNodeIds: ["n1"], unboundCount: 0 },
    });
    expect(result.decision.surface).toBe("node_fs_read");
    expect(() => assertGrayscaleBindingDoesNotInvoke(result.surfaceBindings, result)).not.toThrow();
    expect(() => assertNeverInvoke(result.decision, result)).not.toThrow();
    expect(result.invokedTool).toBe(false);
  });

  it("rejects a result that claims invoke", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    const forged = { ...result, invokedTool: true } as unknown as typeof result;
    expect(() => assertGrayscaleBindingDoesNotInvoke(result.surfaceBindings, forged)).toThrowError(
      /ORCH4/,
    );
  });
});
