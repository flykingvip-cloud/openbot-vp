import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { renderIcon } from "../../../icons.ts";
import type { PlatformAuthPanelProps } from "../../../views/platform-auth-panel.ts";

type GovernanceAction = "observe" | "read" | "write" | "invoke" | "pair" | "revoke" | "approve";
type GovernanceEffect = "allowed" | "denied";

type GovernanceAuditEvent = {
  ts: string;
  actor: {
    role:
      | "platform-super-admin"
      | "platform-admin"
      | "tenant-admin"
      | "employee-supervisor"
      | "local-operator";
    subjectId: string;
    scope: "platform" | "tenant" | "self";
  };
  action: GovernanceAction;
  target: {
    kind: "tenant" | "user" | "device" | "supervisor-agent" | "worker-agent";
    resourceId: string;
    tenantId?: string;
    ownerUserId?: string;
  };
  effect: GovernanceEffect;
  reason?: string;
};

type GovernanceAuditResponse = {
  scope: { kind: "platform" | "tenant" | "self"; tenantId?: string; ownerId?: string };
  events: GovernanceAuditEvent[];
};

export type ManagementGovernanceEnterpriseOption = {
  tenantId: string;
  label: string;
};

const ROLE_ROWS = [
  {
    role: "平台管理员大白管家",
    scope: "全平台",
    resources: "全部企业、员工、终端与机器人",
    permissions: "读取 · 写入 · 调用 · 配对 · 撤销 · 审批",
    tone: "danger",
  },
  {
    role: "企业管理员大白管家",
    scope: "本企业",
    resources: "企业员工、员工终端与所属机器人",
    permissions: "读取 · 写入 · 调用 · 配对 · 撤销",
    tone: "warn",
  },
  {
    role: "员工大白管家",
    scope: "本人",
    resources: "本人终端与本人所属其他机器人",
    permissions: "读取 · 写入 · 调用",
    tone: "ok",
  },
] as const;

const ACTION_LABELS: Record<GovernanceAction, string> = {
  observe: "观察",
  read: "读取",
  write: "写入",
  invoke: "调用",
  pair: "配对",
  revoke: "撤销",
  approve: "审批",
};

const ROLE_LABELS: Record<GovernanceAuditEvent["actor"]["role"], string> = {
  "platform-super-admin": "平台超级管理员",
  "platform-admin": "平台管理员",
  "tenant-admin": "企业管理员",
  "employee-supervisor": "员工大白管家",
  "local-operator": "本地管理员",
};

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? value
    : timestamp.toLocaleString("zh-CN", { hour12: false });
}

