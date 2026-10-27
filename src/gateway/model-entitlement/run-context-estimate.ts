/**
 * Build ContextEstimateParts for production entry points (chat / followup /
 * cron / subagent) from whatever session context is actually available.
 *
 * Missing history / system / tools / attachments are marked in `unknownParts`
 * so estimateInsufficient is not reduced to "token total === 0".
 */

import type { SessionEntry } from "../../config/sessions.js";
import {
  type ContextEstimateParts,
  type ContextEstimateUnknownPart,
  estimateInputTokensFromText,
} from "./task-capability-plan.js";

const CHARS_PER_TOKEN = 4;

function charsFromTokens(tokens: number): string {
  const n = Math.max(0, Math.floor(tokens));
  if (n <= 0) {
    return "";
  }
  // Synthetic filler so estimateInputTokensFromText ≈ tokens (ASCII /4).
  return "x".repeat(n * CHARS_PER_TOKEN);
}

function charsFromReportChars(chars: number | undefined): string {
  if (typeof chars !== "number" || !Number.isFinite(chars) || chars <= 0) {
    return "";
  }
  return "x".repeat(Math.floor(chars));
}

export type RunContextEstimateInput = {
  taskText?: string | null;
  sessionEntry?: Pick<
    SessionEntry,
    "totalTokens" | "totalTokensFresh" | "inputTokens" | "systemPromptReport"
  > | null;
  /** Extra system prompt appended for this run (e.g. child subagent prompt). */
  extraSystemPrompt?: string | null;
  /** Attachment summary text when the entry materialized files. */
  attachmentsText?: string | null;
  /** Explicitly known that attachments were considered (even if empty). */
  attachmentsKnown?: boolean;
  /** Explicitly known tool list text when session report is absent. */
  toolsText?: string | null;
  toolsKnown?: boolean;
  outputReserveTokens?: number;
};

export type RunContextEstimateBuild = {
  contextParts: ContextEstimateParts;
  unknownParts: ContextEstimateUnknownPart[];
};

/**
 * Assemble context parts for gate / capability-plan consumption.
 * Prefer observed session totals and systemPromptReport char counts; mark
 * unavailable dimensions as unknown rather than silently omitting them.
 */
export function buildRunContextEstimateParts(
  input: RunContextEstimateInput,
): RunContextEstimateBuild {
  const unknownParts: ContextEstimateUnknownPart[] = [];
  const entry = input.sessionEntry ?? undefined;
  const report = entry?.systemPromptReport;

  // History: prefer fresh total/input tokens; otherwise unknown.
  let historyText: string | undefined;
  const freshTokens =
    entry && entry.totalTokensFresh !== false
      ? (entry.totalTokens ?? entry.inputTokens)
      : undefined;
  if (typeof freshTokens === "number" && Number.isFinite(freshTokens) && freshTokens > 0) {
    historyText = charsFromTokens(freshTokens);
  } else {
    unknownParts.push("history");
  }

  // System prompt: report chars + optional extraSystemPrompt.
  let systemPromptText: string | undefined;
  const systemChars = report?.systemPrompt?.chars;
  const extra = typeof input.extraSystemPrompt === "string" ? input.extraSystemPrompt : "";
  if (typeof systemChars === "number" && systemChars > 0) {
    systemPromptText = `${charsFromReportChars(systemChars)}${extra}`;
  } else if (extra.trim()) {
    systemPromptText = extra;
    // Report missing — still mark incomplete for the unobserved base prompt.
    unknownParts.push("systemPrompt");
  } else {
    unknownParts.push("systemPrompt");
  }

  // Tools: report list+schema chars, or explicit toolsText, else unknown.
  let toolsText: string | undefined;
  if (report?.tools) {
    const toolChars = (report.tools.listChars ?? 0) + (report.tools.schemaChars ?? 0);
    toolsText = toolChars > 0 ? charsFromReportChars(toolChars) : "";
  } else if (input.toolsKnown) {
    toolsText = typeof input.toolsText === "string" ? input.toolsText : "";
  } else if (typeof input.toolsText === "string") {
    toolsText = input.toolsText;
  } else {
    unknownParts.push("tools");
  }

  // Attachments: injected workspace files from report, or explicit text.
  let attachmentsText: string | undefined;
  if (input.attachmentsKnown || typeof input.attachmentsText === "string") {
    attachmentsText = input.attachmentsText ?? "";
  } else if (report?.injectedWorkspaceFiles && report.injectedWorkspaceFiles.length > 0) {
    const injected = report.injectedWorkspaceFiles.reduce(
      (sum, file) => sum + (file.injectedChars || file.rawChars || 0),
      0,
    );
    attachmentsText = charsFromReportChars(injected);
  } else {
    unknownParts.push("attachments");
  }

  const contextParts: ContextEstimateParts = {
    taskText: input.taskText,
    ...(historyText !== undefined ? { historyText } : {}),
    ...(systemPromptText !== undefined ? { systemPromptText } : {}),
    ...(toolsText !== undefined ? { toolsText } : {}),
    ...(attachmentsText !== undefined ? { attachmentsText } : {}),
    ...(input.outputReserveTokens !== undefined
      ? { outputReserveTokens: input.outputReserveTokens }
      : {}),
    unknownParts: [...new Set(unknownParts)],
  };

  return { contextParts, unknownParts: contextParts.unknownParts as ContextEstimateUnknownPart[] };
}

/** Convenience: token total implied by a ContextEstimateParts build (for tests). */
export function peekEstimatedInputTokens(parts: ContextEstimateParts): number {
  return (
    estimateInputTokensFromText(parts.taskText) +
    estimateInputTokensFromText(parts.historyText) +
    estimateInputTokensFromText(parts.systemPromptText) +
    estimateInputTokensFromText(parts.toolsText) +
    estimateInputTokensFromText(parts.attachmentsText)
  );
}
