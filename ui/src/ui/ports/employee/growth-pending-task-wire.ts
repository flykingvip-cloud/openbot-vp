/**
 * P1：任务草稿 stash / 「继续原任务」条 / resume（不 auto-send）。
 */

import {
  analyzeGrowthTask,
  clearGrowthPendingTask,
  recomputeGrowth,
  type AgentGrowthClientState,
  type GrowthPendingTaskContextView,
  type GrowthStatusView,
} from "../../controllers/agent-growth.ts";
import type { GrowthPreludeWireHost } from "./growth-prelude-wire.ts";
import { resolveGrowthEntityFromSessionKey } from "./growth-session-sync.ts";

export type GrowthPendingTaskHost = GrowthPreludeWireHost &
  AgentGrowthClientState & {
    workbenchGrowthPendingTask?: GrowthPendingTaskContextView | null;
    workbenchGrowthContinueBannerVisible?: boolean;
    workbenchGrowthContinueSkippedEnhance?: boolean;
    workbenchGrowthGateProceedAuthorized?: boolean;
  };

function notify(host: GrowthPendingTaskHost) {
  host.requestUpdate?.();
}

function truncateDraft(text: string, max = 48): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

export function stashGrowthPendingTaskLocal(
  host: GrowthPendingTaskHost,
  draftText: string,
  extras?: Partial<GrowthPendingTaskContextView>,
): void {
  const draft = draftText.trim();
  if (!draft) {
    return;
  }
  host.workbenchGrowthPendingTask = {
    draftText: draft,
    source: extras?.source ?? "composer",
    suggestedSkillKeys: extras?.suggestedSkillKeys ?? [],
    taskGaps: extras?.taskGaps ?? [],
    extractedAtMs: extras?.extractedAtMs ?? Date.now(),
    extractStatus: extras?.extractStatus ?? "failed_fallback",
  };
}

export function showGrowthContinueBanner(
  host: GrowthPendingTaskHost,
  options?: { skippedEnhance?: boolean },
): void {
  const draft =
    host.workbenchGrowthPendingTask?.draftText?.trim() ||
    host.workbenchActiveGrowthStatus?.pendingTaskContext?.draftText?.trim() ||
    "";
  if (!draft) {
    return;
  }
  if (!host.workbenchGrowthPendingTask && host.workbenchActiveGrowthStatus?.pendingTaskContext) {
    host.workbenchGrowthPendingTask = host.workbenchActiveGrowthStatus.pendingTaskContext;
  }
  host.workbenchGrowthContinueBannerVisible = true;
  host.workbenchGrowthContinueSkippedEnhance = options?.skippedEnhance === true;
  notify(host);
}

/**
 * 恢复草稿并授权门控放行（由调用方决定是否立即 send）。
 * 调用方 send 时仍应显式传 growthGateProceed:true，避免 options 链路丢失。
 */
export function resumeGrowthPendingTask(
  host: GrowthPendingTaskHost,
  options?: { proceed?: boolean },
): void {
  const draft =
    host.workbenchGrowthPendingTask?.draftText?.trim() ||
    host.workbenchActiveGrowthStatus?.pendingTaskContext?.draftText?.trim() ||
    "";
  if (!draft) {
    return;
  }
  host.chatMessage = draft;
  host.workbenchGrowthContinueBannerVisible = false;
  // 默认 proceed=true：增强后「继续原任务」必须授权下一次 chat.send。
  if (options?.proceed !== false) {
    host.workbenchGrowthGateProceedAuthorized = true;
  }
  notify(host);
  queueMicrotask(() => {
    const el = document.querySelector<HTMLElement>(
      "textarea, [contenteditable='true'], .chat-compose textarea, .composer textarea",
    );
    el?.focus?.();
  });
}

/** 「先做再说」：授权放行并恢复草稿，供立即 send。 */
export function proceedGrowthTaskWithoutEnhance(host: GrowthPendingTaskHost): string {
  const draft =
    host.workbenchGrowthPendingTask?.draftText?.trim() ||
    host.workbenchActiveGrowthStatus?.pendingTaskContext?.draftText?.trim() ||
    host.chatMessage.trim();
  host.workbenchGrowthGateProceedAuthorized = true;
  host.workbenchGrowthContinueBannerVisible = false;
  host.workbenchGrowthContinueSkippedEnhance = true;
  if (draft) {
    host.chatMessage = draft;
    stashGrowthPendingTaskLocal(host, draft, {
      source: host.workbenchGrowthPendingTask?.source ?? "composer",
    });
  }
  notify(host);
  return draft;
}

export async function dismissGrowthContinueBanner(host: GrowthPendingTaskHost): Promise<void> {
  host.workbenchGrowthContinueBannerVisible = false;
  host.workbenchGrowthContinueSkippedEnhance = false;
  host.workbenchGrowthGateProceedAuthorized = false;
  host.workbenchGrowthPendingTask = null;
  notify(host);
  const ref = resolveGrowthEntityFromSessionKey(host.sessionKey);
  if (ref?.kind === "robot") {
    const next = await clearGrowthPendingTask(host, ref.entityId);
    if (next) {
      host.workbenchActiveGrowthStatus = next;
      notify(host);
    }
  }
}

