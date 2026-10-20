/**
 * Web-research auto-route: intent + freshness + user ask.
 * Keyword-only matching is not enough — suppress local rewrite / uploaded-doc work.
 */

export type WebResearchIntent =
  | "research"
  | "compare_live"
  | "freshness"
  | "read_url"
  | "rewrite"
  | "local_material"
  | "stable_knowledge"
  | "none";

export type WebResearchFreshness = "live" | "stable" | "unknown";
export type WebResearchUserAsk = "needs_external" | "has_source" | "unspecified";

export type WebResearchRouteDecision = {
  trigger: boolean;
  intent: WebResearchIntent;
  freshness: WebResearchFreshness;
  userAsk: WebResearchUserAsk;
  reason: string;
};

const EXPLICIT_RESEARCH =
  /调研|研究|搜证|深研|web\s*research|deep\s*research|联网调研|网页调研|文献扫描/i;
const COMPARE = /比较|对比|竞品|vs\.?|versus|横评/i;
const PRICE_OR_LIVE_OFFER = /价格|报价|定价|资费|套餐|售价|收费/i;
const FRESHNESS =
  /最新|当前|现在|今天|近日|最近|本周|本月|实时|今年|2026|政策|行业动态|新闻|行情|动态/i;
const POLICY_OR_INDUSTRY = /政策|监管|法规|行业|动态|新闻|行情/i;
const READ_URL = /https?:\/\/|\bwww\./i;
const READ_PAGE = /阅读.{0,8}(网页|链接|网址)|打开.{0,8}(网页|链接)|分析.{0,8}(网页|链接|网址)/i;
const REWRITE = /改写|润色|扩写|缩写|翻译|校对|润稿|重写/i;
const LOCAL_DOC =
  /上传的|附件里|这份\s*(pdf|word|docx|文档|纪要|合同)|已提供的|下面这段|如下文本|我发给你的(文件|文档|材料)/i;
const STABLE_KB = /什么是|定义是|原理是|公式是|怎么理解|含义是/i;

function classifyFreshness(text: string): WebResearchFreshness {
  if (FRESHNESS.test(text) || PRICE_OR_LIVE_OFFER.test(text) || READ_URL.test(text)) {
    return "live";
  }
  if (STABLE_KB.test(text) && !EXPLICIT_RESEARCH.test(text)) {
    return "stable";
  }
  return "unknown";
}

function classifyUserAsk(text: string): WebResearchUserAsk {
  if (
    LOCAL_DOC.test(text) ||
    (REWRITE.test(text) && !READ_URL.test(text) && !READ_PAGE.test(text))
  ) {
    return "has_source";
  }
  if (
    READ_URL.test(text) ||
    READ_PAGE.test(text) ||
    PRICE_OR_LIVE_OFFER.test(text) ||
    POLICY_OR_INDUSTRY.test(text) ||
    FRESHNESS.test(text)
  ) {
    return "needs_external";
  }
  return "unspecified";
}

export function assessWebResearchRoute(text: string): WebResearchRouteDecision {
  const raw = text.trim();
  if (!raw) {
    return {
      trigger: false,
      intent: "none",
      freshness: "unknown",
      userAsk: "unspecified",
      reason: "empty",
    };
  }

  const freshness = classifyFreshness(raw);
  const userAsk = classifyUserAsk(raw);
  const local = LOCAL_DOC.test(raw);
  const rewrite = REWRITE.test(raw) && !READ_URL.test(raw) && !READ_PAGE.test(raw);
  const explicit = EXPLICIT_RESEARCH.test(raw);
  const compareLive = COMPARE.test(raw) && (PRICE_OR_LIVE_OFFER.test(raw) || freshness === "live");
  const readPage = READ_URL.test(raw) || READ_PAGE.test(raw);
  const freshnessAsk =
    freshness === "live" && (POLICY_OR_INDUSTRY.test(raw) || PRICE_OR_LIVE_OFFER.test(raw));
  const stableOnly =
    STABLE_KB.test(raw) && freshness !== "live" && !explicit && !compareLive && !readPage;

  if (local && freshness !== "live" && !readPage) {
    return {
      trigger: false,
      intent: "local_material",
      freshness,
      userAsk: "has_source",
      reason: "uploaded-or-local-document",
    };
  }
  // Rewrite of supplied text wins over the word「调研/研究」in the source title.
  if (rewrite && freshness !== "live" && !readPage) {
    return {
      trigger: false,
      intent: "rewrite",
      freshness,
      userAsk: "has_source",
      reason: "rewrite-existing-text",
    };
  }
  if (stableOnly) {
    return {
      trigger: false,
      intent: "stable_knowledge",
      freshness: "stable",
      userAsk,
      reason: "stable-knowledge-no-freshness",
    };
  }
  if (explicit) {
    return {
      trigger: true,
      intent: "research",
      freshness,
      userAsk: userAsk === "has_source" && !local ? "needs_external" : userAsk,
      reason: "explicit-research-intent",
    };
  }
  if (compareLive) {
    return {
      trigger: true,
      intent: "compare_live",
      freshness: "live",
      userAsk: "needs_external",
      reason: "live-comparison",
    };
  }
  if (freshnessAsk) {
    return {
      trigger: true,
      intent: "freshness",
      freshness: "live",
      userAsk: "needs_external",
      reason: "timeliness-required",
    };
  }
  if (readPage) {
    return {
      trigger: true,
      intent: "read_url",
      freshness: "live",
      userAsk: "needs_external",
      reason: "read-specified-page",
    };
  }
  return {
    trigger: false,
    intent: "none",
    freshness,
    userAsk,
    reason: "no-external-research-need",
  };
}
