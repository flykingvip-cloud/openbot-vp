/**
 * 资源与配额 handler（READ / WRITE）。Bot 创建经闸口 + 配额校验（R20 / R23）。
 *
 * 方法：resources.summary / resources.set-user-limit / resources.create-bot
 */

import { countActiveAgentRuns } from "../billing/agent-run-registry.js";
import {
  authorizeBillableBotCreate,
  publishBillableBotChanged,
  registerBillableBot,
} from "../billing/billable-bot.js";
import {
  botCountsByUser,
  countActiveBots,
  setUserBotLimit,
} from "../billing/bot-resources-store.js";
import { resolveEnterpriseEntitlement } from "../billing/resolve-enterprise-entitlement.js";
import {
  numberValue,
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

export const resourcesHandlers: GatewayRequestHandlers = {
  "resources.summary": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const usedBots = await countActiveBots(scope.enterpriseId);
      const perUser = await botCountsByUser(scope.enterpriseId);
      const entitlement = await resolveEnterpriseEntitlement(scope.enterpriseId);
      const quota = entitlement?.maxBots ?? 0;
      const concurrencyUsed = await countActiveAgentRuns(scope.enterpriseId);
      const concurrencyLimit = entitlement?.maxConcurrentRuns ?? 0;
      const ratio = quota > 0 ? usedBots / quota : 0;
      respond(true, {
        usedBots,
        quota,
        ratio,
        perUser,
        concurrencyUsed,
        concurrencyLimit,
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "resources.set-user-limit": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const userId = stringValue(params.userId);
      const limit = numberValue(params.limit);
      if (!userId) {
        respondInvalid(respond, "userId 是必填项");
        return;
      }
      if (limit === null) {
        respondInvalid(respond, "limit 是必填项");
        return;
      }
      if (limit < 0) {
        respondInvalid(respond, "limit 不能为负数");
        return;
      }
      await setUserBotLimit(scope.enterpriseId, userId, Math.floor(limit));
      respond(true, { ok: true });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "resources.create-bot": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const ownerUserId = stringValue(params.ownerUserId) ?? scope.user?.id ?? null;
      if (!ownerUserId) {
        respondInvalid(respond, "ownerUserId 是必填项");
        return;
      }
      // 统一商业闸口（P0）+ 用户级上限：与数字人创建（agents.create）共用同一 helper。
      const gate = await authorizeBillableBotCreate({
        enterpriseId: scope.enterpriseId,
        ownerUserId,
      });
      if (!gate.allowed) {
        respondInvalid(respond, gate.message);
        return;
      }
      const { bot } = await registerBillableBot({
        enterpriseId: scope.enterpriseId,
        ownerUserId,
        visibility: "private",
      });
      await publishBillableBotChanged({
        enterpriseId: scope.enterpriseId,
        bot,
        action: "created",
      });
      respond(true, { bot });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
