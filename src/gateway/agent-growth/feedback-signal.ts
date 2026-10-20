/**
 * Agent Growth OS — 入站反馈信号（确定性检测，无 LLM）。
 *
 * 补齐 `operationalScore` 长期空缺的两个信号源：
 *  - `humanTakeoverRate`：用户明确表示"我自己来 / 我接手"→ 记一次人工接管观测。
 *  - `satisfaction`：用户明确表达满意或不满（返工、否定）→ 记一次情绪观测。
 *
 * 设计原则：**只认用户说出口的确定性信号，宁缺勿滥**。无匹配 → 不产生观测，
 * 从而避免旧实现的缺陷（没有信号源却输出恒 0 的接管率，并被打分器当作满分计入）。
 */

export type FeedbackSentiment = "positive" | "negative";

export type InboundFeedbackSignals = {
  /** 用户明确接管（true）；未表达 → 字段缺省，不产生观测。 */
  humanTakeover?: boolean;
  /** 明确的满意/不满；中性 → 字段缺省。 */
  sentiment?: FeedbackSentiment;
  /** 命中的原文片段，便于审计与调参。 */
  matched?: string;
};

/**
 * 人工接管：用户表示这活儿自己干。
 * 收紧到"第一人称 + 接手/自己来"，避免误吞"你来处理一下"这类派活。
 */
const TAKEOVER_PATTERNS: readonly RegExp[] = [
  /我(自己|亲自)?来(弄|做|搞|处理|写|改)?(吧|了)?/,
  /我接手/,
  /我自己(搞|弄|做|处理|写|改|来)/,
  /(算了|不用了|别弄了)[，,]?\s*我/,
  /不用你(了|来|弄|做|处理)/,
  /我手动(改|弄|做|处理|来)/,
  /\bi(?:'|’)?ll (?:take (?:it|this|over)|do (?:it|this)|handle (?:it|this))\b/i,
  /\blet me (?:do|handle|take) (?:it|this)\b/i,
  /\btaking (?:it |this )?over\b/i,
  /\bnever mind,? i(?:'|’)?ll\b/i,
];

/** 不满：返工、否定、报错抱怨。 */
const NEGATIVE_PATTERNS: readonly RegExp[] = [
  /不对|错了|搞错|弄错|又错|不是这个|不是我要的|理解错/,
  /重做|重新(做|来|写|改)|再来一次|返工/,
  /没用|不行|有问题|别这样/,
  /\b(wrong|incorrect|not right|not what i (?:asked|wanted)|misunderstood)\b/i,
  /\b(redo|do it again|try again|start over)\b/i,
  /\b(that(?:'|’)?s not it|doesn(?:'|’)?t work|you broke)\b/i,
];

/** 满意：明确肯定或验收通过。 */
const POSITIVE_PATTERNS: readonly RegExp[] = [
  /太好了|很好|做得好|干得好|完美|漂亮|没问题了|可以了|搞定了|通过了/,
  /辛苦了|谢谢你|多谢/,
  /\b(perfect|great job|well done|nicely done|looks good|lgtm|exactly what i wanted)\b/i,
  /\b(thanks|thank you)\b/i,
];

function firstMatch(text: string, patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) {
      return match[0];
    }
  }
  return null;
}

/**
 * 从一条入站用户消息派生反馈信号。
 *
 * 优先级：接管 > 不满 > 满意。接管本身即强烈不满，因此同时记为 negative
 * （单条消息只产生一次情绪观测，不重复计数）。
 */
export function deriveInboundFeedbackSignals(text: string): InboundFeedbackSignals {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const takeover = firstMatch(trimmed, TAKEOVER_PATTERNS);
  if (takeover) {
    return { humanTakeover: true, sentiment: "negative", matched: takeover };
  }

  const negative = firstMatch(trimmed, NEGATIVE_PATTERNS);
  if (negative) {
    return { humanTakeover: false, sentiment: "negative", matched: negative };
  }

  const positive = firstMatch(trimmed, POSITIVE_PATTERNS);
  if (positive) {
    return { humanTakeover: false, sentiment: "positive", matched: positive };
  }

  // 中性消息仍算一次"有机会观察到接管但没发生"，这样接管率才有真实分母。
  return { humanTakeover: false };
}

/** 是否值得写盘（全空 → 跳过 I/O）。 */
export function hasInboundFeedbackSignal(signals: InboundFeedbackSignals): boolean {
  return signals.humanTakeover !== undefined || signals.sentiment !== undefined;
}
