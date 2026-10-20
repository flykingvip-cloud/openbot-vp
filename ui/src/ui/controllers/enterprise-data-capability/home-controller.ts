/**
 * 企业数据能力中心首页 — module-local controller（纯函数 + 可变 state）。
 *
 * 与 `enterprise-capability-center-surface.ts` 一致：状态自持于模块层，
 * 异步分支通过 `requestRender` 触发重渲染（surface 侧用 PopStateEvent）。
 * 三个面板（summary / approvals / sourceHealth）相互隔离，单面板失败不阻塞其余。
 *
 * @module enterprise-data-capability/home-controller
 */

import type {
  AssetLandscapeGraph,
  AuditLineageOverview,
  AuthorizationSourceCard,
  CapabilityUsageRow,
  DataCapabilityDashboardSummary,
  DataSourceHealthRow,
  KnowledgeSupplyOverview,
  PendingApprovalItem,
} from "../../capability/enterprise-data-capability/types.ts";
import type { EnterpriseDataCapabilityGateway } from "./gateway-client.ts";

export type DataCapabilityHomeState = {
  /**
   * 首页是否已发起首轮加载（load-once 总开关）。
   * 不要拿某个面板（如 summary）当总开关——后续 Phase 2/3 增量加面板时，
   * 用单面板做开关会导致新面板永不首载。
   */
  loadStarted: boolean;
  summary: DataCapabilityDashboardSummary | null;
  summaryLoading: boolean;
  summaryError: string | null;
  approvals: PendingApprovalItem[] | null;
  approvalsLoading: boolean;
  approvalsError: string | null;
  sourceHealth: DataSourceHealthRow[] | null;
  sourceHealthLoading: boolean;
  sourceHealthError: string | null;
  capabilityRows: CapabilityUsageRow[] | null;
  capabilityRowsLoading: boolean;
  capabilityRowsError: string | null;
  authorizationCards: AuthorizationSourceCard[] | null;
  authorizationCardsLoading: boolean;
  authorizationCardsError: string | null;
  assetLandscape: AssetLandscapeGraph | null;
  assetLandscapeLoading: boolean;
  assetLandscapeError: string | null;
  knowledgeSupply: KnowledgeSupplyOverview | null;
  knowledgeSupplyLoading: boolean;
  knowledgeSupplyError: string | null;
  lineageOverview: AuditLineageOverview | null;
  lineageOverviewLoading: boolean;
  lineageOverviewError: string | null;
};

export function createInitialDataCapabilityHomeState(): DataCapabilityHomeState {
  return {
    loadStarted: false,
    summary: null,
    summaryLoading: false,
    summaryError: null,
    approvals: null,
    approvalsLoading: false,
    approvalsError: null,
    sourceHealth: null,
    sourceHealthLoading: false,
    sourceHealthError: null,
    capabilityRows: null,
    capabilityRowsLoading: false,
    capabilityRowsError: null,
    authorizationCards: null,
    authorizationCardsLoading: false,
    authorizationCardsError: null,
    assetLandscape: null,
    assetLandscapeLoading: false,
    assetLandscapeError: null,
    knowledgeSupply: null,
    knowledgeSupplyLoading: false,
    knowledgeSupplyError: null,
    lineageOverview: null,
    lineageOverviewLoading: false,
    lineageOverviewError: null,
  };
}

const LOAD_FAILED = "加载失败，请重试。";

/**
 * 并行加载三个面板；每个面板独立 settle 并触发重渲染。
 * 返回的 Promise 在全部 settle 后 resolve（便于测试 await）。
 *
 * @param resetData 是否在加载开始前清空既有成功数据。
 *   - `true`：清空 → 加载期间显示骨架；失败则为「无数据 + 错误」，不会出现「旧数据 + 新错误」混合态。
 *   - `false`（默认）：stale-while-revalidate，保留旧数据直到新数据到达；这是显式选择，调用方需自知语义。
 */
