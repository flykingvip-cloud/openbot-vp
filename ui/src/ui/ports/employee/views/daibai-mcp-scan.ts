/**
 * Stage C: role-scoped MCP discovery filter + scan-and-apply entry (no auto-grant).
 *
 * Reads enterprise-data.mcp-discovery.for-seat snapshots (read-only) and ranks items that
 * match 大白 pilot role hints. Primary CTA submits enterprise-data.governance-approvals.create (mcp_tool_mapping);
 * secondary may deeplink EDC for admin Save — never mcp-mapping.upsert, never silent grant / OI open.
 */

import {
  DAIBAI_DEFAULT_TEMPLATE_ID,
  DAIBAI_MCP_SCAN_HINTS_BY_TEMPLATE,
  resolveDaibaiCatalogTemplateId,
  scoreDaibaiMcpHintItem,
  type DaibaiMcpScanHint,
} from "../../../../../../src/gateway/enterprise-data/daibai-mcp-scan-hints.ts";
import { DAIBAI_TEMPLATE_MCP_HINTS } from "./daibai-capability-gaps.ts";

export type DaibaiMcpDiscoveryStatus = "unmapped" | "mapped_pending_grant" | "authorized";

export type DaibaiMcpDiscoveryItem = {
  serverName: string;
  toolName: string;
  status: DaibaiMcpDiscoveryStatus;
  capabilityId: string | null;
  capabilityKey: string | null;
  capabilityDisplayName: string | null;
};

export type DaibaiMcpDiscoverySnapshot = {
  remoteToolsList: "ok" | "unavailable" | "partial";
  gap: "none" | "remote_tools_list_unavailable" | "no_candidates";
  items: readonly DaibaiMcpDiscoveryItem[];
  /**
   * Set when for-seat already applied the shared template prefilter.
   * Stage C must not drop those rows again for the same template.
   */
  filterApplied?: boolean;
  catalogId?: string;
  templateId?: string;
  emptyReason?: DaibaiMcpScanEmptyReason;
  matchedHints?: readonly string[];
};

export type { DaibaiMcpScanHint };

export type DaibaiMcpScanCandidate = {
  serverName: string;
  toolName: string;
  status: DaibaiMcpDiscoveryStatus;
  capabilityId: string | null;
  capabilityKey: string | null;
  capabilityDisplayName: string | null;
  matchScore: number;
  matchedKeywords: readonly string[];
  /** Only unmapped / pending get a CTA; authorized is read-only. */
  cta: "mcp_scan_apply" | null;
  ctaLabel: string | null;
  note: string;
};

export type DaibaiMcpScanEmptyReason =
  | "no_role"
  | "no_candidates"
  | "no_match"
  | "remote_unavailable"
  | null;

export type DaibaiMcpScanResult = {
  catalogId: string;
  templateId: string;
  hasRoleTemplate: boolean;
  candidates: DaibaiMcpScanCandidate[];
  emptyReason: DaibaiMcpScanEmptyReason;
  /** When remote list is unavailable / empty of matches, surface Stage B static MCP hints. */
  staticFallbackHints: readonly { key: string; label: string; note: string }[];
  usedStaticFallback: boolean;
};

export { DAIBAI_MCP_SCAN_HINTS_BY_TEMPLATE };

const STATUS_RANK: Record<DaibaiMcpDiscoveryStatus, number> = {
  unmapped: 0,
  mapped_pending_grant: 1,
  authorized: 2,
};

const APPLY_NOTE =
  "将提交企业审批；通过后由管理员显式开通（不会自动授权）。扫描不会自动 grant，也不会开通运营身份。";

const AUTHORIZED_NOTE = "该 MCP 能力已授权可用；创建路径不会再次 grant。";

const SERVER_ONLY_NOTE = "该条目只有 MCP 服务、没有工具名，不能提交开通申请。";

