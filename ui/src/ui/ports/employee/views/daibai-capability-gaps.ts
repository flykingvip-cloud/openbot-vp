/**
 * Stage B: after 大白 catalog create + Stage A skill preload, summarize what is
 * still missing so the success page can show an apply checklist.
 *
 * Pure / static: mirrors Growth template `requiredCapabilities` for pilots and
 * static OI / MCP / seat hints. Never grants oauth, MCP, OI, or seat.
 *
 * Keep requiredCapabilities in sync with
 * `src/gateway/agent-growth/templates/index.ts` for the three pilots.
 */

import {
  DAIBAI_DEFAULT_TEMPLATE_ID,
  resolveDaibaiCatalogTemplateId,
} from "./daibai-catalog-template-id.ts";

export type DaibaiGapKind = "skill" | "oauth" | "knowledge_binding" | "mcp" | "oi" | "seat";

/** Explicit apply target — wired to existing flows only; never silent grant. */
export type DaibaiGapCtaKind =
  | "oauth_authorize"
  | "bind_knowledge"
  | "mcp_admin_save"
  | "mcp_scan_apply"
  | "apply_personal_oi"
  | "apply_enterprise_oi"
  | "contact_admin_seat";

/** Optional deeplink context for Stage C scan CTAs (mcpServer / mcpTool). */
export type DaibaiGapApplyDeeplink = {
  mcpServer?: string;
  mcpTool?: string;
  capabilityId?: string | null;
  /** When mapped_pending_grant, prefer authorization edc over capabilities. */
  edc?: "capabilities" | "authorization";
  /** Optional capability-access request id for admin EDC fulfill context. */
  approvalId?: string;
};

export type DaibaiGapStatus = "preloaded" | "pending" | "recommended" | "check_unavailable";

export type DaibaiCapabilityGapItem = {
  key: string;
  kind: DaibaiGapKind;
  label: string;
  status: DaibaiGapStatus;
  /** Null when the row is informational only (e.g. already preloaded). */
  cta: DaibaiGapCtaKind | null;
  ctaLabel: string | null;
  note?: string;
};

export type DaibaiCapabilityGapSummary = {
  catalogId: string;
  templateId: string;
  /** True when catalog mapped to a non-generic Growth template. */
  hasRoleTemplate: boolean;
  items: DaibaiCapabilityGapItem[];
};

type TemplateCap = {
  key: string;
  kind: "skill" | "oauth" | "knowledge_binding" | "workflow";
  label: string;
  required: boolean;
};

/** Snapshot of Growth pilot `requiredCapabilities` (UI-safe; no gateway import). */
export const DAIBAI_TEMPLATE_REQUIRED_CAPABILITIES: Readonly<
  Record<string, readonly TemplateCap[]>
> = {
  personal_mail_assistant: [
    { key: "personal_email", kind: "oauth", label: "个人邮箱授权", required: true },
  ],
  sales_assistant: [
    { key: "crm", kind: "skill", label: "CRM 技能", required: true },
    { key: "crm_oauth", kind: "oauth", label: "CRM 系统授权", required: true },
  ],
  contract_reviewer: [
    { key: "contract_review", kind: "skill", label: "合同审查技能", required: true },
    { key: "contract_kb", kind: "knowledge_binding", label: "合同知识库", required: true },
    { key: "approval_system", kind: "oauth", label: "审批系统授权", required: true },
  ],
  generic_worker: [],
};

/** Stage B static OI recommendations (personal / enterprise); never auto-open. */
export const DAIBAI_TEMPLATE_RECOMMENDED_OI: Readonly<
  Record<string, readonly { key: string; scope: "personal" | "enterprise"; label: string }[]>
> = {
  personal_mail_assistant: [
    { key: "oi_personal_mail", scope: "personal", label: "个人运营身份（邮箱/渠道）" },
  ],
  sales_assistant: [
    { key: "oi_personal_sales", scope: "personal", label: "个人运营身份（客户触达）" },
    { key: "oi_enterprise_crm", scope: "enterprise", label: "企业运营身份（CRM）" },
  ],
  contract_reviewer: [
    { key: "oi_enterprise_legal", scope: "enterprise", label: "企业运营身份（审批/法务）" },
  ],
  generic_worker: [],
};

/** Static MCP hints — Stage C scan falls back to these when discovery is empty/unavailable. */
export const DAIBAI_TEMPLATE_MCP_HINTS: Readonly<
  Record<string, readonly { key: string; label: string; note: string }[]>
> = {
  personal_mail_assistant: [],
  sales_assistant: [
    {
      key: "mcp_crm",
      label: "CRM / 客户系统 MCP",
      note: "仅发现与管理员显式 Save；创建不会自动 grant。",
    },
  ],
  contract_reviewer: [
    {
      key: "mcp_approval",
      label: "审批系统 MCP",
      note: "仅发现与管理员显式 Save；创建不会自动 grant。",
    },
  ],
  generic_worker: [],
};

