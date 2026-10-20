import { isTenantCapabilityPackId } from "./catalogs.js";
import {
  DRAFT_FORBIDDEN_FIELDS,
  type BlueprintDraft,
  type BlueprintValidation,
  type DesignCatalog,
} from "./types.js";

const SECRET_RE = /\b(sk-|ghp_|Bearer\s|api[_-]?key|access[_-]?token)\b/i;
const HIGH_RISK_GRANTED_EFFECTS = new Set(["recommended"]);

export function validateBlueprintDraft(
  draft: BlueprintDraft,
  catalog: DesignCatalog,
): BlueprintValidation {
  const checks: BlueprintValidation["checks"] = [];

  const publishedBlueprintId =
    draft.roleResolution.kind === "published" ? draft.roleResolution.blueprintId : null;
  const roleOk =
    draft.roleResolution.kind === "custom_draft" ||
    (publishedBlueprintId !== null &&
      catalog.blueprints.some((entry) => entry.blueprintId === publishedBlueprintId));
  checks.push({
    id: "role_legal",
    ok: roleOk,
    detail: roleOk
      ? "role resolution is published or explicit custom"
      : "unknown published blueprint",
  });

  const recipeOk = draft.roleRecipeIds.every(
    (id) =>
      catalog.recipes.some((recipe) => recipe.recipeId === id) && !isTenantCapabilityPackId(id),
  );
  checks.push({
    id: "recipe_legal",
    ok: recipeOk,
    detail: recipeOk
      ? "recipes exist and are not tenant packs"
      : "recipe missing or tenant pack id",
  });

  const resolvedSkillsLegal = draft.skillRecommendations.every((entry) => {
    if (entry.status !== "resolved") {
      return !entry.skillKey;
    }
    return Boolean(entry.skillKey && catalog.skillKeys.has(entry.skillKey));
  });
  checks.push({
    id: "skill_keys_valid",
    ok: resolvedSkillsLegal,
    detail: resolvedSkillsLegal
      ? "resolved keys exist in registry"
      : "invented or unknown skillKey",
  });

  const record = draft as unknown as Record<string, unknown>;
  const forbiddenPresent = DRAFT_FORBIDDEN_FIELDS.filter(
    (field) => field in record && record[field] != null,
  );
  checks.push({
    id: "no_forbidden_fields",
    ok: forbiddenPresent.length === 0,
    detail:
      forbiddenPresent.length === 0
        ? "no instance/auth/task fields"
        : `forbidden: ${forbiddenPresent.join(",")}`,
  });

  const blob = JSON.stringify(draft);
  const noEnterpriseSecrets = !SECRET_RE.test(blob);
  checks.push({
    id: "no_enterprise_data",
    ok: noEnterpriseSecrets,
    detail: noEnterpriseSecrets ? "no token/secret material" : "draft contains secret-like text",
  });

  const highRiskLegal = draft.policyRecommendations.every((entry) => {
    if (entry.risk !== "high") {
      return true;
    }
    return entry.effect === "confirmation_required" || entry.effect === "disabled";
  });
  checks.push({
    id: "high_risk_recommendation_only",
    ok: highRiskLegal,
    detail: highRiskLegal
      ? "high-risk policies are confirmation_required or disabled"
      : "high-risk policy treated as granted",
  });

  const inventedGranted = draft.policyRecommendations.some(
    (entry) =>
      entry.risk === "high" &&
      HIGH_RISK_GRANTED_EFFECTS.has(entry.effect) &&
      entry.id.includes("write"),
  );
  checks.push({
    id: "no_high_risk_write_grant",
    ok: !inventedGranted,
    detail: inventedGranted ? "high-risk write marked recommended" : "no high-risk write grant",
  });

  const gapsListed =
    draft.unresolvedCapabilities.length ===
      draft.skillRecommendations.filter((entry) => entry.status === "unresolved").length &&
    (draft.missingCriticalInputs.length === 0 || draft.unresolvedQuestions.length > 0);
  checks.push({
    id: "gaps_honest",
    ok: gapsListed,
    detail: gapsListed ? "gaps listed" : "gaps not reflected on the draft",
  });

  const blocking = checks.filter((check) => !check.ok && check.id !== "gaps_honest");
  const hasGaps =
    draft.missingCriticalInputs.length > 0 ||
    draft.unresolvedCapabilities.length > 0 ||
    draft.unresolvedQuestions.length > 0;

  let status: BlueprintValidation["status"] = "valid";
  if (blocking.length > 0) {
    status = "invalid";
  } else if (hasGaps) {
    status = "valid_with_gaps";
  }

  return { status, checks };
}

export function canShowConfirmationCard(draft: BlueprintDraft): boolean {
  return draft.validation.status === "valid" || draft.validation.status === "valid_with_gaps";
}
