/**
 * Process-channel thinking progress (not delivery / Layer C).
 *
 * Derives a safe outline + soft progress from internal assistant scratchpad /
 * reasoning text. Labels follow the user's language. Never returns raw CoT.
 *
 * Aligns with reply-surface-protocol + #934 (process ≠ history/delivery).
 */

export type ThinkingProgressLanguage = "zh" | "en";

export type ThinkingProgressStepStatus = "pending" | "active" | "done";

export type ThinkingProgressStep = {
  id: string;
  label: string;
  status: ThinkingProgressStepStatus;
};

export type ThinkingProgressSnapshot = {
  steps: ThinkingProgressStep[];
  activeIndex: number;
  /** Soft estimate 0–100; not a hard completion claim. */
  percent: number;
  /** Neutral copy in the user's language when structure is thin. */
  placeholder: string;
};

export const THINKING_PROGRESS_PLACEHOLDER = "正在梳理思路…";
export const THINKING_PROGRESS_PLACEHOLDER_EN = "Thinking it through…";

const COPY = {
  zh: {
    placeholder: THINKING_PROGRESS_PLACEHOLDER,
    defaults: ["理解问题", "梳理要点", "组织回答"] as const,
    understand: "理解问题",
    gather: "检索信息",
    analyze: "分析判断",
    compose: "组织回答",
  },
  en: {
    placeholder: THINKING_PROGRESS_PLACEHOLDER_EN,
    defaults: ["Understanding", "Key points", "Drafting a reply"] as const,
    understand: "Understanding",
    gather: "Gathering info",
    analyze: "Analyzing",
    compose: "Drafting a reply",
  },
} as const;

type PhaseId = "understand" | "gather" | "analyze" | "compose";

type PhaseSignal = {
  id: PhaseId;
  re: RegExp;
};

const PHASE_SIGNALS: PhaseSignal[] = [
  {
    id: "understand",
    re: /\b(understand|clarif|parse|what (?:the )?user|reading (?:the )?(?:question|request)|intent)\b|理解|弄清|用户(问|要|希望)/i,
  },
  {
    id: "gather",
    re: /\b(search|look(?:ing)? up|check(?:ing)?|find|retriev|inspect|tool(?:call)?|exec)\b|检索|查找|搜索|核对|工具/i,
  },
  {
    id: "analyze",
    re: /\b(analy[sz]|reason|consider|evaluat|weigh|decide|compare)\b|分析|判断|权衡|对比/i,
  },
  {
    id: "compose",
    re: /\b(summar|organiz|draft|compose|write|answer|reply|final(?:\s+answer)?)\b|组织|回答|总结|起草|回复/i,
  },
];

const ENGLISH_COT_HINT_RE =
  /\b(Let me|I need to|Actually,|I'll |I will |The skill |sandbox|toolCall)\b/i;

function resolveLanguage(language?: ThinkingProgressLanguage | null): ThinkingProgressLanguage {
  return language === "en" ? "en" : "zh";
}

function cjkCount(text: string): number {
  // Fresh /g each call — avoid RegExp lastIndex reuse on a shared pattern.
  return (text.match(/[\u4e00-\u9fff]/g) || []).length;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(95, Math.round(value)));
}

/**
 * Keep only short, user-safe labels. Reject raw CoT fragments.
 */
export function sanitizeThinkingStepLabel(
  raw: string,
  language?: ThinkingProgressLanguage | null,
): string | null {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }
  if (ENGLISH_COT_HINT_RE.test(trimmed)) {
    return null;
  }
  const lang = resolveLanguage(language);
  const maxLen = lang === "en" ? 22 : 18;
  if (trimmed.length > maxLen) {
    return null;
  }
  const cjk = cjkCount(trimmed);
  const latin = (trimmed.match(/[A-Za-z]/g) || []).length;
  if (cjk >= 2 && cjk >= latin) {
    return trimmed.slice(0, 16);
  }
  if (lang === "en" && latin >= 3 && latin >= cjk) {
    return trimmed.slice(0, maxLen);
  }
  // Pure latin short tokens are not shown as CoT for zh; map is via PHASE_SIGNALS only.
  return null;
}

