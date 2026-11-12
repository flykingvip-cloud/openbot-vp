export const REJECTED_INTERACTION_TURN_TEXT =
  "本轮未形成可执行的决定，没有启动新任务。本轮请求已结束，不会自动补做；如需重试，请明确提出。";

/** Only pre-admission protocol failures may attest that no new task started. */
export async function persistRejectedInteractionTurn(params: {
  error: unknown;
  runId: string;
  append: (message: string, idempotencyKey: string) => Promise<{ ok: boolean }>;
}): Promise<{ persisted: boolean; text?: string }> {
  const message = params.error instanceof Error ? params.error.message : "";
  if (
    !/^(?:Invalid interaction (?:decision|reply|answer|target|task decision|acceptance checks)|Interaction target is not bound to this request|Interaction did not return a final decision|本轮未取得有效的交互决定，没有启动或修改任务。)$/.test(
      message,
    )
  ) {
    return { persisted: false };
  }
  // This exact gate also owns the persisted terminal. Keep diagnostics here so
  // a host adapter cannot drop the source by converting an error between modules.
  console.warn(
    "[interaction-rejection-source]",
    JSON.stringify({
      validation: message,
      stack: (params.error as Error).stack?.split("\n").slice(1, 7),
    }),
  );
  try {
    const result = await params.append(
      REJECTED_INTERACTION_TURN_TEXT,
      `${params.runId}:interaction-rejected`,
    );
    return { persisted: result.ok, ...(result.ok ? { text: REJECTED_INTERACTION_TURN_TEXT } : {}) };
  } catch {
    return { persisted: false };
  }
}
