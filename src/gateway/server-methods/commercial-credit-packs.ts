/**
 * 容量包（CreditPack）RPC — 企业只读列表，平台 ADMIN 维护。
 */

import {
  listActiveCreditPacks,
  listCreditPacks,
  upsertCreditPack,
} from "../commerce/credit-packs-store.js";
import type { CreditPack } from "../commerce/types.js";
import { numberValue, respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function parsePackStatus(value: string | undefined): CreditPack["status"] | null {
  if (value === "active" || value === "archived") {
    return value;
  }
  return null;
}

export const commercialCreditPacksHandlers: GatewayRequestHandlers = {
  "credit-packs.list": async ({ params, respond }) => {
    try {
      const status = parsePackStatus(stringValue(params.status) ?? undefined);
      const packs =
        status === "active" || !status
          ? await listActiveCreditPacks()
          : await listCreditPacks({ status });
      respond(true, { packs });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "credit-packs.upsert": async ({ params, respond }) => {
    try {
      const name = stringValue(params.name);
      const credits = numberValue(params.credits);
      const priceCents = numberValue(params.priceCents);
      if (!name || credits == null || priceCents == null) {
        respondInvalid(respond, "name、credits、priceCents 为必填项");
        return;
      }
      const status = parsePackStatus(stringValue(params.status) ?? undefined);
      const pack = await upsertCreditPack({
        ...(stringValue(params.id) ? { id: stringValue(params.id) as string } : {}),
        name,
        credits,
        priceCents,
        ...(status ? { status } : {}),
      });
      respond(true, { pack });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("不能为空") || message.includes("必须")) {
        respondInvalid(respond, message);
        return;
      }
      respondUnavailable(respond, err);
    }
  },
};
