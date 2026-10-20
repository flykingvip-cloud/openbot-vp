import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  PLATFORM_PLAN_BUNDLE_ENDPOINTS,
  type PlatformPlanBundleActivateRequest,
  type PlatformPlanBundleActivateResponse,
  type PlatformPlanBundleDeprecateRequest,
  type PlatformPlanBundleDeprecateResponse,
  type PlatformPlanBundleDeleteVersionRequest,
  type PlatformPlanBundleDeleteVersionResponse,
  type PlatformPlanBundleCreateRequest,
  type PlatformPlanBundleCreateResponse,
  type PlatformPlanBundleUpdateRequest,
  type PlatformPlanBundleUpdateResponse,
  type PlatformPlanBundleCreateVersionRequest,
  type PlatformPlanBundleCreateVersionResponse,
  type PlatformPlanBundleDiffRequest,
  type PlatformPlanBundleDiffResponse,
  type PlatformPlanBundleConsistencyResponse,
  type PlatformPlanBundlePreviewAllocationResponse,
  type PlatformPlanBundleGetRequest,
  type PlatformPlanBundleGetResponse,
  type PlatformPlanBundleListResponse,
  type PlatformPlanBundleOverviewResponse,
  type PlatformPlanBundleSetMarketingTagsRequest,
  type PlatformPlanBundleSetMarketingTagsResponse,
  type PlatformPlanBundleSetMatchingProfileRequest,
  type PlatformPlanBundleSetMatchingProfileResponse,
} from "./endpoints.ts";

type OverviewCacheEntry = {
  promise: Promise<PlatformPlanBundleOverviewResponse> | null;
  value: PlatformPlanBundleOverviewResponse | null;
  expiresAtMs: number;
};

const overviewCacheByClient = new WeakMap<GatewayBrowserClient, OverviewCacheEntry>();
const OVERVIEW_CACHE_TTL_MS = 2_000;

type PlatformPlanBundleOverviewDebugMeta = {
  debugSource?: string;
  debugPath?: string;
  debugModuleUrl?: string;
};

