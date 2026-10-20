/**
 * 模型授权 RPC 的类型化客户端工厂（基于 `GatewayBrowserClient`）。
 *
 * 暴露平台侧 `platform-model-binding.*` 与企业侧 `enterprise-model-grant.*`
 * 两组方法的强类型封装，供企业端授权操作面（任务 11）与员工端只读（任务 12）调用。
 */

import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  MODEL_AUTHORIZATION_ENDPOINTS,
  type BindingGetRequest,
  type BindingGetResponse,
  type BindingListResponse,
  type BindingSetRequest,
  type BindingSetResponse,
  type EmployeeSummaryResponse,
  type GrantBatchRequest,
  type GrantBatchResponse,
  type GrantListRequest,
  type GrantListResponse,
  type GrantRequest,
  type GrantResponse,
  type RevokeRequest,
  type RevokeResponse,
} from "./endpoints.ts";

const GRANTS_LIST_CACHE_TTL_MS = 5_000;
const grantsListCache = new Map<string, { at: number; data: GrantListResponse }>();
const grantsListInflight = new Map<string, Promise<GrantListResponse>>();

function grantsListCacheKey(req: GrantListRequest): string {
  return req.enterpriseId?.trim() || "__default__";
}

export function invalidateModelAuthorizationGrantsCache(enterpriseId?: string): void {
  if (enterpriseId?.trim()) {
    grantsListCache.delete(grantsListCacheKey({ enterpriseId }));
    grantsListInflight.delete(grantsListCacheKey({ enterpriseId }));
    return;
  }
  grantsListCache.clear();
  grantsListInflight.clear();
}

/** Test helper: clear in-memory listGrants dedupe between browser tests. */
export function __resetModelAuthorizationGrantsCacheForTest(): void {
  invalidateModelAuthorizationGrantsCache();
}

async function listGrantsCached(
  client: GatewayBrowserClient,
  req: GrantListRequest = {},
): Promise<GrantListResponse> {
  const key = grantsListCacheKey(req);
  const cached = grantsListCache.get(key);
  if (cached && Date.now() - cached.at < GRANTS_LIST_CACHE_TTL_MS) {
    return cached.data;
  }
  const inflight = grantsListInflight.get(key);
  if (inflight) {
    return inflight;
  }
  const pending = client
    .request<GrantListResponse>(MODEL_AUTHORIZATION_ENDPOINTS.grantList, req)
    .then((data) => {
      grantsListCache.set(key, { at: Date.now(), data });
      grantsListInflight.delete(key);
      return data;
    })
    .catch((error) => {
      grantsListInflight.delete(key);
      throw error;
    });
  grantsListInflight.set(key, pending);
  return pending;
}

export function createModelAuthorizationGateway(client: GatewayBrowserClient) {
  const invalidateGrants = (enterpriseId?: string) =>
    invalidateModelAuthorizationGrantsCache(enterpriseId ?? undefined);

  return {
    // ── 平台侧 ──
    setBinding(req: BindingSetRequest): Promise<BindingSetResponse> {
      return client.request<BindingSetResponse>(MODEL_AUTHORIZATION_ENDPOINTS.bindingSet, req);
    },
    getBinding(req: BindingGetRequest): Promise<BindingGetResponse> {
      return client.request<BindingGetResponse>(MODEL_AUTHORIZATION_ENDPOINTS.bindingGet, req);
    },
    listBindings(): Promise<BindingListResponse> {
      return client.request<BindingListResponse>(MODEL_AUTHORIZATION_ENDPOINTS.bindingList, {});
    },
    // ── 企业侧 ──
    grant(req: GrantRequest): Promise<GrantResponse> {
      invalidateGrants(req.enterpriseId);
      return client.request<GrantResponse>(MODEL_AUTHORIZATION_ENDPOINTS.grantGrant, req);
    },
    grantBatch(req: GrantBatchRequest): Promise<GrantBatchResponse> {
      invalidateGrants(req.enterpriseId);
      return client.request<GrantBatchResponse>(MODEL_AUTHORIZATION_ENDPOINTS.grantGrantBatch, req);
    },
    revoke(req: RevokeRequest): Promise<RevokeResponse> {
      invalidateGrants(req.enterpriseId);
      return client.request<RevokeResponse>(MODEL_AUTHORIZATION_ENDPOINTS.grantRevoke, req);
    },
    listGrants(req: GrantListRequest = {}): Promise<GrantListResponse> {
      return listGrantsCached(client, req);
    },
    // ── 员工侧（只读）──
    getEmployeeSummary(): Promise<EmployeeSummaryResponse> {
      return client.request<EmployeeSummaryResponse>(
        MODEL_AUTHORIZATION_ENDPOINTS.employeeSummary,
        {},
      );
    },
  };
}

export type ModelAuthorizationGateway = ReturnType<typeof createModelAuthorizationGateway>;
