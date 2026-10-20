/**
 * Floor Runtime v2.1 §6.4 P1-C — useful-v1.
 *
 * A post is useful only when all four rules hold. Any change to those rules
 * must bump QUALITY_CLASSIFIER_VERSION (do not compare metrics across versions).
 */
import { classifyPlaceholderReply } from "./completion-contract.js";
import type { EpisodeDecisionNeedSource } from "./need-resolver.js";

export const QUALITY_CLASSIFIER_VERSION = "useful-v1" as const;

/** Strictly less than this 4-gram Jaccard vs any earlier visible post. */
export const USEFUL_V1_JACCARD_MAX = 0.55;
/** Strictly less than this cosine when both posts have an embedding. */
export const USEFUL_V1_COSINE_MAX = 0.9;
export const USEFUL_V1_MIN_EFFECTIVE_CHARS = 8;
const NGRAM_SIZE = 4;

export type QualityRuleId =
  | "no_reply_or_placeholder_or_duplicate"
  | "near_duplicate"
  | "pure_courtesy"
  | "need_intent";

export type QualityPost = {
  agentId: string;
  text: string;
  atMs?: number;
  /** Present only when the caller computed one. Missing → Jaccard only. */
  embedding?: readonly number[] | null;
  noReply?: boolean;
  placeholder?: boolean;
  duplicateSuppressed?: boolean;
};

export type QualityClassifyInput = {
  posts: readonly QualityPost[];
  /** Need source for rule 4. `none` is not a Need scene. */
  needSource: EpisodeDecisionNeedSource;
  /** Human trigger text. Mention / labeled scenes must respond to it. */
  triggerText?: string;
  /** Task or artifact ids that count as a citation in a task Need scene. */
  taskRefs?: readonly string[];
  artifactRefs?: readonly string[];
};

export type QualityPostVerdict = {
  agentId: string;
  useful: boolean;
  failedRules: QualityRuleId[];
};

const COURTESY_WORDS = [
  "大家好",
  "各位好",
  "你好",
  "您好",
  "谢谢",
  "感谢",
  "辛苦了",
  "辛苦",
  "收到",
  "好的",
  "thanks",
  "thankyou",
  "hello",
  "hey",
  "hi",
  "ok",
  "okay",
  "各位",
  "大家",
  "嗯",
  "哦",
  "啊",
];

