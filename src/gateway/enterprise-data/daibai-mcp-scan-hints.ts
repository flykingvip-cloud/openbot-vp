/**
 * Shared 大白 Stage C MCP keyword hints.
 *
 * Server `mcp-discovery.for-seat` and the employee Stage C ranker both import
 * this module so template filters cannot drift.
 */

export const DAIBAI_DEFAULT_TEMPLATE_ID = "generic_worker" as const;

/** Stable catalogId → templateId for Stage A pilots. */
export const DAIBAI_CATALOG_TEMPLATE_ID: Readonly<Record<string, string>> = {
  email: "personal_mail_assistant",
  crm: "sales_assistant",
  contract: "contract_reviewer",
};

export type DaibaiMcpScanHint = {
  /** Match against serverName / toolName / capabilityKey / displayName (case-insensitive). */
  keywords: readonly string[];
  /** Human label for this hint group. */
  label: string;
};

export type DaibaiMcpScanEmptyReason =
  | "no_role"
  | "no_candidates"
  | "no_match"
  | "remote_unavailable"
  | null;

/** Static role → keyword hints for pilots (email / crm / contract). */
export const DAIBAI_MCP_SCAN_HINTS_BY_TEMPLATE: Readonly<
  Record<string, readonly DaibaiMcpScanHint[]>
> = {
  personal_mail_assistant: [
    {
      label: "邮箱 / 邮件通道",
      keywords: ["mail", "email", "gmail", "outlook", "imap", "smtp", "mailbox"],
    },
  ],
  sales_assistant: [
    {
      label: "CRM / 客户系统",
      keywords: ["crm", "salesforce", "hubspot", "customer", "lead", "opportunity", "sales"],
    },
  ],
  contract_reviewer: [
    {
      label: "审批 / 合同系统",
      keywords: [
        "contract",
        "approval",
        "legal",
        "workflow",
        "docusign",
        "esign",
        "e-sign",
        "签章",
        "审批",
        "合同",
      ],
    },
  ],
  generic_worker: [],
};

export type DaibaiMcpHintItem = {
  serverName: string;
  toolName: string;
  capabilityKey?: string | null;
  capabilityDisplayName?: string | null;
};

export function resolveDaibaiCatalogTemplateId(catalogId: string | null | undefined): string {
  const key = typeof catalogId === "string" ? catalogId.trim() : "";
  if (!key) {
    return DAIBAI_DEFAULT_TEMPLATE_ID;
  }
  return DAIBAI_CATALOG_TEMPLATE_ID[key] ?? DAIBAI_DEFAULT_TEMPLATE_ID;
}

export function isKnownDaibaiTemplateId(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(DAIBAI_MCP_SCAN_HINTS_BY_TEMPLATE, value);
}

export function isKnownDaibaiCatalogId(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(DAIBAI_CATALOG_TEMPLATE_ID, value);
}

/**
 * Seat roleCode counts as a member binding only when it is exactly a known
 * catalog or template id. Other role codes stay unfiltered.
 */
export function daibaiRoleBindingFromSessionRole(roleCode: string | null | undefined): {
  catalogId?: string;
  templateId?: string;
} | null {
  const role = typeof roleCode === "string" ? roleCode.trim() : "";
  if (!role) {
    return null;
  }
  if (isKnownDaibaiTemplateId(role)) {
    return { templateId: role };
  }
  if (isKnownDaibaiCatalogId(role)) {
    return { catalogId: role };
  }
  return null;
}

export type DaibaiMcpRoleFilter = {
  /** True when the caller or session binding named a catalog/template. */
  specified: boolean;
  catalogId: string;
  templateId: string;
  hasRoleTemplate: boolean;
  hints: readonly DaibaiMcpScanHint[];
};

export function resolveDaibaiMcpRoleFilter(input: {
  catalogId?: string | null;
  templateId?: string | null;
}): DaibaiMcpRoleFilter {
  const catalogId = typeof input.catalogId === "string" ? input.catalogId.trim() : "";
  const templateId = typeof input.templateId === "string" ? input.templateId.trim() : "";
  if (!catalogId && !templateId) {
    return {
      specified: false,
      catalogId: "",
      templateId: "",
      hasRoleTemplate: false,
      hints: [],
    };
  }

  let resolvedTemplate: string = DAIBAI_DEFAULT_TEMPLATE_ID;
  if (templateId && isKnownDaibaiTemplateId(templateId)) {
    resolvedTemplate = templateId;
  } else if (catalogId) {
    resolvedTemplate = resolveDaibaiCatalogTemplateId(catalogId);
  }

  const hasRoleTemplate = resolvedTemplate !== DAIBAI_DEFAULT_TEMPLATE_ID;
  return {
    specified: true,
    catalogId,
    templateId: resolvedTemplate,
    hasRoleTemplate,
    hints: hasRoleTemplate ? (DAIBAI_MCP_SCAN_HINTS_BY_TEMPLATE[resolvedTemplate] ?? []) : [],
  };
}

export function scoreDaibaiMcpHintItem(
  item: DaibaiMcpHintItem,
  hints: readonly DaibaiMcpScanHint[],
): { score: number; matched: string[] } {
  const hay = [
    item.serverName,
    item.toolName,
    item.capabilityKey ?? "",
    item.capabilityDisplayName ?? "",
  ]
    .join("\0")
    .toLowerCase();
  const matched: string[] = [];
  let score = 0;
  for (const hint of hints) {
    for (const keyword of hint.keywords) {
      const needle = keyword.trim().toLowerCase();
      if (!needle) {
        continue;
      }
      if (hay.includes(needle)) {
        matched.push(keyword);
        const inServer = item.serverName.toLowerCase().includes(needle);
        const inTool = item.toolName.toLowerCase().includes(needle);
        score += inServer || inTool ? 3 : 1;
      }
    }
  }
  return { score, matched };
}

export function emptyReasonForUnmatchedDaibaiMcpItems(input: {
  itemCount: number;
  remoteToolsList?: "ok" | "unavailable" | "partial" | null;
  gap?: "none" | "remote_tools_list_unavailable" | "no_candidates" | null;
}): Exclude<DaibaiMcpScanEmptyReason, "no_role"> {
  const remoteUnavailable =
    input.remoteToolsList === "unavailable" || input.gap === "remote_tools_list_unavailable";
  const noCandidates = input.itemCount === 0 || input.gap === "no_candidates";
  if (remoteUnavailable && input.itemCount === 0) {
    return "remote_unavailable";
  }
  if (noCandidates) {
    return "no_candidates";
  }
  return "no_match";
}
