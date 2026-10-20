import type { GatewayBrowserClient } from "../gateway.ts";
import type { PlatformModelsManagementSnapshot } from "../ports/platform/models/snapshot-types.ts";

export type PlatformModelsManagementState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  modelsManagementLoading: boolean;
  modelsManagementError: string | null;
  modelsManagementSnapshot: PlatformModelsManagementSnapshot | null;
  platformModelsMode: "native" | "aor_enhanced";
};

export async function loadPlatformModelsManagementSnapshot(
  state: PlatformModelsManagementState,
  options?: { enterpriseId?: string },
) {
  if (!state.client || !state.connected) {
    // Model Assets treats "!snapshot && !error" as still-loading. If we skip
    // the RPC while disconnected without recording an error, the page stays on
    // "正在加载模型资产…" forever (common after platform session expiry / 1008).
    state.modelsManagementLoading = false;
    if (!state.modelsManagementSnapshot) {
      state.modelsManagementError = !state.connected
        ? "未连接到 Gateway：平台会话可能已失效，请重新登录平台管理后再刷新。"
        : "Gateway 客户端未就绪，请刷新页面后重试。";
    }
    return;
  }
  if (state.modelsManagementLoading) {
    return;
  }

  state.modelsManagementLoading = true;
  state.modelsManagementError = null;
  try {
    const params =
      options?.enterpriseId && options.enterpriseId.trim()
        ? { enterpriseId: options.enterpriseId.trim() }
        : {};
    const snapshot = await state.client.request<PlatformModelsManagementSnapshot>(
      "models.management.snapshot",
      params,
    );
    state.modelsManagementSnapshot = snapshot;
    state.platformModelsMode = snapshot.mode ?? state.platformModelsMode;
  } catch (error) {
    state.modelsManagementError =
      error instanceof Error ? error.message : "加载模型管理 snapshot 失败";
  } finally {
    state.modelsManagementLoading = false;
  }
}
