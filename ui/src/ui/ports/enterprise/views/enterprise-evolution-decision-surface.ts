/**
 * Enterprise「需要企业决定」Decision Surface, standalone element.
 *
 * Shows the enterprise admin of the trusted tenant the evolution decisions
 * that need the enterprise, exactly as the D3 projection resolved them:
 * enterprise-owned decisions with evidence counts, an employee's
 * personal-asset changes as redacted participation rows, and platform
 * canaries that affect this tenant. It renders only the actions on each row
 * and submits through the D1 judge only. It never calls Gateway, the control
 * plane, or an Adapter, and it stores nothing.
 *
 * No enterprise page mounts this element in D3.3. The runtime gate
 * (`evolution-decision/runtime-gate.ts`) stays closed, and the mount is a
 * separate, frozen step for the owner of the enterprise surfaces file. The
 * element renders nothing until a host injects a server-resolved principal
 * with enterprise identity and a read-only snapshot source, so it cannot
 * show a placeholder panel.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 * Not E5.2.
 */

import "../evolution-decision/enterprise-evolution-decision.css";
import { LitElement, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import {
  EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED,
  type EvolutionDecisionAction,
  type EvolutionDecisionPrincipal,
} from "../../../evolution-decision-contract.ts";
import { renderIcon } from "../../../icons.ts";
import {
  hasEnterpriseDecisionIdentity,
  isEnterpriseDecisionActionAllowedByMap,
  loadEvolutionEnterpriseDecisionSurface,
  submitEvolutionEnterpriseDecisionAction,
} from "../evolution-decision/client.ts";
import { EVOLUTION_ENTERPRISE_DECISION_COPY } from "../evolution-decision/copy.ts";
import {
  enterpriseDecisionActionLabel,
  enterpriseDecisionAuthorityLabel,
  enterpriseDecisionEvidenceText,
  enterpriseDecisionNotActionableText,
  enterpriseDecisionReceiptText,
  enterpriseDecisionStatusLabel,
  enterpriseDecisionTargetLabel,
  enterpriseDecisionTimesText,
  enterpriseDecisionTypeLabel,
  enterpriseDecisionUnavailableActionLines,
  enterpriseDecisionWowDisplay,
} from "../evolution-decision/display.ts";
import type {
  EvolutionEnterpriseDecisionCommandIdFactory,
  EvolutionEnterpriseDecisionHistorySource,
  EvolutionEnterpriseDecisionRow,
  EvolutionEnterpriseDecisionSubmitContext,
  EvolutionEnterpriseDecisionSubmitReceipt,
  EvolutionEnterpriseDecisionSurfaceView,
} from "../evolution-decision/types.ts";

const COPY = EVOLUTION_ENTERPRISE_DECISION_COPY;

/** A refusal the element decides on its own, before the judge. Zero-write. */
function uiRefusal(input: {
  decisionId: string;
  action: string;
  code: string;
}): EvolutionEnterpriseDecisionSubmitReceipt {
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

export class EnterpriseEvolutionDecisionSurface extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  /** Server-resolved principal. Never read from the page. */
  @property({ attribute: false }) principal: EvolutionDecisionPrincipal | null = null;
  /** Read-only current / prior snapshots. */
  @property({ attribute: false }) historySource: EvolutionEnterpriseDecisionHistorySource | null =
    null;
  /** Server-resolved submit context per decision id. */
  @property({ attribute: false }) submitContexts: ReadonlyMap<
    string,
    EvolutionEnterpriseDecisionSubmitContext
  > | null = null;
  /** Idempotency key per submit. Without it the element refuses to submit. */
  @property({ attribute: false })
  commandIdFactory: EvolutionEnterpriseDecisionCommandIdFactory | null = null;

  @state() private view: EvolutionEnterpriseDecisionSurfaceView | null = null;
  @state() private loading = false;
  @state() private lastReceipt: EvolutionEnterpriseDecisionSubmitReceipt | null = null;

  private loadGeneration = 0;

  connectedCallback() {
    super.connectedCallback();
    // The first connect loads from willUpdate(). A reconnect reloads, because
    // disconnecting dropped any load that was in flight.
    if (this.hasUpdated) {
      void this.refresh();
    }
  }

  disconnectedCallback() {
    this.loadGeneration += 1;
    super.disconnectedCallback();
  }

  /**
   * Start loading before render. refresh() sets state synchronously (clearing
   * or `loading`); doing that here folds it into the current update instead of
   * scheduling another one from updated() (https://lit.dev/msg/change-in-update).
   */
  protected willUpdate(changed: PropertyValues) {
    if (changed.has("principal") || changed.has("historySource")) {
      void this.refresh();
    }
  }

  /** Principal with enterprise identity plus a snapshot source, or nothing renders. */
  private wired(): boolean {
    return Boolean(this.historySource) && hasEnterpriseDecisionIdentity(this.principal);
  }

  private async refresh() {
    const generation = ++this.loadGeneration;
    const principal = this.principal;
    const source = this.historySource;
    if (!principal || !source || !this.wired()) {
      this.view = null;
      this.loading = false;
      this.lastReceipt = null;
      return;
    }
    this.loading = true;
    const next = await loadEvolutionEnterpriseDecisionSurface({ source, principal });
    if (generation !== this.loadGeneration) {
      return;
    }
    this.view = next;
    this.loading = false;
  }

  private onAction(row: EvolutionEnterpriseDecisionRow, action: string) {
    const refuse = (code: string) => {
      this.lastReceipt = uiRefusal({ decisionId: row.decisionId, action, code });
    };
    if (!isEnterpriseDecisionActionAllowedByMap(action)) {
      refuse("endpoint_action_forbidden");
      return;
    }
    if (!row.allowedActions.includes(action as EvolutionDecisionAction)) {
      refuse("action_not_allowed");
      return;
    }
    const context = this.submitContexts?.get(row.decisionId);
    if (!context) {
      refuse("submit_context_unavailable");
      return;
    }
    const commandId = this.commandIdFactory?.({
      decisionId: row.decisionId,
      action: action as EvolutionDecisionAction,
    });
    if (typeof commandId !== "string" || commandId.trim().length === 0) {
      refuse("command_id_unavailable");
      return;
    }
    this.lastReceipt = submitEvolutionEnterpriseDecisionAction({
      command: {
        commandId,
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
    if (view?.phase === "denied") {
      return nothing;
    }
    return html`
      <section
        class="enterprise-card enterprise-evolution-decision"
        aria-label=${COPY.title}
        data-evolution-decision=${view?.claimGrade ?? "code-present"}
        data-runtime-enabled=${String(EVOLUTION_ENTERPRISE_DECISION_RUNTIME_ENABLED)}
        data-production-proven="false"
        data-e52="false"
      >
        <header class="enterprise-evolution-decision__head">
          ${renderIcon("shieldCheck", "enterprise-evolution-decision__icon")}
          <div>
            <h2 class="enterprise-evolution-decision__title">${COPY.title}</h2>
            <p class="enterprise-evolution-decision__subtitle">${COPY.subtitle}</p>
          </div>
        </header>
        ${
          this.loading && !view
            ? html`<p class="enterprise-evolution-decision__line" role="status">
                ${COPY.loading}
              </p>`
            : nothing
        }
        ${view ? this.renderView(view) : nothing} ${this.renderReceipt()}
      </section>
    `;
  }

  private renderView(view: EvolutionEnterpriseDecisionSurfaceView) {
    if (view.phase === "load-fail") {
      return html`<p
        class="enterprise-evolution-decision__phase"
        data-phase="load-fail"
        role="alert"
      >
        ${COPY.loadFail}
      </p>`;
    }
    return html`
      ${
        view.phase === "empty"
          ? html`<p class="enterprise-evolution-decision__phase" data-phase="empty">
              ${COPY.empty}
            </p>`
          : nothing
      }
      ${
        view.phase === "evidence-unavailable"
          ? html`<p class="enterprise-evolution-decision__phase" data-phase="evidence-unavailable">
              ${COPY.evidenceUnavailable}
            </p>`
          : nothing
      }
      ${this.renderWow(view)} ${this.renderRows(view.rows)}
    `;
  }

  private renderWow(view: EvolutionEnterpriseDecisionSurfaceView) {
    const wow = view.weekOverWeek;
    const display = enterpriseDecisionWowDisplay(wow);
    return html`
      <section
        class="enterprise-evolution-decision__section enterprise-evolution-decision__wow"
        aria-label=${COPY.wowTitle}
        data-wow-availability=${wow.availability}
        data-wow-reason=${wow.availability === "history-unavailable" ? wow.reason : nothing}
      >
        <h3 class="enterprise-evolution-decision__section-title">${COPY.wowTitle}</h3>
        ${
          display.availability === "history-unavailable"
            ? html`<p class="enterprise-evolution-decision__line">${display.message}</p>`
            : html`
                <p class="enterprise-evolution-decision__line" data-field="wow-period">
                  ${display.period}
                </p>
                <ul class="enterprise-evolution-decision__wow-list" data-field="wow-counts">
                  ${display.counts.map(
                    (line) => html`<li data-wow-status=${line.key}>${line.text}</li>`,
                  )}
                </ul>
                <h4 class="enterprise-evolution-decision__section-title">
                  ${COPY.transitionsTitle}
                </h4>
                ${
                  display.transitions.length === 0
                    ? html`<p class="enterprise-evolution-decision__line">
                        ${COPY.noTransitions}
                      </p>`
                    : html`<ul
                        class="enterprise-evolution-decision__wow-list"
                        data-field="wow-transitions"
                      >
                        ${display.transitions.map((line) => html`<li>${line}</li>`)}
                      </ul>`
                }
              `
        }
      </section>
    `;
  }

  private renderRows(rows: readonly EvolutionEnterpriseDecisionRow[]) {
    if (rows.length === 0) {
      return nothing;
    }
    return html`
      <section
        class="enterprise-evolution-decision__section"
        aria-label=${COPY.listTitle}
        data-field="rows"
      >
        <h3 class="enterprise-evolution-decision__section-title">${COPY.listTitle}</h3>
        <div class="enterprise-evolution-decision__rows">
          ${rows.map((row) => this.renderRow(row))}
        </div>
      </section>
    `;
  }

  private renderRow(row: EvolutionEnterpriseDecisionRow) {
    const actions = row.allowedActions.filter((action) =>
      isEnterpriseDecisionActionAllowedByMap(action),
    );
    const unavailable = enterpriseDecisionUnavailableActionLines(row);
    return html`
      <article
        class="enterprise-evolution-decision__row"
        data-decision-id=${row.decisionId}
        data-decision-type=${row.decisionType}
        data-ui-status=${row.uiStatus}
        data-status=${row.status}
        data-view=${row.view}
        data-participation=${row.participation}
        data-surface-id=${row.impactTarget.surfaceId}
      >
        <div class="enterprise-evolution-decision__row-title">
          <span data-field="decision-type">${enterpriseDecisionTypeLabel(row.decisionType)}</span>
          <span
            class="enterprise-evolution-decision__status"
            data-field="status"
            data-ui-status=${row.uiStatus}
            >${enterpriseDecisionStatusLabel(row.uiStatus)}</span
          >
        </div>
        <p class="enterprise-evolution-decision__line" data-field="target">
          ${COPY.targetLabel}：${enterpriseDecisionTargetLabel(row.impactTarget)}
        </p>
        <p class="enterprise-evolution-decision__line" data-field="times">
          ${enterpriseDecisionTimesText(row)}
        </p>
        <p
          class="enterprise-evolution-decision__line"
          data-field="required-authority"
          data-required-authority=${row.requiredAuthority}
        >
          ${COPY.authorityLabel}：${enterpriseDecisionAuthorityLabel(row.requiredAuthority)}
        </p>
        <div class="enterprise-evolution-decision__actions" data-field="allowed-actions">
          <span class="enterprise-evolution-decision__line">${COPY.actionsLabel}：</span>
          ${
            actions.length === 0
              ? html`<span class="enterprise-evolution-decision__line">${COPY.noAction}</span>`
              : actions.map(
                  (action) => html`<button
                    type="button"
                    class="enterprise-evolution-decision__action"
                    data-action=${action}
                    @click=${() => this.onAction(row, action)}
                  >
                    ${enterpriseDecisionActionLabel(action)}
                  </button>`,
                )
          }
        </div>
        <p
          class="enterprise-evolution-decision__line"
          data-field="evidence"
          data-evidence=${row.evidence.availability}
        >
          ${enterpriseDecisionEvidenceText(row)}
        </p>
        ${
          row.status === "pending"
            ? nothing
            : html`<p class="enterprise-evolution-decision__line" data-field="not-actionable">
                ${enterpriseDecisionNotActionableText(row)}
              </p>`
        }
        ${unavailable.map(
          (line) => html`<p
            class="enterprise-evolution-decision__line"
            data-field="action-reason"
            data-action=${line.action}
            data-reason=${line.code}
          >
            ${line.text}
          </p>`,
        )}
      </article>
    `;
  }

  private renderReceipt() {
    const receipt = this.lastReceipt;
    if (!receipt) {
      return nothing;
    }
    return html`<div
      class="enterprise-evolution-decision__receipt"
      role="status"
      data-outcome=${receipt.outcome}
      data-code=${receipt.code}
      data-command-id=${receipt.commandId}
      data-executed=${String(receipt.executed)}
      data-effect-proof=${String(receipt.effectProof)}
      data-writes=${String(receipt.writes.length)}
      data-audit-receipt-ref=${receipt.auditReceiptRef}
    >
      ${enterpriseDecisionReceiptText(receipt)}
    </div>`;
  }
}

if (!customElements.get("enterprise-evolution-decision-surface")) {
  customElements.define(
    "enterprise-evolution-decision-surface",
    EnterpriseEvolutionDecisionSurface,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "enterprise-evolution-decision-surface": EnterpriseEvolutionDecisionSurface;
  }
}
