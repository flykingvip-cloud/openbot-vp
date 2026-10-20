import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { projectEvolutionLineageView, type EvolutionLineageView } from "../evolution-lineage.ts";
import {
  fetchEvolutionLedger,
  fetchEvolutionProposals,
  holdEvolutionProposal,
  resumeEvolutionExperiment,
} from "../services/governanceApi.ts";

@customElement("evolution-lineage-panel")
export class EvolutionLineagePanel extends LitElement {
  @state() private views: EvolutionLineageView[] = [];
  @state() private loaded = false;
  @state() private busyProposalId: string | null = null;
  @state() private actionMessage: string | null = null;

  static styles = css`
    :host {
      display: block;
      min-width: 0;
      max-width: 100%;
    }

    .panel {
      min-width: 0;
    }

    h2 {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 600;
    }

    .hint,
    .notice {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 13px;
    }

    .notice {
      padding-left: 8px;
      border-left: 3px solid color-mix(in srgb, var(--warn, var(--border)) 70%, transparent);
      color: var(--text);
    }

    .row {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
      gap: 8px 16px;
      padding: 8px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
    }

    .row:last-child {
      border-bottom: 0;
    }

    .id,
    .meta,
    .steps {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .id {
      font-weight: 600;
    }

    .meta {
      color: var(--muted);
      font-size: 12px;
    }

    .proof {
      font-size: 12px;
    }

    .proof--linked,
    .proof--none {
      color: var(--warn, var(--muted));
    }

    .observation {
      margin-top: 4px;
      font-size: 12px;
      color: var(--muted);
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 8px;
    }

    .action-btn {
      padding: 6px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--card);
      color: var(--text);
      cursor: pointer;
      font-size: 13px;
    }

    .action-btn:hover:not(:disabled) {
      background: var(--bg-hover);
    }

    .action-btn:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }

    .steps {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      overflow-x: auto;
    }

    .step {
      font-size: 12px;
      color: var(--text);
    }

    .step--receipt {
      color: var(--muted);
    }

    @media (max-width: 720px) {
      .row {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    const [proposals, events] = await Promise.all([
      fetchEvolutionProposals(),
      fetchEvolutionLedger(),
    ]);
    this.views = (proposals ?? []).map((proposal) =>
      projectEvolutionLineageView(proposal, events ?? []),
    );
    this.loaded = true;
  }

  private async onHoldAction(view: EvolutionLineageView) {
    const action = view.holdAction;
    if (!action || this.busyProposalId) {
      return;
    }
    this.busyProposalId = view.proposalId;
    this.actionMessage = null;
    const result =
      action.command === "hold"
        ? await holdEvolutionProposal(view.proposalId)
        : await resumeEvolutionExperiment(view.proposalId);
    this.busyProposalId = null;
    if (!result.ok) {
      this.actionMessage = result.message;
      return;
    }
    this.actionMessage =
      action.command === "hold" ? "已暂停实验，可恢复同一实验。" : "已恢复同一实验。";
    await this.load();
  }

  render() {
    if (!this.loaded) {
      return html`
        <section class="panel"><div class="hint">正在读取进化谱系…</div></section>
      `;
    }
    if (this.views.length === 0) {
      return html`
        <section class="panel">
          <h2>统一进化谱系</h2>
          <p class="hint">暂无提案。默认 assist，critical 永不自动应用。回执不是效果证明。</p>
        </section>
      `;
    }
    return html`<section class="panel">
      <h2>统一进化谱系</h2>
      <p class="hint">
        提案 → 实验 → 应用回执 → 验证。实验中可暂停，暂停后恢复同一实验。默认 assist；回执 ≠
        效果证明。
      </p>
      ${this.actionMessage ? html`<p class="notice">${this.actionMessage}</p>` : ""}
      ${this.views.map(
        (view) => html`
          <div class="row" data-proposal-id=${view.proposalId} data-status=${view.status}>
            <div>
              <div class="id">${view.proposalId}</div>
              <div class="meta">${view.surfaceId} · ${view.statusLabel}</div>
              <div class="proof proof--${view.effectProof}">${view.effectProofLabel}</div>
              ${
                view.observation?.availability === "unavailable"
                  ? html`<div
                    class="observation"
                    data-observation="unavailable"
                    data-observation-reason=${view.observation.reason ?? ""}
                  >
                    observation unavailable
                  </div>`
                  : ""
              }
              ${
                view.holdAction
                  ? html`
                    <div class="actions">
                      <button
                        class="action-btn"
                        data-hold-command=${view.holdAction.command}
                        ?disabled=${this.busyProposalId !== null}
                        title=${
                          view.holdAction.command === "hold"
                            ? "暂停当前实验，不自动应用"
                            : "恢复同一实验，不新建实验"
                        }
                        @click=${() => void this.onHoldAction(view)}
                      >
                        ${view.holdAction.label}
                      </button>
                    </div>
                  `
                  : ""
              }
            </div>
            <div class="steps">
              ${view.steps.map(
                (step) => html`<span class="step ${step.receiptOnly ? "step--receipt" : ""}"
                  >${step.label}</span
                >`,
              )}
            </div>
          </div>
        `,
      )}
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "evolution-lineage-panel": EvolutionLineagePanel;
  }
}
