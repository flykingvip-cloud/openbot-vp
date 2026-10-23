/**
 * resolveEffectiveModelSet（P1）— 运行时解析员工有效模型集合。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§6.1）。
 *
 * 读取独立授权层（EnterpriseModelEntitlementStore + SeatModelGrantStore），
 * 以「平台资源目录 enabled modelIds」为上界，产出 EffectiveModelSet。
 *
 * `models.providers` 仅作发现/seed；授权控制面上界来自 resource catalog。
 * 目录缺失时托管企业 fail-closed（resolved empty）；显式 override 仍可用于测试。
 */

import type { OpenBotConfig } from "../../config/types.js";
import { listActiveTenantOwnedModelIds } from "../enterprise-model/asset-store.js";
import { isEnterpriseRuntimeModelId } from "../enterprise-model/ids.js";
import { loadEnterpriseVisiblePlatformModelIds } from "../models/load-connected-platform-model-ids.js";
import { listEnabledResourceCatalogModelIds } from "../resource-catalog/list-enabled-model-ids.js";
import { computeEffectiveModelSet } from "./effective-set.js";
import { ensureDefaultSeatModelGrant } from "./ensure-default-seat-model-grant.js";
import { getEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import { syncBillingGrantToOrgSeat } from "./mirror-billing-grant-to-org-seats.js";
import { resolveBillingSeatForEmployee } from "./resolve-billing-seat-for-employee.js";
import { getEmployeeModelGrant, getSeatModelGrant } from "./seat-model-grant-store.js";
import type { EffectiveModelSetResult, ModelRef, SeatModelGrant } from "./types.js";

function hasUsableActiveGrant(grant: SeatModelGrant | null | undefined): boolean {
  return Boolean(
    grant && grant.status === "active" && grant.grantedModelIds.some((id) => id.trim().length > 0),
  );
}

function unionModelIds(groups: Array<readonly ModelRef[] | undefined>): ModelRef[] {
  return [
    ...new Set(groups.flatMap((group) => (group ?? []).map((id) => id.trim()).filter(Boolean))),
  ];
}

/**
 * Employee grant wins for platform model ids (design §5.4).
 * Enterprise BYOK (`ent/*`) is unioned from every related seat: org position,
 * billing seat, and the bot's owning seat. A revoked/empty employee grant must
 * not hide a usable seat grant.
 */
export function mergeRelatedModelGrants(input: {
  employeeGrant: SeatModelGrant | null | undefined;
  seatGrants: Array<SeatModelGrant | null | undefined>;
}): SeatModelGrant | null {
  const usableEmployee = hasUsableActiveGrant(input.employeeGrant) ? input.employeeGrant : null;
  const usableSeats = input.seatGrants.filter((grant): grant is SeatModelGrant =>
    hasUsableActiveGrant(grant),
  );
  if (!usableEmployee && usableSeats.length === 0) {
    return input.employeeGrant ?? input.seatGrants.find((grant) => grant != null) ?? null;
  }
  const enterpriseIds = unionModelIds([
    usableEmployee ? usableEmployee.grantedModelIds.filter(isEnterpriseRuntimeModelId) : [],
    ...usableSeats.map((grant) => grant.grantedModelIds.filter(isEnterpriseRuntimeModelId)),
  ]);
  const platformIds = usableEmployee
    ? usableEmployee.grantedModelIds.filter((id) => !isEnterpriseRuntimeModelId(id))
    : unionModelIds(usableSeats.map((grant) => grant.grantedModelIds));
  const base = usableEmployee ?? usableSeats[0];
  if (!base) {
    return null;
  }
  return {
    ...base,
    grantedModelIds: unionModelIds([
      platformIds.filter((id) => !isEnterpriseRuntimeModelId(id)),
      enterpriseIds,
    ]),
  };
}

function grantModelIdsEqual(
  a: SeatModelGrant | null | undefined,
  b: SeatModelGrant | null | undefined,
): boolean {
  const left = [
    ...new Set((a?.grantedModelIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ].toSorted();
  const right = [
    ...new Set((b?.grantedModelIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ].toSorted();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Discovery/seed helper: enumerate `cfg.models.providers` + CLI backends.
 * Not the authorization upper bound — use listEnabledResourceCatalogModelIds for that.
 */
export function listConfiguredModelIds(cfg: OpenBotConfig | undefined): ModelRef[] {
  const ids: ModelRef[] = [];
  const providers = cfg?.models?.providers;
  if (providers && typeof providers === "object") {
    for (const [providerName, provider] of Object.entries(providers)) {
      const models = (provider as { models?: Array<{ id?: unknown }> } | undefined)?.models;
      if (!Array.isArray(models)) {
        continue;
      }
      for (const model of models) {
        const id = typeof model?.id === "string" ? model.id.trim() : "";
        if (id) {
          ids.push(`${providerName}/${id}`);
        }
      }
    }
  }
  const cliBackends = cfg?.agents?.defaults?.cliBackends;
  if (cliBackends && typeof cliBackends === "object") {
    for (const [rawId, backend] of Object.entries(cliBackends)) {
      const backendId = rawId.trim();
      const catalog = (backend as { modelCatalog?: Array<{ id?: unknown }> } | undefined)
        ?.modelCatalog;
      if (!backendId || !Array.isArray(catalog)) {
        continue;
      }
      for (const entry of catalog) {
        const modelId = typeof entry?.id === "string" ? entry.id.trim() : "";
        if (modelId) {
          ids.push(`${backendId}/${modelId}`);
        }
      }
    }
  }
  return [...new Set(ids)];
}

export type ResolveEffectiveModelSetInput = {
  tenantId: string;
  employeeId?: string;
  /** 员工登录邮箱；计费席位 userId 与 employeeId（platform id）可能不一致。 */
  userEmail?: string;
  seatId: string;
  cfg: OpenBotConfig | undefined;
  /** 迁移期灰度：无 active grant 时是否继承企业全集（默认 false）。 */
  seatGrantInheritsEnterprise?: boolean;
  /** 测试注入：覆盖目录 modelIds（绕过 store / cfg）。 */
  catalogActiveModelIdsOverride?: ModelRef[];
  /** 测试注入：resource catalog store 路径。 */
  resourceCatalogStorePath?: string;
  /**
   * When true (default for managed tenants), empty/missing platform catalog
   * yields resolved-empty (fail-closed). When false, falls back to cfg seed list
   * for non-enterprise compatibility paths.
   */
  requirePlatformCatalog?: boolean;
  /** 测试注入：store 路径。 */
  entitlementStorePath?: string;
  seatGrantStorePath?: string;
  /** 测试注入：billing seats store 路径。 */
  billingSeatsStorePath?: string;
  /** 测试注入：enterprise BYOK asset store 路径。 */
  enterpriseModelAssetStorePath?: string;
  /** 测试注入：enterprise BYOK connection store 路径。 */
  enterpriseModelConnectionStorePath?: string;
  /**
   * Commercial layer already resolved the billing seat. Chat must read its
   * grant even when employee email lookup misses (bot runs pass no userEmail).
   */
  billingSeatId?: string;
  /**
   * Other seats whose grants belong to this run — the bot owner seat when the
   * resolved employee/billing seat is a different id.
   */
  supplementalSeatIds?: string[];
  /**
   * 平台已连通模型。传入后跳过探测存储与网关目录 IO。
   * 测试用它固定授权交集，不把「未探测」当成用例主题。
   */
  platformConnectedModelIdsOverride?: ModelRef[];
  /** 测试注入：最近一次 models.probe 落盘路径。 */
  probeStorePath?: string;
  /** 已加载的网关目录 modelRef。省略且需要现场目录时才加载。 */
  gatewayCatalogModelIds?: ModelRef[];
  /** false 时不加载网关目录（显式配置且无成功探测的平台模型视为未连通）。 */
  loadGatewayCatalog?: boolean;
  /** 测试注入：默认席位授权兜底用的目录 / 套餐路径。 */
  modelCatalogStorePath?: string;
  subscriptionsStorePath?: string;
  planBindingStorePath?: string;
  entitlementSnapshotStorePath?: string;
};

export async function resolveEffectiveModelSet(
  input: ResolveEffectiveModelSetInput,
): Promise<EffectiveModelSetResult> {
  let catalogActiveModelIds = input.catalogActiveModelIdsOverride;
  if (!catalogActiveModelIds) {
    const platform = await listEnabledResourceCatalogModelIds({
      storePath: input.resourceCatalogStorePath,
    });
    const requireCatalog = input.requirePlatformCatalog !== false;
    if (platform.catalogEmpty) {
      if (requireCatalog) {
        // Managed default: no silent pass when catalog unmigrated/unreadable empty.
        catalogActiveModelIds = [];
      } else {
        catalogActiveModelIds = listConfiguredModelIds(input.cfg);
      }
    } else {
      catalogActiveModelIds = platform.modelIds;
    }
  }

  const entitlement = await getEnterpriseModelEntitlement(
    input.tenantId,
    input.entitlementStorePath,
  );
  // 授权粒度：employee 级优先于 seat 级（design §5.4「seat / employee 授权」）。
  // 企业自供模型不在 employee 平台 grant 里，必须从 org / billing / bot 席位并进来。
  const employeeGrant = input.employeeId
    ? await getEmployeeModelGrant(input.tenantId, input.employeeId, input.seatGrantStorePath)
    : null;
  const primarySeatId = input.seatId.trim();
  const seatGrant = primarySeatId
    ? await getSeatModelGrant(input.tenantId, primarySeatId, input.seatGrantStorePath)
    : null;

  const relatedSeatGrants: Array<SeatModelGrant | null> = [seatGrant];
  const seenSeatIds = new Set<string>(primarySeatId ? [primarySeatId] : []);
  let billingSeatIdForSync: string | undefined;
  let billingGrantForSync: SeatModelGrant | null = null;

  const explicitBillingSeatId = input.billingSeatId?.trim();
  const hasEmployeeContext = Boolean(input.employeeId?.trim() || input.userEmail?.trim());
  if (hasEmployeeContext || explicitBillingSeatId) {
    const billingSeat = hasEmployeeContext
      ? await resolveBillingSeatForEmployee({
          tenantId: input.tenantId,
          platformUserId: input.employeeId,
          userEmail: input.userEmail,
          billingSeatsStorePath: input.billingSeatsStorePath,
        })
      : null;
    // Lookup and the commercial-layer seat can differ. Read both grants.
    const billingSeatIds = [billingSeat?.id?.trim(), explicitBillingSeatId].filter(
      (id): id is string => Boolean(id),
    );
    billingSeatIdForSync = billingSeat?.id?.trim() || explicitBillingSeatId;
    for (const billingSeatId of billingSeatIds) {
      const billingGrant = seenSeatIds.has(billingSeatId)
        ? seatGrant
        : await getSeatModelGrant(input.tenantId, billingSeatId, input.seatGrantStorePath);
      if (billingSeatId === billingSeatIdForSync) {
        billingGrantForSync = billingGrant;
      }
      if (!seenSeatIds.has(billingSeatId)) {
        seenSeatIds.add(billingSeatId);
        relatedSeatGrants.push(billingGrant);
      }
    }
  }

  for (const rawSeatId of input.supplementalSeatIds ?? []) {
    const seatId = rawSeatId.trim();
    if (!seatId || seenSeatIds.has(seatId)) {
      continue;
    }
    seenSeatIds.add(seatId);
    relatedSeatGrants.push(
      await getSeatModelGrant(input.tenantId, seatId, input.seatGrantStorePath),
    );
  }

  let grant = mergeRelatedModelGrants({
    employeeGrant,
    seatGrants: relatedSeatGrants,
  });

  // org seatId 与 billing seatId 分离：把 billing 平台授权镜像到 org 席位（union，不覆盖 ent/*）。
  if (
    !hasUsableActiveGrant(employeeGrant) &&
    billingSeatIdForSync &&
    primarySeatId &&
    billingSeatIdForSync !== primarySeatId &&
    billingGrantForSync &&
    hasUsableActiveGrant(billingGrantForSync) &&
    !grantModelIdsEqual(seatGrant, billingGrantForSync)
  ) {
    await syncBillingGrantToOrgSeat({
      tenantId: input.tenantId,
      orgSeatId: primarySeatId,
      billingSeatId: billingSeatIdForSync,
      grant: billingGrantForSync,
      userEmail: input.userEmail,
      platformUserId: input.employeeId,
      seatGrantStorePath: input.seatGrantStorePath,
    });
  }

  // 无可用 grant：按企业套餐最低档（viewer）落盘兜底，避免员工激活后无法调模型。
  if (!hasUsableActiveGrant(grant) && input.seatId?.trim()) {
    const ensured = await ensureDefaultSeatModelGrant({
      tenantId: input.tenantId,
      seatId: input.seatId,
      ...(input.entitlementStorePath ? { entitlementStorePath: input.entitlementStorePath } : {}),
      ...(input.seatGrantStorePath ? { seatGrantStorePath: input.seatGrantStorePath } : {}),
      ...(input.modelCatalogStorePath
        ? { modelCatalogStorePath: input.modelCatalogStorePath }
        : {}),
      ...(input.subscriptionsStorePath
        ? { subscriptionsStorePath: input.subscriptionsStorePath }
        : {}),
      ...(input.planBindingStorePath ? { planBindingStorePath: input.planBindingStorePath } : {}),
      ...(input.entitlementSnapshotStorePath
        ? { entitlementSnapshotStorePath: input.entitlementSnapshotStorePath }
        : {}),
    });
    if (ensured.grant && hasUsableActiveGrant(ensured.grant)) {
      grant = ensured.grant;
    }
  }

  const tenantOwnedActiveModelIds = await listActiveTenantOwnedModelIds(
    input.tenantId,
    input.enterpriseModelAssetStorePath,
    input.enterpriseModelConnectionStorePath,
  );
  const platformConnectedModelIds = await resolvePlatformConnectedModelIds(input);

  return computeEffectiveModelSet({
    entitlement,
    grant,
    catalogActiveModelIds,
    tenantOwnedActiveModelIds,
    platformConnectedModelIds,
    ...(input.seatGrantInheritsEnterprise !== undefined
      ? { seatGrantInheritsEnterprise: input.seatGrantInheritsEnterprise }
      : {}),
  });
}

async function resolvePlatformConnectedModelIds(
  input: ResolveEffectiveModelSetInput,
): Promise<ModelRef[]> {
  if (input.platformConnectedModelIdsOverride) {
    return input.platformConnectedModelIdsOverride;
  }
  let gatewayCatalogModelIds = input.gatewayCatalogModelIds;
  if (!gatewayCatalogModelIds && shouldLoadGatewayCatalog(input)) {
    gatewayCatalogModelIds = await loadGatewayCatalogModelIds();
  }
  const connected = await loadEnterpriseVisiblePlatformModelIds({
    cfg: input.cfg,
    gatewayCatalogModelIds: gatewayCatalogModelIds ?? [],
    probeStorePath: input.probeStorePath,
  });
  return [...connected];
}

function shouldLoadGatewayCatalog(input: ResolveEffectiveModelSetInput): boolean {
  if (input.loadGatewayCatalog === false) {
    return false;
  }
  if (input.loadGatewayCatalog === true) {
    return true;
  }
  // Vitest 不默认拉 pi 目录；生产路径加载，以便 catalog_verified 与平台池一致。
  return process.env.VITEST !== "true";
}

async function loadGatewayCatalogModelIds(): Promise<ModelRef[]> {
  try {
    const { loadGatewayModelCatalog } = await import("../server-model-catalog.js");
    const catalog = await loadGatewayModelCatalog();
    return catalog
      .map((entry) => {
        const provider = entry.provider?.trim() ?? "";
        const id = entry.id?.trim() ?? "";
        return provider && id ? `${provider}/${id}` : "";
      })
      .filter((id) => id.length > 0);
  } catch {
    return [];
  }
}