const ROLL_CALL_TEMPLATE_RE = /^(?:报到|我到了|我在的?|在的|到)[!！。.]?$|^我是|^我叫|自我介绍/u;
const SELF_INTRO_RE = /我是|我叫|自我介绍|我负责|我的职责|职责是|我可以|I am\b|I'm\b|my role/iu;
const TASK_CITE_RE =
  /(?:\btask[-_:：]\s*[A-Za-z0-9][\w-]*|\bartifact[-_:：]\s*[A-Za-z0-9][\w-]*|任务\s*[#＃:：]\s*\S+|交付物\s*[#＃:：]?\s*\S+)/iu;

function codePoints(text: string): string[] {
  return Array.from(text);
}

/**
 * True for the canonical NO_REPLY token and common Chinese paraphrases models
 * emit instead (e.g. 「无需回复」). Those must not post as visible group replies
 * when mentionBotMustRespond is on — they are silence, not content.
 */
export function isNoReplyText(text: string): boolean {
  const compact = text.trim().replace(/[`*]+/g, "").replace(/\s+/g, "");
  if (!compact) {
    return false;
  }
  if (/^NO_REPLY$/i.test(compact)) {
    return true;
  }
  // Exact-phrase Chinese silence (no extra payload). Keep narrow to avoid
  // suppressing real sentences that merely contain these words.
  return /^(?:无需回复|不用回复|不必回复|无增量|没有增量|无增量可补充|暂无增量)$/u.test(compact);
}

export function charNgramSet(text: string, n = NGRAM_SIZE): Set<string> {
  const compact = text.replace(/\s+/g, "").toLowerCase();
  const chars = codePoints(compact);
  if (chars.length === 0) {
    return new Set();
  }
  if (chars.length < n) {
    return new Set([chars.join("")]);
  }
  const grams = new Set<string>();
  for (let i = 0; i <= chars.length - n; i += 1) {
    grams.add(chars.slice(i, i + n).join(""));
  }
  return grams;
}

export function jaccardSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const gram of left) {
    if (right.has(gram)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number | null {
  if (left.length === 0 || left.length !== right.length) {
    return null;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return null;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/** True when similarity violates useful-v1 (Jaccard ≥ 0.55, or cosine ≥ 0.90 when present). */
export function exceedsSimilarityCeiling(params: {
  jaccard: number;
  cosine: number | null;
}): boolean {
  if (params.jaccard >= USEFUL_V1_JACCARD_MAX) {
    return true;
  }
  return params.cosine !== null && params.cosine >= USEFUL_V1_COSINE_MAX;
}

function usableEmbedding(value: readonly number[] | null | undefined): readonly number[] | null {
  if (
    !value ||
    value.length === 0 ||
    value.some((n) => typeof n !== "number" || !Number.isFinite(n))
  ) {
    return null;
  }
  return value;
}

export function effectiveCourtesyResidue(text: string): string {
  let compact = text.replace(/@\S+/g, "").replace(/\s+/g, "").toLowerCase();
  const words = [...COURTESY_WORDS].toSorted((a, b) => b.length - a.length);
  for (const word of words) {
    const needle = word.toLowerCase();
    if (/^[a-z]+$/i.test(needle)) {
      compact = compact.replace(new RegExp(`(?<![a-z])${needle}(?![a-z])`, "gu"), "");
      continue;
    }
    compact = compact.split(needle).join("");
  }
  return compact.replace(/[，。,.!！?？:：；;、~～"'“”‘’()（）[\]【】]/gu, "");
}

export function hitsRollCallTemplate(text: string): boolean {
  const compact = text.replace(/\s+/g, "").trim();
  return ROLL_CALL_TEMPLATE_RE.test(compact);
}

export function hasSelfIntroduction(text: string): boolean {
  return SELF_INTRO_RE.test(text);
}

export function citesTaskOrArtifact(text: string, refs: readonly string[] | undefined): boolean {
  for (const ref of refs ?? []) {
    const id = ref.trim();
    if (id.length >= 2 && text.includes(id)) {
      return true;
    }
  }
  return TASK_CITE_RE.test(text);
}

function contentTokens(text: string): string[] {
  const tokens: string[] = [];
  const cjkRuns = text.match(/[\u3400-\u9fff]+/gu) ?? [];
  for (const run of cjkRuns) {
    for (let i = 0; i <= run.length - 2; i += 1) {
      const gram = run.slice(i, i + 2);
      if (!COURTESY_WORDS.includes(gram)) {
        tokens.push(gram);
      }
    }
  }
  const latin = text.toLowerCase().match(/[a-z0-9]{3,}/gu) ?? [];
  for (const token of latin) {
    if (!COURTESY_WORDS.includes(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

function respondsToTrigger(postText: string, triggerText: string | undefined): boolean {
  const trigger = triggerText?.trim() ?? "";
  if (!trigger) {
    return true;
  }
  const tokens = contentTokens(trigger);
  if (tokens.length === 0) {
    return true;
  }
  const haystack = postText.toLowerCase();
  return tokens.some((token) => haystack.includes(token.toLowerCase()));
}

function passesNeedIntent(text: string, input: QualityClassifyInput): boolean {
  if (input.needSource === "none") {
    return true;
  }
  if (input.needSource === "roll_call") {
    return hasSelfIntroduction(text);
  }
  if (input.needSource === "task") {
    return citesTaskOrArtifact(text, [...(input.taskRefs ?? []), ...(input.artifactRefs ?? [])]);
  }
  return respondsToTrigger(text, input.triggerText);
}

/** Fixed preflight stop lines (alias unresolved / goal unclear) must not poison retry posts. */
function isSkillClarificationStopText(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return (
    compact.includes("这一步有两个做法，请指定用哪一个") ||
    compact.includes("请补充这次要交付的具体结果") ||
    compact.includes("有多个做法同时命中，请指定一个") ||
    compact.includes("这个做法当前不可用")
  );
}

function isVisibleComparisonTarget(post: QualityPost): boolean {
  if (post.noReply || post.duplicateSuppressed || isNoReplyText(post.text)) {
    return false;
  }
  if (isSkillClarificationStopText(post.text)) {
    return false;
  }
  return post.text.trim().length > 0;
}

function failsNearDuplicate(post: QualityPost, earlier: readonly QualityPost[]): boolean {
  const currentGrams = charNgramSet(post.text);
  const currentEmbedding = usableEmbedding(post.embedding);
  for (const previous of earlier) {
    if (!isVisibleComparisonTarget(previous)) {
      continue;
    }
    const jaccard = jaccardSimilarity(currentGrams, charNgramSet(previous.text));
    const previousEmbedding = usableEmbedding(previous.embedding);
    const cosine =
      currentEmbedding && previousEmbedding
        ? cosineSimilarity(currentEmbedding, previousEmbedding)
        : null;
    if (exceedsSimilarityCeiling({ jaccard, cosine })) {
      return true;
    }
  }
  return false;
}

function verdictFor(
  post: QualityPost,
  earlier: readonly QualityPost[],
  input: QualityClassifyInput,
): QualityPostVerdict {
  const failed: QualityRuleId[] = [];
  const substantiveFail =
    post.noReply === true ||
    post.placeholder === true ||
    post.duplicateSuppressed === true ||
    isNoReplyText(post.text) ||
    classifyPlaceholderReply(post.text);
  if (substantiveFail) {
    failed.push("no_reply_or_placeholder_or_duplicate");
  }
  if (failsNearDuplicate(post, earlier)) {
    failed.push("near_duplicate");
  }
  const residue = effectiveCourtesyResidue(post.text);
  const courtesyFail =
    residue.length < USEFUL_V1_MIN_EFFECTIVE_CHARS && !hitsRollCallTemplate(post.text);
  if (courtesyFail) {
    failed.push("pure_courtesy");
  }
  if (!passesNeedIntent(post.text, input)) {
    failed.push("need_intent");
  }
  return { agentId: post.agentId, useful: failed.length === 0, failedRules: failed };
}

export function classifyUsefulPosts(input: QualityClassifyInput): QualityPostVerdict[] {
  const ordered = input.posts
    .map((post, index) => ({ post, index }))
    .toSorted((left, right) => {
      const leftAt = left.post.atMs ?? left.index;
      const rightAt = right.post.atMs ?? right.index;
      if (leftAt !== rightAt) {
        return leftAt - rightAt;
      }
      return left.index - right.index;
    });
  const earlier: QualityPost[] = [];
  const verdicts: QualityPostVerdict[] = [];
  for (const entry of ordered) {
    verdicts.push(verdictFor(entry.post, earlier, input));
    earlier.push(entry.post);
  }
  return verdicts;
}
