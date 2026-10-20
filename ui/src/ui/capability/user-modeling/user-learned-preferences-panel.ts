/**
 * Learned user preferences panel — read-only profile + clear action (employee settings).
 */

import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  fetchUserModelingProfile,
  resetUserModelingProfile,
  type UserModelingProfileView,
} from "./user-modeling-api.ts";

const FIELD_LABELS: Record<string, { zh: string; en: string }> = {
  preferredReplyLanguage: { zh: "回复语言", en: "Reply language" },
  preferredOutputFormat: { zh: "输出格式", en: "Output format" },
  preferredTone: { zh: "语气", en: "Tone" },
  confirmationPreference: { zh: "确认偏好", en: "Confirmation" },
  verbosity: { zh: "详略", en: "Verbosity" },
};

function labelFor(field: string, locale: string): string {
  const entry = FIELD_LABELS[field];
  if (!entry) {
    return field;
  }
  return locale === "en" ? entry.en : entry.zh;
}

function isDefaultProfile(profile: UserModelingProfileView): boolean {
  return (
    !profile.preferredReplyLanguage &&
    profile.preferredOutputFormat === "structured" &&
    profile.preferredTone === "neutral" &&
    profile.confirmationPreference === "confirm_first" &&
    profile.verbosity === "normal" &&
    Object.keys(profile.observations ?? {}).length === 0
  );
}

@customElement("user-learned-preferences-panel")
export class UserLearnedPreferencesPanel extends LitElement {
  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) locale = "zh-CN";

  @state() private profile: UserModelingProfileView | null = null;
  @state() private userKeyHash: string | null = null;
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
      gap: 8px;
      margin-bottom: 16px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 14px;
      padding: 8px 0;
      border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.2));
    }
    .row:last-child {
      border-bottom: none;
    }
    .label {
      color: var(--muted-foreground, rgba(128, 128, 128, 0.85));
    }
    .value {
      font-weight: 500;
      text-align: right;
    }
    .empty {
      font-size: 14px;
      color: var(--muted-foreground, rgba(128, 128, 128, 0.85));
      padding: 8px 0 16px;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .callout {
      margin-top: 12px;
      font-size: 13px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(128, 128, 128, 0.08);
    }
    .callout--error {
      color: #b42318;
      background: rgba(180, 35, 24, 0.08);
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("client") && this.client?.connected) {
      void this.load();
    }
  }

  private t(zh: string, en: string): string {
    return this.locale === "en" ? en : zh;
  }

  private async load(): Promise<void> {
    if (!this.client?.connected) {
      this.loaded = true;
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const result = await fetchUserModelingProfile(this.client);
      this.profile = result?.profile ?? null;
      this.userKeyHash = result?.userKeyHash ?? null;
    } catch {
      this.error = this.t("无法加载画像。", "Could not load profile.");
    } finally {
      this.loading = false;
      this.loaded = true;
    }
  }

  private async onClear(): Promise<void> {
    if (!this.client?.connected || this.busy) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const ok = await resetUserModelingProfile(this.client);
      if (!ok) {
        this.error = this.t("清除失败，请稍后重试。", "Clear failed. Try again later.");
        return;
      }
      this.profile = null;
      this.userKeyHash = null;
      this.notice = this.t("已清除学习到的偏好。", "Learned preferences cleared.");
      await this.load();
    } finally {
      this.busy = false;
    }
  }

  private renderRows() {
    const profile = this.profile;
    if (!profile || isDefaultProfile(profile)) {
      return html`
        <div class="empty">
          ${this.t("暂无学习到的偏好。在对话中直接说明即可，例如「简洁点」或「reply in English」。", "No learned preferences yet. Say things like “keep it concise” or “reply in English” in chat.")}
        </div>
      `;
    }
    const fields = [
      "preferredReplyLanguage",
      "preferredOutputFormat",
      "preferredTone",
      "confirmationPreference",
      "verbosity",
    ] as const;
    return html`
      <div class="rows">
        ${fields.map((field) => {
          const raw = profile[field];
          const value =
            field === "preferredReplyLanguage"
              ? (raw ?? this.t("未设置", "Not set"))
              : String(raw ?? "—");
          return html`
            <div class="row">
              <span class="label">${labelFor(field, this.locale)}</span>
              <span class="value">${value}</span>
            </div>
          `;
        })}
      </div>
      ${
        this.userKeyHash
          ? html`
            <div class="hint">
              ${this.t("画像 ID", "Profile ID")}: <code>${this.userKeyHash}</code>
            </div>
          `
          : nothing
      }
    `;
  }

  render() {
    return html`
      <div class="hint">
        ${this.t(
          "OpenBot 仅根据你在对话中明确说出的偏好学习沟通方式；不会保存原始消息内容。",
          "OpenBot learns communication preferences only from explicit instructions in chat; raw messages are not stored.",
        )}
      </div>
      ${
        this.loading && !this.loaded
          ? html`
            <div class="empty">${this.t("加载中…", "Loading…")}</div>
          `
          : this.renderRows()
      }
      <div class="actions">
        <button type="button" class="btn btn--sm" ?disabled=${this.busy} @click=${() => void this.load()}>
          ${this.t("刷新", "Refresh")}
        </button>
        <button
          type="button"
          class="btn btn--sm btn--danger"
          ?disabled=${this.busy || !this.client?.connected}
          @click=${() => void this.onClear()}
        >
          ${this.busy ? this.t("处理中…", "Working…") : this.t("清除我的画像", "Clear my profile")}
        </button>
      </div>
      ${this.notice ? html`<div class="callout">${this.notice}</div>` : nothing}
      ${this.error ? html`<div class="callout callout--error">${this.error}</div>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "user-learned-preferences-panel": UserLearnedPreferencesPanel;
  }
}
