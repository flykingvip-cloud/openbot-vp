/**
 * 大白成功页「我的申请」摘要（设计 §8.2.3）。
 * 只做状态映射与列表整理；不调用 mcp-mapping.upsert / grants.upsert / OI authorize。
 * 列表数据来自 enterprise-data.governance-approvals.list（非管理员已被网关限定为 requestedBy=self）。
 */

export const DAIBAI_CAPABILITY_ACCESS_CATEGORIES = [
  "mcp_tool_mapping",
  "oi_enrollment",
  "pack_skill_review",
] as const;

export type DaibaiMyApplicationStatus = "pending" | "approved" | "rejected" | "cancelled";

export type DaibaiApplicationProductStatus =
  | "submitted"
  | "in_review"
  | "approved_pending_save"
  | "fulfilled"
  | "rejected"
  | "cancelled"
  | "approved";

export const DAIBAI_APPLICATION_STATUS_LABEL: Record<DaibaiApplicationProductStatus, string> = {
  submitted: "已提交",
  in_review: "审批中",
  approved_pending_save: "已批准（待管理员开通）",
  fulfilled: "已开通",
  rejected: "已拒绝",
  cancelled: "已撤回",
  approved: "已批准",
};

export type DaibaiMyApplication = {
  approvalId: string;
  category: string;
  displayName: string;
  status: DaibaiMyApplicationStatus;
  reviewState?: string;
  fulfillmentStatus?: string;
  subjectId?: string;
  subjectPayload?: Record<string, unknown>;
  requestedAt?: string;
  requestedBy?: string;
};

export type DaibaiApplicationEdcTarget = {
  mcpServer: string;
  mcpTool: string;
  approvalId: string;
  edc: "capabilities";
};

const CAPABILITY_RANK: Record<string, number> = Object.fromEntries(
  DAIBAI_CAPABILITY_ACCESS_CATEGORIES.map((category, index) => [category, index]),
);

