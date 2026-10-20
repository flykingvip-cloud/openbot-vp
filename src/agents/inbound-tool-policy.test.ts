import { describe, expect, it } from "vitest";
import {
  applyInboundToolCeiling,
  evaluateInboundToolExecution,
  filterClientToolDefinitionsForInboundCeiling,
  filterToolsForInboundCeiling,
  INBOUND_TOOL_POLICY_VERSION,
  listRetrieveReadOnlyCoreToolIds,
  wrapInboundToolExecutionGuard,
  type InboundToolCeiling,
} from "./inbound-tool-policy.js";
import { resolveCoreToolCapability, resolveCoreToolCatalogId } from "./tool-catalog.js";
import { ToolAuthorizationError, type AnyAgentTool } from "./tools/common.js";

const RETRIEVE_CEILING: InboundToolCeiling = {
  depth: "retrieve",
  maxToolMode: "read",
  maxSideEffectLevel: "none",
};

const CHAT_CEILING: InboundToolCeiling = {
  depth: "chat",
  maxToolMode: "none",
  maxSideEffectLevel: "none",
};

const ACT_CEILING: InboundToolCeiling = {
  depth: "act",
  maxToolMode: "write",
  maxSideEffectLevel: "reversible",
};

function fakeTool(name: string, execute?: () => Promise<unknown>): AnyAgentTool {
  return {
    name,
    execute:
      execute ??
      (async () =>
        ({
          content: [],
          details: {},
        }) as never),
  } as unknown as AnyAgentTool;
}

