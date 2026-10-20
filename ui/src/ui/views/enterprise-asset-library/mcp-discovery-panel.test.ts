// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import {
  renderMcpDiscoveryPanel,
  type McpDiscoveryListItem,
  type McpDiscoveryPanelProps,
} from "./mcp-discovery-panel.ts";

function props(overrides?: Partial<McpDiscoveryPanelProps>): McpDiscoveryPanelProps {
  return {
    loading: false,
    error: null,
    disconnected: false,
    remoteToolsList: "unavailable",
    gap: "none",
    items: [],
    mapHref: "/enterprise/acme/data-governance/overview?edc=capabilities",
    authorizeHref: "/enterprise/acme/data-governance/overview?edc=authorization",
    onRetry: vi.fn(),
    ...overrides,
  };
}

function mount(value: McpDiscoveryPanelProps): HTMLElement {
  const container = document.createElement("div");
  render(renderMcpDiscoveryPanel(value), container);
  return container;
}

const rows: McpDiscoveryListItem[] = [
  {
    serverName: "linear",
    toolName: "list_issues",
    status: "unmapped",
    capabilityId: null,
    capabilityKey: null,
    capabilityDisplayName: null,
  },
  {
    serverName: "linear",
    toolName: "get_issue",
    status: "mapped_pending_grant",
    capabilityId: "cap-1",
    capabilityKey: "linear.issue",
    capabilityDisplayName: "议题详情",
  },
  {
    serverName: "linear",
    toolName: "search",
    status: "authorized",
    capabilityId: "cap-2",
    capabilityKey: "linear.search",
    capabilityDisplayName: "议题搜索",
  },
];

describe("renderMcpDiscoveryPanel", () => {
  it("shows remote-unavailable empty state that links to mapping and does not offer install", () => {
    const container = mount(
      props({ gap: "remote_tools_list_unavailable", remoteToolsList: "unavailable" }),
    );
    const discovery = container.querySelector(".mcp-discovery");
    expect(discovery?.textContent).toContain("远程工具列表暂不可用");
    expect(discovery?.textContent).toContain("不会出现建议安装的连接卡");
    expect(discovery?.textContent).toContain("去映射或申请授权");
    const link = container.querySelector<HTMLAnchorElement>(".mcp-discovery__empty a");
    expect(link?.textContent?.trim()).toBe("去映射");
    expect(link?.getAttribute("href")).toBe(
      "/enterprise/acme/data-governance/overview?edc=capabilities",
    );
    expect(
      Array.from(container.querySelectorAll("a,button")).map((node) => node.textContent?.trim()),
    ).toEqual(["去映射"]);
    expect(container.querySelector(".mcp-discovery__list")).toBeNull();
  });

  it("distinguishes a confirmed empty candidate list from remote unavailable", () => {
    const container = mount(props({ gap: "no_candidates", remoteToolsList: "ok" }));
    expect(container.textContent).toContain("本租户暂无候选 MCP 工具");
    expect(container.textContent).not.toContain("远程工具列表暂不可用");
    expect(
      Array.from(container.querySelectorAll("a,button")).map((node) => node.textContent?.trim()),
    ).toEqual(["去映射"]);
  });

  it("uses 去映射 and 申请授权, and hides both once a tool is authorized", () => {
    const container = mount(props({ items: rows }));
    const actionText = Array.from(container.querySelectorAll(".mcp-discovery__action")).map(
      (node) => node.textContent?.trim(),
    );
    expect(actionText).toEqual(["去映射", "申请授权", "员工席位可见"]);
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>(".mcp-discovery a"));
    expect(links.map((link) => link.textContent?.trim())).toEqual(["去映射", "申请授权"]);
    expect(links[0]?.getAttribute("href")).toBe(
      "/enterprise/acme/data-governance/overview?edc=capabilities&mcpServer=linear&mcpTool=list_issues",
    );
    expect(links[1]?.getAttribute("href")).toBe(
      "/enterprise/acme/data-governance/overview?edc=authorization&mcpServer=linear&mcpTool=get_issue&capabilityId=cap-1",
    );
    expect(container.textContent).toContain("未映射");
    expect(container.textContent).toContain("已映射待授权");
    expect(container.textContent).toContain("已授权可用");
    expect(container.textContent).toContain("议题搜索");
    expect(container.textContent).not.toContain("推送挂载");
  });

  it("builds per-row deeplink hrefs with mcpServer/mcpTool (and capabilityId when authorizing)", () => {
    const container = mount(props({ items: rows }));
    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".mcp-discovery__action a"),
    );
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute("href")).toContain("mcpServer=linear");
    expect(links[0]?.getAttribute("href")).toContain("mcpTool=list_issues");
    expect(links[0]?.getAttribute("href")).not.toContain("capabilityId=");
    expect(links[1]?.getAttribute("href")).toContain("mcpServer=linear");
    expect(links[1]?.getAttribute("href")).toContain("mcpTool=get_issue");
    expect(links[1]?.getAttribute("href")).toContain("capabilityId=cap-1");
  });

  it("retries a failed read without rendering a connect card", () => {
    const onRetry = vi.fn();
    const container = mount(props({ error: "MCP 发现列表加载失败", onRetry, items: rows }));
    expect(container.querySelector(".mcp-discovery__list")).toBeNull();
    container.querySelector<HTMLButtonElement>(".mcp-discovery__empty .btn")?.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
