import { DEFAULT_DESIGN_CATALOG } from "./catalogs.js";
import {
  detectCapabilityNeeds,
  hypothesizeRole,
  resolvePublishedRole,
  resolveSkillNeed,
} from "./resolve.js";
import type {
  BlueprintDraft,
  DesignCatalog,
  DraftSource,
  EmployeeDesignIntent,
  PolicyRecommendation,
  SkillRecommendation,
} from "./types.js";
import { validateBlueprintDraft } from "./validate-draft.js";

const ENTERPRISE_DATA_RE =
  /\b(sk-|ghp_|Bearer\s|api[_-]?key|access[_-]?token)\b|客户[A-Z0-9]{2,}的(电话|合同)/i;

export function composeBlueprintDraft(params: {
  intent: EmployeeDesignIntent;
  source?: DraftSource;
  catalog?: DesignCatalog;
  draftId: string;
  revision?: number;
}): BlueprintDraft {
  const catalog = params.catalog ?? DEFAULT_DESIGN_CATALOG;
  const roleHypothesis = hypothesizeRole(params.intent);
  const roleResolution = resolvePublishedRole(params.intent, catalog);
  const published =
    roleResolution.kind === "published"
      ? catalog.blueprints.find((entry) => entry.blueprintId === roleResolution.blueprintId)
      : undefined;

  const roleRecipeIds = [...(published?.recipeIds ?? [])];
  const text = params.intent.rawRequest.toLowerCase();
  if (
    (text.includes("邮件") || text.includes("邮箱")) &&
    !roleRecipeIds.includes("email-communication")
  ) {
    roleRecipeIds.push("email-communication");
  }

  const explicitSkillNeeds = uniqueStrings(
    params.intent.desiredOutcomes
      .filter((entry) => entry.startsWith("skill:"))
      .map((entry) => entry.slice("skill:".length).trim()),
  );
  const skillRecommendations: SkillRecommendation[] = [];
  if (explicitSkillNeeds.length > 0) {
    for (const need of explicitSkillNeeds) {
      skillRecommendations.push({ need, ...resolveSkillNeed(need, catalog) });
    }
  } else {
    for (const recipeId of roleRecipeIds) {
      const recipe = catalog.recipes.find((entry) => entry.recipeId === recipeId);
      if (!recipe) {
        skillRecommendations.push({
          need: recipeId,
          status: "unresolved",
          unresolvedReason: `unknown recipe: ${recipeId}`,
        });
        continue;
      }
      for (const skillKey of recipe.skillKeys) {
        const matched = resolveSkillNeed(skillKey, catalog);
        skillRecommendations.push({ need: skillKey, ...matched });
      }
    }
    const capabilityText = [
      params.intent.rawRequest,
      ...params.intent.desiredOutcomes,
      ...params.intent.responsibilities,
    ].join("\n");
    for (const detected of detectCapabilityNeeds(capabilityText, catalog)) {
      if (!skillRecommendations.some((entry) => entry.need === detected.need)) {
        skillRecommendations.push(detected);
      }
    }
  }

  const unresolvedCapabilities = skillRecommendations
    .filter((entry) => entry.status === "unresolved")
    .map((entry) => entry.need);

  const explicitPolicies = uniqueStrings(
    params.intent.policyRequirements
      .filter((entry) => entry.startsWith("policy:"))
      .map((entry) => entry.slice("policy:".length).trim()),
  );
  const policyRecommendations: PolicyRecommendation[] =
    explicitPolicies.length > 0
      ? explicitPolicies.map(parseTaggedPolicy)
      : [...(published?.policyRecommendations ?? [])];
  if (explicitPolicies.length === 0) {
    const policyText = [params.intent.rawRequest, ...params.intent.policyRequirements].join("\n");
    if (/不能改|只读|不得修改/.test(policyText)) {
      replacePolicy(policyRecommendations, "crm.write", {
        id: "crm.write",
        effect: "disabled",
        risk: "high",
      });
    }
    if (/发布|公众号|发信/.test(policyText)) {
      replacePolicy(policyRecommendations, "public.publish", {
        id: "public.publish",
        effect: "confirmation_required",
        risk: "high",
      });
    }
  }

  const explicitModes = uniqueStrings(
    params.intent.responsibilities
      .filter((entry) => entry.startsWith("mode:"))
      .map((entry) => entry.slice("mode:".length).trim()),
  );
  const taskPatterns =
    explicitModes.length > 0
      ? explicitModes.map((id) => {
          const publishedPattern = published?.taskPatterns.find((item) => item.id === id);
          if (publishedPattern) {
            return publishedPattern;
          }
          const label = id.startsWith("custom:") ? id.slice(id.lastIndexOf(":") + 1) : id;
          return { id, label };
        })
      : (published?.taskPatterns ?? []);

  const missingCriticalInputs = [...(published?.missingCriticalInputs ?? [])];
  const unresolvedQuestions = missingCriticalInputs.map((text, index) => ({
    id: `q${index + 1}`,
    text,
    changes: ["role_scope", "policy"],
  }));

  const riskFlags = policyRecommendations
    .filter((entry) => entry.risk === "high")
    .map((entry) => ({ id: entry.id, summary: `${entry.id} is ${entry.effect}` }));

  const draft: BlueprintDraft = {
    draftId: params.draftId,
    revision: params.revision ?? 1,
    source: params.source ?? "ai",
    roleHypothesis,
    roleResolution,
    responsibilities:
      published && explicitModes.length === 0
        ? published.taskPatterns.map((item) => item.label)
        : explicitModes.length > 0
          ? taskPatterns.map((item) => item.label)
          : params.intent.responsibilities,
    objectives: params.intent.desiredOutcomes,
    roleRecipeIds,
    skillRecommendations,
    memorySchema: published?.memorySchema ?? { entities: [], memoryTypes: [] },
    taskPatterns,
    toolRecommendations: [],
    policyRecommendations,
    interactionProfile: published?.interactionProfile ?? {
      proactiveLevel: "moderate",
      responseStyle: "concise",
    },
    unresolvedQuestions,
    missingCriticalInputs,
    unresolvedCapabilities,
    riskFlags,
    validation: { status: "valid", checks: [] },
  };

  if (ENTERPRISE_DATA_RE.test(params.intent.rawRequest)) {
    draft.riskFlags = [
      ...draft.riskFlags,
      {
        id: "enterprise_data",
        summary: "request appears to contain enterprise secrets or records",
      },
    ];
  }

  draft.validation = validateBlueprintDraft(draft, catalog);
  return draft;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function parseTaggedPolicy(raw: string): PolicyRecommendation {
  if (raw.startsWith("custom:")) {
    return { id: raw, effect: "recommended", risk: "low" };
  }
  const [policyId, effectRaw] = raw.split("::");
  const effect =
    effectRaw === "disabled" || effectRaw === "confirmation_required" ? effectRaw : "recommended";
  return {
    id: policyId || raw,
    effect,
    risk: effect === "recommended" ? "low" : "high",
  };
}

function replacePolicy(list: PolicyRecommendation[], id: string, next: PolicyRecommendation): void {
  const index = list.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    list[index] = next;
  } else {
    list.push(next);
  }
}
