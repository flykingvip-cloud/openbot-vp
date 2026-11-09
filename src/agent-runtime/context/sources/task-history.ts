import {
  applyContextCutWithOptionalArticlePreserve,
  type PreserveArticleOptions,
} from "./preserved-article.js";
/**
 * Park / resume / cancel notice. Written after the user turn as a system
 * separator. Model history drops it so the run does not see an assistant
 * "开始某标题" turn.
 */
export function isTaskStatusSeparatorMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const row = message as { taskStatusSeparator?: unknown; taskStatusLine?: unknown };
  return row.taskStatusSeparator === true || row.taskStatusLine === true;
}

export function omitTaskStatusSeparators<T>(messages: readonly T[]): T[] {
  return messages.filter((message) => !isTaskStatusSeparatorMessage(message));
}

/** User text first, then the system separator. History refresh keeps this order. */
export function transcriptEntriesForInboundTurn(params: {
  userMessage: Record<string, unknown>;
  taskStatusLine?: string;
}): Array<Record<string, unknown>> {
  const line = params.taskStatusLine?.trim() ?? "";
  if (!line) {
    return [params.userMessage];
  }
  return [
    params.userMessage,
    {
      role: "system",
      content: [{ type: "text", text: line }],
      taskStatusLine: true,
      taskStatusSeparator: true,
    },
  ];
}

/** A real switch sets contextCut on the new turn. Fence text is not the cut. */
export function omitParkedPriorTurns<T>(
  messages: readonly T[],
  options?: PreserveArticleOptions,
): T[] {
  let cutAt = -1;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!message || typeof message !== "object") {
      continue;
    }
    const row = message as { contextCut?: unknown; taskSwitch?: unknown };
    if (row.contextCut === true || row.taskSwitch === true) {
      cutAt = i;
    }
  }
  if (cutAt <= 0) {
    return [...messages];
  }
  return applyContextCutWithOptionalArticlePreserve(messages, cutAt, options);
}
