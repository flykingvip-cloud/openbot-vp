import { describe, expect, it } from "vitest";
import {
  appendMcpDiscoveryContext,
  buildMcpHandlerRef,
  buildMcpMappingPrefill,
  formatMcpDiscoveryLabel,
  parseMcpDiscoveryContext,
  suggestCapabilityKeyFromMcp,
} from "./mcp-discovery-deeplink.ts";

describe("mcp-discovery-deeplink", () => {
  it("appends mcpServer/mcpTool onto an edc base href, and capabilityId when given", () => {
    const map = appendMcpDiscoveryContext(
      "/enterprise/acme/data-governance/overview?edc=capabilities",
      { mcpServer: "linear", mcpTool: "list_issues" },
    );
    expect(map).toBe(
      "/enterprise/acme/data-governance/overview?edc=capabilities&mcpServer=linear&mcpTool=list_issues",
    );
    const authorize = appendMcpDiscoveryContext(
      "/enterprise/acme/data-governance/overview?edc=authorization",
      { mcpServer: "linear", mcpTool: "get_issue", capabilityId: "cap-1" },
    );
    expect(authorize).toBe(
      "/enterprise/acme/data-governance/overview?edc=authorization&mcpServer=linear&mcpTool=get_issue&capabilityId=cap-1",
    );
  });

  it("omits empty tool and capabilityId", () => {
    expect(
      appendMcpDiscoveryContext("/x?edc=capabilities", {
        mcpServer: "linear",
        mcpTool: "  ",
        capabilityId: null,
      }),
    ).toBe("/x?edc=capabilities&mcpServer=linear");
  });

  it("parses discovery context from search, requiring mcpServer", () => {
    expect(
      parseMcpDiscoveryContext(
        "?edc=capabilities&mcpServer=linear&mcpTool=list_issues&capabilityId=cap-1",
      ),
    ).toEqual({
      mcpServer: "linear",
      mcpTool: "list_issues",
      capabilityId: "cap-1",
      requestId: null,
    });
    expect(parseMcpDiscoveryContext("?edc=capabilities&mcpTool=only")).toBeNull();
    expect(parseMcpDiscoveryContext("")).toBeNull();
  });

  it("suggests a sanitized capability key and label", () => {
    const ctx = {
      mcpServer: "Linear Ops",
      mcpTool: "list issues!",
      capabilityId: null,
      requestId: null,
    };
    expect(suggestCapabilityKeyFromMcp(ctx)).toBe("linear_ops.list_issues");
    expect(formatMcpDiscoveryLabel(ctx)).toBe("Linear Ops / list issues!");
  });

  it("builds mapping prefill with readable mcp:// handler without writing", () => {
    const ctx = {
      mcpServer: "linear",
      mcpTool: "list_issues",
      capabilityId: null,
      requestId: null,
    };
    expect(buildMcpHandlerRef(ctx.mcpServer, ctx.mcpTool)).toBe("mcp://linear/list_issues");
    expect(buildMcpMappingPrefill(ctx)).toEqual({
      mcpServer: "linear",
      mcpTool: "list_issues",
      capabilityKey: "linear.list_issues",
      displayName: "list_issues",
      description: "来自 MCP 发现：linear / list_issues",
      handlerRef: "mcp://linear/list_issues",
    });
    expect(
      buildMcpMappingPrefill({
        mcpServer: "linear",
        mcpTool: "",
        capabilityId: null,
        requestId: null,
      }),
    ).toBeNull();
  });

  it("appends requestId / capabilityAccessRequestId for approve_intent_only fulfill", () => {
    const href = appendMcpDiscoveryContext("/x?edc=capabilities", {
      mcpServer: "linear",
      mcpTool: "list_issues",
      requestId: "apr-1",
    });
    expect(href).toContain("requestId=apr-1");
    expect(href).toContain("capabilityAccessRequestId=apr-1");
    expect(
      parseMcpDiscoveryContext("?mcpServer=linear&mcpTool=list_issues&requestId=apr-1"),
    ).toEqual({
      mcpServer: "linear",
      mcpTool: "list_issues",
      capabilityId: null,
      requestId: "apr-1",
    });
  });
});
