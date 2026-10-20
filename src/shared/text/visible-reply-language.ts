/**
 * Final-answer language enforcement.
 *
 * A normal English answer is not a planning draft, so the scratchpad cleaner
 * keeps it. When the turn asked for Chinese and the visible text is still
 * mostly Latin (after code, URLs, and product tokens), one rewrite pass
 * produces the text that live, persist, history, and channels share.
 */

export type VisibleReplyLanguage = "zh" | "en";

export const VISIBLE_REPLY_CJK_REWRITE_THRESHOLD = 0.2;

const REWRITE_PROMPT_PREFIX = "把下面的回复改写成中文，保留事实、数字和专名，不要加解释。";

export type VisibleReplyRewriter = (text: string) => Promise<string>;

const rewriters = new Map<string, VisibleReplyRewriter>();
const pendingByText = new Map<string, Promise<string>>();
const resolvedByText = new Map<string, string>();

function stripNonLanguageNoise(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:[A-Z]{2,}(?:\.[A-Z]{2,})*|[A-Za-z]*\d[A-Za-z0-9]*)\b/g, " ");
}

/** Han / (Han + Latin) after dropping code, URLs, and product-name tokens. */
export function visibleReplyCjkRatio(text: string): number {
  const stripped = stripNonLanguageNoise(text);
  const han = stripped.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latin = stripped.match(/[A-Za-z]/g)?.length ?? 0;
  if (han + latin === 0) {
    return 1;
  }
  return han / (han + latin);
}

export function visibleReplyNeedsChineseRewrite(
  text: string,
  expectedLanguage: VisibleReplyLanguage | null,
): boolean {
  if (expectedLanguage !== "zh") {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  return visibleReplyCjkRatio(trimmed) < VISIBLE_REPLY_CJK_REWRITE_THRESHOLD;
}

export function registerVisibleReplyRewriter(
  runId: string,
  rewriter: VisibleReplyRewriter,
): () => void {
  if (!runId) {
    return () => {};
  }
  rewriters.set(runId, rewriter);
  return () => {
    if (rewriters.get(runId) === rewriter) {
      rewriters.delete(runId);
    }
  };
}

export function resetVisibleReplyLanguageForTest(): void {
  rewriters.clear();
  pendingByText.clear();
  resolvedByText.clear();
}

export function visibleReplyRewritePrompt(text: string): string {
  return `${REWRITE_PROMPT_PREFIX}\n\n${text}`;
}

/**
 * One rewrite per distinct source text. Later callers (persist, live final,
 * channel payloads) share the in-flight promise. History uses the resolved
 * cache and never starts a model call.
 */
export async function enforceVisibleReplyLanguage(params: {
  text: string;
  expectedLanguage: VisibleReplyLanguage | null;
  runId?: string;
  allowModel?: boolean;
}): Promise<string> {
  const text = params.text;
  if (!visibleReplyNeedsChineseRewrite(text, params.expectedLanguage)) {
    return text;
  }
  const resolved = resolvedByText.get(text);
  if (resolved) {
    return resolved;
  }
  const pending = pendingByText.get(text);
  if (pending) {
    return pending;
  }
  if (params.allowModel === false) {
    return text;
  }
  const rewriter = params.runId ? rewriters.get(params.runId) : undefined;
  if (!rewriter) {
    return text;
  }
  const task = rewriter(text)
    .then((out) => {
      const next = out.trim();
      if (!next || visibleReplyNeedsChineseRewrite(next, "zh")) {
        return text;
      }
      resolvedByText.set(text, next);
      return next;
    })
    .catch(() => text);
  pendingByText.set(text, task);
  return task;
}

/** History path: same decision, cache only, no model call. */
export function enforceVisibleReplyLanguageFromCache(params: {
  text: string;
  expectedLanguage: VisibleReplyLanguage | null;
}): string {
  if (!visibleReplyNeedsChineseRewrite(params.text, params.expectedLanguage)) {
    return params.text;
  }
  return resolvedByText.get(params.text) ?? params.text;
}

export async function enforceVisibleReplyTexts(params: {
  texts: string[];
  expectedLanguage: VisibleReplyLanguage | null;
  runId?: string;
}): Promise<string[]> {
  if (params.expectedLanguage !== "zh" || params.texts.length === 0) {
    return params.texts;
  }
  const joined = params.texts.join("\n\n").trim();
  if (!joined) {
    return params.texts;
  }
  const rewritten = await enforceVisibleReplyLanguage({
    text: joined,
    expectedLanguage: "zh",
    runId: params.runId,
  });
  if (!rewritten || rewritten === joined) {
    return params.texts;
  }
  return [rewritten];
}