const APPLICATION_STATUSES = new Set<DaibaiMyApplicationStatus>([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

/**
 * Product status for the success-page summary.
 * pending + submitted（缺省 reviewState 也视为已提交）/ in_review；
 * approved + pending_admin_save|failed → 待管理员开通；fulfilled → 已开通。
 */
export function resolveDaibaiApplicationProductStatus(request: {
  status?: string;
  reviewState?: string;
  fulfillmentStatus?: string;
}): DaibaiApplicationProductStatus {
  if (request.status === "rejected") {
    return "rejected";
  }
  if (request.status === "cancelled") {
    return "cancelled";
  }
  if (request.status === "approved") {
    if (request.fulfillmentStatus === "fulfilled") {
      return "fulfilled";
    }
    if (
      request.fulfillmentStatus === "pending_admin_save" ||
      request.fulfillmentStatus === "failed"
    ) {
      return "approved_pending_save";
    }
    return "approved";
  }
  if (request.reviewState === "in_review") {
    return "in_review";
  }
  return "submitted";
}

export function daibaiApplicationStatusLabel(request: {
  status?: string;
  reviewState?: string;
  fulfillmentStatus?: string;
}): string {
  return DAIBAI_APPLICATION_STATUS_LABEL[resolveDaibaiApplicationProductStatus(request)];
}

export function daibaiApplicationCategoryLabel(category: string): string {
  switch (category) {
    case "mcp_tool_mapping":
      return "MCP 工具映射";
    case "oi_enrollment":
      return "运营身份开通";
    case "pack_skill_review":
      return "技能包审核";
    default:
      return "其他申请";
  }
}

export function daibaiApplicationCanCancel(request: { status?: string }): boolean {
  return request.status === "pending";
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseMcpSubjectId(
  subjectId: string | undefined,
): { mcpServer: string; mcpTool: string } | null {
  if (!subjectId?.startsWith("mcp:")) {
    return null;
  }
  const payload = subjectId.slice("mcp:".length);
  const slash = payload.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  try {
    const mcpServer = decodeURIComponent(payload.slice(0, slash)).trim();
    const mcpTool = decodeURIComponent(payload.slice(slash + 1)).trim();
    if (!mcpServer) {
      return null;
    }
    return { mcpServer, mcpTool };
  } catch {
    return null;
  }
}

/** Admin EDC deeplink only for approved MCP rows still waiting on explicit Save. */
export function daibaiApplicationAdminEdcTarget(
  request: DaibaiMyApplication,
): DaibaiApplicationEdcTarget | null {
  if (request.category !== "mcp_tool_mapping") {
    return null;
  }
  if (resolveDaibaiApplicationProductStatus(request) !== "approved_pending_save") {
    return null;
  }
  const payload = request.subjectPayload ?? {};
  const fromPayloadServer = textField(payload.mcpServer);
  const fromPayloadTool = textField(payload.mcpTool);
  const parsed = parseMcpSubjectId(request.subjectId);
  const mcpServer = fromPayloadServer || parsed?.mcpServer || "";
  const mcpTool = fromPayloadTool || parsed?.mcpTool || "";
  if (!mcpServer) {
    return null;
  }
  return {
    mcpServer,
    mcpTool,
    approvalId: request.approvalId,
    edc: "capabilities",
  };
}

export function sortDaibaiMyApplications<T extends { category: string; requestedAt?: string }>(
  items: readonly T[],
): T[] {
  return items.toSorted((a, b) => {
    const rankA = CAPABILITY_RANK[a.category] ?? 10;
    const rankB = CAPABILITY_RANK[b.category] ?? 10;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return (b.requestedAt ?? "").localeCompare(a.requestedAt ?? "");
  });
}

/** Server rows win on approvalId so a later list refresh replaces the optimistic submit. */
export function mergeDaibaiMyApplications(
  listed: readonly DaibaiMyApplication[],
  optimistic: readonly DaibaiMyApplication[],
): DaibaiMyApplication[] {
  const byId = new Map<string, DaibaiMyApplication>();
  for (const item of optimistic) {
    byId.set(item.approvalId, item);
  }
  for (const item of listed) {
    byId.set(item.approvalId, item);
  }
  return sortDaibaiMyApplications([...byId.values()]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseDaibaiMyApplication(value: unknown): DaibaiMyApplication | null {
  const row = asRecord(value);
  if (!row) {
    return null;
  }
  const approvalId = textField(row.approvalId);
  const status = textField(row.status);
  if (!approvalId || !APPLICATION_STATUSES.has(status as DaibaiMyApplicationStatus)) {
    return null;
  }
  const displayName = textField(row.displayName) || approvalId;
  const subjectPayload = asRecord(row.subjectPayload) ?? undefined;
  return {
    approvalId,
    category: textField(row.category),
    displayName,
    status: status as DaibaiMyApplicationStatus,
    ...(textField(row.reviewState) ? { reviewState: textField(row.reviewState) } : {}),
    ...(textField(row.fulfillmentStatus)
      ? { fulfillmentStatus: textField(row.fulfillmentStatus) }
      : {}),
    ...(textField(row.subjectId) ? { subjectId: textField(row.subjectId) } : {}),
    ...(subjectPayload ? { subjectPayload } : {}),
    ...(textField(row.requestedAt) ? { requestedAt: textField(row.requestedAt) } : {}),
    ...(textField(row.requestedBy) ? { requestedBy: textField(row.requestedBy) } : {}),
  };
}

/** Accept `{ requests: [...] }` from governance-approvals.list, or a bare array. */
export function parseDaibaiMyApplicationsResponse(payload: unknown): DaibaiMyApplication[] {
  const root = asRecord(payload);
  const raw = Array.isArray(payload) ? payload : Array.isArray(root?.requests) ? root.requests : [];
  const parsed: DaibaiMyApplication[] = [];
  for (const item of raw) {
    const application = parseDaibaiMyApplication(item);
    if (application) {
      parsed.push(application);
    }
  }
  return sortDaibaiMyApplications(parsed);
}

export function buildOptimisticDaibaiOiApplication(input: {
  approvalId: string;
  identityScope: "personal" | "enterprise";
  identityId: string;
  targetAgentId: string;
  catalogId?: string;
  displayName?: string;
  requestedAt?: string;
}): DaibaiMyApplication {
  const identityId = input.identityId.trim();
  const targetAgentId = input.targetAgentId.trim();
  const displayName =
    input.displayName?.trim() ||
    (input.identityScope === "enterprise" ? `企业 OI ${identityId}` : `个人 OI ${identityId}`);
  return {
    approvalId: input.approvalId.trim(),
    category: "oi_enrollment",
    displayName,
    status: "pending",
    reviewState: "submitted",
    fulfillmentStatus: "not_required",
    subjectPayload: {
      identityScope: input.identityScope,
      identityId,
      targetAgentId,
      ...(input.catalogId?.trim() ? { catalogId: input.catalogId.trim() } : {}),
    },
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  };
}

export function buildOptimisticDaibaiMcpApplication(input: {
  approvalId: string;
  mcpServer: string;
  mcpTool: string;
  catalogId?: string;
  requestedAt?: string;
}): DaibaiMyApplication {
  const mcpServer = input.mcpServer.trim();
  const mcpTool = input.mcpTool.trim();
  return {
    approvalId: input.approvalId.trim(),
    category: "mcp_tool_mapping",
    displayName: mcpTool ? `${mcpServer} / ${mcpTool}` : mcpServer,
    status: "pending",
    reviewState: "submitted",
    fulfillmentStatus: "not_required",
    subjectPayload: {
      mcpServer,
      mcpTool,
      ...(input.catalogId?.trim() ? { catalogId: input.catalogId.trim() } : {}),
    },
    requestedAt: input.requestedAt ?? new Date().toISOString(),
  };
}
