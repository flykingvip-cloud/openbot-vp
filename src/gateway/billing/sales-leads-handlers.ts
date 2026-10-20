/**
 * 销售线索 handler。
 *
 * - `sales-leads.submit`（WRITE）：卓越版「联系销售」需求提交，校验必填后落库。
 * - `sales-leads.list`（READ/ADMIN）：平台查看线索。
 *
 * 注：handler 放在 billing/ 下（命中 loom `billing/**` 落地流），由 server-methods.ts 注册。
 */

import {
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "../server-methods/billing-helpers.js";
import type { GatewayRequestHandlers } from "../server-methods/types.js";
import { createSalesLead, listSalesLeads } from "./sales-leads-store.js";

export const salesLeadsHandlers: GatewayRequestHandlers = {
  "sales-leads.submit": async ({ client, params, respond }) => {
    try {
      const company = stringValue(params.company);
      const contact = stringValue(params.contact);
      const phone = stringValue(params.phone);
      if (!company) {
        respondInvalid(respond, "company 是必填项");
        return;
      }
      if (!contact) {
        respondInvalid(respond, "contact 是必填项");
        return;
      }
      if (!phone) {
        respondInvalid(respond, "phone 是必填项");
        return;
      }
      const lead = await createSalesLead({
        company,
        contact,
        phone,
        ...(stringValue(params.planId) ? { planId: stringValue(params.planId) as string } : {}),
        ...(stringValue(params.scale) ? { scale: stringValue(params.scale) as string } : {}),
        ...(stringValue(params.requirements)
          ? { requirements: stringValue(params.requirements) as string }
          : {}),
        ...(client?.user ? { submittedByUserId: client.user } : {}),
      });
      respond(true, { leadId: lead.id, lead });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
  "sales-leads.list": async ({ respond }) => {
    try {
      const leads = await listSalesLeads();
      respond(true, { leads });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