export function resolveGrowthContinueBanner(host: GrowthPendingTaskHost): {
  draftPreview: string;
  skippedEnhance: boolean;
  /** 门控阻断：需要选增强或先做再说（尚未授权 proceed）。 */
  gateBlocked: boolean;
  recommendedCount: number;
} | null {
  if (!host.workbenchGrowthContinueBannerVisible) {
    return null;
  }
  const draft =
    host.workbenchGrowthPendingTask?.draftText?.trim() ||
    host.workbenchActiveGrowthStatus?.pendingTaskContext?.draftText?.trim() ||
    "";
  if (!draft) {
    return null;
  }
  const unmet =
    host.workbenchGrowthPendingTask?.taskGaps?.filter((gap) => gap.status === "missing") ??
    host.workbenchActiveGrowthStatus?.pendingTaskContext?.taskGaps?.filter(
      (gap) => gap.status === "missing",
    ) ??
    [];
  const gateBlocked = unmet.length > 0 && host.workbenchGrowthGateProceedAuthorized !== true;
  return {
    draftPreview: truncateDraft(draft),
    skippedEnhance: host.workbenchGrowthContinueSkippedEnhance === true,
    gateBlocked,
    recommendedCount: unmet.length || (host.workbenchRecommendedSkillKeys?.length ?? 0),
  };
}

/** install CTA：stash → analyze（有草稿）→ 开 skills。 */
export async function beginInstallCapabilitiesFlow(
  host: GrowthPendingTaskHost,
  recommendedSkillKeys: string[],
): Promise<void> {
  const draft = host.chatMessage.trim();
  const ref = resolveGrowthEntityFromSessionKey(host.sessionKey);
  if (draft) {
    stashGrowthPendingTaskLocal(host, draft, { source: "composer" });
  }
  if (ref?.kind === "robot" && draft) {
    const next = await analyzeGrowthTask(host, ref.entityId, draft, "composer");
    if (next) {
      host.workbenchActiveGrowthStatus = next;
      if (next.pendingTaskContext) {
        host.workbenchGrowthPendingTask = next.pendingTaskContext;
      }
      const keys = next.recommendation?.target.recommendedSkillKeys?.length
        ? next.recommendation.target.recommendedSkillKeys
        : recommendedSkillKeys;
      host.workbenchRecommendedSkillKeys = keys;
    } else {
      host.workbenchRecommendedSkillKeys = recommendedSkillKeys;
    }
  } else {
    host.workbenchRecommendedSkillKeys = recommendedSkillKeys;
  }
  host.workbenchPrimaryModule = "assistant";
  host.workbenchRobotWorkbenchTab = "skills";
  notify(host);
}

/** 跳过增强：保留草稿并显示续跑条。 */
export function skipEnhanceAndShowContinue(host: GrowthPendingTaskHost): void {
  const draft =
    host.chatMessage.trim() ||
    host.workbenchGrowthPendingTask?.draftText?.trim() ||
    host.workbenchActiveGrowthStatus?.pendingTaskContext?.draftText?.trim() ||
    "";
  if (draft) {
    stashGrowthPendingTaskLocal(host, draft, {
      source: host.workbenchGrowthPendingTask?.source ?? "composer",
    });
  }
  showGrowthContinueBanner(host, { skippedEnhance: true });
}

/** 技能安装成功后：recompute + 显条；缺口已满足时预授权下一次续跑。 */
export async function afterRobotSkillInstallForGrowth(host: GrowthPendingTaskHost): Promise<void> {
  const ref = resolveGrowthEntityFromSessionKey(host.sessionKey);
  if (ref?.kind === "robot") {
    const next = await recomputeGrowth(host, ref, {
      preferCultivate: host.workbenchGrowthPreferCultivate === true,
    });
    if (next) {
      host.workbenchActiveGrowthStatus = next;
      if (next.pendingTaskContext) {
        host.workbenchGrowthPendingTask = next.pendingTaskContext;
      }
    }
  }
  const hasPending =
    Boolean(host.workbenchGrowthPendingTask?.draftText?.trim()) ||
    Boolean(host.workbenchActiveGrowthStatus?.pendingTaskContext?.draftText?.trim());
  if (hasPending) {
    const unmet =
      host.workbenchGrowthPendingTask?.taskGaps?.filter((gap) => gap.status === "missing") ??
      host.workbenchActiveGrowthStatus?.pendingTaskContext?.taskGaps?.filter(
        (gap) => gap.status === "missing",
      ) ??
      [];
    // 安装后缺口已清空：预授权，避免「继续原任务」再被门控拦截。
    if (unmet.length === 0) {
      host.workbenchGrowthGateProceedAuthorized = true;
    }
    showGrowthContinueBanner(host);
  } else {
    notify(host);
  }
}

export function syncPendingFromGrowthStatus(
  host: GrowthPendingTaskHost,
  view: GrowthStatusView | null,
): void {
  if (view?.pendingTaskContext?.draftText) {
    host.workbenchGrowthPendingTask = view.pendingTaskContext;
  }
}
