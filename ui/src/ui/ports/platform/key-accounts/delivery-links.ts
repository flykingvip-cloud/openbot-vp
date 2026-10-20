/**
 * Deep links out of the customer-delivery console.
 *
 * Assumption: the platform port has no `/platform/seats` route.
 * Seat price and entitlement catalog live on the pricing home
 * (`/platform/pricing`, packages tab). Remote account and cash
 * actions live on the commerce tab of that same surface
 * (`/platform/pricing?tab=commerce`). This module only links there.
 * It does not issue a bill or store a second license ledger.
 */

import { platformPricingHomeHref, platformPricingHref } from "../pricing/route.ts";

export const SEAT_CATALOG_NOTE = "席位与套餐目录在套餐与定价。本模块不编辑 SKU，也不保存许可账。";

export const COMMERCE_ISSUANCE_NOTE =
  "远程开户与核销记录在商业核销。本页只给入口，不在这里开发票或登记收款。";

export function seatCatalogHref(basePath: string): string {
  return platformPricingHref(basePath);
}

export function commerceIssuanceHref(basePath: string): string {
  return platformPricingHomeHref(basePath, { tab: "commerce" });
}
