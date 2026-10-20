/**
 * Map a precipitation candidate → EmployeeSkillProfile + SkillRuntimeDefinition drafts.
 */

import type { EmployeeSkillProfile, SkillRuntimeDefinition } from "../skill-lifecycle-store.js";
import type { SkillPrecipitationCandidate } from "./types.js";
import { PRECIPITATION_EMPLOYEE_HINT } from "./types.js";

export type ExtractedSkillDraft = {
  profile: Omit<EmployeeSkillProfile, "id"> & { id?: string };
  runtimeDefinition: Partial<SkillRuntimeDefinition> & {
    prompts: string[];
    tools: string[];
  };
  employeeHint: string;
};

function buildPromptBody(candidate: SkillPrecipitationCandidate): string {
  const lines: string[] = [];
  lines.push(`## When`);
  lines.push(candidate.whenToUse);
  lines.push("");
  if (candidate.redLines.length > 0) {
    lines.push("## Red lines");
    for (const line of candidate.redLines) {
      lines.push(`- ${line}`);
    }
    lines.push("");
  }
  if (candidate.steps.length > 0) {
    lines.push("## Pipeline");
    for (const step of candidate.steps) {
      const toolSuffix =
        step.tools && step.tools.length > 0 ? ` (tools: ${step.tools.join(", ")})` : "";
      lines.push(`${step.order}. ${step.instruction}${toolSuffix}`);
    }
    lines.push("");
  }
  if (candidate.acceptance.length > 0) {
    lines.push("## Acceptance");
    for (const line of candidate.acceptance) {
      lines.push(`- ${line}`);
    }
    lines.push("");
  }
  if (candidate.failureModes.length > 0) {
    lines.push("## Failure modes");
    for (const line of candidate.failureModes) {
      lines.push(`- ${line}`);
    }
    lines.push("");
  }
  if (candidate.ephemeralParams.length > 0) {
    lines.push("## Parameters (do not hard-code)");
    for (const param of candidate.ephemeralParams.slice(0, 12)) {
      lines.push(`- ${param}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function extractSkillDraftFromCandidate(
  candidate: SkillPrecipitationCandidate,
): ExtractedSkillDraft {
  const name = (candidate.suggestedName ?? candidate.whenToUse).slice(0, 120);
  const summary = candidate.whenToUse.slice(0, 500);
  const promptBody = buildPromptBody(candidate);

  const profile = {
    name,
    summary,
    visibility: "private" as const,
    assetType: "capability" as const,
    tags: [
      "precipitation",
      candidate.completeness === "full" ? "recipe-full" : "recipe-partial",
    ].slice(0, 10),
    usageExamples: [candidate.whenToUse].slice(0, 3),
    inputDescription: "同类多步任务再次出现时启用本能力",
    outputDescription: "按配方完成步骤并通过验收点",
    category: "precipitation",
    avatar: "",
  };

  const runtimeDefinition = {
    prompts: [promptBody],
    tools: candidate.toolChain.slice(0, 32),
    workflow: {
      kind: "precipitation-recipe",
      steps: candidate.steps,
      redLines: candidate.redLines,
      acceptance: candidate.acceptance,
      failureModes: candidate.failureModes,
    },
    routingHints: {
      precipitation: {
        completeness: candidate.completeness,
        completenessReason: candidate.completenessReason ?? null,
        confidence: candidate.confidence,
        sourceEvidenceRefs: candidate.sourceEvidenceRefs,
        ephemeralParams: candidate.ephemeralParams,
        whenToUse: candidate.whenToUse,
        toolChainSignature: candidate.toolChain.join(">"),
      },
    },
    memoryStrategy: null,
    dependencies: [],
    modelPreferences: null,
    executionPolicies: null,
    capabilities: [],
    providers: [],
  };

  return {
    profile,
    runtimeDefinition,
    employeeHint: PRECIPITATION_EMPLOYEE_HINT,
  };
}
