import { afterEach, describe, expect, it } from "vitest";
import { CONVERSATION_TASK_ENV } from "../conversation-task/feature.js";
import {
  considerDispatch,
  considerDispatchFromEnv,
  getLastOrchShadowObservation,
  resetOrchShadowObservation,
} from "./dispatch.js";
import { ORCHESTRATION_ENV } from "./feature.js";
import { ORCH_REASON } from "./reason-codes.js";
import {
  BROWSER_TOOL_BINDINGS,
  NODE_EXEC_TOOL_BINDINGS,
  NODE_FS_READ_TOOL_BINDINGS,
  WEB_READ_TOOL_BINDINGS,
} from "./surface-binding.js";
import { emptyOrchestrationFlags, shadowOrchestrationFlags } from "./types.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

describe("considerDispatch Gate C shadow-observe", () => {
  afterEach(() => {
    resetOrchShadowObservation();
  });

  it("keeps ORCHESTRATION_LIVE_INVOKE frozen false", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("scores routeStep and logs reason codes when shadow-only, allowlist empty, activation OFF", () => {
    resetOrchShadowObservation();
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags(),
      ctrActivationEnabled: false,
      allowlistEmpty: true,
    });
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(result.shadowObserved).toBe(true);
    expect(result.decision.kind).toBe("selected");
    expect(result.decision.surface).toBe("web_read");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.LADDER_WEB_READ);
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.SHADOW_OBSERVE);
    expect(result.loggedReasonCodes).toContain(ORCH_REASON.LADDER_WEB_READ);
    expect(result.loggedReasonCodes).toContain(ORCH_REASON.SHADOW_OBSERVE);
    expect(result.job).toBeNull();
    expect(result.createdConversationTask).toBe(false);
    expect(result.invokedTool).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.decision.invoke).toBe(false);
    expect(result.decision.enqueue).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
    const logged = getLastOrchShadowObservation();
    expect(logged).not.toBeNull();
    expect(logged?.reasonCodes).toContain(ORCH_REASON.LADDER_WEB_READ);
    expect(logged?.invoke).toBe(false);
    expect(logged?.enqueue).toBe(false);
  });

  it("scores a missing allowlist proof under shadow-only and still does not invoke", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags(),
      ctrActivationEnabled: false,
    });
    expect(result.shadowObserved).toBe(true);
    expect(result.decision.kind).toBe("selected");
    expect(result.decision.surface).toBe("web_read");
    expect(result.invokedTool).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.job).toBeNull();
  });

  it("fail-closes without invoke when DISPATCH is armed even if shadow is on", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true }),
      ctrActivationEnabled: false,
      allowlistEmpty: true,
    });
    expect(result.invokedTool).toBe(false);
    expect(result.shadowObserved).toBe(false);
    expect(result.decision.kind).toBe("noop");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.ALLOWLIST_EMPTY);
    expect(result.job).toBeNull();
  });

  it("fail-closes without invoke when NODE is armed on the shadow path", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ nodeEnabled: true }),
      ctrActivationEnabled: false,
      allowlistEmpty: true,
    });
    expect(result.invokedTool).toBe(false);
    expect(result.decision.invoke).toBe(false);
    expect(result.shadowObserved).toBe(false);
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.LIVE_PATH_ARMED);
    expect(result.loggedReasonCodes).toEqual([]);
  });

  it("fail-closes without invoke when BROWSER is armed on the shadow path", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ browserEnabled: true }),
      ctrActivationEnabled: false,
      allowlistEmpty: true,
    });
    expect(result.invokedTool).toBe(false);
    expect(result.decision.invoke).toBe(false);
    expect(result.shadowObserved).toBe(false);
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.LIVE_PATH_ARMED);
  });
});

describe("considerDispatch dormant kernel", () => {
  it("is a no-op when all flags are off: no jobs, no invokes", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: emptyOrchestrationFlags(),
      ctrActivationEnabled: false,
      allowlistEmpty: false,
    });
    expect(result.job).toBeNull();
    expect(result.createdConversationTask).toBe(false);
    expect(result.invokedTool).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.decision.kind).toBe("noop");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.DORMANT);
    expect(result.surfaceBindings).toEqual([]);
  });

  it("still no-ops the dispatch path when the allowlist is empty", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: true,
    });
    expect(result.job).toBeNull();
    expect(result.invokedTool).toBe(false);
    expect(result.shadowObserved).toBe(false);
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.ALLOWLIST_EMPTY);
  });

  it("treats a missing allowlist proof as empty on the dispatch path", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true }),
      ctrActivationEnabled: true,
    });
    expect(result.job).toBeNull();
    expect(result.invokedTool).toBe(false);
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.ALLOWLIST_EMPTY);
  });
});

