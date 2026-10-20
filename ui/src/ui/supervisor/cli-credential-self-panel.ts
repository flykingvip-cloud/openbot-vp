/**
 * cli-credential-self-panel.ts — delegated CLI-backend credential self-service.
 *
 * One component, two mount points. The gateway derives the credential SCOPE from
 * the trusted session domain (employee → personal key; enterprise-admin → shared
 * enterprise key), so this panel is identical for both surfaces — only the copy
 * differs via the `variant` property. The raw key value is sent once over the
 * authenticated channel and encrypted at rest server-side (encrypted-local); the
 * panel never reads secret values back.
 */

import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatRelativeTimestamp } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  defaultEnvForApiKeyCliBackend,
  formatApiKeyCliBackendOption,
  SUPERVISOR_API_KEY_CLI_BACKENDS,
} from "./supervisor-api-key-backends.ts";
import { SUPERVISOR_SETUP_CHANGED } from "./supervisor-setup-readiness.ts";

type ScopedCredentialRow = {
  credentialId: string;
  backendId: string;
  scope: "enterprise" | "personal";
  envVarNames: string[];
  updatedAt: string;
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function notifySetupChanged(host: HTMLElement) {
  host.dispatchEvent(new CustomEvent(SUPERVISOR_SETUP_CHANGED, { bubbles: true }));
}

@customElement("cli-credential-self-panel")
export class CliCredentialSelfPanel extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  /** "employee" → personal key; "enterprise" → shared enterprise key. */
  @property({ type: String }) variant: "employee" | "enterprise" = "employee";
  @property({ type: String }) heading = "";
  @property({ type: Boolean }) compact = false;
  /** When true, omit the panel heading (e.g. parent already shows a section label). */
  @property({ type: Boolean }) hideTitle = false;

  @state() private credentials: ScopedCredentialRow[] = [];
  @state() private loading = false;
  @state() private busy = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  @state() private formBackendId = "codex-cli";
  @state() private formEnvName = "OPENAI_API_KEY";
  @state() private formValue = "";
  private loadedOnce = false;

  connectedCallback() {
    super.connectedCallback();
    if (this.client) {
      void this.load();
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("client") && this.client && !this.loadedOnce) {
      void this.load();
    }
  }

  private resolvedHeading(): string {
    if (this.heading.trim()) {
      return this.heading.trim();
    }
    return this.variant === "enterprise" ? "协作工具共享凭证" : "我的 CLI 凭证";
  }

  private async load() {
    if (!this.client) {
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const res = await this.client.request<{ credentials: ScopedCredentialRow[] }>(
        "cliBackend.credential.scopedList",
        {},
      );
      this.credentials = res.credentials ?? [];
      this.loadedOnce = true;
      notifySetupChanged(this);
    } catch (err) {
      this.error = errMessage(err);
    } finally {
      this.loading = false;
    }
  }

  private onBackendChange(backendId: string) {
    this.formBackendId = backendId;
    this.formEnvName = defaultEnvForApiKeyCliBackend(backendId);
  }

  private async save() {
    if (!this.client || this.busy) {
      return;
    }
    const backendId = this.formBackendId.trim();
    const envName = this.formEnvName.trim();
    const value = this.formValue.trim();
    if (!backendId || !envName || !value) {
      this.error = "请选择后端、填写环境变量名与密钥值。";
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("cliBackend.credential.scopedSet", {
        backendId,
        envVars: { [envName]: value },
      });
      this.notice =
        this.variant === "enterprise"
          ? `已为企业添加 ${backendId} 的 KEY。`
          : `已添加 ${backendId} 的 KEY。`;
      this.formValue = "";
      await this.load();
    } catch (err) {
      this.error = errMessage(err);
    } finally {
      this.busy = false;
    }
  }

  private async removeCredential(backendId: string) {
    if (!this.client || this.busy) {
      return;
    }
    if (!window.confirm(`确定删除 ${backendId} 的凭证吗？`)) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("cliBackend.credential.scopedRemove", { backendId });
      this.notice = `已删除 ${backendId} 的凭证。`;
      await this.load();
    } catch (err) {
      this.error = errMessage(err);
    } finally {
      this.busy = false;
    }
  }

  private async verify(backendId: string) {
    if (!this.client || this.busy) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const result = await this.client.request<{ valid: boolean; failedKeys?: string[] }>(
        "cliBackend.credential.scopedVerify",
        { backendId },
      );
      this.notice = result.valid
        ? `${backendId} 凭证校验通过。`
        : `${backendId} 凭证校验失败：${(result.failedKeys ?? []).join(", ") || "无法解析"}。`;
      notifySetupChanged(this);
    } catch (err) {
      this.error = errMessage(err);
    } finally {
      this.busy = false;
    }
  }

  render() {
    const isEnterprise = this.variant === "enterprise";
    return html`
      <section class="cli-credential-self ${this.compact ? "cli-credential-self--compact" : ""}">
        ${
          this.hideTitle
            ? nothing
            : html`
                <div class="cli-credential-self__title">${this.resolvedHeading()}</div>
              `
        }
        ${
          this.compact
            ? nothing
            : html`
                <p class="cli-credential-self__copy">
                  ${
                    isEnterprise
                      ? "为本企业配置 API-Key 型 CLI（Codex / Claude 等）的共享密钥；企业内所有未自配个人密钥的成员将共用。密钥加密存储，配置后不可回显。"
                      : "为 API-Key 型 CLI（Codex / Claude 等）配置你的个人密钥；个人密钥优先于企业共享密钥使用。密钥加密存储，配置后不可回显。"
                  }
                </p>
              `
        }

        ${
          this.error
            ? html`<div class="cli-credential-self__banner is-error">${this.error}</div>`
            : nothing
        }
        ${
          this.notice
            ? html`<div class="cli-credential-self__banner is-success">${this.notice}</div>`
            : nothing
        }

        <div class="cli-credential-self__form-row">
          <label class="cli-credential-self__field cli-credential-self__field--backend">
            <span>CLI 后端</span>
            <select
              class="mono"
              .value=${this.formBackendId}
              ?disabled=${this.busy}
              @change=${(e: Event) => this.onBackendChange((e.target as HTMLSelectElement).value)}
            >
              ${SUPERVISOR_API_KEY_CLI_BACKENDS.map(
                (entry) =>
                  html`<option value=${entry.backendId}>${formatApiKeyCliBackendOption(entry)}</option>`,
              )}
            </select>
          </label>
          <label class="cli-credential-self__field cli-credential-self__field--env">
            <span>环境变量名</span>
            <input
              class="mono"
              .value=${this.formEnvName}
              ?disabled=${this.busy}
              @input=${(e: Event) => {
                this.formEnvName = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <label class="cli-credential-self__field cli-credential-self__field--value">
            <span>密钥值</span>
            <input
              type="password"
              autocomplete="off"
              placeholder="sk-..."
              .value=${this.formValue}
              ?disabled=${this.busy}
              @input=${(e: Event) => {
                this.formValue = (e.target as HTMLInputElement).value;
              }}
            />
          </label>
          <div class="cli-credential-self__form-action">
            <button
              class="btn btn--primary btn--sm"
              type="button"
              ?disabled=${this.busy}
              @click=${() => this.save()}
            >
              ${this.busy ? "添加中…" : "添加 KEY"}
            </button>
          </div>
        </div>

        ${this.renderList()}
      </section>
    `;
  }

  private renderList() {
    if (this.loading && this.credentials.length === 0) {
      return html`
        <p class="cli-credential-self__muted">加载中…</p>
      `;
    }
    if (this.credentials.length === 0) {
      return html`
        <p class="cli-credential-self__muted">尚未添加 KEY。</p>
      `;
    }
    return html`
      <div class="cli-credential-self__table-wrap">
        <table class="cli-credential-self__table">
          <thead>
            <tr>
              <th scope="col">CLI 后端</th>
              <th scope="col">环境变量</th>
              <th scope="col">更新时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            ${this.credentials.map(
              (cred) => html`
                <tr>
                  <td class="mono">${cred.backendId}</td>
                  <td class="mono">${cred.envVarNames.join(", ")}</td>
                  <td>${formatRelativeTimestamp(Date.parse(cred.updatedAt))}</td>
                  <td class="cli-credential-self__table-actions">
                    <button
                      class="btn btn--sm"
                      type="button"
                      ?disabled=${this.busy}
                      @click=${() => this.verify(cred.backendId)}
                    >
                      校验
                    </button>
                    <button
                      class="btn btn--sm"
                      type="button"
                      ?disabled=${this.busy}
                      @click=${() => this.removeCredential(cred.backendId)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cli-credential-self-panel": CliCredentialSelfPanel;
  }
}