function extractHeadingLabels(text: string, language: ThinkingProgressLanguage): string[] {
  const labels: string[] = [];
  const lines = text.split(/\n+/);
  for (const line of lines) {
    const heading =
      /^\s{0,3}#{1,3}\s+(.+)$/.exec(line)?.[1] ?? /^\s*(?:\d+[.)、]|[-*•])\s+(.+)$/.exec(line)?.[1];
    if (!heading) {
      continue;
    }
    const safe = sanitizeThinkingStepLabel(heading, language);
    if (safe && !labels.includes(safe)) {
      labels.push(safe);
    }
    if (labels.length >= 5) {
      break;
    }
  }
  return labels;
}

function detectPhaseLabels(text: string, language: ThinkingProgressLanguage): string[] {
  const found: string[] = [];
  const copy = COPY[language];
  for (const signal of PHASE_SIGNALS) {
    const label = copy[signal.id];
    if (signal.re.test(text) && !found.includes(label)) {
      found.push(label);
    }
  }
  return found;
}

function softPercentFromLength(charCount: number, activeIndex: number, stepCount: number): number {
  const lengthPart = Math.min(55, charCount / 18);
  const stepPart =
    stepCount <= 1 ? 0 : Math.min(40, (activeIndex / Math.max(1, stepCount - 1)) * 40);
  return clampPercent(8 + lengthPart + stepPart);
}

/**
 * Derive a process-only thinking structure + progress from internal text.
 * Input may be English scratchpad; output labels follow the user's language.
 */
export function deriveThinkingProgress(
  rawText: string,
  language?: ThinkingProgressLanguage | null,
): ThinkingProgressSnapshot {
  const lang = resolveLanguage(language);
  const copy = COPY[lang];
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text) {
    const steps: ThinkingProgressStep[] = copy.defaults.map((label, index) => ({
      id: `default-${index}`,
      label,
      status: index === 0 ? "active" : "pending",
    }));
    return {
      steps,
      activeIndex: 0,
      percent: 5,
      placeholder: copy.placeholder,
    };
  }

  const headingLabels = extractHeadingLabels(text, lang);
  const phaseLabels = detectPhaseLabels(text, lang);
  const labels =
    headingLabels.length >= 2
      ? headingLabels
      : phaseLabels.length > 0
        ? (() => {
            // Keep default spine; promote detected phases in order.
            const ordered: string[] = [];
            for (const label of copy.defaults) {
              if (!ordered.includes(label)) {
                ordered.push(label);
              }
            }
            for (const label of phaseLabels) {
              if (!ordered.includes(label)) {
                ordered.push(label);
              }
            }
            return ordered.slice(0, 5);
          })()
        : [...copy.defaults];

  let activeIndex = 0;
  if (phaseLabels.length > 0) {
    const lastPhase = phaseLabels[phaseLabels.length - 1];
    const idx = labels.indexOf(lastPhase);
    activeIndex = idx >= 0 ? idx : Math.min(labels.length - 1, phaseLabels.length - 1);
  } else if (headingLabels.length > 0) {
    activeIndex = Math.min(labels.length - 1, headingLabels.length - 1);
  } else {
    // Length-only soft advance across defaults.
    activeIndex = Math.min(
      labels.length - 1,
      Math.floor(text.length / Math.max(120, Math.ceil(900 / labels.length))),
    );
  }

  const steps: ThinkingProgressStep[] = labels.map((label, index) => ({
    id: `step-${index}`,
    label,
    status: index < activeIndex ? "done" : index === activeIndex ? "active" : "pending",
  }));

  return {
    steps,
    activeIndex,
    percent: softPercentFromLength(text.length, activeIndex, steps.length),
    placeholder: copy.placeholder,
  };
}

/** True when snapshot is safe to show (no raw CoT fields). */
export function isSafeThinkingProgressSnapshot(value: unknown): value is ThinkingProgressSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.placeholder !== "string" || typeof rec.percent !== "number") {
    return false;
  }
  if (typeof rec.activeIndex !== "number" || !Array.isArray(rec.steps)) {
    return false;
  }
  if (rec.steps.length === 0 || rec.steps.length > 8) {
    return false;
  }
  for (const step of rec.steps) {
    if (!step || typeof step !== "object") {
      return false;
    }
    const s = step as Record<string, unknown>;
    if (typeof s.id !== "string" || typeof s.label !== "string") {
      return false;
    }
    if (s.status !== "pending" && s.status !== "active" && s.status !== "done") {
      return false;
    }
    if (ENGLISH_COT_HINT_RE.test(s.label) || s.label.length > 24) {
      return false;
    }
  }
  return true;
}
