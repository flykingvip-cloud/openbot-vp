/**
 * 企业能力中心 — 审核队列 Controller
 *
 * 状态管理：纯函数 + 可变 state 对象 + async 方法
 * （与 my-accumulation.ts / asset-list.ts 对齐）。
 *
 * 行为要点：
 * - 默认 filters：`status = null`（全部）、`searchQuery = ""`；分页默认 20 条/页（需求 14.1
 *   待审核队列按提交时间正序，先进先审）
 * - 提交审核动作前先调用 `./review-rules.ts` 中的纯函数做客户端校验：
 *     • `approveReview` → `validateReviewOpinion("通过", opinion)` + `validateApprovalPayload(approval)`
 *     • `rejectReview` / `requestModification` → `validateReviewOpinion(result, opinion)`（≥10 字符）
 *   未通过校验时，将 `state.submitError` 写为业务语言原因并返回 `false`，不发起网络请求。
 * - 通过校验后调用 `gateway.review(...)`；成功路径写入 `state.lastReviewRecord` 并重新加载队列；
 *   失败路径写入 `state.submitError` 并保留现有列表。
 * - `submitting` 始终在 `finally` 中归位为 false。
 * - 任何会改变结果集语义的状态变更（filters）都将 `currentPage` 重置为 1；
 *   `changeReviewPage` 仅做单纯页码变更。
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 19.2
 */

import type { ReviewQueueItemWithAssessment } from "../../capability/enterprise-capability/endpoints.ts";
import type { EnterpriseCapabilityGateway } from "../../capability/enterprise-capability/gateway-client.ts";
import type {
  PaginationState,
  ReviewApprovalPayload,
  ReviewRecord,
} from "../../capability/enterprise-capability/types.ts";
import { autoCorrectPage } from "./pagination-utils.ts";
import { validateApprovalPayload, validateReviewOpinion } from "./review-rules.ts";

/**
 * 审核队列筛选条件：状态下拉（null = 全部）+ 关键词搜索。
 *
 * 与 `endpoints.ts` 中 `ReviewQueueFilters` 字面字段一致。这里独立声明
 * 是为了让 controller 不依赖具体 endpoint 文件的导出形态，方便单测复用。
 */
export type ReviewQueueFilters = {
  status: "待审核" | "审核中" | null;
  searchQuery: string;
};

export type ReviewQueueState = {
  gateway: EnterpriseCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  items: ReviewQueueItemWithAssessment[];
  pagination: PaginationState;
  filters: ReviewQueueFilters;
  /** 最近一次提交成功的审核记录（用于 UI flash / 通知） */
  lastReviewRecord: ReviewRecord | null;
  /** 最近一次审核完成后的员工端回流提示 */
  lastEmployeeFeedbackNotice: string | null;
  /** 单次审核动作的提交状态：用于按钮 loading 与防重复点击 */
  submitting: boolean;
  submitError: string | null;
};

/**
 * 默认分页：第 1 页、每页 20 条、总数 0。
 * 队列页面比能力列表展示更多内容（带评估卡片），20 条/页是合理的初值。
 */
const DEFAULT_PAGINATION: PaginationState = {
  currentPage: 1,
  pageSize: 20,
  totalItems: 0,
};

const DEFAULT_FILTERS: ReviewQueueFilters = {
  status: null,
  searchQuery: "",
};

export function createInitialReviewQueueState(): ReviewQueueState {
  return {
    gateway: null,
    loading: false,
    error: null,
    items: [],
    // Spread 后赋值新对象，避免外部 mutation 污染默认常量对象。
    pagination: { ...DEFAULT_PAGINATION },
    filters: { ...DEFAULT_FILTERS },
    lastReviewRecord: null,
    lastEmployeeFeedbackNotice: null,
    submitting: false,
    submitError: null,
  };
}

/**
 * 加载审核队列（按提交时间先进先审排序，由后端保证）。
 *
 * 成功路径：以服务端返回的分页数据为准；失败路径以业务语言提示，
 * 保留 `items` / `pagination` 不被错误覆盖（与 asset-list.ts 一致）。
 */
export async function loadReviewQueue(state: ReviewQueueState): Promise<void> {
  if (state.gateway === null) {
    state.error = "暂时无法加载审核队列，请稍后再试";
    return;
  }

  state.loading = true;
  state.error = null;
  try {
    const response = await state.gateway.reviewQueue({
      filters: state.filters,
      pagination: {
        page: state.pagination.currentPage,
        pageSize: state.pagination.pageSize,
      },
    });
    state.items = response.items;
    state.pagination = {
      currentPage: autoCorrectPage(
        response.pagination.currentPage,
        response.pagination.totalItems,
        response.pagination.pageSize,
      ),
      pageSize: response.pagination.pageSize,
      totalItems: response.pagination.totalItems,
    };
  } catch {
    // 错误细节不透传至业务视图层（需求 12 投影边界），统一以业务语言提示。
    state.error = "加载审核队列失败";
  } finally {
    state.loading = false;
  }
}