describe("considerDispatch cannot outrun CTR", () => {
  it("does not create tasks or invoke when dispatchEnabled=1 but CTR activation is off", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({
        dispatchEnabled: true,
        nodeEnabled: true,
        browserEnabled: true,
      }),
      ctrActivationEnabled: false,
      allowlistEmpty: false,
    });
    expect(result.job).toBeNull();
    expect(result.createdConversationTask).toBe(false);
    expect(result.invokedTool).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.decision.invoke).toBe(false);
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.CTR_SHADOW_ONLY);
  });

  it("still does not invoke when CTR activation env is on but orch flags are off", () => {
    const result = considerDispatchFromEnv(
      {
        intent: "exec_user_machine",
        flags: emptyOrchestrationFlags(),
        allowlistEmpty: false,
      },
      { [CONVERSATION_TASK_ENV.activation]: "1" },
    );
    expect(result.job).toBeNull();
    expect(result.createdConversationTask).toBe(false);
    expect(result.invokedTool).toBe(false);
    expect(result.decision.kind).toBe("noop");
  });

  it("does not treat OPENBOT_CONVERSATION_TASK_ACTIVATION as an orch enable", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    const result = considerDispatchFromEnv(
      {
        intent: "read_web",
        flags: emptyOrchestrationFlags(),
        allowlistEmpty: false,
      },
      {
        [CONVERSATION_TASK_ENV.activation]: "1",
        [ORCHESTRATION_ENV.dispatchEnabled]: "0",
      },
    );
    expect(result.invokedTool).toBe(false);
    expect(result.job).toBeNull();
  });
});

describe("considerDispatch P4.5 never materializes work", () => {
  it("returns invokedTool false even when every gate is hypothetically open", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(result.invokedTool).toBe(false);
    expect(result.createdConversationTask).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.job).toBeNull();
    expect(result.decision.invoke).toBe(false);
    expect(result.decision.enqueue).toBe(false);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });
});

describe("considerDispatch dormant web_read grayscale", () => {
  it("selects web_read with name-only bindings and does not invoke", () => {
    const result = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(result.decision.kind).toBe("selected");
    expect(result.decision.surface).toBe("web_read");
    expect(result.decision.invoke).toBe(false);
    expect(result.invokedTool).toBe(false);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(result.surfaceBindings).toEqual(WEB_READ_TOOL_BINDINGS);
    expect(result.surfaceBindings.every((binding) => !binding.execute)).toBe(true);
  });

  it("still skip-ahead blocks browser on a web_read step", () => {
    const result = considerDispatch({
      intent: "read_web",
      requestedSurface: "browser",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, browserEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(result.decision.kind).toBe("blocked_policy");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.SKIP_AHEAD_BLOCKED);
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.WEB_READ_PREFERRED_OVER_BROWSER);
    expect(result.decision.surface).toBeUndefined();
    expect(result.invokedTool).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
  });
});

