/**
 * Employee settings: seat-scoped AI rules (short multi-line texts).
 * Uses existing seat-rules store (500/2000/8 + content-guard). UI maxlength is
 * slightly looser than server so over-limit drafts can be submitted and rejected.
 * Guidance only;
 * does not open parallel tri-state, cross-bot textarea, or capability install.
 */

import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  fetchSeatAiRules,
  saveSeatAiRules,
  SeatAiRulesSaveError,
  seatAiRulesUiMaxLength,
  type SeatAiRulesLimits,
  type SeatAiRulesResponse,
} from "./seat-ai-rules-api.ts";

type DraftRule = {
  localKey: string;
  id?: string;
  text: string;
};

function newLocalKey(): string {
  return `draft-${Math.random().toString(36).slice(2, 10)}`;
}

function toDrafts(rules: { id: string; text: string }[]): DraftRule[] {
  return rules.map((rule) => ({
    localKey: rule.id || newLocalKey(),
    id: rule.id,
    text: rule.text,
  }));
}

function reasonLabel(reason: string): string {
  if (reason.startsWith("seat_rule_max_chars_")) {
    return `单条超过 ${reason.slice("seat_rule_max_chars_".length)} 字`;
  }
  if (reason.startsWith("seat_rules_max_total_chars_")) {
    return `合计超过 ${reason.slice("seat_rules_max_total_chars_".length)} 字`;
  }
  if (reason.startsWith("seat_rules_max_count_")) {
    return `最多 ${reason.slice("seat_rules_max_count_".length)} 条`;
  }
  const map: Record<string, string> = {
    empty_rule: "规则不能为空",
    secret: "不能包含密钥、令牌或连接串",
    disable_approval: "不能要求关闭审批",
    skip_security: "不能要求跳过安全",
    elevate: "不能要求提升权限",
    change_host: "不能要求改执行位置",
    credential_policy: "不能改凭证策略",
    execution_placement: "不能改执行落点",
    skip_confirmation: "不能写成「不用确认就执行」",
    cross_scope: "不能点名其他租户、席位或员工",
    duplicate_rule_id: "规则 id 重复",
  };
  return map[reason] ?? reason;
}

