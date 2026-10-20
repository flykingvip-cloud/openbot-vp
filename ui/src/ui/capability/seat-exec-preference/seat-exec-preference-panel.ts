/**
 * Employee settings: tighten ExecAsk / ExecSecurity within the enterprise ceiling.
 * Does not expose host, credential policy, placement, parallel tri-state, or AI rules textarea.
 */

import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../../../i18n/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  fetchSeatExecPreference,
  saveSeatExecPreference,
  type SeatExecAsk,
  type SeatExecPreferenceResponse,
  type SeatExecSecurity,
} from "./seat-exec-preference-api.ts";

function askLabel(value: SeatExecAsk): string {
  if (value === "on-miss") {
    return t("execApprovalsPage.options.onMiss");
  }
  return t(`execApprovalsPage.options.${value}`);
}

function securityLabel(value: SeatExecSecurity): string {
  return t(`execApprovalsPage.options.${value}`);
}

@customElement("seat-exec-preference-panel")
export class SeatExecPreferencePanel extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;

  @state() private data: SeatExecPreferenceResponse | null = null;
  @state() private loading = false;
  @state() private loaded = false;
  @state() private busy = false;
  @state() private notice: string | null = null;
  @state() private error: string | null = null;

  static styles = css`
    :host {
      display: block;
    }
    .hint {
      font-size: 13px;
      line-height: 1.5;
      color: var(--muted-foreground, rgba(128, 128, 128, 0.85));
      margin-bottom: 12px;
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .row {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .label {
      font-size: 13px;
      font-weight: 600;
    }
    .meta {
      font-size: 12px;
      color: var(--muted-foreground, rgba(128, 128, 128, 0.85));
    }
    select {
      max-width: 280px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.35));
      background: var(--background, #fff);
      color: inherit;
      font-size: 14px;
    }
    .callout {
      margin-top: 12px;
      font-size: 13px;
    }
    .callout--danger {
      color: var(--danger, #b42318);
    }
  `;

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("client") && this.client && !this.loaded && !this.loading) {
      void this.reload();
    }
  }

  private async reload() {
    if (!this.client) {
      return;
    }
    this.loading = true;
    this.error = null;
    this.notice = null;
    const data = await fetchSeatExecPreference(this.client);
    this.data = data;
    this.loading = false;
    this.loaded = true;
    if (!data) {
      this.error = "无法加载席位执行偏好（需要已绑定的企业席位）。";
    }
  }

  private async onAskChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value as SeatExecAsk | "__inherit__";
    await this.persist({ ask: value === "__inherit__" ? null : value });
  }

  private async onSecurityChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value as SeatExecSecurity | "__inherit__";
    await this.persist({ security: value === "__inherit__" ? null : value });
  }

  private async persist(patch: { ask?: SeatExecAsk | null; security?: SeatExecSecurity | null }) {
    if (!this.client || this.busy) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    const saved = await saveSeatExecPreference(this.client, patch);
    this.busy = false;
    if (!saved) {
      this.error = "保存失败：只能在企业天花板内收紧，且不能改执行位置。";
      await this.reload();
      return;
    }
    this.data = {
      ...(this.data ?? saved),
      ...saved,
      allowed: this.data?.allowed ?? saved.allowed,
    };
    this.notice = "已保存。会话与执行会按更严的一边生效。";
  }

  render() {
    if (this.loading && !this.data) {
      return html`
        <div class="hint">加载席位执行偏好…</div>
      `;
    }
    if (!this.data) {
      return html`
        <div class="hint">
          在企业已绑定的席位上，可把命令审批与安全级别在天花板内拧紧。未绑定席位时不可用。
        </div>
        ${this.error ? html`<div class="callout callout--danger">${this.error}</div>` : nothing}
      `;
    }

    const { ceiling, preference, allowed, effective } = this.data;
    return html`
      <div class="hint">
        只能比企业默认更严：询问更常问、安全更少放行。执行位置与凭证策略由企业配置，员工不可改。
      </div>
      <div class="rows">
        <div class="row">
          <div class="label">${t("execApprovalsPage.ask.title")}</div>
          <div class="meta">
            企业天花板：${askLabel(ceiling.ask)} · 当前生效：${askLabel(effective.ask)}
          </div>
          <select
            ?disabled=${this.busy}
            .value=${preference.ask ?? "__inherit__"}
            @change=${(event: Event) => void this.onAskChange(event)}
          >
            <option value="__inherit__">跟随企业（${askLabel(ceiling.ask)}）</option>
            ${allowed.ask.map(
              (value) => html`
                <option value=${value} ?selected=${preference.ask === value}>
                  ${askLabel(value)}
                </option>
              `,
            )}
          </select>
        </div>
        <div class="row">
          <div class="label">${t("execApprovalsPage.security.title")}</div>
          <div class="meta">
            企业天花板：${securityLabel(ceiling.security)} · 当前生效：${securityLabel(
              effective.security,
            )}
          </div>
          <select
            ?disabled=${this.busy}
            .value=${preference.security ?? "__inherit__"}
            @change=${(event: Event) => void this.onSecurityChange(event)}
          >
            <option value="__inherit__">跟随企业（${securityLabel(ceiling.security)}）</option>
            ${allowed.security.map(
              (value) => html`
                <option value=${value} ?selected=${preference.security === value}>
                  ${securityLabel(value)}
                </option>
              `,
            )}
          </select>
        </div>
      </div>
      ${this.notice ? html`<div class="callout">${this.notice}</div>` : nothing}
      ${this.error ? html`<div class="callout callout--danger">${this.error}</div>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "seat-exec-preference-panel": SeatExecPreferencePanel;
  }
}
