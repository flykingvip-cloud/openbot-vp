/**
 * 运行时 entitlement 身份解析（P5，任务 17）——按 **bot 归属席位** 解析企业作用域。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§6.5）。
 *
 * 用于「无 employee 受信会话」的运行路径（followup / 协作小组多 bot / cron / 外部渠道入站）：
 * 由 `agentId` → `EnterpriseSeatAssetsStore` 的 `assetType="agent"` 绑定（或席位 default agent）
 * 解析出 `{ tenantId, seatId, employeeId? }`。
 *
 * **安全约定**：解析不到归属席位 → 返回 `null`（调用方据此**放行**，绝不因解析失败误杀现网 bot）。
 */

import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import {
  type EnterpriseSeatAssetsStore,
  loadEnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import {
  TENANT_SEAT_ASSETS_FILE,
  resolveTenantControlPlaneStorePath,
} from "../tenant-store-paths.js";

export type AgentRunEntitlementScope = {
  tenantId: string;
  seatId: string;
  employeeId?: string;
};

export type ResolveAgentRunScopeInput = {
  agentId?: string;
  /** 测试注入：预加载的 seat assets store（缺省则从磁盘加载）。 */
  store?: EnterpriseSeatAssetsStore;
  /** Optional session client — preferred for managed multi-tenant addressing. */
  client?: GatewayClient | null;
  /** Explicit tenant when known (e.g. space/cron scoped) without a full session client. */
  tenantId?: string;
};

async function loadSeatStoreForAgentRun(
  input: ResolveAgentRunScopeInput,
): Promise<EnterpriseSeatAssetsStore> {
  if (input.store) {
    return input.store;
  }
  if (input.client) {
    return loadEnterpriseSeatAssetsStore(
      await resolveControlPlaneStorePathForClient(input.client, TENANT_SEAT_ASSETS_FILE),
    );
  }
  const tenantId = input.tenantId?.trim();
  const cfg = loadConfig();
  if (tenantId && isSharedTenantAddressingEnabled(cfg)) {
    return loadEnterpriseSeatAssetsStore(
      resolveTenantControlPlaneStorePath(tenantId, TENANT_SEAT_ASSETS_FILE),
    );
  }
  // Unscoped agent runs (cron/channel without tenant) keep the global default store.
  return loadEnterpriseSeatAssetsStore();
}

export async function resolveAgentRunEntitlementScope(
  input: ResolveAgentRunScopeInput,
): Promise<AgentRunEntitlementScope | null> {
  const agentId = input.agentId?.trim();
  if (!agentId) {
    return null;
  }
  const store = await loadSeatStoreForAgentRun(input);

  // 1) active 的 agent 资产绑定（assetType="agent"）。
  const binding = Object.values(store.assetBindings).find(
    (b) =>
      b.assetType === "agent" && b.assetId === agentId && b.status === "active" && !b.revokedAt,
  );
  const seat = binding
    ? store.seats[binding.seatId]
    : // 2) 回退：席位 default agent 资产列表包含该 agentId。
      Object.values(store.seats).find((s) => s.defaultAgentAssetIds?.includes(agentId));

  if (!seat) {
    return null;
  }
  return {
    tenantId: seat.tenantId,
    seatId: seat.seatId,
    ...(seat.currentEmployeeId ? { employeeId: seat.currentEmployeeId } : {}),
  };
}
