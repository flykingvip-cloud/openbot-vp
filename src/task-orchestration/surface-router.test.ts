import { describe, expect, it } from "vitest";
import { ORCH_REASON } from "./reason-codes.js";
import { routeStep } from "./surface-router.js";
import { emptyOrchestrationFlags, shadowOrchestrationFlags, type RouteStepInput } from "./types.js";

function input(
  overrides: Partial<RouteStepInput> & Pick<RouteStepInput, "intent">,
): RouteStepInput {
  return {
    flags: shadowOrchestrationFlags(),
    ...overrides,
  };
}

describe("routeStep capability ladder", () => {
  it("does not choose browser to scrape a session when a connector is already available", () => {
    const decision = routeStep(
      input({
        intent: "interact_web",
        connectedConnectorIds: ["gmail"],
        requestedConnectorId: "gmail",
        requestedSurface: "browser",
        flags: shadowOrchestrationFlags({ browserEnabled: true }),
      }),
    );
    expect(decision.kind).toBe("blocked_policy");
    expect(decision.surface).toBeUndefined();
    expect(decision.reasonCodes).toContain(ORCH_REASON.SKIP_AHEAD_BLOCKED);
    expect(decision.invoke).toBe(false);

    const auto = routeStep(
      input({
        intent: "interact_web",
        connectedConnectorIds: ["gmail"],
        requestedConnectorId: "gmail",
        flags: shadowOrchestrationFlags({ browserEnabled: true }),
      }),
    );
    expect(auto.kind).toBe("selected");
    expect(auto.surface).toBe("connector");
    expect(auto.surface).not.toBe("browser");
    expect(auto.reasonCodes).toContain(ORCH_REASON.CONNECTOR_PREFERRED_OVER_BROWSER);
  });

  it("prefers web_read over browser when no interaction is required", () => {
    const decision = routeStep(
      input({
        intent: "read_web",
        requestedSurface: "browser",
        flags: shadowOrchestrationFlags({ browserEnabled: true }),
      }),
    );
    expect(decision.kind).toBe("blocked_policy");
    expect(decision.reasonCodes).toContain(ORCH_REASON.SKIP_AHEAD_BLOCKED);
    expect(decision.reasonCodes).toContain(ORCH_REASON.WEB_READ_PREFERRED_OVER_BROWSER);
    expect(decision.invoke).toBe(false);
  });

  it("selects web_read without invoking", () => {
    const decision = routeStep(input({ intent: "read_web" }));
    expect(decision.kind).toBe("selected");
    expect(decision.surface).toBe("web_read");
    expect(decision.invoke).toBe(false);
    expect(decision.enqueue).toBe(false);
  });

  it("selects browser for interact_web when no connector and browserEnabled is on", () => {
    const decision = routeStep(
      input({
        intent: "interact_web",
        flags: shadowOrchestrationFlags({ browserEnabled: true }),
      }),
    );
    expect(decision.kind).toBe("selected");
    expect(decision.surface).toBe("browser");
    expect(decision.invoke).toBe(false);
    expect(decision.enqueue).toBe(false);
  });
});

