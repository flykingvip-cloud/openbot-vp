/**
 * usage.cost.layer — 三端同一份用量事实，按身份裁剪字段。
 * 复用 Usage Ledger + Credits 阶段机，不新建账本。
 */

import type { UsageCostSurface } from "../../shared/usage-cost-layer.js";
import { loadUsageCostFacts } from "../billing/usage-cost-facts.js";
import { presentUsageCostLayer, type UsageCostActor } from "../billing/usage-cost-layer.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { stringValue } from "../records.js";
import { requireEnterpriseScope } from "./billing-helpers.js";
import type { GatewayClient, GatewayRequestHandlers, RespondFn } from "./types.js";

const SURFACES = new Set<UsageCostSurface>(["user", "enterprise", "platform"]);

function ledgerPathOverride(): string | undefined {
  const value = process.env.OPENBOT_USAGE_LEDGER_PATH?.trim();
  return value || undefined;
}

function stagePathOverride(): string | undefined {
  const value = process.env.OPENBOT_CREDIT_USAGE_STAGE_PATH?.trim();
  return value || undefined;
}

function isPlatformOperator(client: GatewayClient | null): boolean {
  if (client?.sessionDomain !== "platform") {
    return false;
  }
  if (client.sessionKind === "platform-admin" || client.sessionKind === "platform-super-admin") {
    return true;
  }
  const scopes = client.connect?.scopes;
  return Array.isArray(scopes) && scopes.includes("operator.platform");
}

function parseSurface(params: Record<string, unknown>): UsageCostSurface | "invalid" | undefined {
  const raw = stringValue(params.surface);
  if (!raw) {
    return undefined;
  }
  return SURFACES.has(raw as UsageCostSurface) ? (raw as UsageCostSurface) : "invalid";
}

function parseInstant(value: unknown): string | undefined | null {
  const text = stringValue(value);
  if (!text) {
    return undefined;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

function fail(
  respond: RespondFn,
  message: string,
  code: "INVALID_REQUEST" | "UNAVAILABLE" = ErrorCodes.INVALID_REQUEST,
) {
  respond(false, undefined, errorShape(code, message));
}

export const usageCostLayerHandlers: GatewayRequestHandlers = {
  "usage.cost.layer": async ({ client, params, respond }) => {
    const record = params && typeof params === "object" ? params : {};
    const surface = parseSurface(record);
    if (surface === "invalid") {
      fail(respond, "参数不正确");
      return;
    }
    const startTime = parseInstant(record.startTime);
    const endTime = parseInstant(record.endTime);
    if (startTime === null || endTime === null) {
      fail(respond, "时间范围不正确");
      return;
    }
    const taskId = stringValue(record.taskId) ?? undefined;
    try {
      if (surface === "platform" || (surface === undefined && isPlatformOperator(client))) {
        if (!isPlatformOperator(client)) {
          fail(respond, "无权查看平台成本");
          return;
        }
        const enterpriseFilter = stringValue(record.enterpriseId) ?? stringValue(record.tenantId);
        const loaded = await loadUsageCostFacts({
          allEnterprises: true,
          ...(taskId ? { taskId } : {}),
          ...(startTime ? { startTime } : {}),
          ...(endTime ? { endTime } : {}),
          ledgerStorePath: ledgerPathOverride(),
          stageStorePath: stagePathOverride(),
        });
        const actor: UsageCostActor = {
          surface: "platform",
          userId: client?.platformUserId ?? null,
          enterpriseId: enterpriseFilter,
          enterpriseWide: true,
        };
        reply(respond, actor, loaded.facts, taskId, loaded.truncated, {
          emptyReason: loaded.emptyReason,
          ledgerBasis: loaded.ledgerBasis,
        });
        return;
      }

      if (client?.sessionDomain === "employee") {
        if (surface === "enterprise") {
          fail(respond, "无权查看企业汇总");
          return;
        }
        const userId = client?.platformUserId?.trim() || client?.user?.trim() || "";
        const enterpriseId =
          client?.sessionEnterpriseId?.trim() || client?.sessionTenantId?.trim() || "";
        if (!userId) {
          fail(respond, "无法确定身份");
          return;
        }
        const loaded = enterpriseId
          ? await loadUsageCostFacts({
              enterpriseId,
              ...(taskId ? { taskId } : {}),
              ...(startTime ? { startTime } : {}),
              ...(endTime ? { endTime } : {}),
              ledgerStorePath: ledgerPathOverride(),
              stageStorePath: stagePathOverride(),
            })
          : {
              facts: [],
              truncated: false,
              emptyReason: "no_ledger_entry" as const,
              ledgerBasis: "usage_ledger_not_tip_spend" as const,
            };
        reply(
          respond,
          {
            surface: "user",
            userId,
            enterpriseId: enterpriseId || null,
            enterpriseWide: false,
          },
          loaded.facts,
          taskId,
          loaded.truncated,
          {
            emptyReason: loaded.emptyReason,
            ledgerBasis: loaded.ledgerBasis,
          },
        );
        return;
      }

      const scope = await requireEnterpriseScope(client, respond, record);
      if (!scope) {
        return;
      }
      const userId = scope.user?.id?.trim() || client?.platformUserId?.trim() || "";
      const wantEnterprise = surface !== "user";
      if (!wantEnterprise && !userId) {
        fail(respond, "无法确定身份");
        return;
      }
      const loaded = await loadUsageCostFacts({
        enterpriseId: scope.enterpriseId,
        ...(taskId ? { taskId } : {}),
        ...(startTime ? { startTime } : {}),
        ...(endTime ? { endTime } : {}),
        ledgerStorePath: ledgerPathOverride(),
        stageStorePath: stagePathOverride(),
      });
      const actor: UsageCostActor = wantEnterprise
        ? {
            surface: "enterprise",
            userId: userId || null,
            enterpriseId: scope.enterpriseId,
            enterpriseWide: scope.isEnterpriseAdmin,
          }
        : {
            surface: "user",
            userId,
            enterpriseId: scope.enterpriseId,
            enterpriseWide: false,
          };
      reply(respond, actor, loaded.facts, taskId, loaded.truncated, {
        emptyReason: loaded.emptyReason,
        ledgerBasis: loaded.ledgerBasis,
      });
    } catch {
      fail(respond, "用量暂时无法读取，请稍后重试", ErrorCodes.UNAVAILABLE);
    }
  },
};

function reply(
  respond: RespondFn,
  actor: UsageCostActor,
  facts: Parameters<typeof presentUsageCostLayer>[1],
  taskId: string | undefined,
  truncated: boolean,
  meta?: {
    emptyReason?: "none" | "no_ledger_entry" | "skipped_consumption" | "filtered_empty";
    ledgerBasis?: "usage_ledger_not_tip_spend";
  },
) {
  const presented = presentUsageCostLayer(actor, facts, {
    ...(taskId ? { taskId } : {}),
    truncated,
    ...(meta?.emptyReason ? { emptyReason: meta.emptyReason } : {}),
    ...(meta?.ledgerBasis ? { ledgerBasis: meta.ledgerBasis } : {}),
  });
  if (!presented.ok) {
    fail(respond, presented.message);
    return;
  }
  respond(true, presented.view);
}
