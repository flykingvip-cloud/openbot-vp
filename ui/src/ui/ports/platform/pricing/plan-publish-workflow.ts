/**
 * 套餐版本发布工作流步骤条（草稿 → 配置 → 预览 → 激活 → 刷新企业）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";

export type PublishStepStatus = "done" | "current" | "pending";

export type PublishWorkflowInput = {
  hasDraft: boolean;
  hasActiveVersion: boolean;
  configureDone: boolean;
  diffCount: number;
  activationReady: boolean;
  lockedSubscriptions: number;
};

export type PublishStepId = "draft" | "configure" | "preview" | "activate" | "refresh";

const STEP_ORDER: PublishStepId[] = ["draft", "configure", "preview", "activate", "refresh"];

function stepDone(id: PublishStepId, input: PublishWorkflowInput): boolean {
  switch (id) {
    case "draft":
      return input.hasDraft;
    case "configure":
      return input.hasDraft && input.configureDone;
    case "preview":
      return input.hasDraft && input.configureDone && input.diffCount === 0;
    case "activate":
      return input.hasActiveVersion && !input.hasDraft;
    case "refresh":
      return input.hasActiveVersion && input.lockedSubscriptions === 0;
    default:
      return false;
  }
}

export function resolvePublishStepStatuses(
  input: PublishWorkflowInput,
): Record<PublishStepId, PublishStepStatus> {
  const out = {} as Record<PublishStepId, PublishStepStatus>;
  let currentAssigned = false;
  for (const id of STEP_ORDER) {
    if (stepDone(id, input)) {
      out[id] = "done";
      continue;
    }
    if (!currentAssigned) {
      out[id] = "current";
      currentAssigned = true;
    } else {
      out[id] = "pending";
    }
  }
  // 草稿就绪且可激活时，「确认激活」优先高亮
  if (input.hasDraft && input.configureDone && input.activationReady) {
    for (const id of STEP_ORDER) {
      out[id] = stepDone(id, input) ? "done" : "pending";
    }
    out.activate = "current";
  }
  return out;
}

function stepLabel(id: PublishStepId): string {
  switch (id) {
    case "draft":
      return t("platformPricing.publishStepDraft");
    case "configure":
      return t("platformPricing.publishStepConfigure");
    case "preview":
      return t("platformPricing.publishStepPreview");
    case "activate":
      return t("platformPricing.publishStepActivate");
    case "refresh":
      return t("platformPricing.publishStepRefresh");
    default:
      return id;
  }
}

export function renderPlanPublishWorkflow(
  input: PublishWorkflowInput,
  options?: { onStepClick?: (step: PublishStepId) => void },
): TemplateResult {
  const statuses = resolvePublishStepStatuses(input);
  const refreshHint =
    input.lockedSubscriptions > 0
      ? t("platformPricing.publishStepRefreshHint", {
          count: String(input.lockedSubscriptions),
        })
      : null;

  return html`
    <div class="platform-pricing__publish-steps" data-testid="plan-publish-workflow">
      <div class="platform-pricing__publish-steps-title">${t("platformPricing.publishWorkflowTitle")}</div>
      <ol class="platform-pricing__publish-steps-list">
        ${STEP_ORDER.map((id) => {
          const status = statuses[id];
          const clickable = Boolean(options?.onStepClick) && status !== "pending";
          const label = stepLabel(id);
          return html`
            <li
              class="platform-pricing__publish-step platform-pricing__publish-step--${status} ${clickable ? "is-clickable" : ""}"
              data-testid="publish-step-${id}"
              data-status=${status}
            >
              <span class="platform-pricing__publish-step-marker" aria-hidden="true"></span>
              ${
                clickable
                  ? html`
                      <button
                        type="button"
                        class="platform-pricing__publish-step-btn"
                        data-testid="publish-step-btn-${id}"
                        @click=${() => options?.onStepClick?.(id)}
                      >
                        ${label}
                      </button>
                    `
                  : html`<span class="platform-pricing__publish-step-label">${label}</span>`
              }
            </li>
          `;
        })}
      </ol>
      ${
        refreshHint && statuses.refresh !== "done"
          ? html`<p class="muted platform-pricing__publish-steps-hint">${refreshHint}</p>`
          : nothing
      }
    </div>
  `;
}
