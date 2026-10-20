import type { MockHandlerInput, MockHandlerResult } from "../mock-handlers.js";
import type { DataConnectorCredentialSecret } from "../types.js";

export type SalesforceProbeResult = {
  ok: boolean;
  message: string;
};

type SalesforceAccount = {
  Id: string;
  Name: string;
  Phone?: string;
  Email?: string;
};

const SALESFORCE_API_VERSION = "v59.0";

export function normalizeSalesforceInstanceUrl(instanceUrl: string): string {
  const trimmed = instanceUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("Salesforce instance URL is required.");
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function resolveAccessToken(secret: DataConnectorCredentialSecret): string {
  const token = secret.oauthAccessToken?.trim() || secret.apiKey?.trim();
  if (!token) {
    throw new Error("Salesforce access token is required.");
  }
  return token;
}

export async function probeSalesforceConnection(
  secret: DataConnectorCredentialSecret,
): Promise<SalesforceProbeResult> {
  const instanceUrl = normalizeSalesforceInstanceUrl(secret.instanceUrl ?? "");
  const token = resolveAccessToken(secret);
  if (token.startsWith("simulated-")) {
    return {
      ok: true,
      message: "Salesforce 模拟 OAuth 凭证有效（开发模式）。",
    };
  }
  const response = await fetch(`${instanceUrl}/services/data/${SALESFORCE_API_VERSION}/limits`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      message: `Salesforce API 返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ""}`,
    };
  }
  return {
    ok: true,
    message: "Salesforce API 连通性正常（已验证访问令牌）。",
  };
}

async function queryFirstAccount(
  secret: DataConnectorCredentialSecret,
): Promise<SalesforceAccount | null> {
  const instanceUrl = normalizeSalesforceInstanceUrl(secret.instanceUrl ?? "");
  const token = resolveAccessToken(secret);
  const query = encodeURIComponent("SELECT Id,Name,Phone FROM Account LIMIT 1");
  const response = await fetch(
    `${instanceUrl}/services/data/${SALESFORCE_API_VERSION}/query?q=${query}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Salesforce query failed with status ${response.status}`);
  }
  const body = (await response.json()) as { records?: SalesforceAccount[] };
  return body.records?.[0] ?? null;
}

export async function executeSalesforceHandler(
  handlerRef: string,
  input: MockHandlerInput,
  secret: DataConnectorCredentialSecret,
): Promise<MockHandlerResult> {
  if (
    handlerRef === "enterprise-data/handlers/crm-customer-read-summary-v1" ||
    handlerRef === "enterprise-data/handlers/crm-customer-read-summary-v2"
  ) {
    const token = secret.oauthAccessToken?.trim() || secret.apiKey?.trim() || "";
    if (token.startsWith("simulated-")) {
      if (handlerRef.endsWith("-v2")) {
        return {
          payload: {
            customer: {
              id: "sf-sim-001",
              name: "Salesforce 模拟客户",
              phone: "",
              email: "",
              segment: "simulated",
            },
          },
        };
      }
      return {
        payload: {
          customer: {
            id: "sf-sim-001",
            name: "Salesforce 模拟客户",
            phone: "",
            email: "",
            owner_id: input.employeeId,
            owner_team: "simulated",
          },
        },
      };
    }
    const account = await queryFirstAccount(secret);
    if (!account) {
      return { payload: { customer: null } };
    }
    if (handlerRef.endsWith("-v2")) {
      return {
        payload: {
          customer: {
            id: account.Id,
            name: account.Name,
            phone: account.Phone ?? "",
            email: "",
            segment: "live",
          },
        },
      };
    }
    return {
      payload: {
        customer: {
          id: account.Id,
          name: account.Name,
          phone: account.Phone ?? "",
          email: "",
          owner_id: input.employeeId,
          owner_team: "live",
        },
      },
    };
  }
  throw new Error(`Salesforce adapter does not support handler: ${handlerRef}`);
}
