/**
 * 能力中心 · MCP 发现列表。
 *
 * 只给企业管理员看候选工具的治理状态。主操作是去数据能力中心映射，或去席位授权。
 * 不提供安装、Add、Connect。员工端设置页不要挂这个面板。
 */
import { html, nothing, type TemplateResult } from "lit";
import { appendMcpDiscoveryContext } from "../../ports/enterprise/views/enterprise-data-capability/mcp-discovery-deeplink.ts";

export type McpDiscoveryStatus = "unmapped" | "mapped_pending_grant" | "authorized";

export type McpDiscoveryListItem = {
  serverName: string;
  toolName: string;
  status: McpDiscoveryStatus;
  capabilityId: string | null;
  capabilityKey: string | null;
  capabilityDisplayName: string | null;
};

export type McpDiscoveryPanelProps = {
  loading: boolean;
  error: string | null;
  disconnected: boolean;
  remoteToolsList: "ok" | "unavailable" | "partial" | null;
  gap: "none" | "remote_tools_list_unavailable" | "no_candidates" | null;
  items: McpDiscoveryListItem[];
  mapHref: string;
  authorizeHref: string;
  onRetry: () => void;
};

const STATUS_LABEL: Record<McpDiscoveryStatus, string> = {
  unmapped: "未映射",
  mapped_pending_grant: "已映射待授权",
  authorized: "已授权可用",
};

function statusClass(status: McpDiscoveryStatus): string {
  if (status === "authorized") {
    return "mcp-discovery__status mcp-discovery__status--authorized";
  }
  if (status === "mapped_pending_grant") {
    return "mcp-discovery__status mcp-discovery__status--pending";
  }
  return "mcp-discovery__status mcp-discovery__status--unmapped";
}

function renderBoundaryNote(): TemplateResult {
  return html`
    <p class="mcp-discovery__note">
      工具要先映射为企业能力，再经席位授权，员工才可见。本页只提供去映射或申请授权。
    </p>
  `;
}

function rowMapHref(props: McpDiscoveryPanelProps, item: McpDiscoveryListItem): string {
  return appendMcpDiscoveryContext(props.mapHref, {
    mcpServer: item.serverName,
    mcpTool: item.toolName,
  });
}

function rowAuthorizeHref(props: McpDiscoveryPanelProps, item: McpDiscoveryListItem): string {
  return appendMcpDiscoveryContext(props.authorizeHref, {
    mcpServer: item.serverName,
    mcpTool: item.toolName,
    capabilityId: item.capabilityId,
  });
}

function renderRow(props: McpDiscoveryPanelProps, item: McpDiscoveryListItem): TemplateResult {
  const toolLabel = item.toolName
    ? `${item.serverName} / ${item.toolName}`
    : `${item.serverName} / 工具名未声明`;
  const capabilityLabel = item.capabilityDisplayName ?? item.capabilityKey;
  return html`
    <div class="mcp-discovery__row">
      <div class="mcp-discovery__tool">${toolLabel}</div>
      <div class=${statusClass(item.status)}>${STATUS_LABEL[item.status]}</div>
      <div class="mcp-discovery__capability">
        ${capabilityLabel ? capabilityLabel : "尚未成为企业能力"}
      </div>
      <div class="mcp-discovery__action">
        ${
          item.status === "unmapped"
            ? html`<a class="btn primary" href=${rowMapHref(props, item)}>去映射</a>`
            : item.status === "mapped_pending_grant"
              ? html`<a class="btn primary" href=${rowAuthorizeHref(props, item)}>申请授权</a>`
              : html`
                  <span class="mcp-discovery__ready">员工席位可见</span>
                `
        }
      </div>
    </div>
  `;
}

export function renderMcpDiscoveryPanel(props: McpDiscoveryPanelProps): TemplateResult {
  const showEmpty =
    !props.disconnected && !props.loading && !props.error && props.items.length === 0;
  return html`
    <section class="mcp-discovery" aria-label="MCP 工具发现">
      <div class="mcp-discovery__head">
        <h2>候选 MCP 工具</h2>
        ${renderBoundaryNote()}
      </div>
      ${
        props.disconnected
          ? html`
              <p class="mcp-discovery__empty">正在连接企业数据，连接后显示映射与授权状态。</p>
            `
          : nothing
      }
      ${
        props.loading
          ? html`
              <p class="mcp-discovery__empty">正在读取映射状态…</p>
            `
          : nothing
      }
      ${
        props.error
          ? html`
            <div class="mcp-discovery__empty">
              <p>${props.error}</p>
              <button type="button" class="btn" @click=${props.onRetry}>重试</button>
            </div>
          `
          : nothing
      }
      ${
        showEmpty
          ? html`
            <div class="mcp-discovery__empty">
              ${
                props.remoteToolsList === "unavailable" ||
                props.gap === "remote_tools_list_unavailable"
                  ? html`
                      <p>远程工具列表暂不可用。</p>
                      <p>
                        未能读取本租户已登记 MCP 的远程工具名（未物化到本机 mcporter
                        配置、探测失败或超时）。这里不会出现建议安装的连接卡。已声明白名单或已用 mcp://服务/工具
                        显式映射的动作，仍会在恢复后列出。
                      </p>
                    `
                  : html`
                      <p>本租户暂无候选 MCP 工具。</p>
                      <p>远程列表已读取，当前没有可浏览的候选。请先在本企业登记 MCP 资产，或将工具映射为数据能力。</p>
                    `
              }
              <a class="btn primary" href=${props.mapHref}>去映射</a>
            </div>
          `
          : nothing
      }
      ${
        !props.loading && !props.error && props.items.length > 0
          ? html`
            <div class="mcp-discovery__list">
              ${props.items.map((item) => renderRow(props, item))}
            </div>
          `
          : nothing
      }
    </section>
  `;
}