export async function loadDataCapabilityHome(params: {
  state: DataCapabilityHomeState;
  gateway: EnterpriseDataCapabilityGateway;
  tenantId: string;
  requestRender: () => void;
  resetData?: boolean;
}): Promise<void> {
  const { state, gateway, tenantId, requestRender, resetData = false } = params;

  state.loadStarted = true;
  if (resetData) {
    state.summary = null;
    state.approvals = null;
    state.sourceHealth = null;
    state.capabilityRows = null;
    state.authorizationCards = null;
    state.assetLandscape = null;
    state.knowledgeSupply = null;
    state.lineageOverview = null;
  }
  state.summaryLoading = true;
  state.summaryError = null;
  state.approvalsLoading = true;
  state.approvalsError = null;
  state.sourceHealthLoading = true;
  state.sourceHealthError = null;
  state.capabilityRowsLoading = true;
  state.capabilityRowsError = null;
  state.authorizationCardsLoading = true;
  state.authorizationCardsError = null;
  state.assetLandscapeLoading = true;
  state.assetLandscapeError = null;
  state.knowledgeSupplyLoading = true;
  state.knowledgeSupplyError = null;
  state.lineageOverviewLoading = true;
  state.lineageOverviewError = null;
  requestRender();

  const summaryTask = gateway
    .loadDashboardSummary(tenantId)
    .then((result) => {
      if (result.ok) {
        state.summary = result.data;
      } else {
        state.summaryError = result.error;
      }
    })
    .catch(() => {
      state.summaryError = LOAD_FAILED;
    })
    .finally(() => {
      state.summaryLoading = false;
      requestRender();
    });

  const approvalsTask = gateway
    .loadPendingApprovals(tenantId)
    .then((result) => {
      if (result.ok) {
        // 合法空态：[] 是「无待审批」，不是失败。
        state.approvals = result.data;
      } else {
        state.approvalsError = result.error;
      }
    })
    .catch(() => {
      state.approvalsError = LOAD_FAILED;
    })
    .finally(() => {
      state.approvalsLoading = false;
      requestRender();
    });

  const healthTask = gateway
    .loadSourceHealth(tenantId)
    .then((result) => {
      if (result.ok) {
        // 合法空态：[] 是「无数据源」，不是失败。
        state.sourceHealth = result.data;
      } else {
        state.sourceHealthError = result.error;
      }
    })
    .catch(() => {
      state.sourceHealthError = LOAD_FAILED;
    })
    .finally(() => {
      state.sourceHealthLoading = false;
      requestRender();
    });

  const capabilityRowsTask = gateway
    .loadCapabilityRows(tenantId, 100)
    .then((result) => {
      if (result.ok) {
        // 合法空态：[] 是「无数据能力」，不是失败。
        state.capabilityRows = result.data;
      } else {
        state.capabilityRowsError = result.error;
      }
    })
    .catch(() => {
      state.capabilityRowsError = LOAD_FAILED;
    })
    .finally(() => {
      state.capabilityRowsLoading = false;
      requestRender();
    });

  const authorizationCardsTask = gateway
    .loadAuthorizationCards(tenantId)
    .then((result) => {
      if (result.ok) {
        // 合法空态：[] 是「无授权数据源」，不是失败。
        state.authorizationCards = result.data;
      } else {
        state.authorizationCardsError = result.error;
      }
    })
    .catch(() => {
      state.authorizationCardsError = LOAD_FAILED;
    })
    .finally(() => {
      state.authorizationCardsLoading = false;
      requestRender();
    });

  const assetLandscapeTask = gateway
    .loadAssetLandscape(tenantId)
    .then((result) => {
      if (result.ok) {
        // 合法空态：nodes 为 [] 是「无资产关系」，不是失败。
        state.assetLandscape = result.data;
      } else {
        state.assetLandscapeError = result.error;
      }
    })
    .catch(() => {
      state.assetLandscapeError = LOAD_FAILED;
    })
    .finally(() => {
      state.assetLandscapeLoading = false;
      requestRender();
    });

  const knowledgeSupplyTask = gateway
    .loadKnowledgeSupply(tenantId)
    .then((result) => {
      if (result.ok) {
        state.knowledgeSupply = result.data;
      } else {
        state.knowledgeSupplyError = result.error;
      }
    })
    .catch(() => {
      state.knowledgeSupplyError = LOAD_FAILED;
    })
    .finally(() => {
      state.knowledgeSupplyLoading = false;
      requestRender();
    });

  const lineageOverviewTask = gateway
    .loadLineageOverview(tenantId)
    .then((result) => {
      if (result.ok) {
        state.lineageOverview = result.data;
      } else {
        state.lineageOverviewError = result.error;
      }
    })
    .catch(() => {
      state.lineageOverviewError = LOAD_FAILED;
    })
    .finally(() => {
      state.lineageOverviewLoading = false;
      requestRender();
    });

  await Promise.all([
    summaryTask,
    approvalsTask,
    healthTask,
    capabilityRowsTask,
    authorizationCardsTask,
    assetLandscapeTask,
    knowledgeSupplyTask,
    lineageOverviewTask,
  ]);
}

/** 审批决定后局部刷新待审批列表（不重载整页）。 */
export async function reloadDataCapabilityPendingApprovals(params: {
  state: DataCapabilityHomeState;
  gateway: EnterpriseDataCapabilityGateway;
  tenantId: string;
  requestRender: () => void;
}): Promise<void> {
  const { state, gateway, tenantId, requestRender } = params;
  state.approvalsLoading = true;
  state.approvalsError = null;
  requestRender();
  try {
    const result = await gateway.loadPendingApprovals(tenantId);
    if (result.ok) {
      state.approvals = result.data;
      state.summary =
        state.summary != null
          ? { ...state.summary, pendingApprovals: result.data.length }
          : state.summary;
    } else {
      state.approvalsError = result.error;
    }
  } catch {
    state.approvalsError = LOAD_FAILED;
  } finally {
    state.approvalsLoading = false;
    requestRender();
  }
}