const SEAT_NOTE =
  "席位 / 权益状态暂无法自动检测；若预装技能不可用，请联系企业管理员核对 seat / entitlement。";

function ctaForOauth(): Pick<DaibaiCapabilityGapItem, "cta" | "ctaLabel"> {
  return { cta: "oauth_authorize", ctaLabel: "去授权连接" };
}

function ctaForKnowledge(): Pick<DaibaiCapabilityGapItem, "cta" | "ctaLabel"> {
  return { cta: "bind_knowledge", ctaLabel: "去绑定知识库" };
}

function ctaForMcp(): Pick<DaibaiCapabilityGapItem, "cta" | "ctaLabel"> {
  return { cta: "mcp_admin_save", ctaLabel: "去数据能力中心（管理员 Save）" };
}

function ctaForOi(
  scope: "personal" | "enterprise",
): Pick<DaibaiCapabilityGapItem, "cta" | "ctaLabel"> {
  return scope === "enterprise"
    ? { cta: "apply_enterprise_oi", ctaLabel: "提交企业审批" }
    : { cta: "apply_personal_oi", ctaLabel: "提交企业审批" };
}

/**
 * Summarize post-create gaps for one catalog member.
 * Skills are marked preloaded (Stage A auto-install); oauth / KB / MCP / OI / seat stay pending.
 */
export function summarizeDaibaiPostCreateGaps(
  catalogId: string | null | undefined,
): DaibaiCapabilityGapSummary {
  const trimmed = typeof catalogId === "string" ? catalogId.trim() : "";
  const templateId = resolveDaibaiCatalogTemplateId(trimmed || null);
  const hasRoleTemplate = templateId !== DAIBAI_DEFAULT_TEMPLATE_ID;
  const items: DaibaiCapabilityGapItem[] = [];

  if (!hasRoleTemplate) {
    return { catalogId: trimmed, templateId, hasRoleTemplate: false, items };
  }

  const caps = DAIBAI_TEMPLATE_REQUIRED_CAPABILITIES[templateId] ?? [];
  for (const cap of caps) {
    if (!cap.required) {
      continue;
    }
    if (cap.kind === "skill") {
      items.push({
        key: cap.key,
        kind: "skill",
        label: cap.label,
        status: "preloaded",
        cta: null,
        ctaLabel: null,
        note: "创建时已触发岗位技能预装（不自动授权连接）。",
      });
      continue;
    }
    if (cap.kind === "oauth") {
      items.push({
        key: cap.key,
        kind: "oauth",
        label: cap.label,
        status: "pending",
        ...ctaForOauth(),
        note: "需你在现有授权流中显式完成，不会静默开通。",
      });
      continue;
    }
    if (cap.kind === "knowledge_binding") {
      items.push({
        key: cap.key,
        kind: "knowledge_binding",
        label: cap.label,
        status: "pending",
        ...ctaForKnowledge(),
        note: "需绑定知识库后才能审查材料。",
      });
      continue;
    }
    // workflow: display-only pending, no invented CTA
    items.push({
      key: cap.key,
      kind: "skill",
      label: cap.label,
      status: "pending",
      cta: null,
      ctaLabel: null,
      note: "工作流能力待上岗培养中配置（本阶段不改培养主流程）。",
    });
  }

  for (const hint of DAIBAI_TEMPLATE_MCP_HINTS[templateId] ?? []) {
    items.push({
      key: hint.key,
      kind: "mcp",
      label: hint.label,
      status: "pending",
      ...ctaForMcp(),
      note: hint.note,
    });
  }

  for (const oi of DAIBAI_TEMPLATE_RECOMMENDED_OI[templateId] ?? []) {
    items.push({
      key: oi.key,
      kind: "oi",
      label: oi.label,
      status: "recommended",
      ...ctaForOi(oi.scope),
      note: "提交企业审批；通过后由本人或管理员显式开通，不会自动授权。",
    });
  }

  items.push({
    key: "seat_entitlement",
    kind: "seat",
    label: "岗位席位 / 权益",
    status: "check_unavailable",
    cta: "contact_admin_seat",
    ctaLabel: "联系管理员核对",
    note: SEAT_NOTE,
  });

  return { catalogId: trimmed, templateId, hasRoleTemplate: true, items };
}

export function summarizeDaibaiPostCreateGapsForMembers(
  members: ReadonlyArray<{ catalogId: string; name?: string }>,
): Array<DaibaiCapabilityGapSummary & { name?: string }> {
  return members.map((member) => ({
    ...summarizeDaibaiPostCreateGaps(member.catalogId),
    name: member.name,
  }));
}

/** Pending / recommended rows that still need an explicit apply action. */
export function listDaibaiActionableGaps(
  summary: DaibaiCapabilityGapSummary,
): DaibaiCapabilityGapItem[] {
  return summary.items.filter((item) => item.cta !== null && item.status !== "preloaded");
}
