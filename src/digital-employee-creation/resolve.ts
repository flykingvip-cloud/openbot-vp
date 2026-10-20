import type {
  DesignCatalog,
  EmployeeDesignIntent,
  RoleHypothesis,
  RoleResolution,
} from "./types.js";

function haystack(intent: EmployeeDesignIntent): string {
  return [
    intent.rawRequest,
    ...intent.desiredOutcomes,
    ...intent.responsibilities,
    ...intent.constraints,
  ]
    .join("\n")
    .toLowerCase();
}

const ROLE_OVERRIDE_HYPOTHESES = [
  { names: ["销售助理"], family: "sales_customer", role: "sales_assistant" },
  {
    names: ["销售运营分析师", "销售运营"],
    family: "sales_customer",
    role: "sales_operations_analyst",
  },
  { names: ["合同审查员", "合同审查"], family: "legal_risk", role: "contract_reviewer" },
  { names: ["财务助理"], family: "finance_ops", role: "finance_assistant" },
  { names: ["市场运营分析师", "市场分析师"], family: "marketing_growth", role: "market_analyst" },
  { names: ["通用办公助理", "办公助理"], family: "general_office", role: "office_assistant" },
  { names: ["人事助理"], family: "hr", role: "hr_assistant" },
  { names: ["客服助理"], family: "customer_service", role: "customer_service_assistant" },
  { names: ["技术运营助理"], family: "tech_operations", role: "tech_operations_assistant" },
] as const;

function includesAny(text: string, needles: readonly string[]): string | null {
  for (const needle of needles) {
    const normalized = needle.toLowerCase();
    if (normalized && text.includes(normalized)) {
      return needle;
    }
  }
  return null;
}

function latestRoleOverride(intent: EmployeeDesignIntent): string | null {
  const matches = [...intent.rawRequest.matchAll(/角色改为([^\n。]+)/g)];
  const last = matches.at(-1)?.[1]?.trim();
  return last || null;
}

export function hypothesizeRole(intent: EmployeeDesignIntent): RoleHypothesis {
  const override = latestRoleOverride(intent);
  if (override) {
    const mapped = ROLE_OVERRIDE_HYPOTHESES.find((entry) =>
      (entry.names as readonly string[]).includes(override),
    );
    if (mapped) {
      return {
        family: mapped.family,
        role: mapped.role,
        confidence: 0.95,
        evidence: [`角色改为${override}`],
      };
    }
  }
  const text = haystack(intent);
  if (includesAny(text, ["销售助理", "sales assistant"])) {
    return {
      family: "sales_customer",
      role: "sales_assistant",
      confidence: 0.9,
      evidence: ["销售助理"],
    };
  }
  if (includesAny(text, ["销售数据", "销售周报", "异常"])) {
    return {
      family: "sales_customer",
      role: "sales_operations_analyst",
      confidence: 0.82,
      evidence: ["销售数据/周报/异常"].filter(Boolean),
    };
  }
  if (includesAny(text, ["竞品", "市场报告", "内容效果"])) {
    return {
      family: "marketing_growth",
      role: "market_analyst",
      confidence: 0.84,
      evidence: ["竞品/市场"],
    };
  }
  if (includesAny(text, ["合同", "法务"])) {
    return {
      family: "legal_risk",
      role: "contract_reviewer",
      confidence: 0.86,
      evidence: ["合同/法务"],
    };
  }
  if (includesAny(text, ["财务"])) {
    return {
      family: "finance_ops",
      role: "finance_assistant",
      confidence: 0.8,
      evidence: ["财务"],
    };
  }
  return {
    family: "general_office",
    role: "office_assistant",
    confidence: 0.4,
    evidence: ["未匹配到更具体职位"],
  };
}

/** D2: Registry fact. Must not copy hypothesis.role into selected id blindly. */
export function resolvePublishedRole(
  intent: EmployeeDesignIntent,
  catalog: DesignCatalog = { blueprints: [], recipes: [], skillKeys: new Set() },
): RoleResolution {
  const override = latestRoleOverride(intent);
  if (override) {
    const matched = catalog.blueprints.find(
      (blueprint) =>
        blueprint.displayName === override ||
        blueprint.blueprintId === override ||
        blueprint.aliases.includes(override),
    );
    if (matched) {
      return {
        kind: "published",
        blueprintId: matched.blueprintId,
        blueprintVersion: matched.blueprintVersion,
        matchedBy: "exact",
      };
    }
    return { kind: "custom_draft", reason: "role override has no published blueprint" };
  }
  const text = haystack(intent);
  for (const blueprint of catalog.blueprints) {
    const alias = includesAny(text, blueprint.aliases);
    if (alias) {
      return {
        kind: "published",
        blueprintId: blueprint.blueprintId,
        blueprintVersion: blueprint.blueprintVersion,
        matchedBy: alias === blueprint.blueprintId || alias === blueprint.role ? "exact" : "alias",
      };
    }
  }
  for (const blueprint of catalog.blueprints) {
    if (includesAny(text, blueprint.familySignals)) {
      return {
        kind: "published",
        blueprintId: blueprint.blueprintId,
        blueprintVersion: blueprint.blueprintVersion,
        matchedBy: "family",
      };
    }
  }
  return { kind: "custom_draft", reason: "no published blueprint matched the request" };
}

export function resolveSkillNeed(
  need: string,
  catalog: DesignCatalog,
): { skillKey?: string; status: "resolved" | "unresolved"; unresolvedReason?: string } {
  const trimmed = need.trim();
  if (catalog.skillKeys.has(trimmed)) {
    return { skillKey: trimmed, status: "resolved" };
  }
  const lowered = trimmed.toLowerCase();
  for (const skillKey of catalog.skillKeys) {
    if (skillKey.toLowerCase() === lowered) {
      return { skillKey, status: "resolved" };
    }
  }
  return {
    status: "unresolved",
    unresolvedReason: `skill not in registry: ${trimmed}`,
  };
}

/** Known capability phrases that are not Registry keys. Never invent a skillKey. */
export const UNRESOLVED_CAPABILITY_PHRASES = [
  { needles: ["客户流失", "customer churn", "churn"], need: "customer-churn-analysis" },
] as const;

export function detectCapabilityNeeds(
  text: string,
  catalog: DesignCatalog,
): Array<{
  need: string;
  skillKey?: string;
  status: "resolved" | "unresolved";
  unresolvedReason?: string;
}> {
  const lowered = text.toLowerCase();
  const results: Array<{
    need: string;
    skillKey?: string;
    status: "resolved" | "unresolved";
    unresolvedReason?: string;
  }> = [];
  for (const phrase of UNRESOLVED_CAPABILITY_PHRASES) {
    if (phrase.needles.some((needle) => lowered.includes(needle.toLowerCase()))) {
      results.push({ need: phrase.need, ...resolveSkillNeed(phrase.need, catalog) });
    }
  }
  return results;
}
