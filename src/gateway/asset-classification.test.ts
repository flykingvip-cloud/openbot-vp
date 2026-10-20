import { describe, expect, it } from "vitest";
import { inferOrganizableAssetClassification } from "./asset-classification.js";

describe("inferOrganizableAssetClassification", () => {
  it("classifies a named catalog tool from user language", () => {
    expect(
      inferOrganizableAssetClassification({
        name: "网页检索",
        summary: "搜索公开网页并整理结果",
      }),
    ).toEqual({
      assetType: "tool",
      toolBinding: { toolIds: ["web_search"] },
    });
  });

  it("classifies an MCP server from a URL in the description", () => {
    expect(
      inferOrganizableAssetClassification({
        name: "Linear",
        summary: "通过 https://mcp.linear.app 查询任务",
      }),
    ).toMatchObject({
      assetType: "mcp",
      mcpBinding: {
        serverName: "linear",
        url: "https://mcp.linear.app",
        transport: "http",
      },
    });
  });

  it("keeps ordinary work patterns as capabilities", () => {
    expect(
      inferOrganizableAssetClassification({
        name: "客户沟通整理",
        summary: "把客户对话整理成清晰摘要",
      }),
    ).toEqual({ assetType: "capability" });
  });

  it("trusts an already-complete runtime bind over keyword guesses", () => {
    expect(
      inferOrganizableAssetClassification({
        name: "随便起个名字",
        summary: "看起来像流程步骤",
        runtimeDefinition: {
          tools: [],
          mcpBinding: {
            serverName: "github",
            transport: "stdio",
            command: "npx -y @modelcontextprotocol/server-github",
          },
        },
      }),
    ).toMatchObject({
      assetType: "mcp",
      mcpBinding: { serverName: "github" },
    });
  });
});
