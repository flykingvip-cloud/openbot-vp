/**
 * Fuzzy Matcher for mention candidates.
 *
 * Filters and ranks `MentionCandidate`s against a query string using a
 * three-tier scoring system (prefix > substring > subsequence). Ties prefer
 * stronger collaboration signals before online status and alphabetical order.
 *
 * Pinyin Support (MVP placeholder):
 * ---------------------------------
 * Chinese-to-Chinese matching works out of the box (both query and text are
 * compared as Unicode strings). ASCII-query → Chinese-text pinyin matching is
 * supported via:
 *   1. A tiny built-in map of common surnames/characters (`COMMON_PINYIN`),
 *      enough to demo the feature without pulling a heavy pinyin library.
 *   2. A `setPinyinProvider()` hook allowing callers to inject a richer
 *      pinyin dictionary (e.g. `pinyin-pro`) at bootstrap without modifying
 *      this module.
 *
 * TODO(MVP): a proper pinyin library (e.g. `pinyin-pro`) should be wired via
 * `setPinyinProvider` in Phase 4 for full coverage. The built-in dictionary
 * intentionally covers only common surnames to keep bundle size small.
 *
 * Validates: Requirements 2.1, 2.2, 2.5.
 */

import type {
  MatchResult,
  MentionCandidate,
} from "../../../../../src/organization/mention-types.js";

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

const MATCH_SCORE = {
  prefix: 100,
  substring: 80,
  subsequence: 60,
} as const;

/** Field priority for tie-breaking when the same score is reached via
 *  multiple fields. Higher wins. */
const FIELD_PRIORITY: Record<MatchResult["matchedField"], number> = {
  displayName: 5,
  roleName: 4,
  capabilityTags: 3,
  currentTask: 2,
  agentId: 1,
};

// ---------------------------------------------------------------------------
// Pinyin support (MVP)
// ---------------------------------------------------------------------------

/** Signature for a pluggable pinyin provider. Given a string that may contain
 *  Chinese characters, return an array of pinyin syllables (one per Han char)
 *  plus pass-through for non-Han characters. The provider is responsible for
 *  casing — values are lowercased here before use. */
export type PinyinProvider = (text: string) => string[];

/** Tiny built-in pinyin dictionary. Covers common surnames / characters so
 *  typical Chinese display names match when users type ASCII. Full coverage
 *  requires injecting a real library via `setPinyinProvider`. */
const COMMON_PINYIN: Record<string, string> = {
  阿: "a",
  安: "an",
  白: "bai",
  北: "bei",
  本: "ben",
  陈: "chen",
  程: "cheng",
  大: "da",
  东: "dong",
  杜: "du",
  冯: "feng",
  高: "gao",
  管: "guan",
  广: "guang",
  郭: "guo",
  海: "hai",
  韩: "han",
  何: "he",
  黄: "huang",
  会: "hui",
  机: "ji",
  技: "ji",
  家: "jia",
  建: "jian",
  江: "jiang",
  金: "jin",
  京: "jing",
  李: "li",
  理: "li",
  梁: "liang",
  刘: "liu",
  罗: "luo",
  马: "ma",
  明: "ming",
  南: "nan",
  宁: "ning",
  欧: "ou",
  彭: "peng",
  平: "ping",
  企: "qi",
  钱: "qian",
  秦: "qin",
  任: "ren",
  上: "shang",
  沈: "shen",
  术: "shu",
  宋: "song",
  孙: "sun",
  台: "tai",
  唐: "tang",
  王: "wang",
  未: "wei",
  吴: "wu",
  西: "xi",
  夏: "xia",
  小: "xiao",
  谢: "xie",
  徐: "xu",
  许: "xu",
  杨: "yang",
  业: "ye",
  员: "yuan",
  运: "yun",
  营: "ying",
  云: "yun",
  张: "zhang",
  赵: "zhao",
  郑: "zheng",
  中: "zhong",
  周: "zhou",
  朱: "zhu",
};

function defaultPinyinProvider(text: string): string[] {
  const result: string[] = [];
  for (const char of text) {
    if (/[\u3400-\u9fff]/u.test(char)) {
      result.push((COMMON_PINYIN[char] ?? char).toLocaleLowerCase());
    } else {
      result.push(char.toLocaleLowerCase());
    }
  }
  return result;
}

let pinyinProvider: PinyinProvider = defaultPinyinProvider;

