/**
 * Build system-prompt addition for Shared Task Context (CL-P3-02 injection).
 * Proposed/superseded decisions never appear as hard constraints.
 */
import { estimateTokensFromText } from "./context-budget.js";
import {
  activeApprovedDecisions,
  fitSharedTaskContextToBudget,
  type SharedTaskContext,
} from "./shared-task-context.js";

export function buildSharedTaskSystemPromptAddition(params: {
  context: SharedTaskContext | null | undefined;
  maxTokens?: number;
}): string | null {
  if (!params.context) {
    return null;
  }
  const approved = activeApprovedDecisions(params.context);
  const hasContent =
    Boolean(params.context.mission) ||
    Boolean(params.context.currentPhase) ||
    params.context.goals.length > 0 ||
    approved.length > 0 ||
    params.context.hardConstraints.some((c) => c.evidenceRefs.length > 0) ||
    params.context.unresolvedQuestions.length > 0;
  if (!hasContent) {
    return null;
  }
  const maxTokens = params.maxTokens ?? 800;
  const fitted = fitSharedTaskContextToBudget({
    context: params.context,
    maxTokens,
    estimateTokens: estimateTokensFromText,
  });
  if (!fitted.text.trim()) {
    return null;
  }
  // Fail closed: never inject PROPOSED/SUPERSEDED decision text.
  for (const d of params.context.approvedDecisions) {
    if (d.status === "PROPOSED" || d.status === "SUPERSEDED" || d.status === "REJECTED") {
      if (fitted.text.includes(d.text) && !approved.some((a) => a.text === d.text)) {
        // strip accidental inclusion
        fitted.text = fitted.text
          .split("\n")
          .filter((line) => !line.includes(d.text))
          .join("\n");
      }
    }
  }
  if (!fitted.text.trim()) {
    return null;
  }
  return [
    "## Shared Task Context (collaboration)",
    "Only approved decisions and hard constraints below are authoritative.",
    "Do not invent private chain-of-thought or other agents' private memory.",
    fitted.text,
    fitted.truncated ? "(truncated for budget)" : "",
  ]
    .filter(Boolean)
    .join("\n");
}
