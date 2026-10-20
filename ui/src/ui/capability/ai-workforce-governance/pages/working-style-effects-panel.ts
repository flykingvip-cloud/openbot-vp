/**
 * Working Style Effects Panel（二阶反馈可视化，企业治理）。
 *
 * 展示各 agent 最近一次 Working DNA 变更的实战效果：improved / regressed / inconclusive / pending，
 * 并标注是否因判定回归已自动回滚。数据来自 `agents.list-working-style-effects`。
 * 网关无数据时显示空态（行为治理不使用 mock）。
 */

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  fetchWorkingStyleEffectiveness,
  fetchWorkingStyleEffects,
} from "../services/governanceApi.ts";
import type { WorkingStyleEffectItem, WorkingStyleEffectivenessAggregate } from "../types/index.ts";

@customElement("working-style-effects-panel")
export class WorkingStyleEffectsPanel extends LitElement {
  @state() private effects: WorkingStyleEffectItem[] = [];
  @state() private aggregate: WorkingStyleEffectivenessAggregate | null = null;
  @state() private isLoading = false;
  @state() private loaded = false;

  static styles = css`
    :host {
      display: block;
      padding: 24px;
      font-family: var(--font-body);
      color: var(--text);
    }
    .header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 16px;
    }
    h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--text-strong);
    }
    .hint {
      font-size: 12px;
      color: var(--text-muted, var(--text));
      opacity: 0.7;
    }
    .empty {
      padding: 16px 0;
      color: var(--text-muted, var(--text));
      opacity: 0.7;
      font-size: 14px;
    }
    .summary {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 16px;
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--muted, rgba(128, 128, 128, 0.08));
      font-size: 13px;
    }
    .summary .stat {
      color: var(--text-muted, var(--text));
    }
    .summary strong {
      color: var(--text-strong);
    }
    code {
      font-family: var(--font-mono, monospace);
      font-size: 12px;
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--card);
      font-size: 14px;
    }
    .agent {
      font-weight: 600;
      color: var(--text-strong);
      min-width: 160px;
    }
    .delta {
      font-variant-numeric: tabular-nums;
      color: var(--text-muted, var(--text));
    }
    .keys {
      margin-left: auto;
      font-size: 12px;
      opacity: 0.7;
    }
    .badge {
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge--improved {
      background: color-mix(in srgb, green 18%, transparent);
      color: green;
    }
    .badge--regressed {
      background: color-mix(in srgb, red 18%, transparent);
      color: red;
    }
    .badge--neutral,
    .badge--pending {
      background: var(--muted, rgba(128, 128, 128, 0.15));
      color: var(--text-muted, var(--text));
    }
    .badge--rolled {
      background: color-mix(in srgb, orange 20%, transparent);
      color: darkorange;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    this.isLoading = true;
    try {
      const [effects, aggregate] = await Promise.all([
        fetchWorkingStyleEffects(),
        fetchWorkingStyleEffectiveness(),
      ]);
      this.effects = effects;
      this.aggregate = aggregate;
    } finally {
      this.isLoading = false;
      this.loaded = true;
    }
  }

  private renderSummary() {
    const agg = this.aggregate;
    if (!agg || agg.overall.total === 0) {
      return null;
    }
    const rate = agg.overall.improvedRate;
    const ratePct = typeof rate === "number" ? `${Math.round(rate * 100)}%` : "—";
    const best = agg.bySignature.find((entry) => entry.total > 0 && entry.netEffectiveness > 0);
    return html`
      <div class="summary">
        <span class="stat"
          >Improved rate <strong>${ratePct}</strong> (${agg.overall.improved}↑ /
          ${agg.overall.regressed}↓ of ${agg.overall.total})</span
        >
        ${
          best
            ? html`<span class="stat"
              >Most effective: <code>${best.signature}</code> (net
              ${best.netEffectiveness.toFixed(2)})</span
            >`
            : null
        }
      </div>
    `;
  }

  private renderBadge(item: WorkingStyleEffectItem) {
    if (item.rolledBack) {
      return html`
        <span class="badge badge--rolled">rolled back</span>
      `;
    }
    switch (item.status) {
      case "improved":
        return html`
          <span class="badge badge--improved">improved</span>
        `;
      case "regressed":
        return html`
          <span class="badge badge--regressed">regressed</span>
        `;
      case "inconclusive":
        return html`
          <span class="badge badge--neutral">inconclusive</span>
        `;
      default:
        return html`
          <span class="badge badge--pending">pending</span>
        `;
    }
  }

  private formatDelta(value: number | null): string {
    if (typeof value !== "number") {
      return "—";
    }
    return value > 0 ? `+${value}` : String(value);
  }

  render() {
    return html`
      <div class="header">
        <h2>Working style effects</h2>
        <span class="hint">运营信号驱动的行为改变及其实战效果（判定回归自动回滚）</span>
      </div>
      ${this.renderSummary()}
      ${
        this.isLoading && !this.loaded
          ? html`
              <div class="empty">Loading…</div>
            `
          : this.effects.length === 0
            ? html`
                <div class="empty">No working-style changes recorded yet.</div>
              `
            : html`
              <div class="list">
                ${this.effects.map(
                  (item) => html`
                    <div class="row">
                      <span class="agent">${item.agentId}</span>
                      ${this.renderBadge(item)}
                      <span class="delta">Δ ${this.formatDelta(item.deltaScore)}</span>
                      <span class="keys">${Object.keys(item.appliedDelta).join(", ") || "—"}</span>
                    </div>
                  `,
                )}
              </div>
            `
      }
    `;
  }
}
