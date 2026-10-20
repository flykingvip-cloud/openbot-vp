/**
 * Employee system-settings「进化」tab.
 *
 * Read-only perception résumé. Not the Agent Growth OS lifecycle report
 * (`workbench-stage-growth-evolution`). Calls only
 * `evolution.perception.query` / `evolution.perception.project`.
 * Claim grade: runtime-enabled. Not production-proven.
 */

import { LitElement, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  askEvolutionPerception,
  refreshEvolutionPerception,
  type EvolutionPerceptionPhase,
  type EvolutionPerceptionSnapshot,
} from "../evolution-perception/client.ts";
import {
  DEFAULT_EVOLUTION_PERCEPTION_INTENT,
  EVOLUTION_PERCEPTION_COPY,
  EVOLUTION_PERCEPTION_INTENTS,
  type EvolutionPerceptionIntentId,
} from "../evolution-perception/copy.ts";
import {
  deriveEvolutionIntentCounts,
  evolutionBudgetLines,
  evolutionFoldedNotes,
  evolutionIntentCountTitle,
  evolutionPerceptionWindowPrecision,
  evolutionRelativeWeekIsNext,
  formatEvolutionEmptyLastChangeCopy,
  formatEvolutionFreshnessCopy,
  formatEvolutionIntentCount,
  formatEvolutionPerceptionWindowLabel,
  formatEvolutionSuccessEmptyCopy,
  formatEvolutionSuccessEmptyHint,
  humanizeEvolutionNarration,
  moreProjectionsSummaryLabel,
  presentEvolutionFact,
  resolveEvolutionPerceptionUiStatus,
  stripEvolutionEmptyNarration,
  visibleEvolutionProjectionGroups,
  type EvolutionIntentCountValue,
  type EvolutionPerceptionUiStatus,
} from "../evolution-perception/display.ts";
import { makeEvolutionFactDetail } from "../evolution-perception/mapping.ts";
import {
  isSystemEvolutionDomain,
  traceableFactIds,
  type EvolutionAutomaticAction,
  type EvolutionFactDetail,
  type EvolutionPerceptionPanels,
  type EvolutionPerceptionQueryView,
  type EvolutionPerceptionWindow,
  type EvolutionTimelineItem,
} from "../evolution-perception/types.ts";