/**
 * 通过审核：必须同时指定 `ApplicableScope` + `CapabilityDomain`（Property 6 / 需求 14.4 + 19.2）。
 *
 * 客户端先做纯函数校验，避免无意义的网络往返；任一校验失败则写入 `submitError`
 * 并直接返回 false。校验通过后调用 `gateway.review` 提交"通过"决策，
 * 成功后重新加载队列以反映最新状态（被通过的任务通常会从待审核/审核中队列移除）。
 */
export async function approveReview(
  state: ReviewQueueState,
  reviewTaskId: string,
  opinion: string,
  approval: ReviewApprovalPayload,
): Promise<boolean> {
  if (state.gateway === null) {
    state.submitError = "暂时无法提交审核结果，请稍后再试";
    return false;
  }

  // 客户端校验 1：意见长度（"通过"无最小长度要求，但仍走统一入口）
  const opinionResult = validateReviewOpinion("通过", opinion);
  if (!opinionResult.ok) {
    state.submitError = opinionResult.reason;
    return false;
  }

  // 客户端校验 2：通过必须指定适用范围 + 能力领域（Property 6）
  const approvalResult = validateApprovalPayload(approval);
  if (!approvalResult.ok) {
    state.submitError = approvalResult.reason;
    return false;
  }

  state.submitting = true;
  state.submitError = null;
  try {
    const response = await state.gateway.review({
      reviewTaskId,
      result: "通过",
      opinion,
      approval,
    });
    state.lastReviewRecord = response.record;
    state.lastEmployeeFeedbackNotice =
      "已通过审核并进入企业资产库，员工端“我的资产”会同步显示正式资产状态。";
    // 通过后重新加载队列，让该任务从"待审核/审核中"中移除。
    await loadReviewQueue(state);
    return true;
  } catch {
    state.submitError = "提交审核结果失败";
    return false;
  } finally {
    state.submitting = false;
  }
}

/**
 * 拒绝审核：审核意见必须 ≥ 10 字符（Property 4 / 需求 14.5）。
 *
 * 共享 `submitReviewWithOpinion()` 的实现路径，差异仅在 `result` 取值。
 */
export async function rejectReview(
  state: ReviewQueueState,
  reviewTaskId: string,
  opinion: string,
): Promise<boolean> {
  return submitReviewWithOpinion(state, reviewTaskId, "拒绝", opinion);
}

/**
 * 标记需修改：审核意见必须 ≥ 10 字符（Property 4 / 需求 14.5 + 14.8）。
 * 员工收到通知后可修改能力并重新提交，重新提交后会创建新审核任务。
 */
export async function requestModification(
  state: ReviewQueueState,
  reviewTaskId: string,
  opinion: string,
): Promise<boolean> {
  return submitReviewWithOpinion(state, reviewTaskId, "需修改", opinion);
}

/**
 * 拒绝 / 需修改的共享实现：仅在 `result` 取值上不同。
 * 提取为模块内私有函数以避免两处分支逻辑漂移。
 */
async function submitReviewWithOpinion(
  state: ReviewQueueState,
  reviewTaskId: string,
  result: "拒绝" | "需修改",
  opinion: string,
): Promise<boolean> {
  if (state.gateway === null) {
    state.submitError = "暂时无法提交审核结果，请稍后再试";
    return false;
  }

  const opinionResult = validateReviewOpinion(result, opinion);
  if (!opinionResult.ok) {
    state.submitError = opinionResult.reason;
    return false;
  }

  state.submitting = true;
  state.submitError = null;
  try {
    const response = await state.gateway.review({
      reviewTaskId,
      result,
      opinion,
    });
    state.lastReviewRecord = response.record;
    state.lastEmployeeFeedbackNotice =
      result === "需修改"
        ? "已退回员工端继续整理，员工可在“我的资产”查看审核意见并重新提交。"
        : "已驳回该资产提交，员工可在“我的资产”查看审核反馈。";
    await loadReviewQueue(state);
    return true;
  } catch {
    state.submitError = "提交审核结果失败";
    return false;
  } finally {
    state.submitting = false;
  }
}

/**
 * 修改单个筛选字段（状态下拉 / 关键词搜索）。
 * 同步将 `currentPage` 重置为 1，避免在第 N 页切换筛选后落入空页。
 * 不触发网络请求，调用方在 UI 防抖后调用 `loadReviewQueue()`。
 */
export function updateReviewFilter<K extends keyof ReviewQueueFilters>(
  state: ReviewQueueState,
  key: K,
  value: ReviewQueueFilters[K],
): void {
  state.filters[key] = value;
  state.pagination.currentPage = 1;
}

/**
 * 切换审核队列页码。
 * 使用 `autoCorrectPage` 保证页码合法（Property 14），避免筛选后请求明显越界页。
 */
export function changeReviewPage(state: ReviewQueueState, page: number): void {
  state.pagination.currentPage = autoCorrectPage(
    page,
    state.pagination.totalItems,
    state.pagination.pageSize,
  );
}
