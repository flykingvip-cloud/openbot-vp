/**
 * supervisor-seat-node-panel.ts — seat ↔ Node binding + IDE CLI readiness (M5 UX).
 *
 * Enterprise: bind/unbind a seat to an online Node (requires write scope).
 * Employee: read-only status + Mac setup checklist.
 */

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import { GatewayRequestError } from "../gateway.ts";
import { SUPERVISOR_SETUP_CHANGED } from "./supervisor-setup-readiness.ts";
import {
  formatSupervisorWorkerLabel,
  formatWorkerHealthSummary,
  isLocalIdeSupervisorWorker,
  type SupervisorNodeBindingRequest,
  type SupervisorNodeSeatBinding,
  type SupervisorNodeSessionSummary,
  type SupervisorWorkerHealthRow,
} from "./supervisor-types.ts";

@customElement("supervisor-seat-node-panel")
export class SupervisorSeatNodePanel extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) tenantId = "";
  @property({ type: String }) seatId = "";
  @property({ type: String }) userId = "";
  @property({ type: String }) tenantLabel = "";
  @property({ type: String }) seatLabel = "";
  /** When false, hide bind controls (employee self-service view). */
  @property({ type: Boolean }) editable = true;
  @property({ type: String }) variant: "embedded" | "standalone" = "embedded";
  /** Hides resolved-step hints and secondary chrome for nested setup panels. */
  @property({ type: Boolean }) compact = false;

  @state() private loading = false;
  @state() private busy = false;
  @state() private unavailable = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  @state() private copyNotice: string | null = null;
  @state() private nodes: SupervisorNodeSessionSummary[] = [];
  @state() private binding: SupervisorNodeSeatBinding | null = null;
  @state() private bindingRequests: SupervisorNodeBindingRequest[] = [];
  @state() private ideHealth: SupervisorWorkerHealthRow[] = [];
  @state() private selectedNodeId = "";

  private loadedOnce = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.client) {
      void this.refresh();
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("tenantId") || changed.has("seatId")) {
      this.loadedOnce = false;
    }
    if (
      (changed.has("client") || changed.has("tenantId") || changed.has("seatId")) &&
      this.client &&
      !this.loadedOnce
    ) {
      void this.refresh();
    }
  }

  private async refresh() {
    if (!this.client) {
      return;
    }
    const tenant = this.tenantId.trim();
    const seat = this.seatId.trim();
    if (!tenant || !seat) {
      return;
    }
    this.loadedOnce = true;
    this.loading = true;
    this.error = null;
    this.unavailable = false;
    try {
      const [nodeResult, bindingResult, requestResult, healthResult] = await Promise.all([
        this.client.request<{ nodes: SupervisorNodeSessionSummary[] }>("supervisor.node.list", {}),
        this.client.request<{ bindings: SupervisorNodeSeatBinding[] }>(
          "supervisor.node.bindings.list",
          {
            tenantId: tenant,
          },
        ),
        this.client.request<{ requests: SupervisorNodeBindingRequest[] }>(
          "supervisor.node.bindingRequest.list",
          {
            tenantId: tenant,
            seatId: seat,
          },
        ),
        this.client.request<{ workers: SupervisorWorkerHealthRow[] }>("supervisor.worker.health", {
          tenantId: tenant,
          seatId: seat,
        }),
      ]);
      this.nodes = nodeResult.nodes ?? [];
      this.binding = (bindingResult.bindings ?? []).find((entry) => entry.seatId === seat) ?? null;
      this.bindingRequests = requestResult.requests ?? [];
      this.ideHealth = (healthResult.workers ?? []).filter((row) =>
        isLocalIdeSupervisorWorker(row.backendId),
      );
      if (!this.selectedNodeId) {
        const preferred =
          this.binding?.nodeId ??
          this.nodes.find((node) => node.supportsSupervisorWorker)?.nodeId ??
          this.nodes[0]?.nodeId ??
          "";
        this.selectedNodeId = preferred;
      }
    } catch (err) {
      if (err instanceof GatewayRequestError && err.gatewayCode === "UNAVAILABLE") {
        this.unavailable = true;
        this.nodes = [];
        this.binding = null;
        this.bindingRequests = [];
        this.ideHealth = [];
      } else {
        this.error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.loading = false;
      if (!this.error && !this.unavailable) {
        this.dispatchEvent(
          new CustomEvent(SUPERVISOR_SETUP_CHANGED, { bubbles: true, composed: true }),
        );
      }
    }
  }

  private boundNode(): SupervisorNodeSessionSummary | null {
    if (!this.binding?.nodeId) {
      return null;
    }
    return this.nodes.find((node) => node.nodeId === this.binding?.nodeId) ?? null;
  }

  private nodeOnline(nodeId: string): boolean {
    return this.nodes.some((node) => node.nodeId === nodeId);
  }

  private eligibleNodes(): SupervisorNodeSessionSummary[] {
    return this.nodes.filter((node) => node.supportsSupervisorWorker);
  }

  private pendingBindingRequest(): SupervisorNodeBindingRequest | null {
    return this.bindingRequests.find((request) => request.status === "pending") ?? null;
  }

  private async requestEmployeeBinding() {
    if (!this.client || this.editable || this.binding) {
      return;
    }
    const tenant = this.tenantId.trim();
    const seat = this.seatId.trim();
    const nodeId =
      this.selectedNodeId.trim() ||
      this.pendingBindingRequest()?.nodeId ||
      this.eligibleNodes()[0]?.nodeId ||
      "";
    if (!tenant || !seat || !nodeId) {
      this.error = "未检测到可用的本机 Node，请先打开 Mac OpenBot 并保持 Node 模式在线。";
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const result = await this.client.request<{ request: SupervisorNodeBindingRequest }>(
        "supervisor.node.bindingRequest.create",
        {
          tenantId: tenant,
          seatId: seat,
          nodeId,
          ...(this.userId.trim() ? { userId: this.userId.trim() } : {}),
        },
      );
      this.bindingRequests = [
        result.request,
        ...this.bindingRequests.filter((entry) => entry.requestId !== result.request.requestId),
      ];
      this.notice = "已发送连接申请，等待企业管理员确认。";
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private async bindSelected() {
    if (!this.client || !this.editable) {
      return;
    }
    const tenant = this.tenantId.trim();
    const seat = this.seatId.trim();
    const nodeId = this.selectedNodeId.trim();
    if (!tenant || !seat || !nodeId) {
      this.error = "请选择要绑定的 Node。";
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const result = await this.client.request<{ binding: SupervisorNodeSeatBinding }>(
        "supervisor.node.bind",
        { tenantId: tenant, seatId: seat, nodeId },
      );
      this.binding = result.binding ?? null;
      this.notice = `已绑定 Node「${nodeId}」。`;
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private async unbind() {
    if (!this.client || !this.editable || !this.binding) {
      return;
    }
    if (!window.confirm("确定解除该席位的 Node 绑定吗？")) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("supervisor.node.unbind", {
        tenantId: this.tenantId.trim(),
        seatId: this.seatId.trim(),
      });
      this.binding = null;
      this.notice = "已解除 Node 绑定。";
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private renderChecklist() {
    const bound = Boolean(this.binding?.nodeId);
    const boundOnline = bound && this.nodeOnline(this.binding!.nodeId);
    const nodeReady = boundOnline && (this.boundNode()?.supportsSupervisorWorker ?? false);
    const cliReady = this.ideHealth.some((row) => row.auth.authenticated);

    const steps = [
      {
        ok: !this.unavailable,
        label: "开发监督子系统已启用",
        hint: this.unavailable
          ? "请设置 OPENBOT_SUPERVISOR_ENABLED=1 或 gateway.supervisor.enabled 并重启 Gateway。"
          : "Gateway 已响应 supervisor API。",
      },
      {
        ok: bound,
        label: "席位已绑定 Node",
        hint: bound
          ? `当前 Node：${this.binding?.nodeId ?? "—"}`
          : this.editable
            ? "在下方选择在线 Node 并绑定；或让员工在 Mac 设置中自助绑定。"
            : "见下方「本机 Node」：在 Mac OpenBot 设置中完成绑定。",
      },
      {
        ok: nodeReady,
        label: "Node 在线且支持监督 Worker",
        hint: nodeReady
          ? "Node 已连接并声明 supervisor.worker.* 命令。"
          : bound
            ? "请确认 Mac 以 Node 模式连接 Gateway，且 app 版本支持开发监督。"
            : "绑定 Node 后自动检查。",
      },
      {
        ok: cliReady,
        label: "本机 IDE CLI 已登录",
        hint: cliReady
          ? "cursor-cli / devin-cli / grok-cli 等探测通过。"
          : "在本机 Cursor / Devin 重新登录；无需在平台配置 API Key。",
      },
    ];

    return html`
      <ol class="supervisor-seat-node-panel__steps">
        ${steps.map(
          (step) => html`
            <li class="supervisor-seat-node-panel__step ${step.ok ? "is-ok" : ""}">
              <span class="supervisor-seat-node-panel__step-marker">${step.ok ? "✓" : "○"}</span>
              <span>
                <strong>${step.label}</strong>
                ${this.compact && step.ok ? nothing : html`<small>${step.hint}</small>`}
              </span>
            </li>
          `,
        )}
      </ol>
    `;
  }

  private renderIdeHealth() {
    if (this.ideHealth.length === 0) {
      return nothing;
    }
    return html`
      <div class="supervisor-seat-node-panel__health" aria-label="本机 CLI 状态">
        <div class="employee-supervisor-center__section-label">本机 CLI 状态</div>
        <div class="employee-supervisor-center__setup-table-wrap">
          <table class="employee-supervisor-center__setup-table">
            <thead>
              <tr>
                <th scope="col">工具</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              ${this.ideHealth.map((row) => {
                const ready = row.auth.authenticated;
                return html`
                  <tr class="${ready ? "is-ready" : "is-pending"}">
                    <td>${formatSupervisorWorkerLabel(row.backendId)}</td>
                    <td class="employee-supervisor-center__setup-detail">
                      ${formatWorkerHealthSummary(row)}
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private async copyText(label: string, value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    try {
      await navigator.clipboard.writeText(trimmed);
      this.copyNotice = `已复制 ${label}`;
    } catch {
      this.copyNotice = `复制失败，请手动复制 ${label}`;
    }
  }

  private renderEmployeeBindGuide(tenant: string, seat: string) {
    if (this.editable) {
      return nothing;
    }
    const bound = Boolean(this.binding?.nodeId);
    const pending = this.pendingBindingRequest();
    const eligible = this.eligibleNodes();
    const boundNode = this.boundNode();
    const tenantLabel = this.tenantLabel.trim() || "当前企业";
    const seatLabel = this.seatLabel.trim() || "当前岗位";
    const nodeLabel =
      boundNode?.displayName ??
      pending?.nodeDisplayName ??
      (this.binding?.nodeId || pending?.nodeId ? "已连接的本机设备" : "—");
    return html`
      <div class="supervisor-seat-node-panel__guide">
        <div class="supervisor-seat-node-panel__guide-head">
          <div>
            <strong>${bound ? "本机执行环境已连接" : pending ? "连接申请待确认" : "连接本机执行环境"}</strong>
            <p>
              ${
                bound
                  ? "开发监督任务可调度到这台 Mac 的本地 IDE CLI。"
                  : pending
                    ? "企业管理员批准后，系统会自动完成席位与 Node 绑定。"
                    : "打开 Mac OpenBot 并保持 Node 模式在线，然后发送连接申请；无需手动填写租户或席位信息。"
              }
            </p>
          </div>
          ${
            bound
              ? html`
                  <span class="supervisor-seat-node-panel__pill is-ok">已连接</span>
                `
              : pending
                ? html`
                    <span class="supervisor-seat-node-panel__pill">待确认</span>
                  `
                : nothing
          }
        </div>
        ${
          !bound && !pending && eligible.length > 1
            ? html`
                <label class="supervisor-seat-node-panel__field">
                  <span>选择本机 Node</span>
                  <select
                    class="mono"
                    .value=${this.selectedNodeId}
                    @change=${(e: Event) => {
                      this.selectedNodeId = (e.target as HTMLSelectElement).value;
                    }}
                  >
                    <option value="">— 选择 —</option>
                    ${eligible.map(
                      (node) => html`
                        <option value=${node.nodeId}>
                          ${node.displayName ?? node.nodeId}${node.platform ? ` · ${node.platform}` : ""}
                        </option>
                      `,
                    )}
                  </select>
                  <small>系统只会提交 Node ID，企业端会自动补齐租户与席位。</small>
                </label>
              `
            : nothing
        }
        <div class="supervisor-seat-node-panel__actions">
          ${
            bound
              ? nothing
              : html`
                  <button
                    type="button"
                    class="btn btn--primary btn--sm"
                    ?disabled=${this.busy || Boolean(pending) || eligible.length === 0}
                    @click=${() => this.requestEmployeeBinding()}
                  >
                    ${this.busy ? "发送中…" : pending ? "已发送申请" : "申请连接本机 Node"}
                  </button>
                `
          }
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            ?disabled=${this.loading}
            @click=${() => {
              this.loadedOnce = false;
              void this.refresh();
            }}
          >
            ${this.loading ? "刷新中…" : "刷新状态"}
          </button>
        </div>
        ${
          eligible.length === 0 && !bound
            ? html`
                <p class="supervisor-seat-node-panel__muted">
                  未检测到可用 Node。请打开 Mac OpenBot，并确认它以 Node 模式连接 Gateway。
                </p>
              `
            : nothing
        }
        <details class="supervisor-seat-node-panel__advanced">
          <summary>高级信息（排障用）</summary>
          <dl class="supervisor-seat-node-panel__id-grid">
            <div class="supervisor-seat-node-panel__id-row">
              <dt>当前企业</dt>
              <dd>${tenantLabel}</dd>
              <button type="button" class="btn btn--sm" @click=${() => void this.copyText("租户 ID", tenant)}>
                复制 ID
              </button>
            </div>
            <div class="supervisor-seat-node-panel__id-row">
              <dt>当前岗位</dt>
              <dd>${seatLabel}</dd>
              <button type="button" class="btn btn--sm" @click=${() => void this.copyText("席位 ID", seat)}>
                复制 ID
              </button>
            </div>
            ${
              bound || pending
                ? html`
                    <div class="supervisor-seat-node-panel__id-row">
                      <dt>本机设备</dt>
                      <dd>${nodeLabel}</dd>
                    </div>
                  `
                : nothing
            }
          </dl>
        </details>
        ${
          this.copyNotice
            ? html`
                <p class="supervisor-seat-node-panel__muted">${this.copyNotice}</p>
              `
            : nothing
        }
      </div>
    `;
  }

  private renderOnlineNodesReadonly() {
    if (this.editable || this.nodes.length === 0) {
      return nothing;
    }
    return html`
      <div class="supervisor-seat-node-panel__nodes">
        <div class="employee-supervisor-center__section-label">在线 Node</div>
        <div class="employee-supervisor-center__setup-table-wrap">
          <table class="employee-supervisor-center__setup-table">
            <thead>
              <tr>
                <th scope="col">设备</th>
                <th scope="col">平台</th>
                <th scope="col">开发监督能力</th>
              </tr>
            </thead>
            <tbody>
              ${this.nodes.map(
                (node) => html`
                  <tr class="${this.binding?.nodeId === node.nodeId ? "is-ready" : ""}">
                    <td class="mono">${node.displayName ?? node.nodeId}</td>
                    <td>${node.platform ?? "—"}</td>
                    <td>${node.supportsSupervisorWorker ? "支持" : "不支持"}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private renderBindControls() {
    if (!this.editable) {
      return nothing;
    }
    const eligible = this.nodes.filter((node) => node.supportsSupervisorWorker);
    return html`
      <div class="supervisor-seat-node-panel__bind">
        <label class="supervisor-seat-node-panel__field">
          <span>选择 Node</span>
          <select
            class="mono"
            .value=${this.selectedNodeId}
            @change=${(e: Event) => {
              this.selectedNodeId = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="">— 选择 —</option>
            ${eligible.map(
              (node) => html`
                <option value=${node.nodeId}>
                  ${node.displayName ?? node.nodeId}${node.platform ? ` · ${node.platform}` : ""}
                </option>
              `,
            )}
            ${this.nodes
              .filter((node) => !node.supportsSupervisorWorker)
              .map(
                (node) => html`
                  <option value=${node.nodeId} disabled>
                    ${node.nodeId}（不支持监督 Worker）
                  </option>
                `,
              )}
          </select>
          <small>${eligible.length} 个 Node 可执行 IDE CLI 监督任务</small>
        </label>
        <div class="supervisor-seat-node-panel__actions">
          <button
            class="btn btn--primary btn--sm"
            type="button"
            ?disabled=${this.busy || !this.selectedNodeId}
            @click=${() => this.bindSelected()}
          >
            ${this.busy ? "处理中…" : "绑定 Node"}
          </button>
          ${
            this.binding
              ? html`
                  <button
                    class="btn btn--sm btn--ghost"
                    type="button"
                    ?disabled=${this.busy}
                    @click=${() => this.unbind()}
                  >
                    解除绑定
                  </button>
                `
              : nothing
          }
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            ?disabled=${this.loading}
            @click=${() => {
              this.loadedOnce = false;
              void this.refresh();
            }}
          >
            刷新
          </button>
        </div>
      </div>
    `;
  }

  render() {
    const tenant = this.tenantId.trim();
    const seat = this.seatId.trim();
    if (!tenant || !seat) {
      return html`
        <div class="supervisor-seat-node-panel supervisor-seat-node-panel--${this.variant}">
          <p class="supervisor-seat-node-panel__muted">需要租户与席位 ID 才能查看 Node 绑定。</p>
        </div>
      `;
    }

    return html`
      <div class="supervisor-seat-node-panel supervisor-seat-node-panel--${this.variant} ${this.compact ? "supervisor-seat-node-panel--compact" : ""}">
        ${
          !this.editable && this.variant === "embedded"
            ? html`
                <div class="employee-supervisor-center__banner is-warn">
                  只读视图：修改 Node 绑定需 enterprise-admin 权限。
                </div>
              `
            : nothing
        }
        ${
          this.loading
            ? html`
                <p class="supervisor-seat-node-panel__muted">加载 Node 与 Worker 状态…</p>
              `
            : nothing
        }
        ${this.error ? html`<div class="employee-supervisor-center__banner is-error">${this.error}</div>` : nothing}
        ${this.notice ? html`<div class="employee-supervisor-center__banner is-success">${this.notice}</div>` : nothing}
        ${this.renderEmployeeBindGuide(tenant, seat)}
        ${this.editable ? this.renderChecklist() : nothing}
        ${this.renderOnlineNodesReadonly()}
        ${this.renderIdeHealth()}
        ${this.renderBindControls()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "supervisor-seat-node-panel": SupervisorSeatNodePanel;
  }
}