describe("routeStep node fail-closed", () => {
  it("never selects node_fs_read/node_exec when nodeEnabled is off", () => {
    for (const intent of ["read_user_machine", "exec_user_machine"] as const) {
      const decision = routeStep(
        input({
          intent,
          flags: shadowOrchestrationFlags({ nodeEnabled: false }),
          nodeInventory: { boundNodeIds: ["node-1"], unboundCount: 0 },
        }),
      );
      expect(decision.kind).toBe("skip");
      expect(decision.surface).toBeUndefined();
      expect(decision.reasonCodes).toContain(ORCH_REASON.NODE_ENABLED_OFF);
    }
  });

  it("raises a human gate when there are zero paired nodes", () => {
    const decision = routeStep(
      input({
        intent: "read_user_machine",
        flags: shadowOrchestrationFlags({ nodeEnabled: true }),
        nodeInventory: { boundNodeIds: [], unboundCount: 0 },
      }),
    );
    expect(decision.kind).toBe("human_gate");
    expect(decision.reasonCodes).toContain(ORCH_REASON.ZERO_NODES);
    expect(decision.kind).not.toBe("selected");
  });

  it("raises a human gate when multiple nodes are unbound", () => {
    const decision = routeStep(
      input({
        intent: "exec_user_machine",
        flags: shadowOrchestrationFlags({ nodeEnabled: true }),
        nodeInventory: { boundNodeIds: [], unboundCount: 3 },
      }),
    );
    expect(decision.kind).toBe("human_gate");
    expect(decision.reasonCodes).toContain(ORCH_REASON.MULTIPLE_UNBOUND_NODES);
    expect(decision.surface).not.toBe("node_exec");
  });

  it("selects node_fs_read only for a single bound node with nodeEnabled on", () => {
    const decision = routeStep(
      input({
        intent: "read_user_machine",
        flags: shadowOrchestrationFlags({ nodeEnabled: true }),
        pathKind: "node",
        nodeInventory: { boundNodeIds: ["node-1"], unboundCount: 0 },
      }),
    );
    expect(decision.kind).toBe("selected");
    expect(decision.surface).toBe("node_fs_read");
    expect(decision.invoke).toBe(false);
    expect(decision.enqueue).toBe(false);
  });

  it("selects node_exec only for a single bound node with nodeEnabled on", () => {
    const decision = routeStep(
      input({
        intent: "exec_user_machine",
        flags: shadowOrchestrationFlags({ nodeEnabled: true }),
        pathKind: "node",
        nodeInventory: { boundNodeIds: ["node-1"], unboundCount: 0 },
      }),
    );
    expect(decision.kind).toBe("selected");
    expect(decision.surface).toBe("node_exec");
    expect(decision.invoke).toBe(false);
    expect(decision.enqueue).toBe(false);
  });

  it("raises a human gate when a single node is unbound", () => {
    const decision = routeStep(
      input({
        intent: "read_user_machine",
        flags: shadowOrchestrationFlags({ nodeEnabled: true }),
        nodeInventory: { boundNodeIds: [], unboundCount: 1 },
      }),
    );
    expect(decision.kind).toBe("human_gate");
    expect(decision.reasonCodes).toContain(ORCH_REASON.NODE_UNBOUND);
    expect(decision.surface).not.toBe("node_fs_read");
  });
});

describe("routeStep sandbox is not the user machine", () => {
  it("must not route a workspace-relative path as node_fs_read", () => {
    const decision = routeStep(
      input({
        intent: "read_user_machine",
        pathKind: "workspace",
        flags: shadowOrchestrationFlags({ nodeEnabled: true }),
        nodeInventory: { boundNodeIds: ["node-1"], unboundCount: 0 },
      }),
    );
    expect(decision.surface).not.toBe("node_fs_read");
    expect(decision.surface).not.toBe("node_exec");
    expect(decision.surface).toBe("memory");
    expect(decision.reasonCodes).toContain(ORCH_REASON.SANDBOX_IS_NOT_NODE);
  });

  it("blocks an explicit node_fs_read request against a workspace path", () => {
    const decision = routeStep(
      input({
        intent: "apply_skill",
        skillId: "notes",
        pathKind: "workspace",
        requestedSurface: "node_fs_read",
        flags: shadowOrchestrationFlags({ nodeEnabled: true }),
      }),
    );
    expect(decision.kind).toBe("blocked_policy");
    expect(decision.reasonCodes).toContain(ORCH_REASON.SANDBOX_IS_NOT_NODE);
  });
});

describe("routeStep dormant", () => {
  it("is a no-op when all flags are off", () => {
    const decision = routeStep({
      intent: "read_web",
      flags: emptyOrchestrationFlags(),
    });
    expect(decision.kind).toBe("noop");
    expect(decision.enqueue).toBe(false);
    expect(decision.invoke).toBe(false);
    expect(decision.surface).toBeUndefined();
    expect(decision.reasonCodes).toContain(ORCH_REASON.DORMANT);
  });
});
