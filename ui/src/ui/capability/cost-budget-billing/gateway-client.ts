/**
 * Gateway client —— 成本与预算（Cost & Budget Billing）。
 *
 * 强类型封装 `platform-*` / `subscriptions.*` / `seats.*` / `budget.*` /
 * `usage-ingest.*` / `resources.*` / `cost-control.*` / `billing.*` RPC。
 * 镜像 `enterprise-capability-usage-management/gateway-client.ts` 范式。
 */

import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  COST_BUDGET_ENDPOINTS,
  type AnalyticsRequest,
  type AnalyticsResponse,
  type SeatAttributionRequest,
  type SeatAttributionResponse,
  type PositionAttributionRequest,
  type PositionAttributionResponse,
  type ExportPositionReportRequest,
  type ExportPositionReportResponse,
  type AllocationApplyProfileRequest,
  type AllocationApplyProfileResponse,
  type AllocationOverviewResponse,
  type AllocationSyncAllSeatsResponse,
  type PlanAllocationPreviewResponse,
  type BudgetGetResponse,
  type BudgetSetRequest,
  type BudgetSetResponse,
  type ChangePlanRequest,
  type ChangePlanResponse,
  type CostControlCheckRequest,
  type CostControlCheckResponse,
  type ConsumptionForecastGetResponse,
  type DashboardResponse,
  type ListCreditsCyclesResponse,
  type PlanCreateRequest,
  type PlanCreateResponse,
  type PlansListResponse,
  type PlanUpdateRequest,
  type PlanUpdateResponse,
  type PricingActivateRequest,
  type PricingActivateResponse,
  type PricingCreateVersionRequest,
  type PricingCreateVersionResponse,
  type PricingDeprecateRequest,
  type PricingDeprecateResponse,
  type PricingDeleteVersionRequest,
  type PricingDeleteVersionResponse,
  type PricingDiffRequest,
  type PricingDiffResponse,
  type PricingListRequest,
  type PricingListResponse,
  type PricingListVersionsRequest,
  type PricingListVersionsResponse,
  type PricingSetRequest,
  type PricingSetResponse,
  type ResourcesCreateBotRequest,
  type ResourcesSetUserLimitRequest,
  type ResourcesSummaryResponse,
  type SeatAssignRequest,
  type SeatAssignResponse,
  type SeatListResponse,
  type SeatSetRoleRequest,
  type SeatSetRoleResponse,
  type SubscribeRequest,
  type SubscribeResponse,
  type SubscriptionGetResponse,
  type SubscriptionPreviewPlanAllocationResponse,
  type CommercialOrdersListResponse,
  type CommercialOrderGetResponse,
  type CommercialOrderDetail,
  type BankTransferInstructions,
  type BillingProfileGetResponse,
  type BillingProfileSetRequest,
  type TenantBillingProfile,
  type InvoicesListResponse,
  type InvoiceRequest,
  type CommercialOrderCreateResponse,
  type PaymentCreateResponse,
} from "./endpoints.ts";

