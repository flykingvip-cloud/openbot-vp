import type {
  WorkbenchAgentDesignMappingView,
  WorkbenchAgentDesignState,
  WorkbenchDesignTagCategory,
  WorkbenchDesignTagDraft,
} from "./workbench-types.ts";

export type DesignRoleFamilyId =
  | "general_office"
  | "sales_customer"
  | "legal_risk"
  | "finance_ops"
  | "marketing_growth"
  | "hr"
  | "customer_service"
  | "tech_operations";

export type DesignRoleFamily = {
  id: DesignRoleFamilyId;
  label: string;
  aliases: readonly string[];
};

export type DesignCatalogRole = {
  id: string;
  familyId: DesignRoleFamilyId;
  label: string;
  published: boolean;
  emoji: string;
  capabilities: readonly string[];
  workModes: readonly string[];
  permissions: readonly string[];
};

export type DesignCatalogTag = {
  id: string;
  category: WorkbenchDesignTagCategory;
  label: string;
  familyIds?: readonly DesignRoleFamilyId[];
};

const CJK_RE = /[\u4e00-\u9fff]/;

export const DESIGN_ROLE_FAMILIES: readonly DesignRoleFamily[] = [
  { id: "general_office", label: "通用办公", aliases: [] },
  { id: "sales_customer", label: "销售与客户", aliases: [] },
  { id: "legal_risk", label: "合同与法务", aliases: ["contract_legal"] },
  { id: "finance_ops", label: "财务", aliases: ["finance"] },
  { id: "marketing_growth", label: "市场与增长", aliases: ["content_marketing"] },
  { id: "hr", label: "人事", aliases: [] },
  { id: "customer_service", label: "客户服务", aliases: [] },
  { id: "tech_operations", label: "技术运营", aliases: [] },
];

export const DESIGN_CATALOG_ROLES: readonly DesignCatalogRole[] = [
  {
    id: "general_office_assistant",
    familyId: "general_office",
    label: "通用办公助理",
    published: true,
    emoji: "🤖",
    capabilities: ["summarize"],
    workModes: ["daily_assist"],
    permissions: ["internal.read::recommended"],
  },
  {
    id: "sales_assistant",
    familyId: "sales_customer",
    label: "销售助理",
    published: true,
    emoji: "💼",
    capabilities: ["sales-coach", "summarize"],
    workModes: ["customer_follow_up", "weekly_sales_report"],
    permissions: [
      "crm.read::recommended",
      "crm.write::disabled",
      "email.send::confirmation_required",
    ],
  },
  {
    id: "sales_operations_analyst",
    familyId: "sales_customer",
    label: "销售运营分析师",
    published: true,
    emoji: "📈",
    capabilities: ["summarize"],
    workModes: ["sales_anomaly", "weekly_sales_report"],
    permissions: ["crm.read::recommended"],
  },
  {
    id: "contract_reviewer",
    familyId: "legal_risk",
    label: "合同审查员",
    published: true,
    emoji: "📄",
    capabilities: ["nano-pdf", "summarize"],
    workModes: ["contract_review"],
    permissions: ["document.read::recommended"],
  },
  {
    id: "finance_assistant",
    familyId: "finance_ops",
    label: "财务助理",
    published: true,
    emoji: "💰",
    capabilities: ["summarize"],
    workModes: ["finance_review"],
    permissions: ["finance.read::recommended", "finance.write::disabled"],
  },
  {
    id: "market_analyst",
    familyId: "marketing_growth",
    label: "市场运营分析师",
    published: true,
    emoji: "📊",
    capabilities: ["defuddle", "summarize"],
    workModes: ["competitor_watch", "weekly_market_report"],
    permissions: ["web.read::recommended", "public.publish::confirmation_required"],
  },
  {
    id: "hr_assistant",
    familyId: "hr",
    label: "人事助理",
    published: false,
    emoji: "👥",
    capabilities: ["summarize"],
    workModes: ["daily_assist"],
    permissions: ["internal.read::recommended"],
  },
  {
    id: "customer_service_assistant",
    familyId: "customer_service",
    label: "客服助理",
    published: false,
    emoji: "🎧",
    capabilities: ["summarize"],
    workModes: ["daily_assist"],
    permissions: ["internal.read::recommended", "email.send::confirmation_required"],
  },
  {
    id: "tech_operations_assistant",
    familyId: "tech_operations",
    label: "技术运营助理",
    published: false,
    emoji: "🛠️",
    capabilities: ["summarize", "defuddle"],
    workModes: ["daily_assist"],
    permissions: ["web.read::recommended", "internal.read::recommended"],
  },
];

