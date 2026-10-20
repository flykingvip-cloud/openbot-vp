import type {
  ControlUiPlatformAuthError,
  ControlUiPlatformAuthState,
  ControlUiPlatformOrganizationSnapshot,
} from "../../../../src/gateway/control-ui-contract.js";
import { CONTROL_UI_ENTERPRISE_BASE_PATH } from "../../../../src/gateway/control-ui-contract.js";
import { normalizeBasePath } from "../navigation.ts";

type EnterpriseSeatAssetsHost = {
  basePath: string;
  platformAuthBusy: boolean;
  platformAuthError: string | null;
  platformAuthState: ControlUiPlatformAuthState | null;
};

type EnterpriseSeatAssetsError = ControlUiPlatformAuthError;

export type EnterpriseSeatAssetsSuccess = {
  ok: true;
  auditId?: string;
  conflicts?: string[];
  emailDelivery?: {
    status: "sent" | "queued" | "failed";
    reason?: "smtp_not_configured" | "unsupported_notification" | "missing_recipient";
    messageId?: string;
    error?: string;
  };
  updatedSnapshot?: {
    organization?: ControlUiPlatformOrganizationSnapshot;
  };
};

export type EnterpriseHandoverTransferSelection = {
  agentIds: string[];
  spaceIds: string[];
  dataKeys: string[];
  policyIds: string[];
};

type EnterpriseSeatCreateSuccess = EnterpriseSeatAssetsSuccess & {
  seat: {
    seatId: string;
    title: string;
    teamLabel?: string;
    responsibility?: string;
    roleCode?: string;
    status: string;
    defaultSpaceIds: string[];
    defaultAgentAssetIds: string[];
    createdAt: string;
    updatedAt: string;
  };
};

type EnterpriseSeatListSuccess = EnterpriseSeatAssetsSuccess & {
  seats: Array<{
    seatId: string;
    tenantId: string;
    title: string;
    teamLabel?: string;
    responsibility?: string;
    roleCode?: string;
    status: string;
    currentEmployeeId?: string;
    defaultSpaceIds: string[];
    defaultAgentAssetIds: string[];
    createdAt: string;
    updatedAt: string;
  }>;
};

type EnterpriseHandoverDetailSuccess = EnterpriseSeatAssetsSuccess & {
  handover: {
    handoverCaseId: string;
    seatId: string;
    seatTitle?: string;
    seatStatus?: string;
    status: string;
    reviewSummary?: string;
    exceptionFlags: string[];
    approvedBy?: string;
    outgoingEmployee?: {
      userId: string;
      email: string;
      displayName: string;
    };
    incomingEmployee?: {
      userId: string;
      email: string;
      displayName: string;
    };
  };
};

type EnterpriseSeatDetailSuccess = EnterpriseSeatAssetsSuccess & {
  detail: {
    seat: {
      seatId: string;
      title: string;
      teamLabel?: string;
      responsibility?: string;
      roleCode?: string;
      status: string;
      defaultAgentIds: string[];
      defaultSpaceIds: string[];
    };
    currentEmployee?: {
      userId: string;
      email: string;
      displayName: string;
      status?: string;
      membershipRole?: string;
    };
    binding?: {
      bindingId: string;
      employeeId: string;
      status: string;
      effectiveAt: string;
      endedAt?: string;
      endedReason?: string;
    };
    handover?: {
      handoverCaseId: string;
      status: string;
      reviewSummary?: string;
      exceptionFlags?: string[];
      approvedBy?: string;
      createdAt?: string;
      updatedAt?: string;
      completedAt?: string;
    };
    access: {
      employeePolicies: Array<{
        policyId: string;
        subjectId: string;
        resourceType: string;
        resourceId: string;
        action: string;
        createdAt: string;
      }>;
      seatPolicies: Array<{
        policyId: string;
        subjectId: string;
        resourceType: string;
        resourceId: string;
        action: string;
        createdAt: string;
      }>;
    };
  };
};

