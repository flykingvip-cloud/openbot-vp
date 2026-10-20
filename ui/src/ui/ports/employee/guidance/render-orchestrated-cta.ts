/**
 * Single orchestrated primary CTA surface (P3.1 / P3.2).
 * Optional actions stay collapsed. High-risk requires confirm.
 */

import { html, nothing, type TemplateResult } from "lit";
import type { UiGuidanceNextAction, UiGuidanceSnapshot } from "./orchestrate-surface.ts";
import { shouldShowOrchestratedPrimaryCta } from "./orchestrate-surface.ts";
import { resolveGuidanceReasonCopy } from "./reason-copy.ts";

export type OrchestratedGuidanceHandlers = {
  onPrimary: (snapshot: UiGuidanceSnapshot) => void;
  onOptional: (snapshot: UiGuidanceSnapshot, action: UiGuidanceNextAction) => void;
  onAcknowledge: (snapshot: UiGuidanceSnapshot) => void;
  onDefer: (snapshot: UiGuidanceSnapshot) => void;
  onResume: (snapshot: UiGuidanceSnapshot) => void;
  onFailureRecover: (snapshot: UiGuidanceSnapshot) => void;
  /** First click on high-risk — enter confirm pending. */
  onRequestHighRiskConfirm: (snapshot: UiGuidanceSnapshot) => void;
  /** Second click — confirmed high-risk execution. */
  onHighRiskConfirm: (snapshot: UiGuidanceSnapshot) => void;
  /** When true, show failure recovery entry. */
  showFailureRecover?: boolean;
  /** When true, show resume-from-gateway entry. */
  showResume?: boolean;
  /** Pending high-risk confirm UI. */
  highRiskPending?: boolean;
  acknowledgedKeys?: ReadonlySet<string> | readonly string[];
  deferredUntilMsByKey?: ReadonlyMap<string, number> | Record<string, number>;
  nowMs?: number;
};

function actionLabel(action: UiGuidanceNextAction): string {
  return action.label?.trim() || action.kind;
}

export function renderOrchestratedGuidanceSurface(
  snapshot: UiGuidanceSnapshot | null | undefined,
  handlers: OrchestratedGuidanceHandlers,
): TemplateResult | typeof nothing {
  if (
    !shouldShowOrchestratedPrimaryCta(snapshot, {
      acknowledgedKeys: handlers.acknowledgedKeys,
      deferredUntilMsByKey: handlers.deferredUntilMsByKey,
      nowMs: handlers.nowMs,
    })
  ) {
    return nothing;
  }
  const snap = snapshot as UiGuidanceSnapshot;
  const primary = snap.nextAction;
  const isHighRisk = primary.risk === "high";
  const optionals = snap.optionalActions ?? [];
  const lead = resolveGuidanceReasonCopy(primary.reason);

  return html`<section
    class="workbench-guidance-orchestrator"
    data-guidance-orchestrator="true"
    data-guidance-scope=${snap.scope}
    data-guidance-entity=${snap.entityId}
    data-guidance-scenario=${snap.scenario}
    data-guidance-primary-kind=${primary.kind}
    data-guidance-primary-risk=${primary.risk}
  >
    ${lead ? html`<div class="workbench-guidance-orchestrator__lead">${lead}</div>` : nothing}
    <div class="workbench-guidance-orchestrator__actions">
      ${
        handlers.highRiskPending && isHighRisk
          ? html`<button
              type="button"
              class="btn primary workbench-guidance-orchestrator__primary"
              data-guidance-primary-cta="confirm"
              data-guidance-high-risk-confirm="true"
              @click=${() => handlers.onHighRiskConfirm(snap)}
            >
              确认高风险操作：${actionLabel(primary)}
            </button>`
          : html`<button
              type="button"
              class="btn primary workbench-guidance-orchestrator__primary"
              data-guidance-primary-cta="true"
              data-guidance-requires-confirm=${isHighRisk ? "true" : "false"}
              @click=${() => {
                if (isHighRisk) {
                  handlers.onRequestHighRiskConfirm(snap);
                  return;
                }
                handlers.onPrimary(snap);
              }}
            >
              ${actionLabel(primary)}
            </button>`
      }
      <button
        type="button"
        class="btn ghost workbench-guidance-orchestrator__defer"
        data-guidance-defer="true"
        @click=${() => handlers.onDefer(snap)}
      >
        稍后处理
      </button>
      <button
        type="button"
        class="btn ghost workbench-guidance-orchestrator__ack"
        data-guidance-acknowledge="true"
        @click=${() => handlers.onAcknowledge(snap)}
      >
        我知道了
      </button>
      ${
        handlers.showResume
          ? html`<button
              type="button"
              class="btn ghost workbench-guidance-orchestrator__resume"
              data-guidance-resume="true"
              @click=${() => handlers.onResume(snap)}
            >
              从进度恢复
            </button>`
          : nothing
      }
      ${
        handlers.showFailureRecover
          ? html`<button
              type="button"
              class="btn ghost workbench-guidance-orchestrator__recover"
              data-guidance-failure-recover="true"
              @click=${() => handlers.onFailureRecover(snap)}
            >
              失败恢复
            </button>`
          : nothing
      }
    </div>
    ${
      optionals.length > 0
        ? html`<details class="workbench-guidance-orchestrator__optional" data-guidance-optional="true">
            <summary>更多建议（${optionals.length}）</summary>
            <ul>
              ${optionals.map(
                (action) => html`<li>
                  <button
                    type="button"
                    class="btn ghost"
                    data-guidance-optional-cta=${action.kind}
                    @click=${() => handlers.onOptional(snap, action)}
                  >
                    ${actionLabel(action)}
                  </button>
                </li>`,
              )}
            </ul>
          </details>`
        : nothing
    }
  </section>`;
}

/** Count primary CTA markers in a rendered root — used by tests. */
export function countGuidancePrimaryCtaMarkers(root: ParentNode): number {
  return root.querySelectorAll("[data-guidance-primary-cta]").length;
}
