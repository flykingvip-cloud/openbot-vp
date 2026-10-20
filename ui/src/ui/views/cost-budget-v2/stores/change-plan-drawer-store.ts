import type { SubscriptionPreviewPlanAllocationResponse } from "../../../capability/cost-budget-billing/endpoints.ts";
import type { PricingDiff } from "../../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { loadChangePlanServerDiff } from "../actions/load-change-plan-diff.ts";

export type ChangePlanDrawerState = {
  open: boolean;
  targetPlanId: string | null;
  pricingDiff: PricingDiff | null;
  pricingDiffLoading: boolean;
  diffError: string | null;
  targetPreview: SubscriptionPreviewPlanAllocationResponse | null;
};

const state: ChangePlanDrawerState = {
  open: false,
  targetPlanId: null,
  pricingDiff: null,
  pricingDiffLoading: false,
  diffError: null,
  targetPreview: null,
};

let rerenderFn: (() => void) | undefined;
let diffLoadToken = 0;

function notify(): void {
  rerenderFn?.();
}

export function getChangePlanDrawerState(): Readonly<ChangePlanDrawerState> {
  return state;
}

export function bindChangePlanDrawerRerender(rerender: () => void): void {
  rerenderFn = rerender;
}

function resetDiffState(): void {
  state.pricingDiff = null;
  state.pricingDiffLoading = false;
  state.diffError = null;
  state.targetPreview = null;
}

export function openChangePlanDrawerConfirm(
  targetPlanId: string,
  client?: GatewayBrowserClient | null,
): void {
  state.open = true;
  state.targetPlanId = targetPlanId;
  resetDiffState();
  notify();
  if (client) {
    void selectChangePlanTarget(client, targetPlanId);
  }
}

export function closeChangePlanDrawer(): void {
  state.open = false;
  state.targetPlanId = null;
  resetDiffState();
  notify();
}

export async function selectChangePlanTarget(
  client: GatewayBrowserClient,
  targetPlanId: string,
): Promise<void> {
  state.targetPlanId = targetPlanId;
  resetDiffState();
  state.pricingDiffLoading = true;
  notify();
  const token = ++diffLoadToken;
  const result = await loadChangePlanServerDiff(client, targetPlanId);
  if (token !== diffLoadToken) {
    return;
  }
  state.pricingDiff = result.pricingDiff;
  state.targetPreview = result.preview;
  state.diffError = result.error;
  state.pricingDiffLoading = false;
  notify();
}

export async function ensureChangePlanDrawerDiffLoaded(
  client: GatewayBrowserClient,
  targetPlanId: string,
): Promise<void> {
  if (state.targetPlanId === targetPlanId && !state.pricingDiffLoading && state.targetPreview) {
    return;
  }
  await selectChangePlanTarget(client, targetPlanId);
}

export function __resetChangePlanDrawerForTest(): void {
  state.open = false;
  state.targetPlanId = null;
  resetDiffState();
  diffLoadToken = 0;
  rerenderFn = undefined;
}
