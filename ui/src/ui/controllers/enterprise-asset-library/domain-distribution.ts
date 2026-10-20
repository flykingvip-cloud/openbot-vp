/**
 * 企业能力中心 — 能力领域分布 Controller（第二屏）
 *
 * 状态管理：纯函数 + 可变 state 对象 + async 方法（与 statistics.ts / my-accumulation.ts 对齐）。
 *
 * 行为要点：
 * - 初始 `domains` 使用 `emptyDomainDistributions()` 占位，确保即使未加载也能渲染 6 个领域骨架
 * - 加载失败时保留已有 `domains`（避免已展示的领域分布因刷新失败被清空）
 * - 支持以单一 `CapabilityDomain` 过滤后端聚合范围（用于"展开某领域查看其下能力"场景）
 * - `selectDomain` 仅做本地状态切换（同步、无 API 调用），用于驱动钻取导航
 * - 仅暴露业务能力视图字段（需求 12 投影边界）
 *
 * Validates: Requirements 19.1, 19.4, 19.5, 19.6
 */

import type { EnterpriseCapabilityGateway } from "../../capability/enterprise-capability/gateway-client.ts";
import type {
  CapabilityDomain,
  DomainDistribution,
} from "../../capability/enterprise-capability/types.ts";
import { emptyDomainDistributions } from "./domain-aggregation.ts";

export type DomainDistributionState = {
  gateway: EnterpriseCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  domains: DomainDistribution[];
  /** 当前选中的领域（用于第二屏钻取至该领域下的能力列表）；未选中时为 null。 */
  selectedDomain: CapabilityDomain | null;
};

export function createInitialDomainDistributionState(): DomainDistributionState {
  return {
    gateway: null,
    loading: false,
    error: null,
    // 始终以 6 个领域占位作为初始值，避免视图首帧渲染空数组导致领域骨架闪烁。
    domains: emptyDomainDistributions(),
    selectedDomain: null,
  };
}

/**
 * 加载能力领域分布。
 *
 * - `domainFilter` 为可选；传入时收窄到单一领域，未传入或为 null 时请求全部领域。
 * - 失败路径不清空 `state.domains`，保留上次成功结果作为降级显示（需求 19.4–19.6）。
 *   如尚未成功加载过，则保留初始的 `emptyDomainDistributions()` 占位。
 */
export async function loadDomainDistribution(
  state: DomainDistributionState,
  domainFilter?: CapabilityDomain | null,
): Promise<void> {
  if (state.gateway === null) {
    state.error = "暂时无法加载能力领域分布，请稍后再试";
    return;
  }

  state.loading = true;
  state.error = null;
  try {
    const response = await state.gateway.domainDistribution({
      domain: domainFilter ?? null,
    });
    state.domains = response.domains;
  } catch {
    // 错误细节不透传至业务视图层（需求 12 投影边界），统一以业务语言提示。
    // 不清空 state.domains —— 失败时保留已展示的领域分布或初始占位。
    state.error = "加载能力领域分布失败";
  } finally {
    state.loading = false;
  }
}

/**
 * 选中/取消选中某个领域（用于钻取导航）。
 * 同步操作、不触发 API 调用；展示层根据 `selectedDomain` 决定是否进入子列表视图。
 */
export function selectDomain(
  state: DomainDistributionState,
  domain: CapabilityDomain | null,
): void {
  state.selectedDomain = domain;
}