export const DESIGN_CAPABILITY_TAGS: readonly DesignCatalogTag[] = [
  { id: "summarize", category: "capability", label: "摘要整理" },
  {
    id: "sales-coach",
    category: "capability",
    label: "销售辅导",
    familyIds: ["sales_customer"],
  },
  {
    id: "nano-pdf",
    category: "capability",
    label: "PDF 阅读",
    familyIds: ["legal_risk", "finance_ops", "general_office"],
  },
  {
    id: "defuddle",
    category: "capability",
    label: "网页内容提炼",
    familyIds: ["marketing_growth", "tech_operations"],
  },
  {
    id: "personal-mail-assistant",
    category: "capability",
    label: "个人邮件助手",
    familyIds: ["general_office", "sales_customer", "customer_service"],
  },
];

export const DESIGN_WORK_MODE_TAGS: readonly DesignCatalogTag[] = [
  { id: "daily_assist", category: "workMode", label: "日常办公协助" },
  {
    id: "customer_follow_up",
    category: "workMode",
    label: "客户跟进",
    familyIds: ["sales_customer"],
  },
  {
    id: "weekly_sales_report",
    category: "workMode",
    label: "销售周报",
    familyIds: ["sales_customer"],
  },
  {
    id: "sales_anomaly",
    category: "workMode",
    label: "销售异常提醒",
    familyIds: ["sales_customer"],
  },
  {
    id: "contract_review",
    category: "workMode",
    label: "合同审查",
    familyIds: ["legal_risk"],
  },
  {
    id: "finance_review",
    category: "workMode",
    label: "财务分析",
    familyIds: ["finance_ops"],
  },
  {
    id: "competitor_watch",
    category: "workMode",
    label: "每日竞品监测",
    familyIds: ["marketing_growth"],
  },
  {
    id: "weekly_market_report",
    category: "workMode",
    label: "每周市场报告",
    familyIds: ["marketing_growth"],
  },
];

export const DESIGN_PERMISSION_TAGS: readonly DesignCatalogTag[] = [
  { id: "internal.read::recommended", category: "permission", label: "读取内部资料" },
  {
    id: "crm.read::recommended",
    category: "permission",
    label: "读取客户资料",
    familyIds: ["sales_customer"],
  },
  {
    id: "crm.write::disabled",
    category: "permission",
    label: "禁止改写客户资料",
    familyIds: ["sales_customer"],
  },
  {
    id: "email.send::confirmation_required",
    category: "permission",
    label: "发送邮件需确认",
  },
  {
    id: "document.read::recommended",
    category: "permission",
    label: "读取文档",
    familyIds: ["legal_risk", "general_office"],
  },
  {
    id: "finance.read::recommended",
    category: "permission",
    label: "读取财务数据",
    familyIds: ["finance_ops"],
  },
  {
    id: "finance.write::disabled",
    category: "permission",
    label: "禁止改写财务数据",
    familyIds: ["finance_ops"],
  },
  {
    id: "web.read::recommended",
    category: "permission",
    label: "浏览公开网页",
    familyIds: ["marketing_growth", "tech_operations"],
  },
  {
    id: "public.publish::confirmation_required",
    category: "permission",
    label: "对外发布需确认",
    familyIds: ["marketing_growth"],
  },
];