describe("considerDispatch dormant browser grayscale", () => {
  it("stays a no-op when dormant flags are off", () => {
    const result = considerDispatch({
      intent: "interact_web",
      flags: emptyOrchestrationFlags(),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(result.decision.kind).toBe("noop");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.DORMANT);
    expect(result.job).toBeNull();
    expect(result.invokedTool).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("selects browser with name-only bindings when interact_web has no connector", () => {
    const result = considerDispatch({
      intent: "interact_web",
      // browserEnabled is a test-input gate only — not a process.env default.
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, browserEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(result.decision.kind).toBe("selected");
    expect(result.decision.surface).toBe("browser");
    expect(result.decision.invoke).toBe(false);
    expect(result.invokedTool).toBe(false);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(result.surfaceBindings).toEqual(BROWSER_TOOL_BINDINGS);
    expect(result.surfaceBindings.every((binding) => !binding.execute)).toBe(true);
  });

  it("still skip-ahead blocks requested browser when a connector is connected", () => {
    const result = considerDispatch({
      intent: "interact_web",
      connectedConnectorIds: ["gmail"],
      requestedConnectorId: "gmail",
      requestedSurface: "browser",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, browserEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(result.decision.kind).toBe("blocked_policy");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.SKIP_AHEAD_BLOCKED);
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.CONNECTOR_PREFERRED_OVER_BROWSER);
    expect(result.decision.surface).toBeUndefined();
    expect(result.invokedTool).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
  });

  it("does not select browser when browserEnabled is off on the input flags", () => {
    const result = considerDispatch({
      intent: "interact_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, browserEnabled: false }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(result.decision.kind).toBe("human_gate");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.BROWSER_ENABLED_OFF);
    expect(result.decision.surface).toBeUndefined();
    expect(result.invokedTool).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
  });

  it("keeps web_read preferred and skip-ahead to browser blocked", () => {
    const webRead = considerDispatch({
      intent: "read_web",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(webRead.decision.surface).toBe("web_read");
    expect(webRead.surfaceBindings).toEqual(WEB_READ_TOOL_BINDINGS);

    const skipAhead = considerDispatch({
      intent: "read_web",
      requestedSurface: "browser",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, browserEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
    });
    expect(skipAhead.decision.kind).toBe("blocked_policy");
    expect(skipAhead.decision.reasonCodes).toContain(ORCH_REASON.SKIP_AHEAD_BLOCKED);
  });
});

describe("considerDispatch dormant node grayscale + explicit human gate", () => {
  it("stays a no-op when dormant flags are off", () => {
    const result = considerDispatch({
      intent: "read_user_machine",
      flags: emptyOrchestrationFlags(),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
      pathKind: "node",
      nodeInventory: { boundNodeIds: ["node-1"], unboundCount: 0 },
    });
    expect(result.decision.kind).toBe("noop");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.DORMANT);
    expect(result.job).toBeNull();
    expect(result.invokedTool).toBe(false);
    expect(result.decision.invoke).toBe(false);
    expect(result.decision.enqueue).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("selects node_fs_read with name-only bindings for exactly one bound node", () => {
    const result = considerDispatch({
      intent: "read_user_machine",
      // nodeEnabled is a test-input gate only — not a process.env default.
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, nodeEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
      pathKind: "node",
      nodeInventory: { boundNodeIds: ["node-1"], unboundCount: 0 },
    });
    expect(result.decision.kind).toBe("selected");
    expect(result.decision.surface).toBe("node_fs_read");
    expect(result.decision.invoke).toBe(false);
    expect(result.decision.enqueue).toBe(false);
    expect(result.invokedTool).toBe(false);
    expect(result.job).toBeNull();
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(result.surfaceBindings).toEqual(NODE_FS_READ_TOOL_BINDINGS);
    expect(result.surfaceBindings.every((binding) => !binding.execute)).toBe(true);
  });

  it("selects node_exec with name-only bindings and still does not invoke", () => {
    const result = considerDispatch({
      intent: "exec_user_machine",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, nodeEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
      pathKind: "node",
      nodeInventory: { boundNodeIds: ["node-1"], unboundCount: 0 },
    });
    expect(result.decision.kind).toBe("selected");
    expect(result.decision.surface).toBe("node_exec");
    expect(result.decision.invoke).toBe(false);
    expect(result.decision.enqueue).toBe(false);
    expect(result.invokedTool).toBe(false);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(result.surfaceBindings).toEqual(NODE_EXEC_TOOL_BINDINGS);
  });

  it("human-gates zero paired nodes", () => {
    const result = considerDispatch({
      intent: "read_user_machine",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, nodeEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
      nodeInventory: { boundNodeIds: [], unboundCount: 0 },
    });
    expect(result.decision.kind).toBe("human_gate");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.ZERO_NODES);
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.HUMAN_GATE);
    expect(result.decision.surface).not.toBe("node_fs_read");
    expect(result.invokedTool).toBe(false);
    expect(result.decision.invoke).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
  });

  it("human-gates multiple unbound nodes", () => {
    const result = considerDispatch({
      intent: "exec_user_machine",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, nodeEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
      nodeInventory: { boundNodeIds: [], unboundCount: 3 },
    });
    expect(result.decision.kind).toBe("human_gate");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.MULTIPLE_UNBOUND_NODES);
    expect(result.decision.surface).not.toBe("node_exec");
    expect(result.invokedTool).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
  });

  it("human-gates a single unbound node (no bound node)", () => {
    const result = considerDispatch({
      intent: "read_user_machine",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, nodeEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
      nodeInventory: { boundNodeIds: [], unboundCount: 1 },
    });
    expect(result.decision.kind).toBe("human_gate");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.NODE_UNBOUND);
    expect(result.decision.surface).not.toBe("node_fs_read");
    expect(result.invokedTool).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
  });

  it("does not route a workspace path as a node surface", () => {
    const result = considerDispatch({
      intent: "read_user_machine",
      pathKind: "workspace",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, nodeEnabled: true }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
      nodeInventory: { boundNodeIds: ["node-1"], unboundCount: 0 },
    });
    expect(result.decision.surface).not.toBe("node_fs_read");
    expect(result.decision.surface).not.toBe("node_exec");
    expect(result.decision.surface).toBe("memory");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.SANDBOX_IS_NOT_NODE);
    expect(result.invokedTool).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
  });

  it("skips node surfaces when nodeEnabled is off on the input flags", () => {
    const result = considerDispatch({
      intent: "read_user_machine",
      flags: shadowOrchestrationFlags({ dispatchEnabled: true, nodeEnabled: false }),
      ctrActivationEnabled: true,
      allowlistEmpty: false,
      pathKind: "node",
      nodeInventory: { boundNodeIds: ["node-1"], unboundCount: 0 },
    });
    expect(result.decision.kind).toBe("skip");
    expect(result.decision.reasonCodes).toContain(ORCH_REASON.NODE_ENABLED_OFF);
    expect(result.decision.surface).toBeUndefined();
    expect(result.invokedTool).toBe(false);
    expect(result.surfaceBindings).toEqual([]);
  });
});