function buildEnterpriseUrl(basePath: string, tenantId: string, suffix: string): string {
  const normalizedBase = normalizeBasePath(basePath ?? "");
  const root = normalizedBase
    ? `${normalizedBase}${CONTROL_UI_ENTERPRISE_BASE_PATH}`
    : CONTROL_UI_ENTERPRISE_BASE_PATH;
  return `${root}/${encodeURIComponent(tenantId)}${suffix}`;
}

function trimErrorMessage(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatEnterpriseSeatAssetsError(
  payload: EnterpriseSeatAssetsError | null,
  status: number,
): string {
  const fallback = trimErrorMessage(payload?.error) || `Request failed (${status})`;
  switch (payload?.code) {
    case "ENTERPRISE_ASSETS_NOT_ENABLED":
      return "当前企业岗位资产服务尚未启用：请先启用平台登录（gateway.auth.trustedProxy.platformAuth），并使用企业管理员账号进入企业端。";
    case "ENTERPRISE_ASSETS_UNAUTHORIZED":
      return "当前登录会话已失效或未登录，请先以企业管理员身份登录后再创建岗位。";
    case "ENTERPRISE_ASSETS_ADMIN_REQUIRED":
      return "当前账号不是企业管理员，无法创建或维护岗位。请切换企业管理员账号后重试。";
    case "ENTERPRISE_ASSETS_TENANT_FORBIDDEN":
      return "当前账号没有该企业租户的管理权限，请切换到正确企业或管理员账号。";
    case "ENTERPRISE_ASSETS_TENANT_REQUIRED":
      return "缺少企业租户上下文，请从企业端组织与数字人页面重新进入。";
    case "ENTERPRISE_ASSETS_LOCAL_ONLY":
      return "当前入口未被识别为已配置的企业控制台（公网域名或本机控制台）。请通过 openbot.love 或本机 Control UI 登录企业管理员后再试。";
    case "ENTERPRISE_ASSETS_INVALID_BODY":
      return "提交内容格式不正确，请检查岗位名称、所属团队和岗位职责后重试。";
    case "ENTERPRISE_ASSETS_SEAT_TITLE_REQUIRED":
      return "请输入岗位名称。";
    case "ENTERPRISE_ASSETS_SEAT_CREATE_FAILED":
      return `岗位创建失败：${fallback}`;
    case "ENTERPRISE_ASSETS_MEMBER_NOT_FOUND":
      return "该邮箱还不是当前企业的已激活成员，不能直接发送岗位绑定确认。请先通过“邀请激活/批量发送激活”把该员工加入当前企业后，再发送岗位绑定确认。";
    case "ENTERPRISE_ASSETS_MEMBER_INACTIVE":
      return "该员工还未完成激活，暂时不能发送岗位绑定确认。请先完成企业成员激活后再重试。";
    default:
      return fallback;
  }
}

function extractEnterpriseSeatAssetsError(
  payload: EnterpriseSeatAssetsSuccess | EnterpriseSeatAssetsError | null,
): EnterpriseSeatAssetsError | null {
  return payload && "ok" in payload && !payload.ok ? payload : null;
}

function applyEnterpriseSnapshot(
  host: EnterpriseSeatAssetsHost,
  snapshot: EnterpriseSeatAssetsSuccess["updatedSnapshot"] | undefined,
) {
  if (!host.platformAuthState || !snapshot?.organization) {
    return;
  }
  host.platformAuthState = {
    ...host.platformAuthState,
    organization: snapshot.organization,
  };
}

async function postEnterpriseCommand(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  suffix: string,
  body?: Record<string, unknown>,
): Promise<EnterpriseSeatAssetsSuccess> {
  const response = await fetch(buildEnterpriseUrl(host.basePath, tenantId, suffix), {
    method: "POST",
    headers: body
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { Accept: "application/json" },
    credentials: "same-origin",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json().catch(() => null)) as
    | EnterpriseSeatAssetsSuccess
    | EnterpriseSeatAssetsError
    | null;
  if (!response.ok || !payload || !payload.ok) {
    throw new Error(
      formatEnterpriseSeatAssetsError(extractEnterpriseSeatAssetsError(payload), response.status),
    );
  }
  applyEnterpriseSnapshot(host, payload.updatedSnapshot);
  return payload;
}

async function getEnterpriseResource<T>(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  suffix: string,
): Promise<T> {
  const response = await fetch(buildEnterpriseUrl(host.basePath, tenantId, suffix), {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as T | EnterpriseSeatAssetsError | null;
  if (!response.ok || !payload || (typeof payload === "object" && "ok" in payload && !payload.ok)) {
    throw new Error(
      formatEnterpriseSeatAssetsError(
        payload && typeof payload === "object" && "ok" in payload && !payload.ok ? payload : null,
        response.status,
      ),
    );
  }
  if (payload && typeof payload === "object" && "updatedSnapshot" in payload) {
    applyEnterpriseSnapshot(
      host,
      (payload as { updatedSnapshot?: EnterpriseSeatAssetsSuccess["updatedSnapshot"] })
        .updatedSnapshot,
    );
  }
  return payload as T;
}

export async function getEnterpriseHandoverDetail(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  handoverCaseId: string,
): Promise<EnterpriseHandoverDetailSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await getEnterpriseResource<EnterpriseHandoverDetailSuccess>(
      host,
      tenantId,
      `/handover/${encodeURIComponent(handoverCaseId)}`,
    );
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function getEnterpriseSeatDetail(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  seatId: string,
): Promise<EnterpriseSeatDetailSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await getEnterpriseResource<EnterpriseSeatDetailSuccess>(
      host,
      tenantId,
      `/seats/${encodeURIComponent(seatId)}`,
    );
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function listEnterpriseSeats(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
): Promise<EnterpriseSeatListSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await getEnterpriseResource<EnterpriseSeatListSuccess>(host, tenantId, "/seats");
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function startEnterpriseSeatHandover(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  seatId: string,
): Promise<EnterpriseSeatAssetsSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await postEnterpriseCommand(host, tenantId, "/handover/start", { seatId });
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function createEnterpriseSeat(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  params: {
    seatTitle: string;
    teamLabel?: string | null;
    responsibility?: string | null;
    defaultAgentId?: string | null;
    agentIds?: string[];
  },
  options?: { manageBusy?: boolean },
): Promise<EnterpriseSeatCreateSuccess | void> {
  const manageBusy = options?.manageBusy !== false;
  if (manageBusy) {
    host.platformAuthBusy = true;
  }
  host.platformAuthError = null;
  try {
    return (await postEnterpriseCommand(host, tenantId, "/seats", {
      seatTitle: params.seatTitle,
      ...(params.teamLabel?.trim() ? { teamLabel: params.teamLabel.trim() } : {}),
      ...(params.responsibility?.trim() ? { responsibility: params.responsibility.trim() } : {}),
    })) as EnterpriseSeatCreateSuccess;
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    if (manageBusy) {
      host.platformAuthBusy = false;
    }
  }
}

export async function updateEnterpriseSeatProfile(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  seatId: string,
  params: {
    seatTitle?: string | null;
    teamLabel?: string | null;
    responsibility?: string | null;
    defaultAgentId?: string | null;
    agentIds?: string[];
  },
): Promise<EnterpriseSeatCreateSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return (await postEnterpriseCommand(
      host,
      tenantId,
      `/seats/${encodeURIComponent(seatId)}/assets`,
      {
        ...(params.seatTitle?.trim() ? { seatTitle: params.seatTitle.trim() } : {}),
        ...(params.teamLabel !== undefined ? { teamLabel: params.teamLabel?.trim() ?? "" } : {}),
        ...(params.responsibility !== undefined
          ? { responsibility: params.responsibility?.trim() ?? "" }
          : {}),
        ...(params.defaultAgentId !== undefined
          ? { defaultAgentId: params.defaultAgentId?.trim() ?? "" }
          : {}),
        ...(params.agentIds ? { agentIds: params.agentIds } : {}),
      },
    )) as EnterpriseSeatCreateSuccess;
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function sendEnterpriseSeatAssignmentOffer(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  seatId: string,
  employeeEmail: string,
  inheritMode: "full" | "selective",
  agentIds: string[],
  defaultSpaceIds: string[],
  inheritMemoryScope: boolean,
): Promise<EnterpriseSeatAssetsSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await postEnterpriseCommand(
      host,
      tenantId,
      `/seats/${encodeURIComponent(seatId)}/offers`,
      {
        employeeEmail,
        inheritMode,
        ...(inheritMode === "selective"
          ? {
              agentIds,
              defaultSpaceIds,
              inheritMemoryScope,
            }
          : {}),
      },
    );
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function cancelEnterpriseSeatAssignmentOffer(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  offerId: string,
): Promise<EnterpriseSeatAssetsSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await postEnterpriseCommand(
      host,
      tenantId,
      `/offers/${encodeURIComponent(offerId)}/cancel`,
      {},
    );
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function remindEnterpriseSeatAssignmentOffer(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  offerId: string,
): Promise<EnterpriseSeatAssetsSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await postEnterpriseCommand(
      host,
      tenantId,
      `/offers/${encodeURIComponent(offerId)}/remind`,
      {},
    );
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function nominateEnterpriseSeatHandover(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  handoverCaseId: string,
  employeeEmail: string,
): Promise<EnterpriseSeatAssetsSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await postEnterpriseCommand(
      host,
      tenantId,
      `/handover/${encodeURIComponent(handoverCaseId)}/nominate`,
      { employeeEmail },
    );
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function reviewEnterpriseSeatHandover(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  handoverCaseId: string,
  reviewSummary: string,
  exceptionFlags: string[] = [],
  transferSelection?: EnterpriseHandoverTransferSelection,
): Promise<EnterpriseSeatAssetsSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await postEnterpriseCommand(
      host,
      tenantId,
      `/handover/${encodeURIComponent(handoverCaseId)}/review`,
      {
        reviewSummary,
        exceptionFlags,
        ...(transferSelection ? { transferSelection } : {}),
      },
    );
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function approveEnterpriseSeatHandover(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  handoverCaseId: string,
): Promise<EnterpriseSeatAssetsSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await postEnterpriseCommand(
      host,
      tenantId,
      `/handover/${encodeURIComponent(handoverCaseId)}/approve`,
      {},
    );
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export async function rebindEnterpriseSeatHandover(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  handoverCaseId: string,
  employeeEmail: string,
): Promise<EnterpriseSeatAssetsSuccess | void> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return await postEnterpriseCommand(
      host,
      tenantId,
      `/handover/${encodeURIComponent(handoverCaseId)}/rebind`,
      { employeeEmail },
    );
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}

export type EnterpriseOrganizationDepartmentMutation = {
  action:
    | "create"
    | "rename"
    | "move"
    | "delete"
    | "move-seat"
    | "delete-seat"
    | "delete-seat-and-member"
    | "merge"
    | "sync-structure"
    | "reorder-children";
  path?: string | null;
  label?: string | null;
  parentPath?: string | null;
  seatId?: string | null;
  targetPath?: string | null;
  paths?: string[] | null;
  orderedKeys?: string[] | null;
};

export async function mutateEnterpriseOrganizationDepartment(
  host: EnterpriseSeatAssetsHost,
  tenantId: string,
  mutation: EnterpriseOrganizationDepartmentMutation,
): Promise<
  (EnterpriseSeatAssetsSuccess & { fullPath?: string; affectedSeatIds?: string[] }) | void
> {
  host.platformAuthBusy = true;
  host.platformAuthError = null;
  try {
    return (await postEnterpriseCommand(host, tenantId, "/organization/departments", {
      action: mutation.action,
      ...(mutation.path ? { path: mutation.path } : {}),
      ...(mutation.label ? { label: mutation.label } : {}),
      ...(mutation.parentPath !== undefined ? { parentPath: mutation.parentPath } : {}),
      ...(mutation.seatId ? { seatId: mutation.seatId } : {}),
      ...(mutation.targetPath ? { targetPath: mutation.targetPath } : {}),
      ...(mutation.paths?.length ? { paths: mutation.paths } : {}),
      ...(mutation.orderedKeys?.length ? { orderedKeys: mutation.orderedKeys } : {}),
    })) as EnterpriseSeatAssetsSuccess & {
      fullPath?: string;
      affectedSeatIds?: string[];
      createdPaths?: string[];
    };
  } catch (error) {
    host.platformAuthError = error instanceof Error ? error.message : String(error);
  } finally {
    host.platformAuthBusy = false;
  }
}