const MCP_DISCOVERY_PERMISSION_CODES = new Set([
  "NO_CURRENT_SEAT",
  "TENANT_MISMATCH",
  "IDENTITY_CONTEXT_MISSING",
  "MEMBERSHIP_INVALID",
  "TENANT_CONTEXT_MISSING",
]);

/** Permission / identity failures must not be rendered as discovery rows or static hints. */
export function isDaibaiMcpDiscoveryPermissionFailure(error: unknown): boolean {
  if (error && typeof error === "object" && "details" in error) {
    const details = (error as { details?: unknown }).details;
    if (details && typeof details === "object" && "code" in details) {
      const code = (details as { code?: unknown }).code;
      if (typeof code === "string" && MCP_DISCOVERY_PERMISSION_CODES.has(code)) {
        return true;
      }
    }
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (
    message.includes("没有可用席位") ||
    message.includes("必须与当前企业会话一致") ||
    message.includes("无法确认当前企业身份")
  );
}

export function suggestDaibaiMcpScanHints(catalogIdOrTemplateId: string | null | undefined): {
  catalogId: string;
  templateId: string;
  hasRoleTemplate: boolean;
  hints: readonly DaibaiMcpScanHint[];
} {
  const raw = typeof catalogIdOrTemplateId === "string" ? catalogIdOrTemplateId.trim() : "";
  // Accept either catalogId (email/crm/contract) or an already-resolved templateId.
  const asTemplate =
    raw in DAIBAI_MCP_SCAN_HINTS_BY_TEMPLATE ? raw : resolveDaibaiCatalogTemplateId(raw || null);
  const templateId = asTemplate;
  const hasRoleTemplate = templateId !== DAIBAI_DEFAULT_TEMPLATE_ID;
  return {
    catalogId: raw,
    templateId,
    hasRoleTemplate,
    hints: hasRoleTemplate ? (DAIBAI_MCP_SCAN_HINTS_BY_TEMPLATE[templateId] ?? []) : [],
  };
}

function scoreItem(
  item: DaibaiMcpDiscoveryItem,
  hints: readonly DaibaiMcpScanHint[],
): { score: number; matched: string[] } {
  return scoreDaibaiMcpHintItem(item, hints);
}

function ctaForStatus(
  status: DaibaiMcpDiscoveryStatus,
  toolName: string,
): Pick<DaibaiMcpScanCandidate, "cta" | "ctaLabel" | "note"> {
  if (!toolName) {
    return { cta: null, ctaLabel: null, note: SERVER_ONLY_NOTE };
  }
  if (status === "authorized") {
    return { cta: null, ctaLabel: null, note: AUTHORIZED_NOTE };
  }
  if (status === "mapped_pending_grant") {
    return {
      cta: "mcp_scan_apply",
      ctaLabel: "提交席位授权审批",
      note: APPLY_NOTE,
    };
  }
  return {
    cta: "mcp_scan_apply",
    ctaLabel: "提交企业审批",
    note: APPLY_NOTE,
  };
}

/**
 * Filter + rank discovery items for one 大白 catalog role.
 * Never invents candidates: no match → empty list + explicit emptyReason.
 * When remote tools list is unavailable (or gap says so) and there are no matches,
 * attach Stage B static MCP hints as UI fallback (not fake discovery rows).
 */
export function rankOrFilterMcpDiscoveryForDaibaiRole(
  snapshot: DaibaiMcpDiscoverySnapshot | null | undefined,
  catalogId: string | null | undefined,
): DaibaiMcpScanResult {
  const {
    catalogId: cid,
    templateId,
    hasRoleTemplate,
    hints,
  } = suggestDaibaiMcpScanHints(catalogId);
  const staticFallbackHints = DAIBAI_TEMPLATE_MCP_HINTS[templateId] ?? [];

  if (!hasRoleTemplate) {
    return {
      catalogId: cid,
      templateId,
      hasRoleTemplate: false,
      candidates: [],
      emptyReason: "no_role",
      staticFallbackHints: [],
      usedStaticFallback: false,
    };
  }

  const serverTemplate = typeof snapshot?.templateId === "string" ? snapshot.templateId.trim() : "";
  if (snapshot?.filterApplied === true && serverTemplate && serverTemplate !== templateId) {
    return {
      catalogId: cid,
      templateId,
      hasRoleTemplate: true,
      candidates: [],
      emptyReason: "no_match",
      staticFallbackHints,
      usedStaticFallback: staticFallbackHints.length > 0,
    };
  }

  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const trustServerFilter = snapshot?.filterApplied === true && serverTemplate === templateId;
  const remoteToolsList = snapshot?.remoteToolsList ?? "unavailable";
  const gap = snapshot?.gap ?? "remote_tools_list_unavailable";

  const scored: DaibaiMcpScanCandidate[] = [];
  for (const item of items) {
    const serverName = typeof item.serverName === "string" ? item.serverName.trim() : "";
    if (!serverName) {
      continue;
    }
    const toolName = typeof item.toolName === "string" ? item.toolName.trim() : "";
    const status: DaibaiMcpDiscoveryStatus =
      item.status === "authorized" || item.status === "mapped_pending_grant"
        ? item.status
        : "unmapped";
    const { score, matched } = scoreItem(
      {
        serverName,
        toolName,
        status,
        capabilityId: item.capabilityId ?? null,
        capabilityKey: item.capabilityKey ?? null,
        capabilityDisplayName: item.capabilityDisplayName ?? null,
      },
      hints,
    );
    if (score <= 0 && !trustServerFilter) {
      continue;
    }
    const keptScore = score > 0 ? score : 1;
    const keptMatched = matched.length > 0 ? matched : (snapshot?.matchedHints ?? []);
    scored.push({
      serverName,
      toolName,
      status,
      capabilityId: item.capabilityId ?? null,
      capabilityKey: item.capabilityKey ?? null,
      capabilityDisplayName: item.capabilityDisplayName ?? null,
      matchScore: keptScore,
      matchedKeywords: keptMatched,
      ...ctaForStatus(status, toolName),
    });
  }

  scored.sort((left, right) => {
    if (right.matchScore !== left.matchScore) {
      return right.matchScore - left.matchScore;
    }
    const byStatus = STATUS_RANK[left.status] - STATUS_RANK[right.status];
    if (byStatus !== 0) {
      return byStatus;
    }
    const byServer = left.serverName.localeCompare(right.serverName);
    if (byServer !== 0) {
      return byServer;
    }
    return left.toolName.localeCompare(right.toolName);
  });

  if (scored.length > 0) {
    return {
      catalogId: cid,
      templateId,
      hasRoleTemplate: true,
      candidates: scored,
      emptyReason: null,
      staticFallbackHints,
      usedStaticFallback: false,
    };
  }

  const remoteUnavailable =
    remoteToolsList === "unavailable" || gap === "remote_tools_list_unavailable";
  const noCandidates = items.length === 0 || gap === "no_candidates";
  const serverEmpty = snapshot?.emptyReason;
  let emptyReason: DaibaiMcpScanEmptyReason = "no_match";
  if (
    trustServerFilter &&
    (serverEmpty === "no_role" ||
      serverEmpty === "no_candidates" ||
      serverEmpty === "no_match" ||
      serverEmpty === "remote_unavailable")
  ) {
    emptyReason = serverEmpty;
  } else if (remoteUnavailable && items.length === 0) {
    emptyReason = "remote_unavailable";
  } else if (noCandidates) {
    emptyReason = "no_candidates";
  }

  const usedStaticFallback = staticFallbackHints.length > 0;
  return {
    catalogId: cid,
    templateId,
    hasRoleTemplate: true,
    candidates: [],
    emptyReason,
    staticFallbackHints,
    usedStaticFallback,
  };
}

/** Assert helpers for tests: scan CTAs never imply grant / OI open. */
export function daibaiMcpScanCtaIsExplicitApplyOnly(cta: DaibaiMcpScanCandidate["cta"]): boolean {
  return cta === null || cta === "mcp_scan_apply";
}