const FAMILY_ALIAS: Record<string, DesignRoleFamilyId> = Object.fromEntries(
  DESIGN_ROLE_FAMILIES.flatMap((family) => [
    [family.id, family.id],
    ...family.aliases.map((alias) => [alias, family.id] as const),
  ]),
) as Record<string, DesignRoleFamilyId>;

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function slugifyTagLabel(label: string): string {
  const compact = label.trim().toLowerCase().replace(/\s+/g, "-");
  return compact.slice(0, 24) || "tag";
}

export function emptyDesignTagDraft(): WorkbenchDesignTagDraft {
  return {
    familyId: "general_office",
    roleId: "general_office_assistant",
    capabilities: [],
    workModes: [],
    permissions: [],
    customTags: [],
    addingCategory: null,
    addingText: "",
  };
}

export function findDesignFamily(id: string | undefined): DesignRoleFamily | undefined {
  if (!id) {
    return undefined;
  }
  const normalized = FAMILY_ALIAS[id] ?? id;
  return DESIGN_ROLE_FAMILIES.find((family) => family.id === normalized);
}

export function findDesignRole(id: string | undefined): DesignCatalogRole | undefined {
  if (!id) {
    return undefined;
  }
  return DESIGN_CATALOG_ROLES.find((role) => role.id === id);
}

export function rolesInFamily(familyId: string): DesignCatalogRole[] {
  const family = findDesignFamily(familyId);
  if (!family) {
    return [];
  }
  return DESIGN_CATALOG_ROLES.filter((role) => role.familyId === family.id);
}

function catalogTags(category: WorkbenchDesignTagCategory): readonly DesignCatalogTag[] {
  if (category === "capability") {
    return DESIGN_CAPABILITY_TAGS;
  }
  if (category === "workMode") {
    return DESIGN_WORK_MODE_TAGS;
  }
  return DESIGN_PERMISSION_TAGS;
}

function selectedIds(
  draft: WorkbenchDesignTagDraft,
  category: WorkbenchDesignTagCategory,
): string[] {
  if (category === "capability") {
    return draft.capabilities;
  }
  if (category === "workMode") {
    return draft.workModes;
  }
  return draft.permissions;
}

function withSelectedIds(
  draft: WorkbenchDesignTagDraft,
  category: WorkbenchDesignTagCategory,
  ids: string[],
): WorkbenchDesignTagDraft {
  if (category === "capability") {
    return { ...draft, capabilities: unique(ids) };
  }
  if (category === "workMode") {
    return { ...draft, workModes: unique(ids) };
  }
  return { ...draft, permissions: unique(ids) };
}

export function findDesignTag(
  id: string,
  category: WorkbenchDesignTagCategory,
  draft?: WorkbenchDesignTagDraft | null,
): DesignCatalogTag | undefined {
  const catalog = catalogTags(category).find((tag) => tag.id === id);
  if (catalog) {
    return catalog;
  }
  return draft?.customTags.find((tag) => tag.id === id && tag.category === category);
}

export function labelForDesignTag(
  id: string,
  category: WorkbenchDesignTagCategory,
  draft?: WorkbenchDesignTagDraft | null,
): string {
  return findDesignTag(id, category, draft)?.label ?? id;
}

function matchWorkModeId(label: string): string | null {
  const trimmed = label.trim();
  const found = DESIGN_WORK_MODE_TAGS.find((tag) => tag.label === trimmed || tag.id === trimmed);
  return found?.id ?? null;
}

function matchCapabilityId(need: string, skillKey?: string): string | null {
  const candidates = [skillKey, need].filter((value): value is string => Boolean(value?.trim()));
  for (const candidate of candidates) {
    const found = DESIGN_CAPABILITY_TAGS.find(
      (tag) => tag.id === candidate || tag.label === candidate,
    );
    if (found) {
      return found.id;
    }
  }
  return skillKey?.trim() || null;
}

function permissionTagId(id: string, effect: string): string {
  return `${id}::${effect}`;
}

