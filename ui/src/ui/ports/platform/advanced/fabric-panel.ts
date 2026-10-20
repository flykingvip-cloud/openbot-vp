/**
 * fabric-panel.ts — Fabric execution governance section for the platform
 * "高级治理 (Advanced)" surface, as a self-contained LitElement.
 *
 * Self-fetches from the gateway (read: `fabric.status` + `fabric.audit.query`)
 * and exposes a platform-level enablement toggle (write: `fabric.feature.set`,
 * which persists `gateway.fabric.enabled`). Once enabled at the platform level,
 * all tenants + end users are covered automatically — there is no per-tenant or
 * per-employee Fabric config (policy reuses the existing exec-approvals page).
 *
 * Pattern mirrors the other self-fetching platform sections (e.g.
 * platform-plan-model-binding-section): `client` is injected as a property and
 * data + actions live entirely inside this element, so no controller / render
 * model wiring is required.
 */

import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { renderIcon } from "../../../icons.ts";

interface FabricStatusResponse {
  enabled: boolean;
  serviceInstalled: boolean;
  auditRetained: number;
  stats: FabricStats | null;
}

interface FabricStats {
  total: number;
  byDecision: { ALLOW: number; DENY: number; MODIFY: number };
  byStatus: Record<string, number>;
  costUsd: number;
}

interface FabricAuditQueryResponse {
  enabled: boolean;
  records: FabricAuditRecord[];
  stats: FabricStats | null;
}

interface FabricAuditRecord {
  correlationId: string;
  sessionId: string;
  tenantId?: string;
  what: { tool: { name: string } };
  decision: { decision: "ALLOW" | "DENY" | "MODIFY"; reason?: string };
  result: { status: string; exitCode?: number };
  timing: { start: number; end: number };
  costUsd?: number;
  occurredAt: string;
}

