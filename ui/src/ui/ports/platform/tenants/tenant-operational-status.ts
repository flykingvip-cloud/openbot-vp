/**
 * Platform tenant pause / resume.
 *
 * Calls `platform.tenant.pause` and `platform.tenant.resume`. Success is only
 * the returned status matching the intent. This does not call
 * `agent-runtime.update-lifecycle` and does not pretend agents were drained.
 */

export const TENANT_PAUSE_METHOD = "platform.tenant.pause";
export const TENANT_RESUME_METHOD = "platform.tenant.resume";

export type TenantOperationalIntent = "suspended" | "active";

export type TenantOperationalStatusResult =
  | {
      ok: true;
      tenantId: string;
      status: TenantOperationalIntent;
      previousStatus: "active" | "inactive" | "suspended";
    }
  | { ok: false; error: string };

const PREVIOUS_STATUSES = new Set(["active", "inactive", "suspended"]);

export function tenantOperationalGate(params: {
  scopes: readonly string[] | null | undefined;
  clientConnected: boolean;
  canManagePlatform: boolean;
}): { allowed: boolean; reason: string } {
  if (!params.clientConnected) {
    return { allowed: false, reason: "网关未连接，暂停与恢复当前不可执行" };
  }
  if (!params.canManagePlatform) {
    return { allowed: false, reason: "需要平台管理员会话才能暂停或恢复租户" };
  }
  if (!params.scopes?.includes("operator.admin")) {
    return { allowed: false, reason: "需要 operator.admin 才能暂停或恢复租户" };
  }
  return { allowed: true, reason: "" };
}

export function tenantOperationalMethod(intent: TenantOperationalIntent): string {
  return intent === "suspended" ? TENANT_PAUSE_METHOD : TENANT_RESUME_METHOD;
}

export async function requestTenantOperationalStatus(
  request: <T>(method: string, params: unknown) => Promise<T>,
  params: { tenantId: string; reason: string; intent: TenantOperationalIntent },
): Promise<TenantOperationalStatusResult> {
  const method = tenantOperationalMethod(params.intent);
  try {
    const payload = await request<{
      tenantId?: string;
      status?: string;
      previousStatus?: string;
    }>(method, { tenantId: params.tenantId, reason: params.reason });
    if (
      payload?.tenantId !== params.tenantId ||
      payload.status !== params.intent ||
      !payload.previousStatus ||
      !PREVIOUS_STATUSES.has(payload.previousStatus)
    ) {
      return { ok: false, error: "网关返回与请求不一致，未记为成功" };
    }
    return {
      ok: true,
      tenantId: payload.tenantId,
      status: payload.status,
      previousStatus: payload.previousStatus as "active" | "inactive" | "suspended",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "租户状态变更失败";
    return { ok: false, error: message };
  }
}
