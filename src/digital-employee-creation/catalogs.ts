/**
 * P1 in-memory design catalogs. Mapping layer over legacy templates — not a migration.
 * Tenant Capability Pack IDs are imported so RoleRecipe ids cannot collide.
 */

import { ALL_CAPABILITY_PACKS } from "../gateway/capability-packs/starter-packs.js";
import type { DesignCatalog, PublishedBlueprint, RoleRecipe } from "./types.js";

export const TENANT_CAPABILITY_PACK_IDS: readonly string[] = ALL_CAPABILITY_PACKS.map(
  (pack) => pack.id,
);

export const GROWTH_TEMPLATE_IDS = [
  "generic_worker",
  "contract_reviewer",
  "sales_assistant",
  "personal_mail_assistant",
] as const;

const OFFICE_PROFILE = {
  interactionProfile: { proactiveLevel: "moderate", responseStyle: "concise" },
} as const;

export const PUBLISHED_BLUEPRINTS: readonly PublishedBlueprint[] = [
  {
    blueprintId: "general_office_assistant",
    blueprintVersion: "1.0.0",
    displayName: "通用办公助理",
    family: "general_office",
    role: "office_assistant",
    aliases: ["通用助手", "通用办公助理", "办公助理", "generic_worker"],
    familySignals: ["办公", "助理", "帮忙处理"],
    recipeIds: ["office-base"],
    memorySchema: { entities: ["task", "preference"], memoryTypes: ["note"] },
    taskPatterns: [{ id: "daily_assist", label: "日常办公协助" }],
    policyRecommendations: [{ id: "internal.read", effect: "recommended", risk: "low" }],
    ...OFFICE_PROFILE,
    legacyTemplateId: "generic_worker",
  },
  {
    blueprintId: "sales_assistant",
    blueprintVersion: "1.0.0",
    displayName: "销售助理",
    family: "sales_customer",
    role: "sales_assistant",
    aliases: ["销售助理", "销售助理机器人", "sales assistant", "sales_assistant"],
    familySignals: [],
    recipeIds: ["sales-base"],
    memorySchema: {
      entities: ["customer", "opportunity", "contact"],
      memoryTypes: ["interaction"],
    },
    taskPatterns: [
      { id: "customer_follow_up", label: "客户跟进" },
      { id: "weekly_sales_report", label: "销售周报" },
    ],
    policyRecommendations: [
      { id: "crm.read", effect: "recommended", risk: "low" },
      { id: "crm.write", effect: "disabled", risk: "high" },
      { id: "email.send", effect: "confirmation_required", risk: "high" },
    ],
    ...OFFICE_PROFILE,
    legacyTemplateId: "sales_assistant",
  },
  {
    blueprintId: "sales_operations_analyst",
    blueprintVersion: "1.0.0",
    displayName: "销售运营分析师",
    family: "sales_customer",
    role: "sales_operations_analyst",
    aliases: ["销售运营", "销售分析"],
    familySignals: ["销售数据", "销售周报", "异常提醒"],
    recipeIds: ["sales-ops"],
    memorySchema: { entities: ["pipeline", "metric"], memoryTypes: ["trend"] },
    taskPatterns: [{ id: "sales_anomaly", label: "销售异常提醒" }],
    policyRecommendations: [{ id: "crm.read", effect: "recommended", risk: "low" }],
    interactionProfile: { proactiveLevel: "moderate", responseStyle: "evidence_first" },
  },
  {
    blueprintId: "contract_reviewer",
    blueprintVersion: "1.0.0",
    displayName: "合同审查员",
    family: "legal_risk",
    role: "contract_reviewer",
    aliases: ["合同审查", "合同审查员", "合同审查机器人", "contract_reviewer"],
    familySignals: ["合同", "法务"],
    recipeIds: ["legal-contract"],
    memorySchema: { entities: ["contract", "clause"], memoryTypes: ["finding"] },
    taskPatterns: [{ id: "contract_review", label: "合同审查" }],
    policyRecommendations: [{ id: "document.read", effect: "recommended", risk: "low" }],
    ...OFFICE_PROFILE,
    legacyTemplateId: "contract_reviewer",
  },
  {
    blueprintId: "finance_assistant",
    blueprintVersion: "1.0.0",
    displayName: "财务助理",
    family: "finance_ops",
    role: "finance_assistant",
    aliases: ["财务助理", "财务"],
    familySignals: ["对账", "报销", "费用"],
    recipeIds: ["finance-analysis"],
    memorySchema: { entities: ["ledger_item"], memoryTypes: ["summary"] },
    taskPatterns: [{ id: "finance_review", label: "财务分析" }],
    policyRecommendations: [
      { id: "finance.read", effect: "recommended", risk: "low" },
      { id: "finance.write", effect: "disabled", risk: "high" },
    ],
    interactionProfile: { proactiveLevel: "low", responseStyle: "evidence_first" },
    missingCriticalInputs: ["主要负责对账、费用审核、奖金核算，还是财务分析？"],
  },
  {
    blueprintId: "market_analyst",
    blueprintVersion: "1.0.0",
    displayName: "市场运营分析师",
    family: "marketing_growth",
    role: "market_analyst",
    aliases: ["市场分析师", "市场运营", "竞品研究员"],
    familySignals: ["竞品", "市场报告", "内容效果"],
    recipeIds: ["market-research"],
    memorySchema: {
      entities: ["competitor", "campaign"],
      memoryTypes: ["price_change", "trend"],
    },
    taskPatterns: [
      { id: "competitor_watch", label: "每日竞品监测" },
      { id: "weekly_market_report", label: "每周市场报告" },
    ],
    policyRecommendations: [
      { id: "web.read", effect: "recommended", risk: "low" },
      { id: "public.publish", effect: "confirmation_required", risk: "high" },
    ],
    interactionProfile: { proactiveLevel: "high", responseStyle: "insight_oriented" },
  },
];

export const ROLE_RECIPES: readonly RoleRecipe[] = [
  { recipeId: "office-base", skillKeys: ["summarize"] },
  { recipeId: "sales-base", skillKeys: ["sales-coach", "summarize"] },
  { recipeId: "sales-ops", skillKeys: ["summarize"] },
  { recipeId: "legal-contract", skillKeys: ["nano-pdf", "summarize"] },
  { recipeId: "finance-analysis", skillKeys: ["summarize"] },
  { recipeId: "market-research", skillKeys: ["defuddle", "summarize"] },
  { recipeId: "email-communication", skillKeys: ["personal-mail-assistant"] },
];

export const REGISTERED_SKILL_KEYS: ReadonlySet<string> = new Set(
  ROLE_RECIPES.flatMap((recipe) => recipe.skillKeys),
);

export const DEFAULT_DESIGN_CATALOG: DesignCatalog = {
  blueprints: PUBLISHED_BLUEPRINTS,
  recipes: ROLE_RECIPES,
  skillKeys: REGISTERED_SKILL_KEYS,
};

export const LEGACY_TEMPLATE_INTERPRETATION: Readonly<Record<string, string>> = {
  generic_worker: "general_office_assistant",
  contract_reviewer: "contract_reviewer",
  sales_assistant: "sales_assistant",
  personal_mail_assistant: "email-communication",
};

export function isTenantCapabilityPackId(id: string): boolean {
  return TENANT_CAPABILITY_PACK_IDS.includes(id);
}