export class FabricGovernanceSection extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;

  @state() private status: FabricStatusResponse | null = null;
  @state() private records: FabricAuditRecord[] = [];
  @state() private loading = false;
  @state() private toggling = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  private loadedOnce = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.client) {
      void this.load();
    }
  }

  updated(changed: Map<string, unknown>) {
    // The client may be injected after the first render (it is often null on the
    // initial paint and populated once the gateway socket connects). Load on the
    // first transition to a usable client.
    if (changed.has("client") && this.client && !this.loadedOnce) {
      void this.load();
    }
  }

  private async load() {
    if (!this.client) {
      return;
    }
    this.loadedOnce = true;
    this.loading = true;
    this.error = null;
    try {
      const [status, audit] = await Promise.all([
        this.client.request<FabricStatusResponse>("fabric.status", {}),
        this.client.request<FabricAuditQueryResponse>("fabric.audit.query", { limit: 20 }),
      ]);
      this.status = status;
      this.records = audit.records ?? [];
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private async toggle(next: boolean) {
    if (!this.client || this.toggling) {
      return;
    }
    const message = next
      ? "确认启用 Fabric 执行治理？启用后，企业租户与终端用户的工具执行会进入该控制平面。"
      : "确认停用 Fabric 执行治理？停用后，执行治理会对全平台关闭。";
    if (
      typeof window !== "undefined" &&
      typeof window.confirm === "function" &&
      !window.confirm(message)
    ) {
      return;
    }
    this.toggling = true;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("fabric.feature.set", { enabled: next });
      this.notice = next
        ? "已启用：所有企业租户与终端用户已自动纳入执行治理。"
        : "已停用：执行治理已对全平台关闭。";
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.toggling = false;
    }
  }

  render() {
    const enabled = this.status?.enabled ?? false;
    return html`
      <div class="stack">
        ${this.error ? html`<div class="callout danger">${this.error}</div>` : nothing}
        ${this.notice ? html`<div class="callout">${this.notice}</div>` : nothing}
        ${this.renderStatusCard(enabled)}
        ${enabled && this.status?.stats ? this.renderStatsCard(this.status.stats) : nothing}
        ${enabled && this.records.length > 0 ? this.renderTimeline() : nothing}
        ${enabled && this.records.length === 0 && !this.loading ? this.renderEmpty() : nothing}
      </div>
    `;
  }

  private renderStatusCard(enabled: boolean) {
    const enabledTone = enabled ? "ok" : "warn";
    const serviceTone = this.status?.serviceInstalled ? "ok" : "warn";
    return html`
      <section class="card">
        <div class="row row--split">
          <div>
            <div class="card-title">Fabric 执行治理</div>
            <div class="card-sub">AI 工具执行控制平面 · 策略决策 / 审计 / 成本追踪</div>
          </div>
          <div class="row row--tight">
            <button
              class="btn btn--sm ${enabled ? "" : "btn--primary"}"
              ?disabled=${this.toggling || !this.client}
              @click=${() => this.toggle(!enabled)}
            >
              ${this.toggling ? "处理中…" : enabled ? "停用" : "启用"}
            </button>
            <button class="btn btn--sm" ?disabled=${this.loading} @click=${() => this.load()}>
              ${this.loading ? "加载中…" : "刷新"}
            </button>
          </div>
        </div>
        <div class="stat-grid stat-grid--compact card-follow">
          <div class="stat stat--compact">
            <div class="stat-label">功能状态</div>
            <div class="stat-value ${enabledTone}">${enabled ? "已启用" : "未启用"}</div>
            <div class="muted stat-note">平台级 · 全租户生效</div>
          </div>
          <div class="stat stat--compact">
            <div class="stat-label">服务注入</div>
            <div class="stat-value ${serviceTone}">
              ${this.status?.serviceInstalled ? "运行中" : "未运行"}
            </div>
            <div class="muted stat-note">FabricService</div>
          </div>
          <div class="stat stat--compact">
            <div class="stat-label">审计记录</div>
            <div class="stat-value">${this.status?.auditRetained ?? 0}</div>
            <div class="muted stat-note">内存保留窗口</div>
          </div>
          <div class="stat stat--compact">
            <div class="stat-label">累计成本</div>
            <div class="stat-value">${formatCost(this.status?.stats?.costUsd)}</div>
            <div class="muted stat-note">窗口内 USD</div>
          </div>
        </div>
        ${
          !enabled
            ? html`
                <div class="callout card-follow">
                  点击「启用」即开启 AI 工具执行治理。启用后所有企业租户与终端用户自动获得覆盖，
                  无需逐租户配置；策略沿用既有「执行审批」页面。
                </div>
              `
            : nothing
        }
      </section>
    `;
  }

  private renderStatsCard(stats: FabricStats) {
    const total = stats.total || 1;
    const pct = (n: number) => `${((n / total) * 100).toFixed(0)}%`;
    return html`
      <section class="card">
        <div class="card-title">决策分布</div>
        <div class="stat-grid stat-grid--compact card-follow--sm">
          <div class="stat stat--compact">
            <div class="stat-label">ALLOW</div>
            <div class="stat-value ok">${stats.byDecision.ALLOW}</div>
            <div class="muted text-xs">${pct(stats.byDecision.ALLOW)}</div>
          </div>
          <div class="stat stat--compact">
            <div class="stat-label">DENY</div>
            <div class="stat-value warn">${stats.byDecision.DENY}</div>
            <div class="muted text-xs">${pct(stats.byDecision.DENY)}</div>
          </div>
          <div class="stat stat--compact">
            <div class="stat-label">MODIFY</div>
            <div class="stat-value">${stats.byDecision.MODIFY}</div>
            <div class="muted text-xs">${pct(stats.byDecision.MODIFY)}</div>
          </div>
          <div class="stat stat--compact">
            <div class="stat-label">总计</div>
            <div class="stat-value">${stats.total}</div>
            <div class="muted text-xs">条决策</div>
          </div>
        </div>
      </section>
    `;
  }

  private renderTimeline() {
    return html`
      <section class="card">
        <div class="row row--split">
          <div class="card-title">最近决策记录</div>
          <div class="muted text-xs">${this.records.length} 条 · 最新优先</div>
        </div>
        <div class="platform-capabilities__distribution card-follow--sm">
          <table class="platform-capabilities__distribution-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>工具</th>
                <th>决策</th>
                <th>状态</th>
                <th>耗时</th>
                <th>成本</th>
                <th>租户</th>
                <th>追踪ID</th>
              </tr>
            </thead>
            <tbody>
              ${this.records.map(
                (rec) => html`
                  <tr>
                    <td><span class="muted">${formatTime(rec.occurredAt)}</span></td>
                    <td><code class="text-xs">${rec.what.tool.name}</code></td>
                    <td>${decisionChip(rec.decision.decision)}</td>
                    <td>${statusChip(rec.result.status)}</td>
                    <td>
                      <span class="muted">${formatDurMs(rec.timing.end - rec.timing.start)}</span>
                    </td>
                    <td><span class="muted">${formatCost(rec.costUsd)}</span></td>
                    <td>
                      <span class="muted" title=${rec.tenantId ?? "—"}
                        >${rec.tenantId?.slice(0, 8) ?? "—"}</span
                      >
                    </td>
                    <td>
                      <span class="muted" title=${rec.correlationId}
                        >${rec.correlationId.slice(0, 8)}</span
                      >
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  private renderEmpty() {
    return html`
      <div class="platform-capabilities__empty">
        ${renderIcon("shield", "platform-capabilities__empty-icon")}
        <div class="platform-capabilities__empty-copy">
          <div class="platform-capabilities__empty-title">暂无执行记录</div>
          <div class="platform-capabilities__empty-sub">
            当 AI 工具执行被 Fabric 治理时，决策记录将自动出现在此。
          </div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("fabric-governance-section")) {
  customElements.define("fabric-governance-section", FabricGovernanceSection);
}

// ---- Formatters ----------------------------------------------------------

function decisionChip(decision: string) {
  const tone = decision === "ALLOW" ? "ok" : decision === "DENY" ? "warn" : "neutral";
  return html`<span class="platform-capabilities__chip is-${tone}">${decision}</span>`;
}

function statusChip(status: string) {
  const tone = status === "success" ? "ok" : status === "denied" ? "warn" : "neutral";
  return html`<span class="platform-capabilities__chip is-${tone}">${status}</span>`;
}

function formatDurMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(usd: number | undefined): string {
  if (usd === undefined || usd === 0) {
    return "—";
  }
  return `$${usd.toFixed(4)}`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}