function parsePermissionTagId(id: string): { policyId: string; effect: string } {
  const [policyId, effect] = id.split("::");
  return { policyId: policyId || id, effect: effect || "recommended" };
}

function permissionRisk(effect: string): string {
  return effect === "recommended" ? "low" : "high";
}

function inferFamilyId(mapping: WorkbenchAgentDesignMappingView): DesignRoleFamilyId {
  const byBlueprint = findDesignRole(mapping.role.blueprintId);
  if (byBlueprint) {
    return byBlueprint.familyId;
  }
  const byLabel = DESIGN_CATALOG_ROLES.find(
    (role) => role.label === mapping.role.display || role.id === mapping.role.display,
  );
  if (byLabel) {
    return byLabel.familyId;
  }
  return "general_office";
}

function inferRoleId(
  mapping: WorkbenchAgentDesignMappingView,
  familyId: DesignRoleFamilyId,
): string {
  const byBlueprint = findDesignRole(mapping.role.blueprintId);
  if (byBlueprint) {
    return byBlueprint.id;
  }
  const byLabel = DESIGN_CATALOG_ROLES.find(
    (role) => role.label === mapping.role.display || role.id === mapping.role.display,
  );
  if (byLabel) {
    return byLabel.id;
  }
  return rolesInFamily(familyId)[0]?.id ?? "general_office_assistant";
}

export function tagDraftFromMapping(
  mapping: WorkbenchAgentDesignMappingView | null,
): WorkbenchDesignTagDraft {
  if (!mapping) {
    return emptyDesignTagDraft();
  }
  const familyId = inferFamilyId(mapping);
  const roleId = inferRoleId(mapping, familyId);
  const customTags: WorkbenchDesignTagDraft["customTags"] = [];
  const capabilities: string[] = [];
  for (const entry of mapping.capabilities) {
    const matched = matchCapabilityId(entry.need, entry.skillKey);
    if (matched && DESIGN_CAPABILITY_TAGS.some((tag) => tag.id === matched)) {
      capabilities.push(matched);
      continue;
    }
    const label = (CJK_RE.test(entry.need) ? entry.need : entry.skillKey) || entry.need;
    if (!label.trim()) {
      continue;
    }
    const id = `custom:capability:${slugifyTagLabel(label)}`;
    customTags.push({ id, category: "capability", label: label.trim() });
    capabilities.push(id);
  }
  const workModes: string[] = [];
  for (const pattern of mapping.workMode.taskPatterns) {
    const matched = matchWorkModeId(pattern);
    if (matched) {
      workModes.push(matched);
      continue;
    }
    if (!pattern.trim()) {
      continue;
    }
    const id = `custom:workMode:${slugifyTagLabel(pattern)}`;
    customTags.push({ id, category: "workMode", label: pattern.trim() });
    workModes.push(id);
  }
  const permissions: string[] = [];
  for (const entry of mapping.safetyBoundary) {
    const id = permissionTagId(entry.id, entry.effect);
    if (DESIGN_PERMISSION_TAGS.some((tag) => tag.id === id)) {
      permissions.push(id);
      continue;
    }
    const label = entry.id;
    const customId = `custom:permission:${slugifyTagLabel(`${entry.id}-${entry.effect}`)}`;
    customTags.push({ id: customId, category: "permission", label });
    permissions.push(customId);
  }
  return {
    familyId,
    roleId,
    capabilities: unique(capabilities),
    workModes: unique(workModes),
    permissions: unique(permissions),
    customTags,
    addingCategory: null,
    addingText: "",
  };
}

export function resolveTagDraft(design: WorkbenchAgentDesignState): WorkbenchDesignTagDraft {
  return design.tagDraft ?? tagDraftFromMapping(design.mapping);
}

