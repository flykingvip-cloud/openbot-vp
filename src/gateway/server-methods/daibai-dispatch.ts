/**
 * Daibai 内部调用底座（决策 E：默认 E1 抽服务层）。
 *
 * 大白目录项的 `delegateTarget` 需要一种「在 handler 内安全调用既有能力」的机制。
 * 网关最外层只做 method 路由 + 鉴权（src/gateway/server-methods.ts），没有现成的
 * 「handler 内安全互调」抽象。本模块提供该底座：
 *
 * - **E1（默认）service 模式**：能力核心逻辑以可复用 service 函数注册，handler 与大白都调同一 service；
 *   鉴权在各自入口完成（大白侧由本模块做 operator-scope 闸门 + 目标 service 自校验二级权限）。
 * - **E2（可选）internal-dispatch 模式**：受控网关内部 dispatch，仅在难以拆 service 的方法上局部启用，
 *   默认**未启用**（避免重复消耗 control-plane write 预算 / 重复 respond 语义）。需显式
 *   `setStewardInternalDispatcher` 注入，且注入方负责跳过外层预算扣减。
 *
 * 安全不变量（见 builtin-steward/behavior-rules）：大白只在用户已授权 operator scope 内行动，
 * 永不触达 ADMIN（目录类型层已禁），二级权限交目标 service 自校验。
 */

import type {
  DaibaiActionDescriptor,
  DaibaiActionParamContext,
} from "../../shared/daibai-action-catalog.js";
import { ADMIN_SCOPE } from "../method-scopes.js";
import type { GatewayClient } from "./types.js";

/** 读取 client 已授权的 operator scopes（缺省空数组）。 */
export function resolveClientOperatorScopes(client: GatewayClient | null): readonly string[] {
  const scopes = client?.connect?.scopes;
  return Array.isArray(scopes) ? scopes : [];
}

/**
 * 判定 client 是否拥有给定 operator scope。
 * ADMIN 是超集（与最外层 `authorizeGatewayMethod` 的 ADMIN bypass 语义一致）。
 */
export function clientHasOperatorScope(client: GatewayClient | null, scope: string): boolean {
  const scopes = resolveClientOperatorScopes(client);
  return scopes.includes(scope) || scopes.includes(ADMIN_SCOPE);
}

/** 大白授权失败（operator scope 不足）。execute 应转译为「需升级平台」引导。 */
export class StewardAuthorizationError extends Error {
  constructor(public readonly requiredScope: string) {
    super(`steward action requires scope: ${requiredScope}`);
    this.name = "StewardAuthorizationError";
  }
}

/** 委派目标无法解析（service 未注册 / internal-dispatch 未启用）。 */
export class StewardDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StewardDispatchError";
  }
}

/** E1 service 函数签名：消费 buildParams 产出的参数（可选拿到 client 做二级权限自校验），返回结果载荷。 */
export type StewardServiceFn = (
  params: Record<string, unknown>,
  ctx?: { client: GatewayClient | null },
) => unknown;

const stewardServiceRegistry = new Map<string, StewardServiceFn>();

/** 注册一个可被大白委派的 service（E1）。`ref` 与目录项 `delegateTarget.ref` 对应。 */
export function registerStewardService(ref: string, fn: StewardServiceFn): void {
  stewardServiceRegistry.set(ref, fn);
}

/** 解析已注册的 service（找不到返回 undefined）。 */
export function resolveStewardService(ref: string): StewardServiceFn | undefined {
  return stewardServiceRegistry.get(ref);
}

/** 清空 service 注册表（仅供测试隔离使用）。 */
export function __clearStewardServicesForTest(): void {
  stewardServiceRegistry.clear();
}

/**
 * E2 internal-dispatch 注入点（默认未启用）。
 * 注入方必须：携带原 client 上下文 + 已解析 scope，复用最外层校验/错误格式，
 * 并**跳过 control-plane write 预算扣减**以避免单次用户动作被计两次。
 */
export type StewardInternalDispatcher = (params: {
  method: string;
  params: Record<string, unknown>;
  client: GatewayClient | null;
}) => Promise<unknown>;

let stewardInternalDispatcher: StewardInternalDispatcher | null = null;

export function setStewardInternalDispatcher(dispatcher: StewardInternalDispatcher | null): void {
  stewardInternalDispatcher = dispatcher;
}

/**
 * 判定 client 是否被授权执行需要 `requiredScope` 的动作。
 *
 * **镜像最外层 `authorizeGatewayMethod` 的信任模型**：无 connect 参数的 client（本地直连/受信代理）
 * 已被最外层放行，此处同样视为授权（否则会比外层更严，拒绝合法本地调用）。
 * 否则按 operator scope 校验（ADMIN 为超集）。
 */
export function isStewardActionAuthorized(
  client: GatewayClient | null,
  requiredScope: string,
): boolean {
  if (!client?.connect) {
    return true;
  }
  return clientHasOperatorScope(client, requiredScope);
}

/**
 * 校验 client 是否被授权执行该目录动作（operator scope 闸门 + 排除 ADMIN-only）。
 * 注意：二级权限（如 usage:budget）不在此校验，交目标 service 自校验（决策 F）。
 *
 * @throws StewardAuthorizationError 当 client 缺少 requiredScope 时。
 */
export function assertStewardActionAuthorized(
  action: Pick<DaibaiActionDescriptor, "requiredScope">,
  client: GatewayClient | null,
): void {
  if (!isStewardActionAuthorized(client, action.requiredScope)) {
    throw new StewardAuthorizationError(action.requiredScope);
  }
}

/**
 * 执行目录动作的委派：scope 闸门 → 按 delegateTarget.mode 走 service / internal-dispatch。
 * 不负责确认票据 / ownership 预检（由 execute 上层在调用本函数前完成）。
 */
export async function invokeStewardDelegate(input: {
  action: DaibaiActionDescriptor;
  ctx: DaibaiActionParamContext;
  client: GatewayClient | null;
}): Promise<unknown> {
  const { action, ctx, client } = input;
  assertStewardActionAuthorized(action, client);
  const params = action.buildParams(ctx);

  if (action.delegateTarget.mode === "service") {
    const fn = resolveStewardService(action.delegateTarget.ref);
    if (!fn) {
      throw new StewardDispatchError(
        `no steward service registered for ref: ${action.delegateTarget.ref}`,
      );
    }
    return await fn(params, { client });
  }

  // internal-dispatch (E2)
  if (!stewardInternalDispatcher) {
    throw new StewardDispatchError(
      `internal-dispatch not enabled for method: ${action.delegateTarget.ref} (E1 service mode is default)`,
    );
  }
  return await stewardInternalDispatcher({
    method: action.delegateTarget.ref,
    params,
    client,
  });
}
