import { detectProtocolOverride } from "../../context/rule-adaptation/materials.js";
import {
  SHADOW_AGENT_PROTOCOL_VERSION,
  type ShadowOutcomeCode,
} from "../../contracts/rule-adaptation-shadow.js";
import { FORBIDDEN_PROPOSAL_KEY_SET } from "../../contracts/rule-adaptation.js";

export { detectProtocolOverride };

export type ParsedShadowOutput =
  | {
      ok: true;
      intent: string;
      proposal?: unknown;
      hasForbiddenField: boolean;
      forbiddenPath?: string;
    }
  | { ok: false; code: "protocol_failure"; path: "model.output" };

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function extractJsonText(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const fenced = trimmed.match(FENCE);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function findForbiddenProposalKey(
  value: unknown,
  path = "proposal",
  depth = 0,
): string | undefined {
  if (depth > 32 || value === null || typeof value !== "object") {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = findForbiddenProposalKey(entry, `${path}[${index}]`, depth + 1);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (!isPlainObject(value)) {
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_PROPOSAL_KEY_SET.has(key)) {
      return childPath;
    }
    const found = findForbiddenProposalKey(child, childPath, depth + 1);
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function parseShadowModelOutput(text: string): ParsedShadowOutput {
  const jsonText = extractJsonText(text);
  if (!jsonText) {
    return { ok: false, code: "protocol_failure", path: "model.output" };
  }
  const parsedJson = tryParseJson(jsonText);
  if (!parsedJson.ok || !isPlainObject(parsedJson.value)) {
    return { ok: false, code: "protocol_failure", path: "model.output" };
  }
  const parsed = parsedJson.value;
  const intent =
    typeof parsed.intent === "string"
      ? parsed.intent
      : typeof parsed.kind === "string"
        ? parsed.kind
        : "";
  const proposal =
    "proposal" in parsed ? parsed.proposal : looksLikeProposal(parsed) ? parsed : undefined;
  const forbiddenPath = findForbiddenProposalKey(proposal ?? parsed);
  return {
    ok: true,
    intent: intent || (proposal ? guessIntent(proposal) : ""),
    ...(proposal !== undefined ? { proposal } : {}),
    hasForbiddenField: Boolean(forbiddenPath),
    ...(forbiddenPath ? { forbiddenPath } : {}),
  };
}

function looksLikeProposal(value: Record<string, unknown>): boolean {
  return value.kind === "policy_proposal" || value.kind === "rule_candidate";
}

function guessIntent(proposal: unknown): string {
  if (!isPlainObject(proposal)) {
    return "";
  }
  if (proposal.kind === "rule_candidate") {
    return "rule_candidate";
  }
  if (proposal.kind === "policy_proposal") {
    return "policy_proposal";
  }
  return "";
}

export function intentToOutcome(intent: string): ShadowOutcomeCode | undefined {
  switch (intent) {
    case "no_change":
    case "no_change_needed":
      return "no_change_needed";
    case "insufficient_sources":
      return "insufficient_sources";
    case "insufficient_permission":
      return "insufficient_permission";
    case "tool_unavailable":
      return "tool_unavailable";
    default:
      return undefined;
  }
}

export function assertedProtocolVersion(value: unknown): boolean {
  return isPlainObject(value) && value.protocolVersion === SHADOW_AGENT_PROTOCOL_VERSION;
}
