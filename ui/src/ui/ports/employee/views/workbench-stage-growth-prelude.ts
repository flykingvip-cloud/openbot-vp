/**
 * Agent Growth OS — 上岗培养 Prelude（P0：唯一主建议 + 详情折叠）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import type {
  GrowthCapabilityGapView,
  GrowthStatusView,
  NextGrowthActionView,
} from "../semantic/view-controller-facade.ts";
import { EMPTY_NEXT_GROWTH_ACTION } from "../semantic/view-controller-facade.ts";
import { renderGrowthBadge } from "./workbench-growth-badge.ts";

/** @deprecated 使用 GrowthCapabilityGapView；保留别名兼容旧测试导入。 */
export type GrowthCapabilityGap = {
  key: string;
  label: string;
  kind: "skill" | "oauth" | "knowledge_binding" | "workflow";
  satisfied: boolean;
  pendingIntegration?: boolean;
};

const ROBOT_DIMENSION_KEYS: Array<keyof GrowthStatusView["dimensions"]> = [
  "identity",
  "capability",
  "knowledge",
  "habits",
  "alignment",
];

function dimensionLabel(key: keyof GrowthStatusView["dimensions"]): string {
  return t(`frontstage.workbench.growth.dimension.${key}`);
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function renderDimensionBar(label: string, value: number): TemplateResult {
  const pct = clampPct(value);
  return html`<div class="workbench-growth-prelude__dim" data-dim-label=${label}>
    <span class="workbench-growth-prelude__dim-label">${label}</span>
    <span class="workbench-growth-prelude__dim-track">
      <span class="workbench-growth-prelude__dim-fill" style=${`width:${pct}%`}></span>
    </span>
    <span class="workbench-growth-prelude__dim-pct">${pct}%</span>
  </div>`;
}

/** 五维 Stepper + lifecycle 徽章（详情折叠内使用）。 */
export function renderGrowthStepper(view: GrowthStatusView): TemplateResult {
  const dims = ROBOT_DIMENSION_KEYS.filter(
    (key) => key !== "alignment" || typeof view.dimensions.alignment === "number",
  );
  const pct = clampPct(view.activationScore);
  return html`<div class="workbench-growth-prelude__stepper">
    <div class="workbench-growth-prelude__stepper-head">
      ${renderGrowthBadge(view)}
      <span class="workbench-growth-prelude__score"
        >${t("frontstage.workbench.growth.activationScore", { pct })}</span
      >
    </div>
    ${dims.map((key) => renderDimensionBar(dimensionLabel(key), view.dimensions[key] ?? 0))}
  </div>`;
}

function gapToLegacy(gap: GrowthCapabilityGapView): GrowthCapabilityGap {
  return {
    key: gap.key,
    label: gap.label,
    kind: gap.kind,
    satisfied: gap.status === "satisfied",
    pendingIntegration: gap.status === "pending_integration",
  };
}

function renderGapList(gaps: GrowthCapabilityGap[]): TemplateResult | typeof nothing {
  if (gaps.length === 0) {
    return nothing;
  }
  return html`<ul class="workbench-growth-prelude__gaps">
    ${gaps.map(
      (gap) => html`<li
        class="workbench-growth-prelude__gap"
        data-gap-key=${gap.key}
        data-gap-satisfied=${gap.satisfied ? "true" : "false"}
      >
        <span class="workbench-growth-prelude__gap-mark">${gap.satisfied ? "✓" : "□"}</span>
        <span class="workbench-growth-prelude__gap-label">${gap.label}</span>
        ${
          gap.pendingIntegration
            ? html`
                <span class="workbench-growth-prelude__gap-pending"
                  >${t("frontstage.workbench.growth.gapPending")}</span
                >
              `
            : nothing
        }
      </li>`,
    )}
  </ul>`;
}

function actionGaps(action: NextGrowthActionView): NextGrowthActionView["gaps"] {
  return Array.isArray(action.gaps) ? action.gaps : [];
}

function recommendationLead(action: NextGrowthActionView): string {
  switch (action.kind) {
    case "start_work":
      return t("frontstage.workbench.growth.recommend.startWork");
    case "confirm_identity":
      return t("frontstage.workbench.growth.recommend.confirmIdentity");
    case "install_capabilities": {
      const count = actionGaps(action).length;
      if (action.reason === "growth.recommend.install_for_task") {
        return t("frontstage.workbench.growth.recommend.installForTask", {
          count,
        });
      }
      return t("frontstage.workbench.growth.recommend.installCapabilities", {
        count,
      });
    }
    case "verify_with_task":
      return t("frontstage.workbench.growth.recommend.verifyWithTask");
    default:
      return t("frontstage.workbench.growth.recommend.none");
  }
}

function recommendationCtaLabel(action: NextGrowthActionView): string {
  switch (action.kind) {
    case "start_work":
      return t("frontstage.workbench.growth.recommend.ctaStartWork");
    case "confirm_identity":
      return t("frontstage.workbench.growth.recommend.ctaConfirmIdentity");
    case "install_capabilities":
      return t("frontstage.workbench.growth.recommend.ctaInstallCapabilities");
    case "verify_with_task":
      return t("frontstage.workbench.growth.recommend.ctaVerifyWithTask");
    default:
      return t("frontstage.workbench.growth.recommend.ctaNone");
  }
}

export type RobotGrowthPreludeProps = {
  view: GrowthStatusView;
  /** 角色名（模板 displayName 或身份名）。 */
  roleName?: string | null;
  /** 服务对象，如「法务团队」。 */
  audience?: string | null;
  /** @deprecated 使用 view.capabilityGaps / recommendation.gaps */
  gaps?: GrowthCapabilityGap[];
  recommendation?: NextGrowthActionView | null;
  onPrimaryAction?: (() => void) | null;
  onStartCultivate?: (() => void) | null;
  onDefineIdentity?: (() => void) | null;
  onInstallCapability?: (() => void) | null;
  onUploadKnowledge?: (() => void) | null;
  onSetHabits?: (() => void) | null;
  onDismiss?: (() => void) | null;
  /** 诞生回合 LLM 问候加载中（13.2）。 */
  awakening?: boolean;
  /**
   * Guidance Orchestrator：唯一主 CTA 表面。提供时压制原生 `data-growth-primary-cta`，
   * 避免与 Daibai/Steward 并列「下一步」。
   */
  orchestratedPrimary?: TemplateResult | typeof nothing | null;
};

/** 机器人上岗培养 Prelude：一张卡、一个主 CTA、详情折叠。 */
export function renderRobotGrowthPrelude(
  props: RobotGrowthPreludeProps,
): TemplateResult | typeof nothing {
  if (!props.view) {
    return nothing;
  }
  const role = props.roleName?.trim() || t("frontstage.workbench.growth.defaultRoleName");
  const action = props.recommendation ?? props.view.recommendation ?? EMPTY_NEXT_GROWTH_ACTION;
  const gaps = actionGaps(action);
  const capabilityGaps = Array.isArray(props.view.capabilityGaps) ? props.view.capabilityGaps : [];
  const gapViews =
    gaps.length > 0 ? gaps : capabilityGaps.filter((gap) => gap.status !== "satisfied");
  const legacyGaps = props.gaps ?? gapViews.slice(0, 3).map(gapToLegacy);
  const unmet = legacyGaps.filter((g) => !g.satisfied).length;
  const useOrchestrated = Boolean(props.orchestratedPrimary);
  const showPrimary =
    !useOrchestrated && action.kind !== "none" && typeof props.onPrimaryAction === "function";

  return html`<section class="workbench-growth-prelude" data-growth-prelude="robot">
    <header class="workbench-growth-prelude__head">
      <h3 class="workbench-growth-prelude__title">
        ${t("frontstage.workbench.growth.robot.onboardingTitle", { role })}
      </h3>
      <p class="workbench-growth-prelude__subtitle">
        ${
          props.audience
            ? t("frontstage.workbench.growth.robot.subtitle", { audience: props.audience })
            : t("frontstage.workbench.growth.robot.onboardingLead")
        }
      </p>
    </header>
    ${
      props.awakening
        ? html`<p class="workbench-growth-prelude__awakening" data-growth-awakening>
            ${t("frontstage.workbench.growth.awakening")}
          </p>`
        : nothing
    }
    <div class="workbench-growth-prelude__summary">
      ${renderGrowthBadge(props.view)}
      <span class="workbench-growth-prelude__score"
        >${t("frontstage.workbench.growth.activationScore", {
          pct: clampPct(props.view.activationScore),
        })}</span
      >
    </div>
    <div class="workbench-growth-prelude__recommend" data-recommend-kind=${action.kind}>
      <p class="workbench-growth-prelude__recommend-lead">${recommendationLead(action)}</p>
      ${
        unmet > 0
          ? html`<div class="workbench-growth-prelude__gaps-block">
            <p class="workbench-growth-prelude__gaps-title">
              ${t("frontstage.workbench.growth.robot.gapsTitle", { count: unmet })}
            </p>
            ${renderGapList(legacyGaps)}
          </div>`
          : nothing
      }
    </div>
    ${useOrchestrated ? props.orchestratedPrimary : nothing}
    <div class="workbench-growth-prelude__cta">
      ${
        showPrimary
          ? html`<button
            type="button"
            class="btn btn--sm btn--primary"
            data-growth-primary-cta
            @click=${() => props.onPrimaryAction?.()}
          >
            ${recommendationCtaLabel(action)}
          </button>`
          : nothing
      }
      ${
        !useOrchestrated && props.onStartCultivate && action.kind === "start_work"
          ? html`<button
            type="button"
            class="btn btn--sm"
            data-growth-cultivate-cta
            @click=${() => props.onStartCultivate?.()}
          >
            ${t("frontstage.workbench.growth.recommend.ctaCultivate")}
          </button>`
          : nothing
      }
      ${
        !useOrchestrated && props.onDismiss
          ? html`<button
            type="button"
            class="btn btn--sm btn--ghost workbench-growth-prelude__dismiss"
            @click=${() => props.onDismiss?.()}
          >
            ${t("frontstage.workbench.growth.dismiss")}
          </button>`
          : nothing
      }
    </div>
    <details class="workbench-growth-prelude__details">
      <summary>${t("frontstage.workbench.growth.robot.progressDetails")}</summary>
      ${renderGrowthStepper(props.view)}
      ${renderGapList((props.view.capabilityGaps ?? []).map(gapToLegacy))}
      <div class="workbench-growth-prelude__detail-actions">
        <button type="button" class="btn btn--sm" @click=${() => props.onDefineIdentity?.()}>
          ${t("frontstage.workbench.growth.robot.defineIdentity")}
        </button>
        <button type="button" class="btn btn--sm" @click=${() => props.onInstallCapability?.()}>
          ${t("frontstage.workbench.growth.robot.installCapability")}
        </button>
        <button type="button" class="btn btn--sm" @click=${() => props.onUploadKnowledge?.()}>
          ${t("frontstage.workbench.growth.robot.uploadKnowledge")}
        </button>
        <button type="button" class="btn btn--sm" @click=${() => props.onSetHabits?.()}>
          ${t("frontstage.workbench.growth.robot.setHabits")}
        </button>
      </div>
    </details>
  </section>`;
}

export type TeamGrowthPreludeProps = {
  teamName?: string | null;
  onStartCollaboration?: (() => void) | null;
  onDismiss?: (() => void) | null;
};

export function renderTeamAwakeningPrelude(
  props: TeamGrowthPreludeProps,
): TemplateResult | typeof nothing {
  const team = props.teamName?.trim() || t("frontstage.workbench.growth.defaultRoleName");
  return html`<section class="workbench-growth-prelude" data-growth-prelude="team">
    <header class="workbench-growth-prelude__head">
      <h3 class="workbench-growth-prelude__title">
        ${t("frontstage.workbench.growth.team.title", { team })}
      </h3>
      <p class="workbench-growth-prelude__subtitle">
        ${t("frontstage.workbench.growth.team.welcomeBody")}
      </p>
    </header>
    <div class="workbench-growth-prelude__cta">
      ${
        props.onStartCollaboration
          ? html`<button
            type="button"
            class="btn btn--sm btn--primary"
            @click=${() => props.onStartCollaboration?.()}
          >
            ${t("frontstage.workbench.growth.team.startCollaboration")}
          </button>`
          : nothing
      }
      ${
        props.onDismiss
          ? html`<button
            type="button"
            class="btn btn--sm btn--ghost"
            @click=${() => props.onDismiss?.()}
          >
            ${t("frontstage.workbench.growth.dismiss")}
          </button>`
          : nothing
      }
    </div>
  </section>`;
}