export function selectDesignFamily(
  draft: WorkbenchDesignTagDraft,
  familyId: string,
): WorkbenchDesignTagDraft {
  const family = findDesignFamily(familyId);
  if (!family) {
    return draft;
  }
  const current = findDesignRole(draft.roleId);
  if (current?.familyId === family.id) {
    return { ...draft, familyId: family.id, addingCategory: null, addingText: "" };
  }
  const nextRole = rolesInFamily(family.id)[0];
  if (!nextRole) {
    return { ...draft, familyId: family.id };
  }
  return selectDesignRole(draft, nextRole.id);
}

export function selectDesignRole(
  draft: WorkbenchDesignTagDraft,
  roleId: string,
): WorkbenchDesignTagDraft {
  const role = findDesignRole(roleId);
  if (!role) {
    return draft;
  }
  const customByCategory = (category: WorkbenchDesignTagCategory) =>
    draft.customTags.filter((tag) => tag.category === category).map((tag) => tag.id);
  return {
    ...draft,
    familyId: role.familyId,
    roleId: role.id,
    capabilities: unique([...role.capabilities, ...customByCategory("capability")]),
    workModes: unique([...role.workModes, ...customByCategory("workMode")]),
    permissions: unique([...role.permissions, ...customByCategory("permission")]),
    addingCategory: null,
    addingText: "",
  };
}

export function removeDesignTag(
  draft: WorkbenchDesignTagDraft,
  category: WorkbenchDesignTagCategory,
  id: string,
): WorkbenchDesignTagDraft {
  const next = withSelectedIds(
    draft,
    category,
    selectedIds(draft, category).filter((entry) => entry !== id),
  );
  return {
    ...next,
    customTags: next.customTags.filter((tag) => tag.id !== id),
  };
}

export function addDesignTag(
  draft: WorkbenchDesignTagDraft,
  category: WorkbenchDesignTagCategory,
  id: string,
): WorkbenchDesignTagDraft {
  return withSelectedIds(draft, category, [...selectedIds(draft, category), id]);
}

export function beginAddingDesignTag(
  draft: WorkbenchDesignTagDraft,
  category: WorkbenchDesignTagCategory,
): WorkbenchDesignTagDraft {
  return { ...draft, addingCategory: category, addingText: "" };
}

export function cancelAddingDesignTag(draft: WorkbenchDesignTagDraft): WorkbenchDesignTagDraft {
  return { ...draft, addingCategory: null, addingText: "" };
}

export function commitCustomDesignTag(draft: WorkbenchDesignTagDraft): WorkbenchDesignTagDraft {
  const category = draft.addingCategory;
  const label = draft.addingText.trim();
  if (!category || !label) {
    return cancelAddingDesignTag(draft);
  }
  const existing = [
    ...catalogTags(category),
    ...draft.customTags.filter((tag) => tag.category === category),
  ].find((tag) => tag.label === label || tag.id === label);
  if (existing) {
    return cancelAddingDesignTag(addDesignTag(draft, category, existing.id));
  }
  const id = `custom:${category}:${slugifyTagLabel(label)}`;
  return cancelAddingDesignTag({
    ...addDesignTag(draft, category, id),
    customTags: [...draft.customTags, { id, category, label }],
  });
}

export function suggestionsForCategory(
  draft: WorkbenchDesignTagDraft,
  category: WorkbenchDesignTagCategory,
): DesignCatalogTag[] {
  const selected = new Set(selectedIds(draft, category));
  const role = findDesignRole(draft.roleId);
  const familyId = findDesignFamily(draft.familyId)?.id;
  const ranked = catalogTags(category)
    .filter((tag) => !selected.has(tag.id))
    .slice()
    .toSorted((left, right) => {
      const rank = (tag: DesignCatalogTag) => {
        if (role && selectedIdsFromRole(role, category).includes(tag.id)) {
          return 0;
        }
        if (familyId && tag.familyIds?.includes(familyId)) {
          return 1;
        }
        return 2;
      };
      return rank(left) - rank(right);
    });
  return ranked.slice(0, 6);
}

function selectedIdsFromRole(
  role: DesignCatalogRole,
  category: WorkbenchDesignTagCategory,
): readonly string[] {
  if (category === "capability") {
    return role.capabilities;
  }
  if (category === "workMode") {
    return role.workModes;
  }
  return role.permissions;
}