function readCurrentDebugPath(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function createPlatformPlanBundleGateway(client: GatewayBrowserClient) {
  return {
    overview(
      debugMeta?: PlatformPlanBundleOverviewDebugMeta,
    ): Promise<PlatformPlanBundleOverviewResponse> {
      const now = Date.now();
      const cached = overviewCacheByClient.get(client);
      if (cached?.promise) {
        if (typeof console !== "undefined" && typeof console.debug === "function") {
          console.debug("[plan-bundle.overview] inflight-hit", {
            source: debugMeta?.debugSource ?? "unknown",
            path: debugMeta?.debugPath ?? readCurrentDebugPath(),
            moduleUrl: debugMeta?.debugModuleUrl,
          });
        }
        return cached.promise;
      }
      if (cached?.value && cached.expiresAtMs > now) {
        if (typeof console !== "undefined" && typeof console.debug === "function") {
          console.debug("[plan-bundle.overview] cache-hit", {
            source: debugMeta?.debugSource ?? "unknown",
            path: debugMeta?.debugPath ?? readCurrentDebugPath(),
            moduleUrl: debugMeta?.debugModuleUrl,
          });
        }
        return Promise.resolve(cached.value);
      }
      if (typeof console !== "undefined" && typeof console.debug === "function") {
        console.debug("[plan-bundle.overview] request", {
          source: debugMeta?.debugSource ?? "unknown",
          path: debugMeta?.debugPath ?? readCurrentDebugPath(),
          moduleUrl: debugMeta?.debugModuleUrl,
        });
      }
      const promise = client
        .request<PlatformPlanBundleOverviewResponse>(PLATFORM_PLAN_BUNDLE_ENDPOINTS.overview, {
          ...(debugMeta?.debugSource ? { debugSource: debugMeta.debugSource } : {}),
          ...(debugMeta?.debugPath || readCurrentDebugPath()
            ? { debugPath: debugMeta?.debugPath ?? readCurrentDebugPath() }
            : {}),
          ...(debugMeta?.debugModuleUrl ? { debugModuleUrl: debugMeta.debugModuleUrl } : {}),
        })
        .then((result) => {
          overviewCacheByClient.set(client, {
            promise: null,
            value: result,
            expiresAtMs: Date.now() + OVERVIEW_CACHE_TTL_MS,
          });
          return result;
        })
        .catch((error) => {
          overviewCacheByClient.delete(client);
          throw error;
        });
      overviewCacheByClient.set(client, {
        promise,
        value: cached?.value ?? null,
        expiresAtMs: cached?.expiresAtMs ?? 0,
      });
      return promise;
    },
    list(): Promise<PlatformPlanBundleListResponse> {
      return client.request<PlatformPlanBundleListResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.list,
        {},
      );
    },
    get(req: PlatformPlanBundleGetRequest): Promise<PlatformPlanBundleGetResponse> {
      return client.request<PlatformPlanBundleGetResponse>(PLATFORM_PLAN_BUNDLE_ENDPOINTS.get, req);
    },
    create(req: PlatformPlanBundleCreateRequest): Promise<PlatformPlanBundleCreateResponse> {
      return client.request<PlatformPlanBundleCreateResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.create,
        req,
      );
    },
    update(req: PlatformPlanBundleUpdateRequest): Promise<PlatformPlanBundleUpdateResponse> {
      return client.request<PlatformPlanBundleUpdateResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.update,
        req,
      );
    },
    createVersion(
      req: PlatformPlanBundleCreateVersionRequest,
    ): Promise<PlatformPlanBundleCreateVersionResponse> {
      return client.request<PlatformPlanBundleCreateVersionResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.createVersion,
        req,
      );
    },
    activate(req: PlatformPlanBundleActivateRequest): Promise<PlatformPlanBundleActivateResponse> {
      return client.request<PlatformPlanBundleActivateResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.activate,
        req,
      );
    },
    deprecate(
      req: PlatformPlanBundleDeprecateRequest,
    ): Promise<PlatformPlanBundleDeprecateResponse> {
      return client.request<PlatformPlanBundleDeprecateResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.deprecate,
        req,
      );
    },
    deleteVersion(
      req: PlatformPlanBundleDeleteVersionRequest,
    ): Promise<PlatformPlanBundleDeleteVersionResponse> {
      return client.request<PlatformPlanBundleDeleteVersionResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.deleteVersion,
        req,
      );
    },
    setMarketingTags(
      req: PlatformPlanBundleSetMarketingTagsRequest,
    ): Promise<PlatformPlanBundleSetMarketingTagsResponse> {
      return client.request<PlatformPlanBundleSetMarketingTagsResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.setMarketingTags,
        req,
      );
    },
    setMatchingProfile(
      req: PlatformPlanBundleSetMatchingProfileRequest,
    ): Promise<PlatformPlanBundleSetMatchingProfileResponse> {
      return client.request<PlatformPlanBundleSetMatchingProfileResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.setMatchingProfile,
        req,
      );
    },
    diff(req: PlatformPlanBundleDiffRequest): Promise<PlatformPlanBundleDiffResponse> {
      return client.request<PlatformPlanBundleDiffResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.diff,
        req,
      );
    },
    consistency(): Promise<PlatformPlanBundleConsistencyResponse> {
      return client.request<PlatformPlanBundleConsistencyResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.consistency,
        {},
      );
    },
    previewAllocation(planVersionId: string): Promise<PlatformPlanBundlePreviewAllocationResponse> {
      return client.request<PlatformPlanBundlePreviewAllocationResponse>(
        PLATFORM_PLAN_BUNDLE_ENDPOINTS.previewAllocation,
        { planVersionId },
      );
    },
  };
}

export type PlatformPlanBundleGateway = ReturnType<typeof createPlatformPlanBundleGateway>;
