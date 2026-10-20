/**
 * Agent Growth OS — 入站反馈采集咽喉点（fire-and-forget，绝不影响回复）。
 *
 * 把确定性检测（`feedback-signal.ts`）接到运营指标累加器上，为
 * `humanTakeoverRate` 与 `satisfaction` 提供真实信号源。
 */

import type { OpenBotConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { deriveInboundFeedbackSignals, hasInboundFeedbackSignal } from "./feedback-signal.js";
import { recordFeedbackObservation } from "./operational-metrics-store.js";

export type RecordInboundFeedbackParams = {
  cfg: OpenBotConfig;
  agentId: string;
  text: string;
  sessionEntry?: SessionEntry;
  sessionKey?: string;
  /**
   * 注入的经验提炼回调（默认接 experience backflow）。
   * 参数化是为了避免 agent-growth → auto-reply 的反向静态依赖。
   */
  onHumanTakeover?: (input: { matched?: string }) => void;
};

export async function recordInboundFeedback(params: RecordInboundFeedbackParams): Promise<void> {
  const signals = deriveInboundFeedbackSignals(params.text);
  if (!hasInboundFeedbackSignal(signals)) {
    return;
  }
  await recordFeedbackObservation(params.cfg, params.agentId, {
    ...(signals.humanTakeover !== undefined ? { humanTakeover: signals.humanTakeover } : {}),
    ...(signals.sentiment ? { sentiment: signals.sentiment } : {}),
  });
  // 人工接管是最强的「我干得不好」信号，同时产出候选经验胶囊（需审批）。
  if (signals.humanTakeover === true) {
    params.onHumanTakeover?.(signals.matched ? { matched: signals.matched } : {});
  }
  logVerbose(
    `agent growth feedback: agent=${params.agentId} takeover=${signals.humanTakeover ?? "n/a"} ` +
      `sentiment=${signals.sentiment ?? "neutral"} matched=${signals.matched ?? "none"}`,
  );
}

/** 永不 reject 的包装，供回复主链路 fire-and-forget 调用。 */
export function recordInboundFeedbackSafely(params: RecordInboundFeedbackParams): void {
  void recordInboundFeedback(params).catch((err) => {
    logVerbose(`agent growth feedback failed: ${String(err)}`);
  });
}
