/**
 * Employee system-settings「需要我决定」Decision Surface.
 *
 * Separate from read-only Perception. Actions go through the D1 command map
 * and judge only. Never calls Adapter. Never mutates Perception.
 *
 * The settings page mounts this element only when the runtime gate opens
 * (`runtime-gate.ts`); D2 keeps it closed. The element renders nothing until
 * a host injects a server-resolved principal and a read-only snapshot source,
 * so it cannot show a placeholder panel.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 * Not E5.2.
 */

import { LitElement, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import {
  EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED,
  type EvolutionDecisionAction,
  type EvolutionDecisionPrincipal,
} from "../../../evolution-decision-contract.ts";
import {
  isEmployeeDecisionActionAllowedByMap,
  loadEvolutionEmployeeDecisionSurface,
  submitEvolutionEmployeeDecisionAction,
  type EvolutionDecisionHistorySource,
  type EvolutionDecisionSubmitContext,
} from "../evolution-decision/client.ts";
import { EVOLUTION_DECISION_COPY } from "../evolution-decision/copy.ts";
import {
  evolutionDecisionActionLabel,
  evolutionDecisionAuthorityLabel,
  evolutionDecisionEvidenceText,
  evolutionDecisionNotActionableText,
  evolutionDecisionReceiptText,
  evolutionDecisionStatusLabel,
  evolutionDecisionTargetLabel,
  evolutionDecisionTimesText,
  evolutionDecisionTypeLabel,
  evolutionDecisionUnavailableActionLines,
  evolutionDecisionWowLines,
} from "../evolution-decision/display.ts";
import type {
  EvolutionEmployeeDecisionRow,
  EvolutionEmployeeDecisionSubmitReceipt,
  EvolutionEmployeeDecisionSurfaceView,
} from "../evolution-decision/types.ts";

const COPY = EVOLUTION_DECISION_COPY;

function uiRefusal(input: {
  decisionId: string;
  action: string;
  code: string;
}): EvolutionEmployeeDecisionSubmitReceipt {
  return {
    commandId: "",
    decisionId: input.decisionId,
    action: input.action,
    outcome: "rejected",
    code: input.code,
    executed: false,
    effectProof: false,
    writes: [],
    auditReceiptRef: `decision-refusal:ui:${input.code}`,
  };
}

export class EmployeeEvolutionDecisionSection extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  /** Server-resolved employee principal. Never read from the page. */
  @property({ attribute: false }) principal: EvolutionDecisionPrincipal | null = null;
  /** Read-only current / prior snapshots. */
  @property({ attribute: false }) historySource: EvolutionDecisionHistorySource | null = null;
  @property({ attribute: false }) submitContexts: ReadonlyMap<
    string,
    EvolutionDecisionSubmitContext
  > | null = null;
  @property({ attribute: false }) perceptionFactIdsByControlPlaneRef: ReadonlyMap<
    string,
    readonly string[]
  > | null = null;

  @state() private view: EvolutionEmployeeDecisionSurfaceView | null = null;
  @state() private loading = false;
  @state() private lastReceipt: EvolutionEmployeeDecisionSubmitReceipt | null = null;

  private loadGeneration = 0;

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  disconnectedCallback() {
    this.loadGeneration += 1;
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues) {
    if (
      changed.has("principal") ||
      changed.has("historySource") ||
      changed.has("perceptionFactIdsByControlPlaneRef")
    ) {
      void this.refresh();
    }
  }

  private wired(): boolean {
    return Boolean(this.principal && this.historySource);
  }

  private async refresh() {
    const generation = ++this.loadGeneration;
    const principal = this.principal;
    const source = this.historySource;
    if (!principal || !source) {
      this.view = null;
      this.loading = false;
      return;
    }
    this.loading = true;
    const next = await loadEvolutionEmployeeDecisionSurface({
      source,
      principal,
      perceptionFactIdsByControlPlaneRef: this.perceptionFactIdsByControlPlaneRef ?? undefined,
    });
    if (generation !== this.loadGeneration) {
      return;
    }
    this.view = next;
    this.loading = false;
  }

  private onAction(row: EvolutionEmployeeDecisionRow, action: string) {
    if (!isEmployeeDecisionActionAllowedByMap(action)) {
      this.lastReceipt = uiRefusal({
        decisionId: row.decisionId,
        action,
        code: "endpoint_action_forbidden",
      });
      return;
    }
    const context = this.submitContexts?.get(row.decisionId);
    if (!context) {
      this.lastReceipt = uiRefusal({
        decisionId: row.decisionId,
        action,
        code: "submit_context_unavailable",
      });
      return;
    }
    this.lastReceipt = submitEvolutionEmployeeDecisionAction({
      command: {
        commandId: `ui-${row.decisionId}-${action}-${Date.now()}`,
        decisionId: row.decisionId,
        action: action as EvolutionDecisionAction,
        expectedVersion: row.decisionVersion,
      },
      context,
    });
  }

  protected render() {
    if (!this.wired()) {
      return nothing;
    }
    const view = this.view;
    return html`
      <section
        class="employee-workbench__settings-section employee-evolution-decision"
        aria-label=${COPY.title}
        data-evolution-decision=${view?.claimGrade ?? "code-present"}
        data-runtime-enabled=${String(EVOLUTION_EMPLOYEE_DECISION_RUNTIME_ENABLED)}
        data-production-proven="false"
        data-e52="false"
      >
        <div class="employee-workbench__settings-section-head">
          <div class="employee-workbench__settings-section-title">${COPY.title}</div>
          <p class="employee-evolution-decision__subtitle">${COPY.subtitle}</p>
        </div>
        ${
          this.loading && !view
            ? html`<p class="employee-evolution-decision__line" role="status">${COPY.loading}</p>`
            : nothing
        }
        ${view ? this.renderView(view) : nothing} ${this.renderReceipt()}
      </section>
    `;
  }

  private renderView(view: EvolutionEmployeeDecisionSurfaceView) {
    if (view.phase === "load-fail") {
      return html`<p class="employee-evolution-decision__phase" data-phase="load-fail" role="alert">
        ${COPY.loadFail}
      </p>`;
    }
    return html`
      ${
        view.phase === "empty"
          ? html`<p class="employee-evolution-decision__phase" data-phase="empty">${COPY.empty}</p>`
          : nothing
      }
      ${
        view.phase === "evidence-unavailable"
          ? html`<p class="employee-evolution-decision__phase" data-phase="evidence-unavailable">
              ${COPY.evidenceUnavailable}
            </p>`
          : nothing
      }
      ${this.renderWow(view)} ${this.renderRows(view.rows)}
    `;
  }

  private renderWow(view: EvolutionEmployeeDecisionSurfaceView) {
    const wow = view.weekOverWeek;
    return html`
      <div
        class="employee-evolution-decision__wow"
        data-wow-availability=${wow.availability}
        data-wow-reason=${wow.availability === "history-unavailable" ? wow.reason : nothing}
      >
        <div class="employee-evolution-decision__wow-title">${COPY.wowTitle}</div>
        ${evolutionDecisionWowLines(wow).map(
          (line) => html`<p class="employee-evolution-decision__line">${line}</p>`,
        )}
      </div>
    `;
  }

  private renderRows(rows: readonly EvolutionEmployeeDecisionRow[]) {
    if (rows.length === 0) {
      return nothing;
    }
    return html`
      <div class="employee-evolution-decision__list">
        ${rows.map((row) => this.renderRow(row))}
      </div>
    `;
  }

  private renderRow(row: EvolutionEmployeeDecisionRow) {
    const unavailable = evolutionDecisionUnavailableActionLines(row);
    return html`
      <article
        class="employee-evolution-decision__row"
        data-decision-id=${row.decisionId}
        data-decision-type=${row.decisionType}
        data-ui-status=${row.uiStatus}
        data-status=${row.status}
        data-view=${row.view}
        data-surface-id=${row.impactTarget.surfaceId}
      >
        <div class="employee-evolution-decision__row-title">
          <span>${evolutionDecisionTypeLabel(row.decisionType)}</span>
          <span class="employee-evolution-decision__status"
            >${evolutionDecisionStatusLabel(row.uiStatus)}</span
          >
        </div>
        <p class="employee-evolution-decision__line" data-field="target">
          ${COPY.targetLabel}：${evolutionDecisionTargetLabel(row.impactTarget)}
        </p>
        <p
          class="employee-evolution-decision__line"
          data-field="required-authority"
          data-required-authority=${row.requiredAuthority}
        >
          ${COPY.authorityLabel}：${evolutionDecisionAuthorityLabel(row.requiredAuthority)}
        </p>
        <div class="employee-evolution-decision__actions" data-field="allowed-actions">
          <span class="employee-evolution-decision__line">${COPY.actionsLabel}：</span>
          ${
            row.allowedActions.length === 0
              ? html`<span class="employee-evolution-decision__line">${COPY.noAction}</span>`
              : row.allowedActions.map(
                  (action) => html`<button
                    type="button"
                    class="employee-evolution-decision__action"
                    data-action=${action}
                    @click=${() => this.onAction(row, action)}
                  >
                    ${evolutionDecisionActionLabel(action)}
                  </button>`,
                )
          }
        </div>
        ${
          row.status === "pending"
            ? nothing
            : html`<p class="employee-evolution-decision__line" data-field="not-actionable">
                ${evolutionDecisionNotActionableText(row)}
              </p>`
        }
        ${unavailable.map(
          (line) => html`<p
            class="employee-evolution-decision__line"
            data-field="action-reason"
            data-action=${line.action}
            data-reason=${line.code}
          >
            ${line.text}
          </p>`,
        )}
        <p
          class="employee-evolution-decision__line"
          data-field="evidence"
          data-evidence=${row.evidence.availability}
        >
          ${evolutionDecisionEvidenceText(row.evidence)}
        </p>
        <p class="employee-evolution-decision__line" data-field="times">
          ${evolutionDecisionTimesText(row)}
        </p>
      </article>
    `;
  }

  private renderReceipt() {
    const receipt = this.lastReceipt;
    if (!receipt) {
      return nothing;
    }
    return html`<div
      class="employee-evolution-decision__receipt"
      role="status"
      data-outcome=${receipt.outcome}
      data-code=${receipt.code}
      data-executed=${String(receipt.executed)}
      data-effect-proof=${String(receipt.effectProof)}
      data-writes=${String(receipt.writes.length)}
      data-audit-receipt-ref=${receipt.auditReceiptRef}
    >
      ${evolutionDecisionReceiptText(receipt)}
    </div>`;
  }
}

if (!customElements.get("employee-evolution-decision-section")) {
  customElements.define("employee-evolution-decision-section", EmployeeEvolutionDecisionSection);
}

declare global {
  interface HTMLElementTagNameMap {
    "employee-evolution-decision-section": EmployeeEvolutionDecisionSection;
  }
}