/**
 * Inject a richer pinyin provider (e.g. backed by `pinyin-pro`). Called once
 * at app bootstrap. Passing `null` resets to the built-in minimal dictionary.
 *
 * This indirection keeps the module dependency-free while letting us plug in
 * full pinyin coverage later without touching this file.
 */
export function setPinyinProvider(provider: PinyinProvider | null): void {
  pinyinProvider = provider ?? defaultPinyinProvider;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function containsHanCharacter(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

/**
 * Produce the search variants for a given field value.
 *
 * Always includes the normalized lowercase variant. When the value contains
 * Han characters, also includes:
 *   - full pinyin (concatenated syllables), e.g. 张三 → "zhangsan"
 *   - pinyin initials, e.g. 张三 → "zs"
 *
 * Non-Han runs are pass-through lowercased characters.
 */
function searchVariants(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  const variants = new Set<string>([normalized]);

  if (containsHanCharacter(value)) {
    const syllables = pinyinProvider(value)
      .map((syllable) => syllable.toLocaleLowerCase())
      .filter((syllable) => syllable.length > 0);
    if (syllables.some((part) => /[a-z]/i.test(part))) {
      variants.add(syllables.join(""));
      variants.add(syllables.map((part) => part[0] ?? "").join(""));
    }
  }

  return [...variants].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Public matching primitives
// ---------------------------------------------------------------------------

/** Case-insensitive prefix match. Pure — does not consider pinyin variants. */
export function isPrefixMatch(text: string, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return true;
  }
  return normalizeText(text).startsWith(normalizedQuery);
}

/** Case-insensitive substring match that is strictly NOT a prefix match.
 *  Pure — does not consider pinyin variants. */
export function isSubstringMatch(text: string, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return false;
  }
  const normalizedText = normalizeText(text);
  if (normalizedText.startsWith(normalizedQuery)) {
    return false;
  }
  return normalizedText.includes(normalizedQuery);
}

/**
 * Case-insensitive subsequence match with pinyin-aware Chinese support.
 *
 * A subsequence match returns `true` iff every character of `query` appears in
 * `text` in order (not necessarily adjacent). Matching is attempted against
 * the normalized text and, for Han-containing text, against full pinyin and
 * pinyin initials variants.
 *
 * Examples:
 *   isSubsequenceMatch("alice", "al")   → true
 *   isSubsequenceMatch("alice", "ae")   → true
 *   isSubsequenceMatch("alice", "za")   → false
 *   isSubsequenceMatch("张三", "zs")    → true (pinyin initials)
 */
export function isSubsequenceMatch(text: string, query: string): boolean {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return true;
  }

  return searchVariants(text).some((variant) => {
    let queryIndex = 0;
    for (const char of variant) {
      if (char === normalizedQuery[queryIndex]) {
        queryIndex += 1;
        if (queryIndex === normalizedQuery.length) {
          return true;
        }
      }
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Candidate ranking
// ---------------------------------------------------------------------------

/** Classify how `variant` matches `query` (already normalized). */
function classifyVariant(variant: string, query: string): MatchResult["matchType"] | null {
  if (variant.startsWith(query)) {
    return "prefix";
  }
  if (variant.includes(query)) {
    return "substring";
  }
  let queryIndex = 0;
  for (const char of variant) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) {
        return "subsequence";
      }
    }
  }
  return null;
}

/** Find the best matching variant for a single candidate field. */
function matchField(params: {
  candidate: MentionCandidate;
  field: MatchResult["matchedField"];
  value: string | undefined;
  query: string;
}): MatchResult | null {
  if (!params.value) {
    return null;
  }
  const variants = searchVariants(params.value);
  let best: MatchResult | null = null;
  for (const variant of variants) {
    const matchType = classifyVariant(variant, params.query);
    if (!matchType) {
      continue;
    }
    const score = MATCH_SCORE[matchType];
    if (
      !best ||
      score > best.score ||
      (score === best.score && FIELD_PRIORITY[params.field] > FIELD_PRIORITY[best.matchedField])
    ) {
      best = {
        candidate: params.candidate,
        score,
        matchType,
        matchedField: params.field,
      };
    }
  }
  return best;
}

function pickBestFieldMatch(best: MatchResult, current: MatchResult): MatchResult {
  if (current.score !== best.score) {
    return current.score > best.score ? current : best;
  }
  return FIELD_PRIORITY[current.matchedField] > FIELD_PRIORITY[best.matchedField] ? current : best;
}

function rankSignal(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function emptyQueryResult(candidate: MentionCandidate): MatchResult {
  return {
    candidate,
    score: 0,
    matchType: "subsequence",
    matchedField: "displayName",
  };
}

/**
 * Sort comparator for ranked results.
 *
 * Order (highest priority first):
 *   1. Score DESC (prefix > substring > subsequence)
 *   2. Collaboration frequency DESC
 *   3. Project participation DESC
 *   4. Online candidates first
 *   5. Alphabetical by normalized displayName
 *   6. Alphabetical by agentId (final tie-breaker for determinism)
 */
function compareMatchResults(left: MatchResult, right: MatchResult): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  const collaborationOrder =
    rankSignal(right.candidate.collaborationFrequency) -
    rankSignal(left.candidate.collaborationFrequency);
  if (collaborationOrder !== 0) {
    return collaborationOrder;
  }
  const projectOrder =
    rankSignal(right.candidate.projectParticipation) -
    rankSignal(left.candidate.projectParticipation);
  if (projectOrder !== 0) {
    return projectOrder;
  }
  if (left.candidate.online !== right.candidate.online) {
    return left.candidate.online ? -1 : 1;
  }
  const leftName = normalizeText(left.candidate.displayName || left.candidate.agentId);
  const rightName = normalizeText(right.candidate.displayName || right.candidate.agentId);
  const nameOrder = leftName.localeCompare(rightName, "zh-Hans-CN");
  if (nameOrder !== 0) {
    return nameOrder;
  }
  return left.candidate.agentId.localeCompare(right.candidate.agentId);
}

/**
 * Filter and rank candidates against `query`.
 *
 * Behavior:
 * - Empty query → return all candidates (score 0, matchType "subsequence",
 *   matchedField "displayName"), sorted by online status then alphabetical.
 *   Non-empty query → return only candidates that match at least one of
 *   `displayName`, `roleName`, `capabilityTags`, `currentTask`, or `agentId`,
 *   keeping the best match per candidate.
 * - Results are sorted by score DESC, then collaboration signals, online
 *   status, and alphabetical order.
 */
export function matchCandidates(candidates: MentionCandidate[], query: string): MatchResult[] {
  const normalizedQuery = normalizeText(query);
  const results = candidates
    .map((candidate) => {
      if (!normalizedQuery) {
        return emptyQueryResult(candidate);
      }
      const fieldMatches = [
        matchField({
          candidate,
          field: "displayName",
          value: candidate.displayName,
          query: normalizedQuery,
        }),
        matchField({
          candidate,
          field: "roleName",
          value: candidate.roleName,
          query: normalizedQuery,
        }),
        matchField({
          candidate,
          field: "capabilityTags",
          value: candidate.capabilityTags?.join(" "),
          query: normalizedQuery,
        }),
        matchField({
          candidate,
          field: "currentTask",
          value: candidate.currentTask,
          query: normalizedQuery,
        }),
        matchField({
          candidate,
          field: "agentId",
          value: candidate.agentId,
          query: normalizedQuery,
        }),
      ].filter((entry): entry is MatchResult => entry !== null);

      if (fieldMatches.length === 0) {
        return null;
      }
      // Take the best per-candidate match (highest score wins; ties broken
      // by field priority).
      return fieldMatches.reduce(pickBestFieldMatch);
    })
    .filter((entry): entry is MatchResult => entry !== null);

  return results.toSorted(compareMatchResults);
}

/** Backwards-compatible alias for `matchCandidates`. Used by `mention-popup`. */
export const match = matchCandidates;

// ---------------------------------------------------------------------------
// Factory / interface (Design Document shape)
// ---------------------------------------------------------------------------

/**
 * `FuzzyMatcher` interface as defined in the design document. Callers that
 * prefer a dependency-injection style can build a matcher via
 * `createFuzzyMatcher()`; callers that prefer tree-shakable named imports
 * can use `matchCandidates` / `isSubsequenceMatch` directly.
 */
export interface FuzzyMatcher {
  match(candidates: MentionCandidate[], query: string): MatchResult[];
  isSubsequenceMatch(text: string, query: string): boolean;
}

/** Build a `FuzzyMatcher` instance. Pure factory — no hidden state. */
export function createFuzzyMatcher(): FuzzyMatcher {
  return {
    match: matchCandidates,
    isSubsequenceMatch,
  };
}

/** Legacy named export kept for existing call sites (tests, mention-popup). */
export const FuzzyMatcher: FuzzyMatcher = {
  match: matchCandidates,
  isSubsequenceMatch,
};
