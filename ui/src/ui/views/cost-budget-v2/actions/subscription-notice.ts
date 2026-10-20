import { t } from "../../../../i18n/index.ts";
import type { SubscriptionProvisioning } from "../../../capability/cost-budget-billing/index.ts";

export function formatSubscriptionProvisioningNotice(
  prov: SubscriptionProvisioning | null | undefined,
  kind: "subscribe" | "changePlan",
): string {
  const base =
    kind === "subscribe"
      ? t("costBudget.allocation.subscribeSuccess")
      : t("costBudget.allocation.changePlanSuccess");
  if (!prov) {
    return base;
  }
  const modelCount = prov.entitlement?.allowedModelIds.length ?? 0;
  const bootstrapAssigned = prov.seatBootstrap?.assigned ?? 0;
  const synced = prov.seatGrantsSynced.applied;
  const parts = [base];
  if (bootstrapAssigned > 0) {
    parts.push(
      t("costBudget.allocation.seatBootstrapAutoAssigned", { count: String(bootstrapAssigned) }),
    );
  } else if (synced > 0) {
    parts.push(`${synced} ${t("costBudget.allocation.seatsSynced")}`);
  }
  if (modelCount > 0) {
    parts.push(`${modelCount} ${t("costBudget.allocation.models")}`);
  }
  return parts.join(" · ");
}