export function applyTagDraftToMapping(
  mapping: WorkbenchAgentDesignMappingView,
  draft: WorkbenchDesignTagDraft,
): WorkbenchAgentDesignMappingView {
  const role = findDesignRole(draft.roleId);
  return {
    ...mapping,
    role: {
      ...mapping.role,
      display: role?.label ?? mapping.role.display,
      blueprintId: role?.id ?? mapping.role.blueprintId,
      resolutionKind: role?.published ? "published" : "custom_draft",
    },
    capabilities: draft.capabilities.map((id) => {
      const tag = findDesignTag(id, "capability", draft);
      const custom = id.startsWith("custom:");
      return {
        need: tag?.label ?? id,
        status: custom ? "unresolved" : "resolved",
        ...(custom ? {} : { skillKey: id }),
      };
    }),
    workMode: {
      ...mapping.workMode,
      taskPatterns: draft.workModes.map((id) => labelForDesignTag(id, "workMode", draft)),
    },
    safetyBoundary: draft.permissions.map((id) => {
      if (id.startsWith("custom:")) {
        return { id, effect: "recommended", risk: "low" };
      }
      const parsed = parsePermissionTagId(id);
      return {
        id: parsed.policyId,
        effect: parsed.effect,
        risk: permissionRisk(parsed.effect),
      };
    }),
  };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

export function tagDraftDiffersFromMapping(
  draft: WorkbenchDesignTagDraft,
  mapping: WorkbenchAgentDesignMappingView | null,
): boolean {
  const initial = tagDraftFromMapping(mapping);
  return (
    draft.familyId !== initial.familyId ||
    draft.roleId !== initial.roleId ||
    !sameIds(draft.capabilities, initial.capabilities) ||
    !sameIds(draft.workModes, initial.workModes) ||
    !sameIds(draft.permissions, initial.permissions)
  );
}

function permissionRevisionPhrase(id: string, draft: WorkbenchDesignTagDraft): string {
  const label = labelForDesignTag(id, "permission", draft);
  if (id.startsWith("custom:")) {
    return label;
  }
  const { effect } = parsePermissionTagId(id);
  if (effect === "disabled") {
    return label.startsWith("禁止") ? label : `禁止${label}`;
  }
  if (effect === "confirmation_required") {
    return label.includes("确认") ? label : `${label}前先确认`;
  }
  return label.startsWith("读取") || label.startsWith("浏览") ? `可${label}` : label;
}

export function buildRevisionFromTagDraft(design: WorkbenchAgentDesignState): string | null {
  const mapping = design.mapping;
  if (!mapping) {
    return null;
  }
  const draft = resolveTagDraft(design);
  if (!tagDraftDiffersFromMapping(draft, mapping)) {
    return null;
  }
  const role = findDesignRole(draft.roleId);
  const capabilityLabels = draft.capabilities.map((id) =>
    labelForDesignTag(id, "capability", draft),
  );
  const workModeLabels = draft.workModes.map((id) => labelForDesignTag(id, "workMode", draft));
  const permissionLabels = draft.permissions.map((id) => permissionRevisionPhrase(id, draft));
  const parts = [`角色改为${role?.label ?? mapping.role.display}`];
  if (capabilityLabels.length > 0) {
    parts.push(`需要能力：${capabilityLabels.join("、")}`);
  }
  if (workModeLabels.length > 0) {
    parts.push(`工作方式：${workModeLabels.join("、")}`);
  }
  if (permissionLabels.length > 0) {
    parts.push(permissionLabels.join("；"));
  }
  const tokens = [
    ...draft.capabilities.map((id) => `tag.skill:${id}`),
    ...draft.workModes.map((id) => `tag.mode:${id}`),
    ...draft.permissions.map((id) => `tag.policy:${id}`),
  ];
  return `${parts.join("。")}。\n${tokens.join("\n")}`;
}
