/**
 * 席位策略演练入口：挂在个人偏好，与 seat-exec-preference / seat-ai-rules 并列。
 * 只触发 Fabric policy check；不弹审批、不写允许列表、不构成预授权。
 * 不做平行三态「自动/需审批/仅演练」，不新增 ExecAsk。
 */

import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../gateway.ts";
import { runSeatDrill, type SeatDrillOutcome, type SeatDrillResponse } from "./seat-drill-api.ts";

function outcomeLabel(outcome: SeatDrillOutcome): string {
  if (outcome === "allow") {
    return "允许";
  }
  if (outcome === "deny") {
    return "拒绝";
  }
  return "收紧";
}

@customElement("seat-drill-panel")
export class SeatDrillPanel extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;

  @state() private busy = false;
  @state() private result: SeatDrillResponse | null = null;
  @state() private error: string | null = null;
  @state() private command = "echo seat-policy-drill";

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
    .row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }
    .label {
      font-size: 13px;
      font-weight: 600;
    }
    input {
      max-width: 420px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.35));
      background: var(--background, #fff);
      color: inherit;
      font-size: 14px;
    }
    button {
      align-self: flex-start;
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.35));
      background: var(--background, #fff);
      color: inherit;
      font-size: 14px;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .result {
      margin-top: 12px;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.35));
      font-size: 13px;
      line-height: 1.55;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .callout--danger {
      color: var(--danger, #b42318);
      font-size: 13px;
      margin-top: 8px;
    }
    .meta {
      color: var(--muted-foreground, rgba(128, 128, 128, 0.85));
    }
  `;

  private async onDrill() {
    if (!this.client || this.busy) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.result = null;
    const result = await runSeatDrill(this.client, { command: this.command.trim() || undefined });
    this.busy = false;
    if (!result) {
      this.error = "演练失败（需要已绑定的企业席位；演练不会执行命令）。";
      return;
    }
    this.result = result;
  }

  render() {
    return html`
      <div class="hint">
        演练只走策略裁决（Fabric policy check），不执行命令、不弹审批、不改允许列表；结果不能作为下次真执行的预授权。审批三态仍是关闭 /
        未命中时 / 始终。
      </div>
      <div class="row">
        <div class="label">样例命令（仅用于裁决，不会执行）</div>
        <input
          .value=${this.command}
          ?disabled=${this.busy}
          @input=${(event: Event) => {
            this.command = (event.target as HTMLInputElement).value;
          }}
        />
      </div>
      <button ?disabled=${this.busy || !this.client} @click=${() => void this.onDrill()}>
        ${this.busy ? "演练中…" : "演练一次"}
      </button>
      ${this.error ? html`<div class="callout--danger">${this.error}</div>` : nothing}
      ${
        this.result
          ? html`
            <div class="result">
              <div>
                <strong>结果：</strong>${outcomeLabel(this.result.outcome)}（${
                  this.result.decision
                }）
              </div>
              ${
                this.result.reason
                  ? html`<div class="meta">原因：${this.result.reason}</div>`
                  : nothing
              }
              <div>
                是否构成放宽：${this.result.relaxation ? "是（需人工确认才可真放宽）" : "否"}
              </div>
              <div>
                若真执行是否要审批：${this.result.wouldRequireApprovalIfExecuted ? "是" : "否"}
                <span class="meta"
                  >（有效 ask=${this.result.effective.ask} /
                  security=${this.result.effective.security}）</span
                >
              </div>
              <div class="meta">
                预授权=${String(this.result.preAuthorization)} · 已持久化=${String(
                  this.result.persisted,
                )}
              </div>
              <div class="meta">${this.result.note}</div>
            </div>
          `
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "seat-drill-panel": SeatDrillPanel;
  }
}