describe("inbound retrieve tool policy", () => {
  it("keep a versioned catalog of read-only tools and marks knowledge_source as write", () => {
    expect(INBOUND_TOOL_POLICY_VERSION).toBe("inbound-tool-policy-v1");
    expect(listRetrieveReadOnlyCoreToolIds()).toEqual([
      "agents_list",
      "evolution_perception",
      "image",
      "knowledge_get",
      "knowledge_search",
      "memory_get",
      "memory_search",
      "read",
      "sessions_history",
      "sessions_list",
      "site_describe",
      "site_list",
      "web_fetch",
      "web_search",
    ]);
    expect(resolveCoreToolCatalogId("knowledge-source-tool")).toBe("knowledge_source");
    expect(resolveCoreToolCapability("knowledge_source")).toEqual({
      toolMode: "write",
      sideEffectLevel: "reversible",
    });
    expect(resolveCoreToolCapability("knowledge-source-tool")).toEqual({
      toolMode: "write",
      sideEffectLevel: "reversible",
    });
  });

  it("create-layer retrieve allowlist keeps audited read-only tools and drops write/send/exec/unknown", () => {
    const filtered = filterToolsForInboundCeiling(
      [
        fakeTool("read"),
        fakeTool("memory_search"),
        fakeTool("knowledge_search"),
        fakeTool("knowledge_get"),
        fakeTool("web_search"),
        fakeTool("knowledge_source"),
        fakeTool("knowledge-source-tool"),
        fakeTool("write"),
        fakeTool("sessions_send"),
        fakeTool("message"),
        fakeTool("exec"),
        fakeTool("browser"),
        fakeTool("plugin_unknown"),
      ],
      RETRIEVE_CEILING,
    );
    expect(filtered.map((tool) => tool.name)).toEqual([
      "read",
      "memory_search",
      "knowledge_search",
      "knowledge_get",
      "web_search",
    ]);
  });

  it("does not empty tools for chat unless a chat ceiling is actually supplied", () => {
    expect(
      filterToolsForInboundCeiling([fakeTool("write")], undefined).map((tool) => tool.name),
    ).toEqual(["write"]);
    expect(
      filterToolsForInboundCeiling([fakeTool("write")], ACT_CEILING).map((tool) => tool.name),
    ).toEqual(["write"]);
    expect(filterToolsForInboundCeiling([fakeTool("read")], CHAT_CEILING)).toEqual([]);
  });

  it("execute-layer denies write, knowledge_source, unknown, and ACL failures without calling execute", async () => {
    expect(evaluateInboundToolExecution({ toolName: "read", ceiling: RETRIEVE_CEILING })).toEqual({
      allowed: true,
    });
    expect(
      evaluateInboundToolExecution({ toolName: "knowledge_search", ceiling: RETRIEVE_CEILING }),
    ).toEqual({ allowed: true });
    expect(
      evaluateInboundToolExecution({ toolName: "knowledge_get", ceiling: RETRIEVE_CEILING }),
    ).toEqual({ allowed: true });
    expect(
      evaluateInboundToolExecution({ toolName: "knowledge_source", ceiling: RETRIEVE_CEILING }),
    ).toEqual({ allowed: false, reason: "write_tool_denied" });
    expect(
      evaluateInboundToolExecution({
        toolName: "knowledge-source-tool",
        ceiling: RETRIEVE_CEILING,
      }),
    ).toEqual({ allowed: false, reason: "write_tool_denied" });
    expect(evaluateInboundToolExecution({ toolName: "exec", ceiling: RETRIEVE_CEILING })).toEqual({
      allowed: false,
      reason: "write_tool_denied",
    });
    expect(
      evaluateInboundToolExecution({ toolName: "plugin_unknown", ceiling: RETRIEVE_CEILING }),
    ).toEqual({ allowed: false, reason: "unknown_side_effect" });
    expect(
      evaluateInboundToolExecution({
        toolName: "read",
        ceiling: RETRIEVE_CEILING,
        isStillAllowed: () => false,
      }),
    ).toEqual({ allowed: false, reason: "acl_disallowed" });

    let writeCalls = 0;
    const write = wrapInboundToolExecutionGuard(
      fakeTool("write", async () => {
        writeCalls += 1;
        return { content: [], details: {} };
      }),
      { ceiling: RETRIEVE_CEILING },
    );
    await expect(write.execute("call-1", {}, undefined, undefined)).rejects.toBeInstanceOf(
      ToolAuthorizationError,
    );
    expect(writeCalls).toBe(0);

    let aclCalls = 0;
    const aclDenied = wrapInboundToolExecutionGuard(
      fakeTool("read", async () => {
        aclCalls += 1;
        return { content: [], details: {} };
      }),
      { ceiling: RETRIEVE_CEILING, isStillAllowed: () => false },
    );
    await expect(aclDenied.execute("call-2", {}, undefined, undefined)).rejects.toMatchObject({
      name: "ToolAuthorizationError",
      message: expect.stringContaining("acl_disallowed"),
    });
    expect(aclCalls).toBe(0);
  });

  it("stale write tools from a restored session cannot break the retrieve ceiling", async () => {
    let writeCalls = 0;
    const restored = applyInboundToolCeiling({
      tools: [
        fakeTool("read"),
        fakeTool("write", async () => {
          writeCalls += 1;
          return { content: [], details: {} };
        }),
        fakeTool("knowledge_source"),
      ],
      ceiling: RETRIEVE_CEILING,
    });
    expect(restored.map((tool) => tool.name)).toEqual(["read"]);

    const leftoverWrite = wrapInboundToolExecutionGuard(
      fakeTool("write", async () => {
        writeCalls += 1;
        return { content: [], details: {} };
      }),
      { ceiling: RETRIEVE_CEILING },
    );
    await expect(leftoverWrite.execute("stale", {}, undefined, undefined)).rejects.toBeInstanceOf(
      ToolAuthorizationError,
    );
    expect(writeCalls).toBe(0);
  });

  it("allowed retrieve tools execute exactly once and are not retried as a higher-privilege tool", async () => {
    let calls = 0;
    const [read] = applyInboundToolCeiling({
      tools: [
        fakeTool("read", async () => {
          calls += 1;
          return { content: [], details: {} };
        }),
      ],
      ceiling: RETRIEVE_CEILING,
    });
    await read?.execute?.("call-1", {}, undefined, undefined);
    expect(calls).toBe(1);
    expect(
      evaluateInboundToolExecution({ toolName: "write", ceiling: RETRIEVE_CEILING }).allowed,
    ).toBe(false);
  });

  it("act and no-ceiling paths keep the existing tool set", () => {
    const tools = [fakeTool("write"), fakeTool("knowledge_source"), fakeTool("exec")];
    expect(filterToolsForInboundCeiling(tools, undefined)).toEqual(tools);
    expect(filterToolsForInboundCeiling(tools, ACT_CEILING)).toEqual(tools);
    expect(evaluateInboundToolExecution({ toolName: "write" })).toEqual({ allowed: true });
    expect(evaluateInboundToolExecution({ toolName: "write", ceiling: ACT_CEILING })).toEqual({
      allowed: true,
    });
  });

  it("filters hosted client tools by the same retrieve allowlist", () => {
    const clientTools = [
      { type: "function" as const, function: { name: "agents_list" } },
      { type: "function" as const, function: { name: "knowledge_source" } },
      { type: "function" as const, function: { name: "write" } },
    ];
    expect(filterClientToolDefinitionsForInboundCeiling(clientTools, RETRIEVE_CEILING)).toEqual([
      { type: "function", function: { name: "agents_list" } },
    ]);
    expect(filterClientToolDefinitionsForInboundCeiling(clientTools, undefined)).toEqual(
      clientTools,
    );
  });
});
