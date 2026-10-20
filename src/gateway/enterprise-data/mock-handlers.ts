import type { ScopeEvaluationResult } from "./types.js";

export type MockHandlerInput = {
  input?: Record<string, unknown>;
  scope: ScopeEvaluationResult;
  employeeId: string;
};

export type MockHandlerResult = {
  payload: unknown;
};

type MockCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  owner_id: string;
  owner_team: string;
  segment?: string;
};

const MOCK_CUSTOMERS: MockCustomer[] = [
  {
    id: "cust-001",
    name: "华东客户A",
    phone: "13812345678",
    email: "a@example.com",
    owner_id: "emp-mgr-001",
    owner_team: "华东销售",
  },
  {
    id: "cust-002",
    name: "华东客户B",
    phone: "13987654321",
    email: "b@example.com",
    owner_id: "emp-mgr-002",
    owner_team: "华东销售",
    segment: "enterprise",
  },
  {
    id: "cust-003",
    name: "华北客户C",
    phone: "13700001111",
    email: "c@example.com",
    owner_id: "emp-mgr-003",
    owner_team: "华北销售",
    segment: "smb",
  },
];

function matchesScope(
  customer: MockCustomer,
  scope: ScopeEvaluationResult,
  employeeId: string,
): boolean {
  if (scope.scopeType === "ALL") {
    return true;
  }
  for (const [field, value] of Object.entries(scope.resolvedValues)) {
    if (field === "customer.owner_id" && customer.owner_id !== value) {
      return false;
    }
    if (field === "customer.owner_team" && customer.owner_team !== value) {
      return false;
    }
  }
  if (scope.scopeType === "SELF" && customer.owner_id !== employeeId) {
    return false;
  }
  return true;
}

export function executeMockHandler(handlerRef: string, input: MockHandlerInput): MockHandlerResult {
  switch (handlerRef) {
    case "enterprise-data/handlers/crm-customer-read-summary-v1":
      return {
        payload: {
          customer:
            MOCK_CUSTOMERS.filter((customer) =>
              matchesScope(customer, input.scope, input.employeeId),
            )[0] ?? null,
        },
      };
    case "enterprise-data/handlers/crm-customer-read-summary-v2": {
      const customer = MOCK_CUSTOMERS.filter((item) =>
        matchesScope(item, input.scope, input.employeeId),
      )[0];
      return {
        payload: customer
          ? {
              customer: {
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                email: customer.email,
                segment: customer.segment ?? "unknown",
              },
            }
          : { customer: null },
      };
    }
    case "enterprise-data/handlers/crm-customer-export-v1":
      return {
        payload: MOCK_CUSTOMERS.filter((customer) =>
          matchesScope(customer, input.scope, input.employeeId),
        ).map((customer) => ({ customer })),
      };
    case "enterprise-data/handlers/erp-order-read-status-v1":
      return {
        payload: {
          order: {
            id: "order-1001",
            status: "shipped",
            created_by: input.employeeId,
            team_id: input.scope.resolvedValues["order.team_id"] ?? "default-team",
          },
        },
      };
    case "enterprise-data/handlers/notion-kb-search-v1":
      return {
        payload: {
          pages: [
            { id: "notion-page-demo-1", object: "page" },
            { id: "notion-page-demo-2", object: "page" },
          ],
        },
      };
    default:
      throw new Error(`Unknown mock handler: ${handlerRef}`);
  }
}
