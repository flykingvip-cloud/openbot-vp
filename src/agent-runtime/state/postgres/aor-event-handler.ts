import { recordAorFeedbackEvent } from "../../../gateway/model-entitlement/aor-feedback.js";

/** Projection destination is trusted host configuration, never event-controlled filesystem path. */
export function createAorEventHandler(banditStatePath: string) {
  if (!banditStatePath.trim()) {
    throw new Error("AOR consumer requires configured projection target");
  }
  return async (
    eventId: string,
    _executionId: string,
    feedback: Record<string, unknown>,
  ): Promise<void> => {
    const { provider, model, taskTypeId, score, costUsd } = feedback;
    if (
      typeof provider !== "string" ||
      typeof model !== "string" ||
      typeof taskTypeId !== "string" ||
      (score !== undefined &&
        (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1)) ||
      (costUsd !== undefined &&
        (typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0))
    ) {
      throw new Error("Invalid AOR feedback event");
    }
    recordAorFeedbackEvent({
      eventId,
      banditStatePath,
      provider,
      model,
      taskTypeId,
      ...(typeof score === "number" ? { score } : {}),
      ...(typeof costUsd === "number" ? { costUsd } : {}),
    });
  };
}
