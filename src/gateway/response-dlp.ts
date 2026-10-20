/** Response DLP — redact architecture / deployment leakage from assistant output (security P1.3). */

import { createSubsystemLogger } from "../logging/subsystem.js";

const dlpLog = createSubsystemLogger("gateway/dlp");

export type ResponseDlpRule = {
  id: string;
  pattern: RegExp;
  replacement: string;
};

export const DEFAULT_RESPONSE_DLP_RULES: ResponseDlpRule[] = [
  {
    id: "openbot-state-dir",
    pattern: /\/(?:root|home)\/[^\s"'`]*\/\.openbot\b[^\s"'`]*/gi,
    replacement: "[redacted-path]",
  },
  {
    id: "deploy-production",
    pattern: /\bdeploy\/production[^\s"'`]*/gi,
    replacement: "[redacted-path]",
  },
  { id: "kiro-specs", pattern: /\.kiro\/specs[^\s"'`]*/gi, replacement: "[redacted-path]" },
  {
    id: "rfc1918",
    pattern:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    replacement: "[redacted-ip]",
  },
  { id: "nginx-etc", pattern: /\/etc\/nginx[^\s"'`]*/gi, replacement: "[redacted-path]" },
  { id: "rc-amd64", pattern: /\brc-amd64-v\d+[^\s"'`]*/gi, replacement: "[redacted-release]" },
];

export type ResponseDlpResult = {
  text: string;
  redacted: boolean;
  matchedRuleIds: string[];
};

export function applyResponseDlp(
  text: string,
  rules: ResponseDlpRule[] = DEFAULT_RESPONSE_DLP_RULES,
): ResponseDlpResult {
  if (!text.trim()) {
    return { text, redacted: false, matchedRuleIds: [] };
  }
  let output = text;
  const matchedRuleIds: string[] = [];
  for (const rule of rules) {
    if (rule.pattern.test(output)) {
      matchedRuleIds.push(rule.id);
      output = output.replace(rule.pattern, rule.replacement);
    }
    rule.pattern.lastIndex = 0;
  }
  return {
    text: output,
    redacted: matchedRuleIds.length > 0,
    matchedRuleIds,
  };
}

/** Best-effort audit hook when assistant output is redacted (security P1.3). */
export function logResponseDlpRedaction(params: {
  matchedRuleIds: string[];
  sessionKey?: string;
  agentId?: string;
}): void {
  if (params.matchedRuleIds.length === 0) {
    return;
  }
  dlpLog.warn(
    `response DLP redacted rules=${params.matchedRuleIds.join(",")}` +
      (params.sessionKey ? ` session=${params.sessionKey}` : "") +
      (params.agentId ? ` agent=${params.agentId}` : ""),
  );
}
