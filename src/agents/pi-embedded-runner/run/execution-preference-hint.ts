/**
 * Prompt-only execution preference. Does not shrink or reorder the tool allowlist.
 * Policy remains the final authority.
 */
import { listPatternCandidates } from "../../../gateway/pattern-detection/store.js";

const HEX16 = /^[0-9a-f]{16}$/;
const SHADOW_HINT_MIN_CONFIDENCE = 0.55;

export function isNamedToolHint(name: string): boolean {
  const trimmed = name.trim();
  return Boolean(trimmed) && !HEX16.test(trimmed);
}

export function namedToolsFromCandidateContract(toolsRequired: readonly string[]): string[] {
  return [...new Set(toolsRequired.filter(isNamedToolHint))].slice(0, 8);
}

export function buildExecutionPreferenceHint(params: {
  agentId?: string;
  tenantId?: string | null;
  shadowToolNames?: readonly string[];
  shadowConfidence?: number;
}): string | undefined {
  const agentId = params.agentId?.trim();
  const fromPatterns = agentId
    ? listPatternCandidates({
        agentId,
        tenantId: params.tenantId ?? undefined,
        status: "candidate",
      })
        .toSorted((a, b) => b.overallConfidence - a.overallConfidence)
        .flatMap((candidate) => namedToolsFromCandidateContract(candidate.contract.toolsRequired))
    : [];
  const fromShadow =
    typeof params.shadowConfidence === "number" &&
    params.shadowConfidence >= SHADOW_HINT_MIN_CONFIDENCE
      ? (params.shadowToolNames ?? []).filter(isNamedToolHint)
      : [];
  const names = [...new Set([...fromPatterns, ...fromShadow])].slice(0, 8);
  if (names.length === 0) {
    return undefined;
  }
  return [
    "Recent similar runs preferred these skills/tools: " + names.join(", ") + ".",
    "This is a preference hint only. The full skill and tool lists above remain available.",
    "Policy, approvals, and the allowlist still decide what may execute.",
  ].join("\n");
}