export class EmployeeEvolutionPerceptionSection extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;

  @property({ type: Boolean }) connected = false;

  @state() private phase: EvolutionPerceptionPhase = { status: "offline" };
  @state() private answer: EvolutionPerceptionQueryView | null = null;
  @state() private answerError: string | null = null;
  @state() private selectedIntent: string = DEFAULT_EVOLUTION_PERCEPTION_INTENT;
  @state() private window: EvolutionPerceptionWindow | null = null;
  @state() private selectedFact: EvolutionTimelineItem | null = null;
  @state() private moreOpen = false;
  @state() private loading = false;

  private loadGeneration = 0;
  private lastLoadKey = "";

  connectedCallback() {
    super.connectedCallback();
    this.lastLoadKey = this.loadKey();
    void this.refresh();
  }

  disconnectedCallback() {
    this.loadGeneration += 1;
    super.disconnectedCallback();
  }

  protected updated(changed: PropertyValues) {
    if (!changed.has("client") && !changed.has("connected")) {
      return;
    }
    const key = this.loadKey();
    if (key === this.lastLoadKey) {
      return;
    }
    this.lastLoadKey = key;
    void this.refresh();
  }

  private loadKey(): string {
    return `${this.connected ? "on" : "off"}:${this.client ? "client" : "none"}`;
  }

  private uiStatus(): EvolutionPerceptionUiStatus {
    return resolveEvolutionPerceptionUiStatus({
      loading: this.loading,
      connected: this.connected && Boolean(this.client),
      phaseStatus: this.phase.status,
      answer: this.answer,
      answerError: this.answerError,
    });
  }

  private panels(): EvolutionPerceptionPanels | null {
    return this.phase.status === "loaded" ? this.phase.panels : null;
  }

  private async refresh() {
    const generation = ++this.loadGeneration;
    this.moreOpen = false;
    this.selectedFact = null;
    this.answer = null;
    this.answerError = null;
    this.selectedIntent = DEFAULT_EVOLUTION_PERCEPTION_INTENT;
    if (!this.client || !this.connected) {
      this.loading = false;
      this.phase = { status: "offline" };
      return;
    }
    this.loading = true;
    this.phase = { status: "offline" };
    const client = this.client;
    const snapshot = await refreshEvolutionPerception({
      transport: {
        request: (method, params) => client.request(method, params),
      },
    });
    if (generation !== this.loadGeneration) {
      return;
    }
    this.applySnapshot(snapshot);
    this.loading = false;
  }

  private applySnapshot(snapshot: EvolutionPerceptionSnapshot) {
    this.window = snapshot.window;
    this.phase = snapshot.phase;
    this.answer = snapshot.answer;
    this.answerError = snapshot.answerError;
    this.selectedIntent = snapshot.selectedIntent;
    // Keep more-projections collapsed. A zero-change week should lead with the
    // healthy empty state; low-signal rows stay behind the disclosure.
  }

  private async ask(intent: string) {
    if (!this.client || !this.connected || !this.window) {
      return;
    }
    if (this.phase.status === "denied" || this.phase.status === "untrusted") {
      return;
    }
    const generation = ++this.loadGeneration;
    const client = this.client;
    const perceptionWindow = this.window;
    this.selectedIntent = intent;
    this.answerError = null;
    this.loading = true;
    const asked = await askEvolutionPerception({
      transport: {
        request: (method, params) => client.request(method, params),
      },
      intent,
      window: perceptionWindow,
    });
    if (generation !== this.loadGeneration) {
      return;
    }
    this.loading = false;
    if (asked.status === "denied" || asked.status === "untrusted") {
      this.phase = { status: asked.status };
      this.answer = null;
      return;
    }
    if (asked.status === "failed") {
      this.answer = null;
      this.answerError = asked.message;
      return;
    }
    this.answer = asked.answer;
  }

  private openFact(item: EvolutionTimelineItem) {
    if (traceableFactIds(item.factIds).length === 0) {
      return;
    }
    this.selectedFact = item;
  }

  private expandMore() {
    this.moreOpen = true;
  }

  render() {
    const detail =
      this.selectedFact && this.window
        ? makeEvolutionFactDetail(this.selectedFact, this.window)
        : this.selectedFact
          ? makeEvolutionFactDetail(this.selectedFact)
          : null;
    const uiStatus = this.uiStatus();
    const panels = this.panels();
    const counts = deriveEvolutionIntentCounts({
      panels,
      answer: this.answer,
      selectedIntent: this.selectedIntent,
      uiStatus,
    });
    const suggestRelative = evolutionRelativeWeekIsNext(counts);
    return html`
      <section
        class="employee-workbench__settings-section employee-evolution-perception"
        data-evolution-perception="runtime-enabled"
        data-evolution-hero=${DEFAULT_EVOLUTION_PERCEPTION_INTENT}
        data-evolution-ui-status=${uiStatus}
      >
        <div class="employee-workbench__settings-section-head">
          <div>
            <div class="employee-workbench__settings-section-title employee-evolution-perception__heading">
              进化
              <span
                class="employee-evolution-perception__badge"
                title=${EVOLUTION_PERCEPTION_COPY.readOnlyReminder}
              >
                ${EVOLUTION_PERCEPTION_COPY.readOnlyBadge}
              </span>
            </div>
            ${this.renderWindow()}
          </div>
          <button type="button" class="btn" ?disabled=${this.loading} @click=${() => void this.refresh()}>
            ${EVOLUTION_PERCEPTION_COPY.refresh}
          </button>
        </div>
        <div class="employee-evolution-perception__chips" role="toolbar" aria-label="投影意图">
          ${EVOLUTION_PERCEPTION_INTENTS.map((intent) => {
            const count = counts[intent.id];
            const suggested = suggestRelative && intent.id === "diff_from_last_week";
            return html`
              <button
                type="button"
                class="employee-workbench__settings-tab ${
                  this.selectedIntent === intent.id ? "is-active" : ""
                } ${suggested ? "is-suggested" : ""}"
                title=${evolutionIntentCountTitle(intent.title, count)}
                aria-label=${evolutionIntentCountTitle(intent.title, count)}
                data-evolution-suggest=${suggested ? "relative" : nothing}
                @click=${() => void this.ask(intent.id)}
              >
                <span>${intent.title}</span>
                <span class="employee-evolution-perception__chip-count" aria-hidden="true"
                  >${formatEvolutionIntentCount(count)}</span
                >
              </button>
            `;
          })}
        </div>
        <div class="employee-evolution-perception__hero">${this.renderHero(uiStatus, counts)}</div>
        ${
          this.phase.status === "loaded"
            ? html`
                <details
                  class="employee-evolution-perception__more"
                  ?open=${this.moreOpen}
                  @toggle=${(event: Event) => {
                    const target = event.currentTarget;
                    if (target instanceof HTMLDetailsElement) {
                      this.moreOpen = target.open;
                    }
                  }}
                >
                  <summary>${moreProjectionsSummaryLabel(panels, uiStatus)}</summary>
                  ${this.renderProjections(this.phase.panels)}
                </details>
              `
            : nothing
        }
        ${detail ? this.renderProvenance(detail) : nothing}
      </section>
    `;
  }

  private renderHero(
    uiStatus: EvolutionPerceptionUiStatus,
    counts: Record<EvolutionPerceptionIntentId, EvolutionIntentCountValue>,
  ) {
    if (uiStatus === "loading") {
      return this.renderLoading();
    }
    if (uiStatus === "error") {
      return this.renderError();
    }
    if (uiStatus === "offline") {
      return this.notice(EVOLUTION_PERCEPTION_COPY.offline);
    }
    if (uiStatus === "denied") {
      return this.notice(EVOLUTION_PERCEPTION_COPY.denied);
    }
    if (uiStatus === "untrusted") {
      return this.notice(EVOLUTION_PERCEPTION_COPY.untrusted);
    }
    if (uiStatus === "success_empty") {
      return this.renderSuccessEmpty(counts);
    }
    if (this.answer) {
      return this.renderAnswer(this.answer);
    }
    return this.notice(EVOLUTION_PERCEPTION_COPY.empty);
  }

  private renderLoading() {
    return html`
      <div class="employee-evolution-perception__state" data-evolution-state="loading">
        <div class="employee-workbench__settings-status-copy">${EVOLUTION_PERCEPTION_COPY.loading}</div>
        <div class="employee-evolution-perception__skeleton" aria-hidden="true">
          <div class="employee-evolution-perception__skeleton-card"></div>
          <div class="employee-evolution-perception__skeleton-card"></div>
          <div class="employee-evolution-perception__skeleton-card"></div>
        </div>
      </div>
    `;
  }

  private renderError() {
    const detail = this.answerError
      ? this.answerError
      : this.phase.status === "failed"
        ? this.phase.message
        : EVOLUTION_PERCEPTION_COPY.errorHint;
    return html`
      <div class="employee-evolution-perception__state" data-evolution-state="error">
        <div class="employee-workbench__settings-field-label">${EVOLUTION_PERCEPTION_COPY.errorLead}</div>
        <div class="employee-workbench__settings-status-copy">${EVOLUTION_PERCEPTION_COPY.errorHint}</div>
        <div class="employee-workbench__settings-status-copy employee-evolution-perception__error-detail">
          ${detail}
        </div>
        <div class="employee-evolution-perception__empty-actions">
          <button type="button" class="btn primary" @click=${() => void this.refresh()}>
            ${EVOLUTION_PERCEPTION_COPY.retry}
          </button>
          <button type="button" class="btn" @click=${() => void this.refresh()}>
            ${EVOLUTION_PERCEPTION_COPY.refresh}
          </button>
        </div>
      </div>
    `;
  }

  private renderSuccessEmpty(
    counts: Record<EvolutionPerceptionIntentId, EvolutionIntentCountValue>,
  ) {
    const window = this.window;
    const lead = window ? formatEvolutionSuccessEmptyCopy(window) : EVOLUTION_PERCEPTION_COPY.empty;
    const hint = window
      ? formatEvolutionSuccessEmptyHint(window)
      : EVOLUTION_PERCEPTION_COPY.successEmptyHint;
    const relative = counts.diff_from_last_week;
    const relativeCount = typeof relative === "number" ? relative : null;
    const suggestRelative = evolutionRelativeWeekIsNext(counts);
    return html`
      <div class="employee-evolution-perception__state" data-evolution-state="success_empty">
        <div class="employee-workbench__settings-field-label">
          ${EVOLUTION_PERCEPTION_COPY.learnedNarration}
        </div>
        <div class="employee-workbench__settings-status-copy">${lead}</div>
        <div class="employee-workbench__settings-status-copy">${hint}</div>
        <div class="employee-workbench__settings-status-copy">
          ${formatEvolutionEmptyLastChangeCopy(relativeCount)}
        </div>
        ${this.renderFoldedNotes([])}
        <div class="employee-evolution-perception__empty-actions">
          <button
            type="button"
            class="btn ${suggestRelative ? "primary" : ""}"
            data-evolution-cta="diff_from_last_week"
            @click=${() => void this.ask("diff_from_last_week")}
          >
            ${EVOLUTION_PERCEPTION_COPY.ctaViewDiff}
          </button>
          <button type="button" class="btn" @click=${() => this.expandMore()}>
            ${EVOLUTION_PERCEPTION_COPY.ctaExpandProjections}
          </button>
          <button type="button" class="btn" @click=${() => void this.refresh()}>
            ${EVOLUTION_PERCEPTION_COPY.refresh}
          </button>
        </div>
      </div>
    `;
  }

  private renderAnswer(answer: EvolutionPerceptionQueryView) {
    if (answer.state === "denied") {
      return this.notice(EVOLUTION_PERCEPTION_COPY.denied);
    }
    if (answer.state === "untrusted") {
      return this.notice(EVOLUTION_PERCEPTION_COPY.untrusted);
    }
    const narration = stripEvolutionEmptyNarration(answer.narration);
    const showEmpty =
      answer.items.length === 0 &&
      answer.platformItems.length === 0 &&
      narration.learned.length === 0 &&
      narration.platform.length === 0 &&
      narration.other.length === 0;
    if (showEmpty) {
      return this.renderSuccessEmpty(
        deriveEvolutionIntentCounts({
          panels: this.panels(),
          answer: this.answer,
          selectedIntent: this.selectedIntent,
          uiStatus: "success_empty",
        }),
      );
    }
    const humanized = humanizeEvolutionNarration(narration);
    const showLearnedNarration = humanized.learned.length > 0 && answer.items.length === 0;
    const showPlatformNarration =
      humanized.platform.length > 0 && answer.platformItems.length === 0;
    const showOtherNarration = humanized.other.length > 0 && answer.items.length === 0;
    return html`
      ${
        answer.unresolvedIntents.length > 0
          ? html`<div class="employee-workbench__settings-status-copy">
              未识别意图：${answer.unresolvedIntents.join("、")}
            </div>`
          : nothing
      }
      ${
        showLearnedNarration
          ? this.renderNarration(EVOLUTION_PERCEPTION_COPY.learnedNarration, humanized.learned)
          : nothing
      }
      ${
        answer.items.length > 0
          ? this.renderFactList(EVOLUTION_PERCEPTION_COPY.digitalHumanSection, answer.items)
          : nothing
      }
      ${
        answer.platformItems.length > 0
          ? this.renderFactList(EVOLUTION_PERCEPTION_COPY.platformSection, answer.platformItems)
          : nothing
      }
      ${
        showPlatformNarration
          ? this.renderNarration(EVOLUTION_PERCEPTION_COPY.platformNarration, humanized.platform)
          : nothing
      }
      ${
        showOtherNarration
          ? this.renderNarration(EVOLUTION_PERCEPTION_COPY.otherNarration, humanized.other)
          : nothing
      }
      ${this.renderFoldedNotes([...answer.items, ...answer.platformItems])}
    `;
  }

  private renderFoldedNotes(shown: EvolutionTimelineItem[]) {
    const panels = this.panels();
    if (!panels) {
      return nothing;
    }
    const notes = evolutionFoldedNotes(panels, shown);
    if (notes.length === 0) {
      return nothing;
    }
    return html`
      ${notes.map(
        (note) => html`
          <div class="employee-workbench__settings-status-copy" data-evolution-folded>${note}</div>
        `,
      )}
    `;
  }

  private renderProjections(panels: EvolutionPerceptionPanels) {
    const groups = visibleEvolutionProjectionGroups(panels);
    if (groups.length === 0) {
      return html`<div class="employee-workbench__settings-status-copy">
        ${EVOLUTION_PERCEPTION_COPY.projectionsEmpty}
      </div>`;
    }
    return html`
      <div class="employee-evolution-perception__projections">
        ${groups.map((group) =>
          group.id === "automatic"
            ? this.renderAutomatic(group.actions)
            : this.renderFactList(group.title, group.items),
        )}
      </div>
    `;
  }

  private renderAutomatic(actions: EvolutionAutomaticAction[]) {
    return html`
      <div class="employee-evolution-perception__list">
        <div class="employee-workbench__settings-field-label">${EVOLUTION_PERCEPTION_COPY.automaticTitle}</div>
        ${
          actions.length === 0
            ? this.notice(EVOLUTION_PERCEPTION_COPY.empty)
            : actions.map(
                (action) => html`
                  ${this.renderFactButton(action.item)}
                  ${
                    action.budget.kind === "provided"
                      ? html`<div class="employee-workbench__settings-status-copy">
                          ${evolutionBudgetLines(action.budget).map((line) => html`<div>${line}</div>`)}
                        </div>`
                      : nothing
                  }
                `,
              )
        }
      </div>
    `;
  }

  private renderWindow() {
    const perceptionWindow = this.window;
    if (!perceptionWindow) {
      return nothing;
    }
    const precision = evolutionPerceptionWindowPrecision(perceptionWindow);
    return html`<div
      class="employee-workbench__settings-status-copy"
      data-evolution-window
      title=${precision}
      aria-label=${precision}
    >
      <span aria-hidden="true">${formatEvolutionPerceptionWindowLabel(perceptionWindow)}</span>
      <span class="employee-evolution-perception__sr">${precision}</span>
    </div>
    <div
      class="employee-workbench__settings-status-copy employee-evolution-perception__freshness"
      data-evolution-freshness
    >
      ${formatEvolutionFreshnessCopy(perceptionWindow)}
    </div>`;
  }

  private renderFactList(title: string, items: EvolutionTimelineItem[]) {
    return html`
      <div class="employee-evolution-perception__list">
        <div class="employee-workbench__settings-field-label">${title}</div>
        ${
          items.length === 0
            ? this.notice(EVOLUTION_PERCEPTION_COPY.empty)
            : items.map((item) => this.renderFactButton(item))
        }
      </div>
    `;
  }

  private renderFactButton(item: EvolutionTimelineItem) {
    const system = isSystemEvolutionDomain(item);
    const presentation = presentEvolutionFact(item);
    const story =
      presentation.signal === "none" ? EVOLUTION_PERCEPTION_COPY.lowSignalFact : presentation.story;
    return html`
      <button
        type="button"
        class="employee-evolution-perception__row"
        data-evolution-signal=${presentation.signal}
        @click=${() => this.openFact(item)}
      >
        <span class="employee-evolution-perception__row-title">
          ${presentation.title}
          ${system ? html`<span class="employee-evolution-perception__badge">${EVOLUTION_PERCEPTION_COPY.platformBadge}</span>` : nothing}
        </span>
        <span class="employee-evolution-perception__story">${story}</span>
      </button>
    `;
  }

  private renderNarration(title: string, lines: string[]) {
    if (lines.length === 0) {
      return nothing;
    }
    return html`
      <div class="employee-evolution-perception__list">
        <div class="employee-workbench__settings-field-label">${title}</div>
        ${lines.map((line) => html`<div class="employee-workbench__settings-status-copy">${line}</div>`)}
      </div>
    `;
  }

  private renderProvenance(detail: EvolutionFactDetail) {
    return html`
      <div
        class="employee-workbench__settings-confirm-overlay"
        role="dialog"
        aria-modal="true"
        aria-label=${EVOLUTION_PERCEPTION_COPY.provenanceTitle}
      >
        <div class="employee-workbench__settings-confirm-card employee-workbench__settings-confirm-card--provenance">
          <div class="employee-workbench__settings-confirm-title">
            ${EVOLUTION_PERCEPTION_COPY.provenanceTitle}
          </div>
          <div class="employee-workbench__settings-confirm-body">
            ${EVOLUTION_PERCEPTION_COPY.readOnlyReminder}
          </div>
          <div class="employee-workbench__settings-field-label">${detail.audienceLabel}</div>
          ${detail.fields.map(
            (field) => html`
              <div class="employee-evolution-perception__field">
                <span>${field.label}</span>
                <span>${field.value}</span>
              </div>
            `,
          )}
          <div class="employee-workbench__settings-confirm-actions">
            <button type="button" class="btn" @click=${() => {
              this.selectedFact = null;
            }}>
              ${EVOLUTION_PERCEPTION_COPY.close}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private notice(text: string) {
    return html`<div class="employee-workbench__settings-status-copy">${text}</div>`;
  }
}

if (!customElements.get("employee-evolution-perception-section")) {
  customElements.define(
    "employee-evolution-perception-section",
    EmployeeEvolutionPerceptionSection,
  );
}

declare global {
  interface HTMLElementTagNameMap {
    "employee-evolution-perception-section": EmployeeEvolutionPerceptionSection;
  }
}
