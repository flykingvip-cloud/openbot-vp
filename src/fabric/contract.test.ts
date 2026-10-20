import { describe, expect, it } from "vitest";
import {
  ExecutionGraphState,
  FabricContractError,
  parseContract,
  PolicyDecision,
  RuntimeNode,
  ToolRequest,
} from "./contract.js";

describe("Fabric contract — ToolRequest", () => {
  const valid = {
    id: "req-1",
    source: { type: "cursor", tenantId: "t1" },
    tool: { name: "exec" },
    input: { args: ["echo", "hi"], cwd: "/repo" },
    context: { repoRoot: "/repo", fileScope: ["src/**"] },
    trace: { sessionId: "s1", correlationId: "c1" },
  };

  it("accepts a well-formed request and applies defaults", () => {
    const parsed = parseContract(ToolRequest, valid);
    expect(parsed.tool.name).toBe("exec");
    expect(parsed.source.type).toBe("cursor");
  });

  it("accepts an unknown (extensible) source type", () => {
    const parsed = parseContract(ToolRequest, {
      ...valid,
      source: { type: "my-custom-ide" },
    });
    expect(parsed.source.type).toBe("my-custom-ide");
  });

  it("rejects a missing required field with a locatable error", () => {
    const bad = { ...valid, trace: { sessionId: "s1" } }; // missing correlationId
    expect(() => parseContract(ToolRequest, bad, "ToolRequest")).toThrow(FabricContractError);
    try {
      parseContract(ToolRequest, bad, "ToolRequest");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('"req-1"'); // object id surfaced
      expect(message).toContain("trace.correlationId"); // field path surfaced
    }
  });
});

describe("Fabric contract — PolicyDecision discriminated union", () => {
  it("ALLOW carries optional constraints + decisionTrace", () => {
    const d = parseContract(PolicyDecision, {
      decision: "ALLOW",
      decisionTrace: [{ stage: "exec.allowlist", hit: true, effect: "allow" }],
    });
    expect(d.decision).toBe("ALLOW");
    expect(d.matchedRules).toEqual([]);
  });

  it("DENY requires a reason", () => {
    expect(() => parseContract(PolicyDecision, { decision: "DENY" })).toThrow(FabricContractError);
    const d = parseContract(PolicyDecision, {
      decision: "DENY",
      reason: "blocked by allowlist",
    });
    expect(d.decision === "DENY" && d.reason).toBe("blocked by allowlist");
  });

  it("MODIFY requires constraints", () => {
    expect(() => parseContract(PolicyDecision, { decision: "MODIFY" })).toThrow(
      FabricContractError,
    );
    const d = parseContract(PolicyDecision, {
      decision: "MODIFY",
      constraints: { sandboxMode: "strict", allowNetwork: false },
    });
    expect(d.decision).toBe("MODIFY");
  });

  it("rejects an unknown decision discriminant", () => {
    expect(() => parseContract(PolicyDecision, { decision: "MAYBE" })).toThrow(FabricContractError);
  });
});

describe("Fabric contract — RuntimeNode discriminated union", () => {
  it("accepts a tool node", () => {
    const node = parseContract(RuntimeNode, {
      id: "n1",
      type: "tool",
      request: {
        id: "req-1",
        source: { type: "openbot" },
        tool: { name: "git" },
        trace: { sessionId: "s1", correlationId: "c1" },
      },
    });
    expect(node.type).toBe("tool");
    expect(node.status).toBe("pending");
  });

  it("accepts fork/merge projection nodes", () => {
    expect(parseContract(RuntimeNode, { id: "f1", type: "fork", branches: ["a", "b"] }).type).toBe(
      "fork",
    );
    const merge = parseContract(RuntimeNode, { id: "m1", type: "merge" });
    expect(merge.type === "merge" && merge.strategy).toBe("all");
  });

  it("rejects a fork node with no branches", () => {
    expect(() => parseContract(RuntimeNode, { id: "f1", type: "fork", branches: [] })).toThrow(
      FabricContractError,
    );
  });

  it("rejects an unknown node type", () => {
    expect(() => parseContract(RuntimeNode, { id: "x", type: "wormhole" })).toThrow(
      FabricContractError,
    );
  });
});

describe("Fabric contract — ExecutionGraphState projection", () => {
  it("requires at least one node and carries trace context", () => {
    const state = parseContract(ExecutionGraphState, {
      graphId: "g1",
      nodes: [
        {
          id: "n1",
          type: "tool",
          request: {
            id: "req-1",
            source: { type: "kiro" },
            tool: { name: "exec" },
            trace: { sessionId: "s1", correlationId: "c1" },
          },
        },
      ],
      context: { sessionId: "s1", correlationId: "c1" },
    });
    expect(state.nodes).toHaveLength(1);
    expect(state.runs).toEqual([]);
    expect(state.edges).toEqual([]);
  });

  it("rejects an empty graph (no nodes)", () => {
    expect(() =>
      parseContract(ExecutionGraphState, {
        graphId: "g1",
        nodes: [],
        context: { sessionId: "s1", correlationId: "c1" },
      }),
    ).toThrow(FabricContractError);
  });
});
