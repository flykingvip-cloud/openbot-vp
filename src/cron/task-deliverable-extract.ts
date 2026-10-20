/**
 * Split agent/cron run output into process (summary) vs deliverable (成果).
 *
 * P0: only hard `<<DELIVERABLE>>` tags count as user-reviewable work products.
 * Process narration, tool logs, and bare summaries must NOT be labeled as 任务成果.
 */

import {
  extractTaggedDeliverableEnvelopes,
  type DeliverableEnvelope,
} from "../shared/preview-artifact/deliverable-envelope.js";

export const NO_DELIVERABLE_PLACEHOLDER =
  "本任务未产出可验收成果（未检测到 `<<DELIVERABLE>>` 声明）。\n\n" +
  "过程说明见「任务详情」中的执行记录。请让机器人补发成果信封（文章正文 / 文件名 / 外链），或重新执行任务。";

/**
 * Injected into isolated cron agent runs so task outputs declare envelopes that
 * result cards + 成果中心 can consume (P1).
 */
export function buildCronDeliverablePromptSection(): string {
  return [
    "## 任务成果声明（强制）",
    "本任务若产出了可验收工作成果（文章/报告正文、文件、外链草稿等），最终回复必须用 `<<DELIVERABLE>>` 信封包裹成果本体：",
    "",
    "示例（文章 / 公众号草稿）：",
    '<<DELIVERABLE title="标题" type="article" url="https://...">>',
    "# 标题",
    "完整正文…",
    "<</DELIVERABLE>>",
    "",
    "示例（工作区文件）：",
    '<<DELIVERABLE title="标题" type="doc" file="报告.docx">>',
    "可选摘要…",
    "<</DELIVERABLE>>",
    "",
    "规则：",
    "- 过程说明、tool 日志、media_id、调用步骤等放在信封外，不要当作成果。",
    "- 信封内只放可验收本体（正文 / 文件名 / 外链），不要写「我开始执行…」。",
    "- `file=` 只写文件名不写路径；外链成果必须带 `url=`。",
    "- 若确实无成果，不要伪造信封；诚实说明即可。",
    "",
  ].join("\n");
}

const TAGGED_DELIVERABLE_STRIP_RE = /<<\s*DELIVERABLE\b[^>]*>+[\s\S]*?<<\s*\/\s*DELIVERABLE\s*>>/gi;

export type TaskOutcomeSplit = {
  /** Process / status prose without deliverable envelopes. */
  processText: string;
  /** Qualifying deliverable envelopes (tagged only). */
  deliverables: DeliverableEnvelope[];
  /** Markdown for the 任务成果 section (never the full process dump). */
  deliverableMarkdown: string;
  /** Whether at least one real deliverable was found. */
  hasDeliverable: boolean;
};

function stripTaggedDeliverableEnvelopes(text: string): string {
  return text
    .replace(TAGGED_DELIVERABLE_STRIP_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatSingleDeliverableMarkdown(
  entry: DeliverableEnvelope,
  index: number,
  total: number,
): string {
  const title = entry.title?.trim() || (total > 1 ? `成果 ${index + 1}` : "任务成果");
  const type = entry.type?.trim();
  const lines: string[] = [];
  if (total > 1) {
    lines.push(`### ${title}${type ? ` · ${type}` : ""}`);
  } else if (entry.title?.trim()) {
    lines.push(`### ${title}${type ? ` · ${type}` : ""}`);
  }
  if (entry.file) {
    lines.push(`- 文件：\`${entry.file}\``);
  }
  if (entry.url) {
    lines.push(`- 链接：${entry.url}`);
  }
  if (entry.body.trim()) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(entry.body.trim());
  } else if (entry.file || entry.url) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(
      entry.file
        ? "（文件型成果，请通过打开成果查看实际文件。）"
        : "（外链型成果，请通过链接打开。）",
    );
  }
  // Re-wrap so preview/open can resolve file/url via envelope parser.
  const attrs = [
    `title="${title.replace(/"/g, "")}"`,
    type ? `type="${type.replace(/"/g, "")}"` : "",
    entry.file ? `file="${entry.file.replace(/"/g, "")}"` : "",
    entry.url ? `url="${entry.url.replace(/"/g, "")}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const body = lines.join("\n").trim() || title;
  return `<<DELIVERABLE ${attrs}>>\n${body}\n<</DELIVERABLE>>`;
}

/**
 * Split agent final text into process vs deliverable markdown for task cards.
 */
export function splitTaskOutcomeFromAgentOutput(raw: string | undefined | null): TaskOutcomeSplit {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    return {
      processText: "",
      deliverables: [],
      deliverableMarkdown: NO_DELIVERABLE_PLACEHOLDER,
      hasDeliverable: false,
    };
  }

  const deliverables = extractTaggedDeliverableEnvelopes(text);
  const processText = stripTaggedDeliverableEnvelopes(text);

  if (deliverables.length === 0) {
    return {
      processText: text,
      deliverables: [],
      deliverableMarkdown: NO_DELIVERABLE_PLACEHOLDER,
      hasDeliverable: false,
    };
  }

  const deliverableMarkdown = deliverables
    .map((entry, index) => formatSingleDeliverableMarkdown(entry, index, deliverables.length))
    .join("\n\n");

  return {
    processText: processText || "任务已完成，详见下方成果。",
    deliverables,
    deliverableMarkdown,
    hasDeliverable: true,
  };
}

/** One-line headline for the summary section (status card). */
export function buildTaskOutcomeHeadline(params: {
  processText: string;
  hasDeliverable: boolean;
  deliverables: DeliverableEnvelope[];
  maxLen?: number;
}): string {
  const maxLen = params.maxLen ?? 280;
  if (params.hasDeliverable && params.deliverables[0]) {
    const first = params.deliverables[0];
    const title = first.title?.trim();
    if (title) {
      return params.deliverables.length > 1
        ? `已产出 ${params.deliverables.length} 项成果，首项：${title}`
        : `已产出成果：${title}`;
    }
    if (first.file) {
      return `已产出文件：${first.file}`;
    }
    if (first.url) {
      return "已产出外链成果（见任务成果）。";
    }
  }
  const process = params.processText.replace(/\s+/g, " ").trim();
  if (!process) {
    return params.hasDeliverable ? "任务已完成。" : "任务已完成，但未声明可验收成果。";
  }
  if (process.length <= maxLen) {
    return process;
  }
  return `${process.slice(0, maxLen).trim()}…`;
}