@customElement("seat-ai-rules-panel")
export class SeatAiRulesPanel extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;

  @state() private data: SeatAiRulesResponse | null = null;
  @state() private drafts: DraftRule[] = [];
  @state() private loading = false;
  @state() private loaded = false;
  @state() private busy = false;
  @state() private dirty = false;
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
    .meta {
      font-size: 12px;
      color: var(--muted-foreground, rgba(128, 128, 128, 0.85));
      margin-bottom: 10px;
    }
    .meta--over {
      color: var(--danger, #b42318);
    }
    .rules {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .rule {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.28));
      border-radius: 10px;
      background: var(--background, #fff);
    }
    .rule-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .rule-label {
      font-size: 12px;
      font-weight: 600;
    }
    .rule-count {
      font-size: 12px;
      color: var(--muted-foreground, rgba(128, 128, 128, 0.85));
    }
    .rule-count--over {
      color: var(--danger, #b42318);
    }
    textarea {
      width: 100%;
      min-height: 64px;
      resize: vertical;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.35));
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 14px;
      line-height: 1.45;
      box-sizing: border-box;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    button {
      padding: 7px 12px;
      border-radius: 8px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.35));
      background: var(--background, #fff);
      color: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    button.primary {
      background: var(--primary, #1d4ed8);
      border-color: var(--primary, #1d4ed8);
      color: #fff;
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    button.danger {
      color: var(--danger, #b42318);
    }
    .callout {
      margin-top: 12px;
      font-size: 13px;
    }
    .callout--danger {
      color: var(--danger, #b42318);
    }
    .empty {
      font-size: 13px;
      color: var(--muted-foreground, rgba(128, 128, 128, 0.85));
      padding: 4px 0 2px;
    }
  `;

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("client") && this.client && !this.loaded && !this.loading) {
      void this.reload();
    }
  }

  private limits(): SeatAiRulesLimits {
    return (
      this.data?.limits ?? {
        maxChars: 500,
        maxTotalChars: 2000,
        maxCount: 8,
      }
    );
  }

  private totalChars(): number {
    return this.drafts.reduce((sum, rule) => sum + rule.text.length, 0);
  }

  private async reload() {
    if (!this.client) {
      return;
    }
    this.loading = true;
    this.error = null;
    this.notice = null;
    const data = await fetchSeatAiRules(this.client);
    this.data = data;
    this.drafts = data ? toDrafts(data.rules) : [];
    this.dirty = false;
    this.loading = false;
    this.loaded = true;
    if (!data) {
      this.error = "无法加载席位 AI 规则（需要已绑定的企业席位）。";
    }
  }

  private onTextInput(localKey: string, event: Event) {
    const value = (event.target as HTMLTextAreaElement).value;
    this.drafts = this.drafts.map((rule) =>
      rule.localKey === localKey ? { ...rule, text: value } : rule,
    );
    this.dirty = true;
    this.notice = null;
    this.error = null;
  }

  private addRule() {
    const limits = this.limits();
    if (this.drafts.length >= limits.maxCount) {
      this.error = `最多 ${limits.maxCount} 条。`;
      return;
    }
    this.drafts = [...this.drafts, { localKey: newLocalKey(), text: "" }];
    this.dirty = true;
    this.notice = null;
    this.error = null;
  }

  private removeRule(localKey: string) {
    this.drafts = this.drafts.filter((rule) => rule.localKey !== localKey);
    this.dirty = true;
    this.notice = null;
    this.error = null;
  }

  private async persist() {
    if (!this.client || this.busy) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const payload = this.drafts.map((rule) =>
        rule.id ? { id: rule.id, text: rule.text } : { text: rule.text },
      );
      const saved = await saveSeatAiRules(this.client, payload);
      this.data = saved;
      this.drafts = toDrafts(saved.rules);
      this.dirty = false;
      this.notice = "已保存。仅对本席位绑定的机器人生效（行为指导，不改硬策略）。";
    } catch (err) {
      if (err instanceof SeatAiRulesSaveError) {
        const details = err.rejections.map((entry) => reasonLabel(entry.reason)).join("；");
        this.error = details
          ? `保存失败：${details}。已存规则未改。`
          : `保存失败：${err.message || "整次拒绝"}。已存规则未改。`;
      } else {
        this.error = "保存失败：请确认已绑定企业席位，且内容符合上限与安全要求。";
      }
    } finally {
      this.busy = false;
    }
  }

  render() {
    if (this.loading && !this.data) {
      return html`
        <div class="hint">加载席位 AI 规则…</div>
      `;
    }
    if (!this.data) {
      return html`
        <div class="hint">
          在企业已绑定的席位上，可添加少量短规则，只指导本席位绑定的机器人。未绑定席位时不可用。
        </div>
        ${this.error ? html`<div class="callout callout--danger">${this.error}</div>` : nothing}
      `;
    }

    const limits = this.limits();
    const total = this.totalChars();
    return html`
      <div class="hint">
        多条短文本，只注入本席位绑定的机器人；不跨机器人、不进审批硬策略。超限或敏感内容整次保存失败。
      </div>
      <div class="meta ${total > limits.maxTotalChars ? "meta--over" : ""}">
        ${this.drafts.length}/${limits.maxCount} 条 · 合计 ${total}/${limits.maxTotalChars} 字（保存时校验） ·
        单条保存上限 ${limits.maxChars} 字
      </div>
      <div class="rules">
        ${
          this.drafts.length === 0
            ? html`<div class="empty">还没有规则。可添加最多 ${limits.maxCount} 条短文本。</div>`
            : nothing
        }
        ${this.drafts.map(
          (rule, index) => html`
            <div class="rule">
              <div class="rule-head">
                <div class="rule-label">规则 ${index + 1}</div>
                <div
                  class="rule-count ${rule.text.length > limits.maxChars ? "rule-count--over" : ""}"
                >
                  ${rule.text.length}/${limits.maxChars}
                </div>
              </div>
              <textarea
                ?disabled=${this.busy}
                .value=${rule.text}
                maxlength=${seatAiRulesUiMaxLength(limits.maxChars)}
                placeholder="例如：状态更新尽量简短，用条目列出风险。"
                @input=${(event: Event) => this.onTextInput(rule.localKey, event)}
              ></textarea>
              <div>
                <button
                  type="button"
                  class="danger"
                  ?disabled=${this.busy}
                  @click=${() => this.removeRule(rule.localKey)}
                >
                  删除
                </button>
              </div>
            </div>
          `,
        )}
      </div>
      <div class="actions">
        <button
          type="button"
          ?disabled=${this.busy || this.drafts.length >= limits.maxCount}
          @click=${() => this.addRule()}
        >
          添加规则
        </button>
        <button
          type="button"
          class="primary"
          ?disabled=${this.busy || !this.dirty}
          @click=${() => void this.persist()}
        >
          保存
        </button>
        <button
          type="button"
          ?disabled=${this.busy || !this.dirty}
          @click=${() => void this.reload()}
        >
          撤销未保存
        </button>
      </div>
      ${this.notice ? html`<div class="callout">${this.notice}</div>` : nothing}
      ${this.error ? html`<div class="callout callout--danger">${this.error}</div>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "seat-ai-rules-panel": SeatAiRulesPanel;
  }
}
