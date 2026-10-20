/**
 * 租户开票资料 RPC。
 */

import {
  getBillingProfile,
  isBillingProfileComplete,
  upsertBillingProfile,
} from "../commerce/billing-profile-store.js";
import type { TenantBillingProfile } from "../commerce/types.js";
import {
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function parseInvoiceType(value: string | undefined): TenantBillingProfile["invoiceType"] | null {
  if (value === "vat_special" || value === "vat_normal" || value === "electronic") {
    return value;
  }
  return null;
}

export const commercialBillingProfileHandlers: GatewayRequestHandlers = {
  "billing-profile.get": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const profile = await getBillingProfile(scope.enterpriseId);
      respond(true, {
        profile,
        complete: isBillingProfileComplete(profile),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "billing-profile.set": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const legalName = stringValue(params.legalName);
      const taxId = stringValue(params.taxId);
      const invoiceType = parseInvoiceType(stringValue(params.invoiceType) ?? undefined);
      if (!legalName || !taxId || !invoiceType) {
        respondInvalid(respond, "legalName、taxId、invoiceType 为必填项");
        return;
      }
      const profile = await upsertBillingProfile({
        enterpriseId: scope.enterpriseId,
        legalName,
        taxId,
        invoiceType,
        ...(stringValue(params.bankAccount)
          ? { bankAccount: stringValue(params.bankAccount) as string }
          : {}),
        ...(stringValue(params.address) ? { address: stringValue(params.address) as string } : {}),
        ...(stringValue(params.contactEmail)
          ? { contactEmail: stringValue(params.contactEmail) as string }
          : {}),
      });
      respond(true, { profile, complete: true });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