export function createCostBudgetGateway(client: GatewayBrowserClient) {
  return {
    // 平台端
    listPlans(): Promise<PlansListResponse> {
      return client.request<PlansListResponse>(COST_BUDGET_ENDPOINTS.plansList, {});
    },
    createPlan(req: PlanCreateRequest): Promise<PlanCreateResponse> {
      return client.request<PlanCreateResponse>(COST_BUDGET_ENDPOINTS.plansCreate, req);
    },
    updatePlan(req: PlanUpdateRequest): Promise<PlanUpdateResponse> {
      return client.request<PlanUpdateResponse>(COST_BUDGET_ENDPOINTS.plansUpdate, req);
    },
    setPricing(req: PricingSetRequest): Promise<PricingSetResponse> {
      return client.request<PricingSetResponse>(COST_BUDGET_ENDPOINTS.pricingSet, req);
    },
    listPricing(req: PricingListRequest): Promise<PricingListResponse> {
      return client.request<PricingListResponse>(COST_BUDGET_ENDPOINTS.pricingList, req);
    },
    createPlanVersion(req: PricingCreateVersionRequest): Promise<PricingCreateVersionResponse> {
      return client.request<PricingCreateVersionResponse>(
        COST_BUDGET_ENDPOINTS.pricingCreateVersion,
        req,
      );
    },
    activatePlanVersion(req: PricingActivateRequest): Promise<PricingActivateResponse> {
      return client.request<PricingActivateResponse>(COST_BUDGET_ENDPOINTS.pricingActivate, req);
    },
    deprecatePlanVersion(req: PricingDeprecateRequest): Promise<PricingDeprecateResponse> {
      return client.request<PricingDeprecateResponse>(COST_BUDGET_ENDPOINTS.pricingDeprecate, req);
    },
    deletePlanVersion(req: PricingDeleteVersionRequest): Promise<PricingDeleteVersionResponse> {
      return client.request<PricingDeleteVersionResponse>(
        COST_BUDGET_ENDPOINTS.pricingDeleteVersion,
        req,
      );
    },
    listPlanVersions(req: PricingListVersionsRequest): Promise<PricingListVersionsResponse> {
      return client.request<PricingListVersionsResponse>(
        COST_BUDGET_ENDPOINTS.pricingListVersions,
        req,
      );
    },
    diffPlanVersions(req: PricingDiffRequest): Promise<PricingDiffResponse> {
      return client.request<PricingDiffResponse>(COST_BUDGET_ENDPOINTS.pricingDiff, req);
    },
    // 企业端 - 订阅
    subscribe(req: SubscribeRequest): Promise<SubscribeResponse> {
      return client.request<SubscribeResponse>(COST_BUDGET_ENDPOINTS.subscribe, req);
    },
    getSubscription(): Promise<SubscriptionGetResponse> {
      return client.request<SubscriptionGetResponse>(COST_BUDGET_ENDPOINTS.subscriptionGet, {});
    },
    changePlan(req: ChangePlanRequest): Promise<ChangePlanResponse> {
      return client.request<ChangePlanResponse>(COST_BUDGET_ENDPOINTS.changePlan, req);
    },
    // 企业端 - Seat
    assignSeat(req: SeatAssignRequest): Promise<SeatAssignResponse> {
      return client.request<SeatAssignResponse>(COST_BUDGET_ENDPOINTS.seatAssign, req);
    },
    setSeatRole(req: SeatSetRoleRequest): Promise<SeatSetRoleResponse> {
      return client.request<SeatSetRoleResponse>(COST_BUDGET_ENDPOINTS.seatSetRole, req);
    },
    listSeats(): Promise<SeatListResponse> {
      return client.request<SeatListResponse>(COST_BUDGET_ENDPOINTS.seatList, {});
    },
    allocationOverview(): Promise<AllocationOverviewResponse> {
      return client.request<AllocationOverviewResponse>(
        COST_BUDGET_ENDPOINTS.allocationOverview,
        {},
      );
    },
    applyAllocationProfile(
      req: AllocationApplyProfileRequest,
    ): Promise<AllocationApplyProfileResponse> {
      return client.request<AllocationApplyProfileResponse>(
        COST_BUDGET_ENDPOINTS.allocationApplyProfile,
        req,
      );
    },
    syncAllSeatGrants(): Promise<AllocationSyncAllSeatsResponse> {
      return client.request<AllocationSyncAllSeatsResponse>(
        COST_BUDGET_ENDPOINTS.allocationSyncAllSeats,
        {},
      );
    },
    previewPlanAllocation(planVersionId: string): Promise<PlanAllocationPreviewResponse> {
      return client.request<PlanAllocationPreviewResponse>(
        COST_BUDGET_ENDPOINTS.subscriptionPreviewPlanAllocation,
        { planVersionId },
      );
    },
    previewPlanAllocationByPlanId(
      planId: string,
    ): Promise<SubscriptionPreviewPlanAllocationResponse> {
      return client.request<SubscriptionPreviewPlanAllocationResponse>(
        COST_BUDGET_ENDPOINTS.subscriptionPreviewPlanAllocation,
        { planId },
      );
    },
    // 企业端 - 预算
    setBudget(req: BudgetSetRequest): Promise<BudgetSetResponse> {
      return client.request<BudgetSetResponse>(COST_BUDGET_ENDPOINTS.budgetSet, req);
    },
    getBudget(): Promise<BudgetGetResponse> {
      return client.request<BudgetGetResponse>(COST_BUDGET_ENDPOINTS.budgetGet, {});
    },
    // 企业端 - 资源
    resourcesSummary(): Promise<ResourcesSummaryResponse> {
      return client.request<ResourcesSummaryResponse>(COST_BUDGET_ENDPOINTS.resourcesSummary, {});
    },
    setUserBotLimit(req: ResourcesSetUserLimitRequest): Promise<{ ok: boolean }> {
      return client.request<{ ok: boolean }>(COST_BUDGET_ENDPOINTS.resourcesSetUserLimit, req);
    },
    createBot(req: ResourcesCreateBotRequest): Promise<unknown> {
      return client.request(COST_BUDGET_ENDPOINTS.resourcesCreateBot, req);
    },
    // 企业端 - 成本控制
    costControlCheck(req: CostControlCheckRequest): Promise<CostControlCheckResponse> {
      return client.request<CostControlCheckResponse>(COST_BUDGET_ENDPOINTS.costControlCheck, req);
    },
    // 企业端 - 看板/账单
    dashboard(): Promise<DashboardResponse> {
      return client.request<DashboardResponse>(COST_BUDGET_ENDPOINTS.dashboard, {});
    },
    consumptionForecast(): Promise<ConsumptionForecastGetResponse> {
      return client.request<ConsumptionForecastGetResponse>(
        COST_BUDGET_ENDPOINTS.consumptionForecastGet,
        {},
      );
    },
    analytics(req: AnalyticsRequest): Promise<AnalyticsResponse> {
      return client.request<AnalyticsResponse>(COST_BUDGET_ENDPOINTS.analytics, req);
    },
    attributionBySeat(req: SeatAttributionRequest = {}): Promise<SeatAttributionResponse> {
      return client.request<SeatAttributionResponse>(COST_BUDGET_ENDPOINTS.attributionBySeat, req);
    },
    attributionByPosition(
      req: PositionAttributionRequest = {},
    ): Promise<PositionAttributionResponse> {
      return client.request<PositionAttributionResponse>(
        COST_BUDGET_ENDPOINTS.attributionByPosition,
        req,
      );
    },
    exportPositionReport(req: ExportPositionReportRequest): Promise<ExportPositionReportResponse> {
      return client.request<ExportPositionReportResponse>(
        COST_BUDGET_ENDPOINTS.exportPositionReport,
        req,
      );
    },
    listCreditsCycles(limit?: number): Promise<ListCreditsCyclesResponse> {
      return client.request<ListCreditsCyclesResponse>(
        COST_BUDGET_ENDPOINTS.listCreditsCycles,
        limit != null && limit > 0 ? { limit } : {},
      );
    },
    listCommercialOrders(): Promise<CommercialOrdersListResponse> {
      return client.request<CommercialOrdersListResponse>(
        COST_BUDGET_ENDPOINTS.commercialOrdersList,
        {},
      );
    },
    getCommercialOrder(orderId: string): Promise<CommercialOrderGetResponse> {
      return client.request<CommercialOrderGetResponse>(COST_BUDGET_ENDPOINTS.commercialOrdersGet, {
        orderId,
      });
    },
    cancelCommercialOrder(orderId: string): Promise<{ order: CommercialOrderDetail }> {
      return client.request(COST_BUDGET_ENDPOINTS.commercialOrdersCancel, { orderId });
    },
    checkoutInfo(): Promise<{ bankTransfer: BankTransferInstructions }> {
      return client.request(COST_BUDGET_ENDPOINTS.commercialOrdersCheckoutInfo, {});
    },
    getBillingProfile(): Promise<BillingProfileGetResponse> {
      return client.request<BillingProfileGetResponse>(COST_BUDGET_ENDPOINTS.billingProfileGet, {});
    },
    setBillingProfile(
      req: BillingProfileSetRequest,
    ): Promise<{ profile: TenantBillingProfile; complete: boolean }> {
      return client.request(COST_BUDGET_ENDPOINTS.billingProfileSet, req);
    },
    listInvoiceRequests(): Promise<InvoicesListResponse> {
      return client.request<InvoicesListResponse>(COST_BUDGET_ENDPOINTS.invoicesList, {});
    },
    requestInvoice(req: {
      orderId?: string;
      billId?: string;
    }): Promise<{ request: InvoiceRequest }> {
      return client.request(COST_BUDGET_ENDPOINTS.invoicesRequest, req);
    },
    createRenewOrder(): Promise<CommercialOrderCreateResponse> {
      return client.request<CommercialOrderCreateResponse>(
        COST_BUDGET_ENDPOINTS.commercialOrdersCreate,
        {
          kind: "renew",
        },
      );
    },
    createPayment(req: {
      orderId: string;
      provider: "manual" | "stripe" | "alipay";
      requestId?: string;
    }): Promise<PaymentCreateResponse> {
      return client.request<PaymentCreateResponse>(COST_BUDGET_ENDPOINTS.paymentsCreate, req);
    },
  };
}

export type CostBudgetGateway = ReturnType<typeof createCostBudgetGateway>;