export class ManagementGovernanceSection extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ attribute: false }) enterprises: ManagementGovernanceEnterpriseOption[] = [];
  @property({ attribute: false }) authPanelProps: PlatformAuthPanelProps | null = null;

  @state() private response: GovernanceAuditResponse | null = null;
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private action = "";
  @state() private effect = "";
  @state() private actorId = "";
  @state() private resourceId = "";
  @state() private assignmentNodeId = "";
  @state() private assignmentTenantId = "";
  @state() private assignmentOwnerId = "";
  @state() private assigning = false;
  @state() private assignmentNotice: string | null = null;
  private loadedOnce = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.client) {
      void this.loadAudit();
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("client") && this.client && !this.loadedOnce) {
      void this.loadAudit();
    }
  }

  private async loadAudit() {
    if (!this.client || this.loading) {
      return;
    }
    this.loadedOnce = true;
    this.loading = true;
    this.error = null;
    try {
      const params: Record<string, string | number> = { limit: 100 };
      if (this.action) {
        params.action = this.action;
      }
      if (this.effect) {
        params.effect = this.effect;
      }
      if (this.actorId.trim()) {
        params.actorId = this.actorId.trim();
      }
      if (this.resourceId.trim()) {
        params.resourceId = this.resourceId.trim();
      }
      this.response = await this.client.request<GovernanceAuditResponse>(
        "management-governance.audit.list",
        params,
      );
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  private renderAuthorityChain() {
    return html`
      <section class="card">
        <div class="row row--split">
          <div class="card-title">大白管家权力链</div>
          <span class="chip">${this.enterprises.length} 个企业租户</span>
        </div>
        <div class="platform-capabilities__distribution card-follow">
          <table class="platform-capabilities__distribution-table">
            <thead>
              <tr>
                <th>治理角色</th>
                <th>作用域</th>
                <th>可治理资源</th>
                <th>授权动作</th>
              </tr>
            </thead>
            <tbody>
              ${ROLE_ROWS.map(
                (row) => html`
                  <tr>
                    <td><strong>${row.role}</strong></td>
                    <td>
                      <span class="platform-capabilities__chip is-${row.tone}">${row.scope}</span>
                    </td>
                    <td>${row.resources}</td>
                    <td><span class="mono">${row.permissions}</span></td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  private renderPlatformAdministratorManagement() {
    const props = this.authPanelProps;
    const state = props?.state;
    if (!props || !state?.canManagePlatformAdmins) {
      return nothing;
    }
    const admins = state.platformAdmins ?? [];
    const scopeOptions = [
      { value: "operator.read", label: "读取" },
      { value: "operator.write", label: "写入" },
      { value: "operator.approvals", label: "审批" },
      { value: "operator.pairing", label: "终端配对" },
      { value: "operator.admin", label: "管理员操作" },
    ] as const;
    const selectedScopes = new Set(props.platformAdminScopes);
    return html`
      <section class="card">
        <div class="row row--split">
          <div class="card-title">平台管理员授权</div>
          <span class="chip">${admins.length} 位管理员</span>
        </div>
        <div class="platform-capabilities__distribution card-follow">
          <table class="platform-capabilities__distribution-table">
            <thead>
              <tr>
                <th>管理员</th>
                <th>平台角色</th>
                <th>权限范围</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              ${admins.map(
                (admin) => html`
                  <tr>
                    <td>
                      <div>${admin.displayName?.trim() || admin.user}</div>
                      <div class="muted">${admin.user}</div>
                    </td>
                    <td>${admin.platformRole === "super-admin" ? "超级管理员" : "平台管理员"}</td>
                    <td class="mono">${admin.scopes?.join(" · ") || "—"}</td>
                    <td>
                      <span class="platform-capabilities__chip is-ok"
                        >${admin.isCurrentUser ? "当前账号" : "已启用"}</span
                      >
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
        <div class="form-grid card-follow">
          <label class="stack stack--tight">
            <span class="card-sub">姓名</span>
            <input
              class="input"
              autocomplete="name"
              .value=${props.platformAdminDisplayName}
              ?disabled=${props.busy}
              @input=${(event: Event) => props.onPlatformAdminDisplayNameChange((event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="stack stack--tight">
            <span class="card-sub">邮箱</span>
            <input
              class="input"
              type="email"
              autocomplete="username"
              .value=${props.platformAdminEmail}
              ?disabled=${props.busy}
              @input=${(event: Event) => props.onPlatformAdminEmailChange((event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="stack stack--tight">
            <span class="card-sub">初始密码</span>
            <input
              class="input"
              type="password"
              autocomplete="new-password"
              .value=${props.platformAdminPassword}
              ?disabled=${props.busy}
              @input=${(event: Event) => props.onPlatformAdminPasswordChange((event.target as HTMLInputElement).value)}
            />
          </label>
        </div>
        <div class="row row--wrap card-follow">
          ${scopeOptions.map(
            (scope) => html`
              <label class="row row--tight">
                <input
                  type="checkbox"
                  .checked=${selectedScopes.has(scope.value)}
                  ?disabled=${props.busy}
                  @change=${(event: Event) => {
                    const next = new Set(props.platformAdminScopes);
                    if ((event.target as HTMLInputElement).checked) {
                      next.add(scope.value);
                    } else {
                      next.delete(scope.value);
                    }
                    props.onPlatformAdminScopesChange([...next]);
                  }}
                />
                <span>${scope.label}</span>
              </label>
            `,
          )}
        </div>
        ${props.error ? html`<div class="callout danger card-follow">${props.error}</div>` : nothing}
        ${props.notice ? html`<div class="callout card-follow">${props.notice}</div>` : nothing}
        <div class="row row--end card-follow">
          <button
            class="btn btn--primary"
            type="button"
            ?disabled=${props.busy || !props.onCreatePlatformAdmin || !props.platformAdminDisplayName.trim() || !props.platformAdminEmail.trim() || !props.platformAdminPassword.trim()}
            @click=${() => props.onCreatePlatformAdmin?.()}
          >
            ${props.busy ? "创建中…" : "授予平台管理员权限"}
          </button>
        </div>
      </section>
    `;
  }

  private async assignNodeOwnership() {
    if (!this.client || this.assigning) {
      return;
    }
    const nodeId = this.assignmentNodeId.trim();
    const tenantId = this.assignmentTenantId.trim();
    if (!nodeId || !tenantId) {
      return;
    }
    this.assigning = true;
    this.error = null;
    this.assignmentNotice = null;
    try {
      await this.client.request("management-governance.node.assign", {
        nodeId,
        tenantId,
        ...(this.assignmentOwnerId.trim() ? { ownerUserId: this.assignmentOwnerId.trim() } : {}),
      });
      this.assignmentNotice = `已将终端 ${nodeId} 归属到 ${tenantId}`;
      await this.loadAudit();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.assigning = false;
    }
  }

  private renderNodeAssignment() {
    if (!this.authPanelProps?.state?.canManagePlatform) {
      return nothing;
    }
    return html`
      <section class="card">
        <div class="card-title">终端归属分配</div>
        <div class="form-grid card-follow">
          <label class="stack stack--tight">
            <span class="card-sub">终端 / 节点 ID</span>
            <input
              class="input mono"
              .value=${this.assignmentNodeId}
              @input=${(event: Event) => (this.assignmentNodeId = (event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="stack stack--tight">
            <span class="card-sub">企业租户</span>
            <select
              class="input"
              .value=${this.assignmentTenantId}
              @change=${(event: Event) => (this.assignmentTenantId = (event.target as HTMLSelectElement).value)}
            >
              <option value="">请选择企业</option>
              ${this.enterprises.map((enterprise) => html`<option value=${enterprise.tenantId}>${enterprise.label} (${enterprise.tenantId})</option>`)}
            </select>
          </label>
          <label class="stack stack--tight">
            <span class="card-sub">员工用户 ID</span>
            <input
              class="input mono"
              placeholder="可选"
              .value=${this.assignmentOwnerId}
              @input=${(event: Event) => (this.assignmentOwnerId = (event.target as HTMLInputElement).value)}
            />
          </label>
        </div>
        ${this.assignmentNotice ? html`<div class="callout card-follow">${this.assignmentNotice}</div>` : nothing}
        <div class="row row--end card-follow">
          <button
            class="btn btn--primary"
            ?disabled=${this.assigning || !this.client || !this.assignmentNodeId.trim() || !this.assignmentTenantId.trim()}
            @click=${() => this.assignNodeOwnership()}
          >
            ${this.assigning ? "分配中…" : "确认归属"}
          </button>
        </div>
      </section>
    `;
  }

  private renderFilters() {
    return html`
      <div class="row row--tight row--wrap row--bottom">
        <label class="stack stack--field">
          <span class="card-sub">动作</span>
          <select
            class="input"
            .value=${this.action}
            @change=${(event: Event) => (this.action = (event.target as HTMLSelectElement).value)}
          >
            <option value="">全部动作</option>
            ${Object.entries(ACTION_LABELS).map(([value, label]) => html`<option value=${value}>${label}</option>`)}
          </select>
        </label>
        <label class="stack stack--field">
          <span class="card-sub">结果</span>
          <select
            class="input"
            .value=${this.effect}
            @change=${(event: Event) => (this.effect = (event.target as HTMLSelectElement).value)}
          >
            <option value="">全部结果</option>
            <option value="allowed">允许</option>
            <option value="denied">拒绝</option>
          </select>
        </label>
        <label class="stack stack--field-wide">
          <span class="card-sub">操作者</span>
          <input
            class="input"
            placeholder="用户标识"
            .value=${this.actorId}
            @input=${(event: Event) => (this.actorId = (event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="stack stack--field-wide">
          <span class="card-sub">资源</span>
          <input
            class="input"
            placeholder="资源标识"
            .value=${this.resourceId}
            @input=${(event: Event) => (this.resourceId = (event.target as HTMLInputElement).value)}
          />
        </label>
        <button
          class="btn btn--sm btn--primary"
          ?disabled=${this.loading || !this.client}
          @click=${() => this.loadAudit()}
        >
          ${renderIcon("refreshCw", "platform-capabilities__distribution-action-icon")}
          ${this.loading ? "查询中…" : "查询"}
        </button>
      </div>
    `;
  }

  private renderAuditTable() {
    const events = this.response?.events ?? [];
    if (!this.client) {
      return html`
        <div class="callout warn card-follow">Gateway 未连接，审计记录暂不可用。</div>
      `;
    }
    if (this.error) {
      return html`<div class="callout danger card-follow">${this.error}</div>`;
    }
    if (!this.loading && events.length === 0) {
      return html`
        <div class="platform-capabilities__empty card-follow">
          <div class="platform-capabilities__empty-copy">
            <div class="platform-capabilities__empty-title">暂无匹配记录</div>
          </div>
        </div>
      `;
    }
    return html`
      <div class="platform-capabilities__distribution card-follow">
        <table class="platform-capabilities__distribution-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>动作</th>
              <th>目标资源</th>
              <th>租户 / 所有人</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            ${events.map(
              (event) => html`
                <tr>
                  <td class="mono">${formatTimestamp(event.ts)}</td>
                  <td>
                    <div>${event.actor.subjectId}</div>
                    <div class="muted">${ROLE_LABELS[event.actor.role]}</div>
                  </td>
                  <td>${ACTION_LABELS[event.action]}</td>
                  <td>
                    <div>${event.target.resourceId}</div>
                    <div class="muted">${event.target.kind}</div>
                  </td>
                  <td class="mono">${event.target.tenantId ?? event.target.ownerUserId ?? "—"}</td>
                  <td>
                    <span
                      class="platform-capabilities__chip is-${event.effect === "allowed" ? "ok" : "danger"}"
                      title=${event.reason ?? ""}
                      >${event.effect === "allowed" ? "允许" : "拒绝"}</span
                    >
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  render() {
    const scope = this.response?.scope;
    return html`
      <div class="management-governance-section stack">
        ${this.renderAuthorityChain()} ${this.renderPlatformAdministratorManagement()}
        ${this.renderNodeAssignment()}
        <section class="card">
          <div class="row row--split card-lead--lg">
            <div class="card-title">治理审计</div>
            ${scope ? html`<span class="chip mono">${scope.kind}${scope.tenantId ? ` · ${scope.tenantId}` : ""}${scope.ownerId ? ` · ${scope.ownerId}` : ""}</span>` : nothing}
          </div>
          ${this.renderFilters()} ${this.renderAuditTable()}
        </section>
      </div>
    `;
  }
}

if (!customElements.get("management-governance-section")) {
  customElements.define("management-governance-section", ManagementGovernanceSection);
}

declare global {
  interface HTMLElementTagNameMap {
    "management-governance-section": ManagementGovernanceSection;
  }
}
