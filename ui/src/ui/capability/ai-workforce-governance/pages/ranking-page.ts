/**
 * Ranking Page
 * Displays AI asset rankings with score breakdown.
 * Prefers enterprise creator assets when readModel is provided (real robot/group names).
 */

import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { EnterprisePortReadModel } from "../../../ports/enterprise/semantic/enterprise-read-model.ts";
import type { AgentsListResult, CollaborationSpacesListResult } from "../../../types.ts";
import { buildCreatorRanking, buildMeshRanking } from "../runtime-adapter.ts";
import { fetchRanking, fetchScores } from "../services/governanceApi.ts";
import type { RankingView, AssetScore } from "../types/index.ts";

@customElement("governance-ranking-page")
export class GovernanceRankingPage extends LitElement {
  @property({ type: String }) rankingType: "bot" | "group" | "position" = "bot";

  @property({ attribute: false })
  readModel?: EnterprisePortReadModel;

  @property({ attribute: false })
  agentsList?: AgentsListResult | null;

  @property({ attribute: false })
  collaborationSpacesResult?: CollaborationSpacesListResult | null;

  @state() private ranking: RankingView | null = null;
  @state() private scores: AssetScore[] = [];
  @state() private isLoading = false;
  @state() private error: string | null = null;

  static styles = css`
    :host {
      display: block;
      padding: 8px 0 16px;
      font-family: var(--font-body);
      color: var(--text);
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      gap: 12px;
      flex-wrap: wrap;
    }

    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: var(--text-strong);
    }

    .type-tabs {
      display: flex;
      gap: 6px;
    }

    .tab {
      padding: 6px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--card);
      color: var(--text);
      cursor: pointer;
      font-size: 13px;
      transition: all var(--duration-fast) var(--ease-out);
    }

    .tab:hover {
      background: var(--bg-hover);
    }

    .tab.active {
      background: var(--accent);
      color: var(--accent-foreground);
      border-color: var(--accent);
    }

    .ranking-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ranking-item {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      transition: box-shadow var(--duration-fast) var(--ease-out);
    }

    .ranking-item:hover {
      box-shadow: var(--shadow-sm);
    }

    .rank-number {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-weight: 600;
      font-size: 13px;
      margin-right: 12px;
      flex-shrink: 0;
    }

    .rank-number.top3 {
      background: color-mix(in srgb, var(--warn) 22%, transparent);
      color: var(--warn);
    }

    .rank-number.normal {
      background: var(--secondary);
      color: var(--muted);
    }

    .asset-info {
      flex: 1;
      min-width: 0;
    }

    .asset-name {
      font-weight: 500;
      font-size: 14px;
      color: var(--text-strong);
      margin-bottom: 2px;
    }

    .asset-meta {
      font-size: 12px;
      color: var(--muted);
    }

    .score-section {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-shrink: 0;
    }

    .score-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 600;
      font-size: 14px;
    }

    .score-badge .star {
      font-size: 13px;
    }

    .metrics {
      display: flex;
      gap: 12px;
      font-size: 12px;
      color: var(--muted);
    }

    .loading,
    .empty {
      text-align: center;
      padding: 24px;
      color: var(--muted);
    }

    .error {
      padding: 12px;
      background: color-mix(in srgb, var(--danger) 12%, transparent);
      color: var(--danger);
      border-radius: var(--radius-md);
      margin-bottom: 12px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this.loadData();
  }

  protected updated(changed: Map<string, unknown>) {
    if (
      changed.has("readModel") ||
      changed.has("agentsList") ||
      changed.has("collaborationSpacesResult") ||
      changed.has("rankingType")
    ) {
      void this.loadData();
    }
  }

  private resolveLocalRanking(): RankingView | null {
    if (!this.readModel) {
      return null;
    }
    const hasCreatorSource =
      this.rankingType === "group"
        ? Boolean(this.collaborationSpacesResult)
        : Boolean(this.agentsList);
    if (hasCreatorSource) {
      const ranking = buildCreatorRanking({
        readModel: this.readModel,
        agentsList: this.agentsList,
        collaborationSpacesResult: this.collaborationSpacesResult,
        rankingType: this.rankingType,
      });
      if (ranking.items.length > 0) {
        return ranking;
      }
    }
    return buildMeshRanking({
      readModel: this.readModel,
      rankingType: this.rankingType,
    });
  }

  private async loadData() {
    this.isLoading = true;
    this.error = null;
    try {
      const local = this.resolveLocalRanking();
      if (local) {
        this.ranking = local;
        this.scores = [];
        return;
      }
      const [ranking, scores] = await Promise.all([fetchRanking(this.rankingType), fetchScores()]);
      this.ranking = ranking;
      this.scores = scores;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to load ranking";
    } finally {
      this.isLoading = false;
    }
  }

  private setType(type: "bot" | "group" | "position") {
    this.rankingType = type;
  }

  private getScoreClass(score: number): string {
    if (score >= 80) {
      return "excellent";
    }
    if (score >= 60) {
      return "good";
    }
    if (score >= 40) {
      return "average";
    }
    return "poor";
  }

  private typeLabel(type: string): string {
    if (type === "position") {
      return "岗位";
    }
    if (type === "bot") {
      return "机器人";
    }
    return "协作组";
  }

  render() {
    if (this.isLoading) {
      return html`
        <div class="loading">加载排名中...</div>
      `;
    }

    if (this.error) {
      return html`<div class="error">${this.error}</div>`;
    }

    const items = this.ranking?.items ?? [];

    return html`
      <div class="header">
        <h1>AI 资产排名</h1>
        <div class="type-tabs">
          <button
            class="tab ${this.rankingType === "bot" ? "active" : ""}"
            @click=${() => this.setType("bot")}
          >
            机器人
          </button>
          <button
            class="tab ${this.rankingType === "group" ? "active" : ""}"
            @click=${() => this.setType("group")}
          >
            协作组
          </button>
          <button
            class="tab ${this.rankingType === "position" ? "active" : ""}"
            @click=${() => this.setType("position")}
          >
            岗位
          </button>
        </div>
      </div>

      <div class="ranking-list">
        ${
          items.length === 0
            ? html`
                <div class="empty">暂无排名数据</div>
              `
            : items.map(
                (item) => html`
                  <div class="ranking-item">
                    <div class="rank-number ${item.rank <= 3 ? "top3" : "normal"}">
                      ${item.rank}
                    </div>
                    <div class="asset-info">
                      <div class="asset-name">${item.name}</div>
                      <div class="asset-meta">${this.typeLabel(item.type)}</div>
                    </div>
                    <div class="score-section">
                      <div class="score-badge ${this.getScoreClass(item.score)}">
                        <span class="star">★</span>
                        <span>${item.score}</span>
                      </div>
                      <div class="metrics">
                        <span class="metric">${item.metrics.taskCount.toLocaleString()} 任务</span>
                        <span class="metric"
                          >${(item.metrics.successRate * 100).toFixed(0)}% 成功率</span
                        >
                        <span class="metric"
                          >$${item.metrics.avgCost.toFixed(3)}/任务</span
                        >
                      </div>
                    </div>
                  </div>
                `,
              )
        }
      </div>
    `;
  }
}
