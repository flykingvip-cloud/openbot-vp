/**
 * supervisor-worker-policy-panel.ts — tenant worker credential/placement overrides (M0.5).
 */

import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import { GatewayRequestError } from "../gateway.ts";
import { isGatewayReady, resolvePanelError, whenGatewayReady } from "./supervisor-gateway-utils.ts";
import {
  SUPERVISOR_CREDENTIAL_POLICY_OPTIONS,
  SUPERVISOR_PLACEMENT_OPTIONS,
  defaultSupervisorWorkerProfile,
  type SupervisorWorkerDescriptor,
  type SupervisorWorkerExecutionPolicy,
} from "./supervisor-types.ts";

type PolicyRow = {
  workerId: string;
  credentialPolicy: string;
  executionPlacement: string;
  source: "default" | "tenant";
  updatedAt?: string;
};

export class SupervisorWorkerPolicyPanel extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) tenantId = "";
  /** When false, list policies only (enterprise operator / viewer). */
  @property({ type: Boolean }) editable = true;
  /** When true, tenant is chosen by a parent panel — hide manual tenant ID input. */
  @property({ type: Boolean }) externalTenantContext = false;
  /** When true, connection errors are shown once by the parent shell. */
  @property({ type: Boolean }) connectionManaged = false;

  @state() private tenantDraft = "";
  @state() private loading = false;
  @state() private busy = false;
  @state() private unavailable = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  @state() private workers: SupervisorWorkerDescriptor[] = [];
  @state() private policies: SupervisorWorkerExecutionPolicy[] = [];
  @state() private editing = false;
  @state() private editWorkerId = "";
  @state() private editCredentialPolicy = "enterprise_shared";
  @state() private editPlacement = "gateway";

  connectedCallback() {
    super.connectedCallback();
    if (this.tenantId.trim()) {
      this.tenantDraft = this.tenantId.trim();
    }
    if (this.client) {
      void this.loadWorkers();
      if (this.tenantDraft.trim()) {
        void this.loadPolicies();
      }
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("tenantId")) {
      const next = this.tenantId.trim();
      if (next && next !== this.tenantDraft.trim()) {
        this.tenantDraft = next;
      }
      if (this.client && next) {
        void this.loadPolicies();
      }
    }
    if (changed.has("client") && this.client) {
      void this.loadWorkers();
    }
    if (changed.has("editable") && !this.editable) {
      this.editing = false;
    }
  }

  private policyRows(): PolicyRow[] {
    const policyByWorker = new Map(this.policies.map((entry) => [entry.workerId, entry]));
    const workerIds = new Set([
      ...this.workers.map((worker) => worker.backendId),
      ...this.policies.map((entry) => entry.workerId),
    ]);
    return [...workerIds]
      .toSorted((a, b) => a.localeCompare(b))
      .map((workerId) => {
        const override = policyByWorker.get(workerId);
        if (override) {
          return {
            workerId,
            credentialPolicy: override.credentialPolicy,
            executionPlacement: override.executionPlacement,
            source: "tenant" as const,
            updatedAt: override.updatedAt,
          };
        }
        const defaults = defaultSupervisorWorkerProfile(workerId);
        return {
          workerId,
          credentialPolicy: defaults.credentialPolicy,
          executionPlacement: defaults.executionPlacement,
          source: "default" as const,
        };
      });
  }

  private async loadWorkers() {
    if (!this.client) {
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    try {
      const result = await this.client.request<{ workers: SupervisorWorkerDescriptor[] }>(
        "supervisor.worker.list",
        {},
      );
      this.workers = result.workers ?? [];
    } catch (err) {
      if (err instanceof GatewayRequestError && err.gatewayCode === "UNAVAILABLE") {
        this.unavailable = true;
      }
    }
  }

  private emitTenantChange() {
    this.dispatchEvent(
      new CustomEvent("supervisor-tenant-change", {
        detail: { tenantId: this.tenantDraft.trim() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async loadPolicies() {
    if (!this.client) {
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    const tenant = this.tenantDraft.trim();
    if (!tenant) {
      if (!this.externalTenantContext) {
        this.error = "请先填写租户 ID。";
      }
      return;
    }
    this.loading = true;
    this.error = null;
    this.unavailable = false;
    this.tenantId = tenant;
    this.emitTenantChange();
    try {
      const result = await this.client.request<{ policies: SupervisorWorkerExecutionPolicy[] }>(
        "supervisor.worker.policy.list",
        { tenantId: tenant },
      );
      this.policies = result.policies ?? [];
    } catch (err) {
      if (err instanceof GatewayRequestError && err.gatewayCode === "UNAVAILABLE") {
        this.unavailable = true;
        this.policies = [];
      } else {
        this.error = resolvePanelError(err, { connectionManaged: this.connectionManaged });
      }
    } finally {
      this.loading = false;
    }
  }

  private openEditor(workerId: string) {
    const row = this.policyRows().find((entry) => entry.workerId === workerId);
    const defaults = defaultSupervisorWorkerProfile(workerId);
    this.editWorkerId = workerId;
    this.editCredentialPolicy = row?.credentialPolicy ?? defaults.credentialPolicy;
    this.editPlacement = row?.executionPlacement ?? defaults.executionPlacement;
    this.editing = true;
    this.error = null;
  }

  private async savePolicy() {
    if (!this.client) {
      return;
    }
    const tenant = this.tenantDraft.trim();
    const workerId = this.editWorkerId.trim();
    if (!tenant || !workerId) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("supervisor.worker.policy.upsert", {
        tenantId: tenant,
        workerId,
        credentialPolicy: this.editCredentialPolicy,
        executionPlacement: this.editPlacement,
      });
      this.notice = `已保存「${workerId}」的执行策略。`;
      this.editing = false;
      await this.loadPolicies();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private async removePolicy(workerId: string) {
    if (!this.client) {
      return;
    }
    const tenant = this.tenantDraft.trim();
    if (!tenant || !window.confirm(`恢复「${workerId}」为系统默认策略吗？`)) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("supervisor.worker.policy.remove", { tenantId: tenant, workerId });
      this.notice = `已移除「${workerId}」的租户覆盖。`;
      await this.loadPolicies();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private labelForPolicy(value: string): string {
    return (
      SUPERVISOR_CREDENTIAL_POLICY_OPTIONS.find((entry) => entry.value === value)?.label ?? value
    );
  }

  private labelForPlacement(value: string): string {
    return SUPERVISOR_PLACEMENT_OPTIONS.find((entry) => entry.value === value)?.label ?? value;
  }

  private renderToolbar() {
    const tenantLocked = Boolean(this.tenantId.trim());
    if (this.externalTenantContext) {
      if (!tenantLocked) {
        return nothing;
      }
      return html`
        <div class="supervisor-governance-panel__toolbar">
          <span class="supervisor-governance-panel__muted mono">租户 ${this.tenantDraft}</span>
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            ?disabled=${this.loading || !isGatewayReady(this.client)}
            @click=${() => this.loadPolicies()}
          >
            ${this.loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      `;
    }
    if (!this.editable && tenantLocked) {
      return html`
        <div class="supervisor-governance-panel__toolbar">
          <span class="supervisor-governance-panel__muted mono">租户 ${this.tenantDraft}</span>
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            ?disabled=${this.loading}
            @click=${() => this.loadPolicies()}
          >
            ${this.loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      `;
    }
    return html`
      <div class="supervisor-governance-panel__toolbar">
        <label class="supervisor-governance-panel__field">
          <span class="card-sub">租户 ID</span>
          <input
            class="input mono"
            .value=${this.tenantDraft}
            ?readonly=${tenantLocked && !this.editable}
            @input=${(e: Event) => {
              this.tenantDraft = (e.target as HTMLInputElement).value;
            }}
          />
        </label>
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${this.loading || !this.tenantDraft.trim()}
          @click=${() => this.loadPolicies()}
        >
          ${this.loading ? "加载中…" : "加载策略"}
        </button>
      </div>
    `;
  }

  render() {
    const rows = this.policyRows();
    return html`
      <section class="supervisor-governance-panel card">
        <div class="card-title">Worker 执行策略</div>
        ${
          !this.editable
            ? html`
                <div class="employee-supervisor-center__banner is-warn">
                  只读视图：当前为企业 operator / 成员角色，可查看策略不可修改。变更需 enterprise-admin 权限。
                </div>
              `
            : nothing
        }
        ${
          this.unavailable
            ? html`
                <div class="employee-supervisor-center__banner is-warn">监督子系统未启用。</div>
              `
            : nothing
        }
        ${this.error ? html`<div class="employee-supervisor-center__banner is-error">${this.error}</div>` : nothing}
        ${this.notice ? html`<div class="employee-supervisor-center__banner is-success">${this.notice}</div>` : nothing}
        ${this.renderToolbar()}
        ${
          rows.length > 0
            ? html`
                <table class="supervisor-governance-panel__table mono">
                  <thead>
                    <tr>
                      <th>Worker</th>
                      <th>凭证策略</th>
                      <th>执行落点</th>
                      <th>来源</th>
                      ${
                        this.editable
                          ? html`
                              <th></th>
                            `
                          : nothing
                      }
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(
                      (row) => html`
                        <tr>
                          <td>${row.workerId}</td>
                          <td>${this.labelForPolicy(row.credentialPolicy)}</td>
                          <td>${this.labelForPlacement(row.executionPlacement)}</td>
                          <td>${row.source === "tenant" ? "租户覆盖" : "系统默认"}</td>
                          ${
                            this.editable
                              ? html`
                                  <td class="supervisor-governance-panel__row-actions">
                                    <button
                                      class="btn btn--sm btn--ghost"
                                      type="button"
                                      ?disabled=${this.busy || !this.tenantDraft.trim()}
                                      @click=${() => this.openEditor(row.workerId)}
                                    >
                                      编辑
                                    </button>
                                    ${
                                      row.source === "tenant"
                                        ? html`
                                            <button
                                              class="btn btn--sm btn--ghost"
                                              type="button"
                                              ?disabled=${this.busy}
                                              @click=${() => this.removePolicy(row.workerId)}
                                            >
                                              恢复默认
                                            </button>
                                          `
                                        : nothing
                                    }
                                  </td>
                                `
                              : nothing
                          }
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              `
            : nothing
        }
        ${
          this.editable && this.editing
            ? html`
                <div class="supervisor-governance-panel__editor">
                  <div class="supervisor-governance-panel__section-title">编辑 · ${this.editWorkerId}</div>
                  <label class="supervisor-governance-panel__field">
                    <span class="card-sub">凭证策略</span>
                    <select
                      .value=${this.editCredentialPolicy}
                      @change=${(e: Event) => {
                        this.editCredentialPolicy = (e.target as HTMLSelectElement).value;
                      }}
                    >
                      ${SUPERVISOR_CREDENTIAL_POLICY_OPTIONS.map(
                        (option) => html`<option value=${option.value}>${option.label}</option>`,
                      )}
                    </select>
                  </label>
                  <label class="supervisor-governance-panel__field">
                    <span class="card-sub">执行落点</span>
                    <select
                      .value=${this.editPlacement}
                      @change=${(e: Event) => {
                        this.editPlacement = (e.target as HTMLSelectElement).value;
                      }}
                    >
                      ${SUPERVISOR_PLACEMENT_OPTIONS.map(
                        (option) => html`<option value=${option.value}>${option.label}</option>`,
                      )}
                    </select>
                  </label>
                  <div class="supervisor-governance-panel__toolbar">
                    <button
                      class="btn btn--primary btn--sm"
                      type="button"
                      ?disabled=${this.busy}
                      @click=${() => this.savePolicy()}
                    >
                      ${this.busy ? "保存中…" : "保存"}
                    </button>
                    <button
                      class="btn btn--sm btn--ghost"
                      type="button"
                      ?disabled=${this.busy}
                      @click=${() => {
                        this.editing = false;
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              `
            : nothing
        }
      </section>
    `;
  }
}

if (!customElements.get("supervisor-worker-policy-panel")) {
  customElements.define("supervisor-worker-policy-panel", SupervisorWorkerPolicyPanel);
}

declare global {
  interface HTMLElementTagNameMap {
    "supervisor-worker-policy-panel": SupervisorWorkerPolicyPanel;
  }
}
