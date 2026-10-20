// @vitest-environment jsdom
// Proves the Enterprise Data Capability Center home section renders the full
// operational cockpit (KPI summary + 6 layers) once dashboard RPCs return data.

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../../../i18n/index.ts";
import type { ManagedConnectorActionRef } from "../../../capability/enterprise-data-capability/types.ts";
import { renderEnterpriseDataGovernanceCenterSurface } from "./enterprise-data-governance-center-surface.ts";

/** Narrow Element from querySelector/find to HTMLButtonElement before .click(). */
function asHtmlButton(el: Element | null | undefined): HTMLButtonElement {
  expect(el).toBeInstanceOf(HTMLButtonElement);
  return el as HTMLButtonElement;
}

function clickButton(el: Element | null | undefined): void {
  asHtmlButton(el).click();
}

// Narrow unknown RPC params to strings without triggering no-base-to-string;
// `String(unknown)` would stringify objects as "[object Object]".
function stringParam(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// Like stringParam but maps missing/empty values to undefined (preserves the
// "empty string -> undefined" semantics some fields rely on).
function optionalStringParam(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// Minimal stub gateway client: returns dashboard payloads per RPC method.
function createStubClient(): {
  connected: boolean;
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
} {
  const payloads: Record<string, unknown> = {
    "enterprise-data.dashboard.summary": {
      summary: {
        totalDataSources: 26,
        totalCapabilities: 43,
        totalDepartments: 14,
        knowledgeObjectCount: 682,
        enabledBindingCount: 9,
        pendingApprovals: 23,
      },
    },
    "enterprise-data.governance-approvals.overview": {
      overview: {
        totalPending: 1,
        pendingByCategory: {},
        recentPending: [
          {
            approvalId: "a1",
            category: "data_access",
            displayName: "财务数据访问申请",
            requestedAt: "2026-06-08T00:00:00.000Z",
            status: "pending",
          },
        ],
      },
    },
    "enterprise-data.dashboard.source-health": {
      rows: [{ sourceId: "s1", displayName: "CRM", category: "crm", status: "normal" }],
    },
    "enterprise-data.sources.list": {
      sources: [
        {
          sourceId: "s1",
          sourceKey: "crm",
          displayName: "CRM",
          category: "crm",
          status: "connected",
          connectorId: "crm-salesforce",
          updatedAt: "2026-06-08T10:23:00.000Z",
        },
      ],
    },
    "enterprise-data.dashboard.capability-rows": {
      rows: [
        {
          capabilityId: "c1",
          displayName: "销售分析能力",
          sourceNames: ["CRM", "ERP"],
          targetLabels: ["销售部门客户摘要访问"],
          knowledgeObjectCount: 128,
          enabled: true,
          lastRunAt: "2026-06-08T10:23:00.000Z",
        },
      ],
    },
    "enterprise-data.dashboard.authorization-cards": {
      cards: [
        {
          sourceId: "s1",
          displayName: "CRM",
          targets: [
            { kind: "department", label: "华东销售", count: 1, precise: true },
            { kind: "seat", label: "华东销售经理", count: 1, precise: true },
          ],
        },
      ],
    },
    "enterprise-data.access-policies.list": {
      policies: [
        {
          policyId: "policy-1",
          displayName: "销售部门客户摘要访问",
          targetKind: "seat",
          targetId: "seat-sales-mgr-east",
          sourceId: "s1",
          actionRefs: [
            {
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v1",
            },
          ],
          enabled: true,
          compiledGrantIds: [],
          updatedAt: "2026-06-08T10:23:00.000Z",
        },
      ],
    },
    "enterprise-data.scope.list": { policies: [] },
    "enterprise-data.approval.policies.list": { policies: [] },
    "enterprise-data.actions.list": {
      actions: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
          displayName: "客户摘要查询",
          category: "crm",
          lifecycle: "active",
          riskLevel: "LOW",
          readOnly: true,
        },
      ],
    },
    "enterprise-data.access-policies.get": {
      detail: {
        policy: {
          policyId: "policy-1",
          displayName: "销售部门客户摘要访问",
          targetKind: "seat",
          targetId: "seat-sales-mgr-east",
          sourceId: "s1",
          actionRefs: [
            {
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v1",
            },
          ],
          enabled: true,
          compiledGrantIds: ["grant-1"],
          updatedAt: "2026-06-08T10:23:00.000Z",
        },
        runtimeActionRefs: [
          {
            connectorId: "crm-salesforce",
            actionKey: "crm.customer.read_summary",
            version: "v1",
          },
        ],
        compiledGrants: [
          {
            grantId: "grant-1",
            seatId: "seat-sales-mgr-east",
            connectorId: "crm-salesforce",
            actionKey: "crm.customer.read_summary",
            version: "v1",
          },
        ],
        compilationSupported: false,
      },
    },
    "enterprise-data.capabilities.list": {
      capabilities: [
        {
          capabilityId: "c1",
          capabilityKey: "sales.analysis",
          displayName: "销售分析能力",
          description: "desc",
          sourceIds: ["s1"],
          actionRefs: [
            {
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v1",
            },
          ],
          enabled: true,
          updatedAt: "2026-06-08T10:23:00.000Z",
        },
      ],
    },
    "enterprise-data.capabilities.governance-view": {
      view: {
        capability: {
          capabilityId: "c1",
          capabilityKey: "sales.analysis",
          displayName: "销售分析能力",
          description: "desc",
          sourceIds: ["s1"],
          actionRefs: [
            {
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v1",
            },
          ],
          enabled: true,
          updatedAt: "2026-06-08T10:23:00.000Z",
        },
        sourceMappings: [
          {
            sourceId: "s1",
            source: {
              sourceId: "s1",
              sourceKey: "crm",
              displayName: "CRM",
              category: "crm",
              status: "connected",
              connectorId: "crm-salesforce",
            },
          },
        ],
        actionMappings: [
          {
            ref: {
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v1",
            },
            action: {
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v1",
              displayName: "客户摘要查询",
              category: "crm",
              lifecycle: "active",
              riskLevel: "LOW",
              readOnly: true,
            },
            handlerRegistered: true,
          },
        ],
        projectionSpecs: [],
        accessScope: {
          policies: [],
          activeGrants: [],
        },
        supplyHealth: {
          enabled: true,
          projectionCount: 0,
          bindingCount: 0,
          activeGrantCount: 0,
          enabledPolicyCount: 0,
        },
      },
    },
    "enterprise-data.governance-approvals.list": {
      requests: [
        {
          approvalId: "a1",
          category: "data_access",
          subjectKind: "data_access_policy",
          subjectId: "policy-1",
          displayName: "财务数据访问申请",
          requestedBy: "admin",
          requestedAt: "2026-06-08T00:00:00.000Z",
          status: "pending",
        },
      ],
    },
    "enterprise-data.governance-approvals.get": {
      request: {
        approvalId: "a1",
        category: "data_access",
        subjectKind: "data_access_policy",
        subjectId: "policy-1",
        displayName: "财务数据访问申请",
        requestedBy: "admin",
        requestedAt: "2026-06-08T00:00:00.000Z",
        status: "pending",
        reason: "请开通财务数据查询",
      },
    },
    "enterprise-data.asset-landscape.graph": {
      graph: {
        nodes: [
          { id: "source:s1", kind: "source", label: "CRM" },
          { id: "capability:c1", kind: "capability", label: "销售分析能力" },
        ],
        edges: [{ from: "source:s1", to: "capability:c1", relation: "source" }],
        truncated: false,
      },
    },
    "enterprise-data.knowledge-supply.overview": {
      overview: {
        projectionCount: 4,
        activeProjectionCount: 3,
        enabledBindingCount: 2,
        visibilityPolicyCount: 1,
        feedItemCount: 12,
        freshness: { fresh: 10, stale: 1, expired: 1 },
        lineageRecordCount: 5,
      },
    },
    "enterprise-data.audit-lineage.overview": {
      overview: { lineageCount: 5, supplyAuditCount: 7 },
    },
  };
  return {
    connected: true,
    request: async (method: string) => payloads[method] ?? {},
  };
}

type StubPolicyRecord = {
  policyId: string;
  displayName: string;
  targetKind: string;
  targetId: string;
  sourceId?: string;
  actionRefs: ManagedConnectorActionRef[];
  scopePolicyId?: string;
  approvalPolicyId?: string;
  enabled: boolean;
  compiledGrantIds: string[];
  updatedAt: string;
};

function createStatefulManagementClient(): {
  connected: boolean;
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
} {
  let sources = [
    {
      sourceId: "s1",
      sourceKey: "crm",
      displayName: "CRM",
      category: "crm",
      status: "connected",
      connectorId: "crm-salesforce",
      updatedAt: "2026-06-08T10:23:00.000Z",
    },
  ];
  let policyCompiledGrants = [
    {
      grantId: "grant-1",
      seatId: "seat-sales-mgr-east",
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v1",
    },
  ];
  let policies: StubPolicyRecord[] = [
    {
      policyId: "policy-1",
      displayName: "销售经理客户摘要访问",
      targetKind: "seat",
      targetId: "seat-sales-mgr-east",
      sourceId: "s1",
      actionRefs: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
        },
      ],
      scopePolicyId: "",
      approvalPolicyId: "",
      enabled: true,
      compiledGrantIds: policyCompiledGrants.map((grant) => grant.grantId),
      updatedAt: "2026-06-08T10:23:00.000Z",
    },
  ];
  let capabilities = [
    {
      capabilityId: "c1",
      capabilityKey: "sales.analysis",
      displayName: "销售分析能力",
      description: "desc",
      sourceIds: ["s1"],
      actionRefs: [
        {
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
        },
      ],
      enabled: true,
      updatedAt: "2026-06-08T10:23:00.000Z",
    },
  ];
  let approvals = [
    {
      approvalId: "a1",
      category: "data_access",
      subjectKind: "data_access_policy",
      subjectId: "policy-1",
      displayName: "财务数据访问申请",
      requestedBy: "admin",
      requestedAt: "2026-06-08T00:00:00.000Z",
      status: "pending",
      reason: "请开通财务数据查询",
      decisionNote: undefined as string | undefined,
    },
  ];

  return {
    connected: true,
    request: async (method: string, params: Record<string, unknown> = {}) => {
      switch (method) {
        case "enterprise-data.dashboard.summary":
          return {
            summary: {
              totalDataSources: sources.length,
              totalCapabilities: capabilities.length,
              totalDepartments: 1,
              knowledgeObjectCount: 682,
              enabledBindingCount: 9,
              pendingApprovals: approvals.filter((item) => item.status === "pending").length,
            },
          };
        case "enterprise-data.governance-approvals.overview":
          return {
            overview: {
              totalPending: approvals.filter((item) => item.status === "pending").length,
              pendingByCategory: {},
              recentPending: approvals,
            },
          };
        case "enterprise-data.governance-approvals.list":
          return { requests: approvals };
        case "enterprise-data.governance-approvals.get": {
          const approvalId = stringParam(params.approvalId);
          return { request: approvals.find((item) => item.approvalId === approvalId) };
        }
        case "enterprise-data.governance-approvals.decide": {
          const approvalId = stringParam(params.approvalId);
          const decision = stringParam(params.decision);
          approvals = approvals.map((item) =>
            item.approvalId === approvalId
              ? {
                  ...item,
                  status: decision,
                  decisionNote: optionalStringParam(params.decisionNote),
                }
              : item,
          );
          return { request: approvals.find((item) => item.approvalId === approvalId) };
        }
        case "enterprise-data.dashboard.source-health":
          return {
            rows: sources.map((source) => ({
              sourceId: source.sourceId,
              displayName: source.displayName,
              category: source.category,
              status: source.status === "disconnected" ? "disconnected" : "normal",
            })),
          };
        case "enterprise-data.sources.list":
          return { sources };
        case "enterprise-data.sources.upsert": {
          const sourceId = stringParam(params.sourceId, `s${sources.length + 1}`);
          const source = {
            sourceId,
            sourceKey: stringParam(params.sourceKey),
            displayName: stringParam(params.displayName),
            category: stringParam(params.category, "crm"),
            status: stringParam(params.status, "connected"),
            connectorId: stringParam(params.connectorId),
            updatedAt: "2026-06-12T00:00:00.000Z",
          };
          const existingIndex = sources.findIndex((item) => item.sourceId === sourceId);
          if (existingIndex >= 0) {
            sources[existingIndex] = source;
          } else {
            sources = [...sources, source];
          }
          return { source };
        }
        case "enterprise-data.sources.archive": {
          const sourceId = stringParam(params.sourceId);
          sources = sources.map((item) =>
            item.sourceId === sourceId ? { ...item, status: "disconnected" } : item,
          );
          return { source: sources.find((item) => item.sourceId === sourceId) };
        }
        case "enterprise-data.sources.sync-log":
          return {
            events: [
              {
                auditId: "audit-1",
                recordedAt: "2026-06-12T00:00:00.000Z",
                status: "success",
                projectionId: "proj-1",
                objectId: "obj-1",
              },
            ],
          };
        case "enterprise-data.actions.list":
          return {
            actions: [
              {
                connectorId: "crm-salesforce",
                actionKey: "crm.customer.read_summary",
                version: "v1",
                displayName: "客户摘要查询",
                category: "crm",
                lifecycle: "active",
                riskLevel: "LOW",
                readOnly: true,
              },
            ],
          };
        case "enterprise-data.scope.list":
          return { policies: [] };
        case "enterprise-data.approval.policies.list":
          return { policies: [] };
        case "enterprise-data.access-policies.list":
          return { policies };
        case "enterprise-data.access-policies.get": {
          const policyId = stringParam(params.policyId);
          const policy = policies.find((item) => item.policyId === policyId);
          return {
            detail: policy
              ? {
                  policy,
                  runtimeActionRefs: policy.actionRefs,
                  compiledGrants: policyCompiledGrants,
                  compilationSupported: policy.targetKind === "seat",
                }
              : null,
          };
        }
        case "enterprise-data.access-policies.upsert": {
          const policyId = stringParam(params.policyId, `policy-${policies.length + 1}`);
          const policy = {
            policyId,
            displayName: stringParam(params.displayName),
            targetKind: stringParam(params.targetKind, "seat"),
            targetId: stringParam(params.targetId),
            sourceId: typeof params.sourceId === "string" ? params.sourceId : undefined,
            actionRefs: (params.actionRefs as ManagedConnectorActionRef[]) ?? [],
            scopePolicyId:
              typeof params.scopePolicyId === "string" ? params.scopePolicyId : undefined,
            approvalPolicyId:
              typeof params.approvalPolicyId === "string" ? params.approvalPolicyId : undefined,
            enabled: params.enabled !== false,
            compiledGrantIds: [],
            updatedAt: "2026-06-12T00:00:00.000Z",
          };
          const existingIndex = policies.findIndex((item) => item.policyId === policyId);
          if (existingIndex >= 0) {
            policies[existingIndex] = policy;
          } else {
            policies = [...policies, policy];
          }
          return { policy };
        }
        case "enterprise-data.access-policies.compile": {
          const policyId = stringParam(params.policyId);
          policyCompiledGrants = [
            {
              grantId: "grant-compiled-1",
              seatId: "seat-sales-mgr-east",
              connectorId: "crm-salesforce",
              actionKey: "crm.customer.read_summary",
              version: "v1",
            },
          ];
          policies = policies.map((item) =>
            item.policyId === policyId
              ? { ...item, compiledGrantIds: policyCompiledGrants.map((grant) => grant.grantId) }
              : item,
          );
          return {
            policy: policies.find((item) => item.policyId === policyId),
            grants: policyCompiledGrants,
          };
        }
        case "enterprise-data.access-policies.archive": {
          const policyId = stringParam(params.policyId);
          policies = policies.filter((item) => item.policyId !== policyId);
          return {
            policy: {
              policyId,
              displayName: "archived",
              targetKind: "seat",
              targetId: "archived",
              actionRefs: [],
              enabled: false,
              compiledGrantIds: [],
              updatedAt: "2026-06-12T00:00:00.000Z",
            },
          };
        }
        case "enterprise-data.grants.revoke": {
          const grantId = stringParam(params.grantId);
          policyCompiledGrants = policyCompiledGrants.map((grant) =>
            grant.grantId === grantId ? { ...grant, revokedAt: "2026-06-12T00:00:00.000Z" } : grant,
          );
          return { grant: policyCompiledGrants.find((grant) => grant.grantId === grantId) };
        }
        case "enterprise-data.capabilities.list":
          return { capabilities };
        case "enterprise-data.capabilities.get": {
          const capabilityId = stringParam(params.capabilityId);
          return { capability: capabilities.find((item) => item.capabilityId === capabilityId) };
        }
        case "enterprise-data.capabilities.governance-view": {
          const capabilityId = stringParam(params.capabilityId);
          const capability = capabilities.find((item) => item.capabilityId === capabilityId);
          return {
            view: capability
              ? {
                  capability,
                  sourceMappings: sources
                    .filter((source) => capability.sourceIds.includes(source.sourceId))
                    .map((source) => ({ sourceId: source.sourceId, source })),
                  actionMappings: capability.actionRefs.map((ref) => ({
                    ref,
                    action: {
                      connectorId: ref.connectorId,
                      actionKey: ref.actionKey,
                      version: ref.version,
                      displayName: "客户摘要查询",
                      category: "crm",
                      lifecycle: "active",
                      riskLevel: "LOW",
                      readOnly: true,
                    },
                    handlerRegistered: true,
                  })),
                  projectionSpecs: [],
                  accessScope: { policies: [], activeGrants: [] },
                  supplyHealth: {
                    enabled: capability.enabled,
                    projectionCount: 0,
                    bindingCount: 0,
                    activeGrantCount: 0,
                    enabledPolicyCount: 0,
                  },
                }
              : null,
          };
        }
        case "enterprise-data.capabilities.upsert": {
          const capabilityId = stringParam(params.capabilityId, `c${capabilities.length + 1}`);
          const capability = {
            capabilityId,
            capabilityKey: stringParam(params.capabilityKey),
            displayName: stringParam(params.displayName),
            description: stringParam(params.description),
            sourceIds: (params.sourceIds as string[]) ?? [],
            actionRefs: (params.actionRefs as ManagedConnectorActionRef[]) ?? [],
            enabled: params.enabled !== false,
            updatedAt: "2026-06-12T00:00:00.000Z",
          };
          const existingIndex = capabilities.findIndex(
            (item) => item.capabilityId === capabilityId,
          );
          if (existingIndex >= 0) {
            capabilities[existingIndex] = capability;
          } else {
            capabilities = [...capabilities, capability];
          }
          return { capability };
        }
        case "enterprise-data.capabilities.archive": {
          const capabilityId = stringParam(params.capabilityId);
          capabilities = capabilities.map((item) =>
            item.capabilityId === capabilityId ? { ...item, enabled: false } : item,
          );
          return { capability: capabilities.find((item) => item.capabilityId === capabilityId) };
        }
        case "enterprise-data.asset-landscape.graph":
          return {
            graph: {
              nodes: [
                { id: "source:s1", kind: "source", label: "CRM" },
                { id: "capability:c1", kind: "capability", label: "销售分析能力" },
              ],
              edges: [{ from: "source:s1", to: "capability:c1", relation: "source" }],
              truncated: false,
            },
          };
        case "enterprise-data.knowledge-supply.overview":
          return {
            overview: {
              projectionCount: 4,
              activeProjectionCount: 3,
              enabledBindingCount: 2,
              visibilityPolicyCount: 1,
              feedItemCount: 12,
              freshness: { fresh: 10, stale: 1, expired: 1 },
              lineageRecordCount: 5,
            },
          };
        case "enterprise-data.audit-lineage.overview":
          return { overview: { lineageCount: 5, supplyAuditCount: 7 } };
        default:
          return {};
      }
    },
  };
}

function createConnectableStubClient(): {
  connected: boolean;
  request: (method: string) => Promise<unknown>;
} {
  const payloads: Record<string, unknown> = {
    "enterprise-data.dashboard.summary": {
      summary: {
        totalDataSources: 26,
        totalCapabilities: 43,
        totalDepartments: 14,
        knowledgeObjectCount: 682,
        enabledBindingCount: 9,
        pendingApprovals: 23,
      },
    },
    "enterprise-data.governance-approvals.overview": {
      overview: {
        totalPending: 1,
        pendingByCategory: {},
        recentPending: [
          {
            approvalId: "a1",
            category: "data_access",
            displayName: "财务数据访问申请",
            requestedAt: "2026-06-08T00:00:00.000Z",
            status: "pending",
          },
        ],
      },
    },
    "enterprise-data.dashboard.source-health": {
      rows: [{ sourceId: "s1", displayName: "CRM", category: "crm", status: "normal" }],
    },
    "enterprise-data.dashboard.capability-rows": {
      rows: [
        {
          capabilityId: "c1",
          displayName: "销售分析能力",
          sourceNames: ["CRM", "ERP"],
          targetLabels: ["销售部门客户摘要访问"],
          knowledgeObjectCount: 128,
          enabled: true,
          lastRunAt: "2026-06-08T10:23:00.000Z",
        },
      ],
    },
    "enterprise-data.dashboard.authorization-cards": {
      cards: [
        {
          sourceId: "s1",
          displayName: "CRM",
          targets: [{ kind: "department", label: "华东销售", count: 1, precise: true }],
        },
      ],
    },
    "enterprise-data.asset-landscape.graph": {
      graph: {
        nodes: [
          { id: "source:s1", kind: "source", label: "CRM" },
          { id: "capability:c1", kind: "capability", label: "销售分析能力" },
        ],
        edges: [{ from: "source:s1", to: "capability:c1", relation: "source" }],
        truncated: false,
      },
    },
    "enterprise-data.knowledge-supply.overview": {
      overview: {
        projectionCount: 4,
        activeProjectionCount: 3,
        enabledBindingCount: 2,
        visibilityPolicyCount: 1,
        feedItemCount: 12,
        freshness: { fresh: 10, stale: 1, expired: 1 },
        lineageRecordCount: 5,
      },
    },
    "enterprise-data.audit-lineage.overview": {
      overview: { lineageCount: 5, supplyAuditCount: 7 },
    },
  };
  return {
    connected: false,
    request: async (method: string) => payloads[method] ?? {},
  };
}

function createProps(client: unknown, readModel: unknown = { currentTenantId: "acme" }) {
  return {
    tab: "enterpriseDataGovernanceCenter",
    basePath: "/openclaw",
    client,
    readModel,
    actions: { dataGovernance: { onRefresh: () => {} } },
    authPanelProps: null,
    seatOfferEditor: undefined,
    handoverEditor: undefined,
    identityManagementEditor: undefined,
    ownershipTransferEditor: undefined,
  } as unknown as Parameters<typeof renderEnterpriseDataGovernanceCenterSurface>[0];
}

async function flush(): Promise<void> {
  // Allow the async dashboard loads (Promise.all in the controller) to settle.
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Enterprise Data Capability Center — home cockpit (full surface)", () => {
  beforeEach(async () => {
    await i18n.setLocale("zh-CN");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  });

  it("renders KPI summary and overview workbench after data loads", async () => {
    const container = document.createElement("div");
    const client = createStubClient();

    // First render kicks off the async loads.
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    // Re-render after data settled (mirrors the surface's popstate-driven refresh).
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const text = container.textContent ?? "";
    // Layer 1: KPI summary numbers.
    expect(text).toContain("26");
    expect(text).toContain("43");
    expect(text).toContain("682");
    // Baseline migration (Task 11): KPI rows use the shared KPI grid component,
    // and the home summary cards (知识供给 / 审计与血缘) also render KPI grids.
    expect(container.querySelectorAll(".enterprise-kpi-grid").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".enterprise-kpi-card__value")).not.toBeNull();
    // Baseline migration: panels use the foundation .enterprise-card (no self-built .card).
    expect(container.querySelector(".enterprise-card")).not.toBeNull();
    expect(container.querySelector(".card-title")).toBeNull();
    expect(container.querySelector(".enterprise-data-capability__subnav")).toBeNull();
    expect(text).toContain("需要处理");
    expect(text).toContain("可用数据产品");
    expect(text).toContain("数据产品运行榜");
    expect(text).toContain("销售分析能力");
    expect(text).toContain("数据源健康状态");
    expect(text).toContain("待审批中心");
    expect(text).not.toContain("加载失败");
  });

  it("surfaces employee seat capability access in the home pending approval panel", async () => {
    const container = document.createElement("div");
    const base = createStubClient();
    const client = {
      ...base,
      request: async (method: string, params: Record<string, unknown> = {}) => {
        if (method === "enterprise-data.governance-approvals.overview") {
          return {
            overview: {
              totalPending: 1,
              pendingByCategory: { seat_capability_access: 1 },
              recentPending: [
                {
                  approvalId: "seat-a1",
                  category: "seat_capability_access",
                  displayName: "客户画像能力 · 席位 seat-1",
                  requestedAt: "2026-06-08T00:00:00.000Z",
                  status: "pending",
                },
              ],
            },
          };
        }
        return base.request(method, params);
      },
    };

    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("待审批中心");
    expect(text).toContain("客户画像能力");
    expect(text).toContain("员工能力申请");
    expect(
      container.querySelector('[data-testid="pending-approval-approve-seat-a1"]'),
    ).not.toBeNull();
  });

  it("defaults to the home section (not a build-tool section) on entry", async () => {
    const container = document.createElement("div");
    const client = createStubClient();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const text = container.textContent ?? "";
    // Home shows overview workbench, not a focused build-tool sub-tab.
    expect(text).toContain("需要处理");
    expect(text).toContain("可用数据产品");
    // 四一级 Tab：总览 / 数据资产 / 数据产品 / 权限与治理。
    expect(text).toContain("数据产品");
    expect(text).toContain("权限与治理");
  });

  it("waits for gateway connection and auto-loads after login handshake without manual refresh", async () => {
    const container = document.createElement("div");
    const client = createConnectableStubClient();

    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    let text = container.textContent ?? "";
    expect(text).not.toContain("数据加载失败");
    expect(text).toContain("需要处理");
    expect(text).toContain("需要处理");

    client.connected = true;
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    text = container.textContent ?? "";
    expect(text).toContain("需要处理");
    expect(text).toContain("销售分析能力");
    expect(text).not.toContain("数据加载失败");
  });

  it("switches to management sections from subnav", async () => {
    const container = document.createElement("div");
    const client = createStubClient();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    // Baseline migration (Task 11.4): the section nav is the shared segmented nav
    // (role=tablist + role=tab), not the old .enterprise-data-capability__subnav.
    const nav = container.querySelector(".enterprise-segmented-nav");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("role")).toBe("tablist");
    expect(container.querySelectorAll('.enterprise-segmented-nav__tab[role="tab"]').length).toBe(4);
    expect(container.querySelector(".enterprise-data-capability__subnav")).toBeNull();

    const sourcesTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("数据资产"),
    );
    expect(sourcesTab).toBeTruthy();
    expect(sourcesTab?.getAttribute("role")).toBe("tab");
    clickButton(sourcesTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("新增数据资产");
    expect(container.textContent).toContain("查看同步日志");

    const approvalsTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("权限与治理"),
    );
    expect(approvalsTab).toBeTruthy();
    clickButton(approvalsTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const pendingSubTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("待审批"),
    );
    expect(pendingSubTab).toBeTruthy();
    clickButton(pendingSubTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("待我审批");
    expect(container.textContent).toContain("批准");
    expect(container.textContent).toContain("拒绝");
  });

  it("opens source editor and approval decision modal in management sections", async () => {
    const container = document.createElement("div");
    const client = createStubClient();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const sourcesTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("数据资产"),
    );
    clickButton(sourcesTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const addSourceButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("新增数据资产"),
    );
    expect(addSourceButton).toBeTruthy();
    clickButton(addSourceButton);
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("下一步");

    const approvalsTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("权限与治理"),
    );
    clickButton(approvalsTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const subTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("待审批"),
    );
    expect(subTab).toBeTruthy();
    clickButton(subTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "批准",
    );
    expect(approveButton).toBeTruthy();
    clickButton(approveButton);
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("审批决策");
  });

  it("opens the policy editor with org data and renders the target picker without crashing", async () => {
    // Regression guard for the org target picker crash: when seat summaries are
    // present, opening the 新建策略 modal renders the checkbox tree, which
    // iterates props.selectedDepartmentPaths ([...set]). A binding that omits
    // departmentPaths makes that undefined and throws on every render, freezing
    // the whole surface (tabs + buttons stop responding). This test reproduces
    // that path; a regression throws synchronously inside render() below.
    const container = document.createElement("div");
    const client = createStubClient();
    const readModel = {
      currentTenantId: "acme",
      seatSummaries: [
        {
          seatId: "seat-1",
          title: "销售经理",
          teamLabel: "销售部",
          status: "active",
          roleCode: "sales-mgr",
        },
      ],
      memberSummaries: [],
    };
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client, readModel), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client, readModel), "/openclaw"),
      container,
    );

    const authorizationTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("权限与治理"),
    );
    clickButton(authorizationTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client, readModel), "/openclaw"),
      container,
    );

    const addPolicyButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("新建策略"),
    );
    expect(addPolicyButton).toBeTruthy();
    clickButton(addPolicyButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client, readModel), "/openclaw"),
      container,
    );

    const text = container.textContent ?? "";
    // Modal opened …
    expect(text).toContain("保存策略");
    // … and the org target picker rendered the tree past the previously-crashing
    // [...selectedDepartmentPaths] line (department + seat from the read model).
    expect(container.querySelector(".edc-org-tree")).not.toBeNull();
    expect(text).toContain("销售部");
    expect(text).toContain("销售经理");
  });

  it("opens the new-projection modal from the projection studio without crashing", async () => {
    // Regression guard for the 新建投影 flow: the projection studio must load
    // (specs/bindings/audit) and render the 新建投影规格 button + modal. A failure
    // in the projections load early-returns before the button; a modal render
    // throw would surface here synchronously.
    const container = document.createElement("div");
    const client = {
      connected: true,
      request: async (method: string) => {
        switch (method) {
          case "enterprise-data.projection-specs.list":
            return { specs: [] };
          case "enterprise-data.projection-bindings.list":
            return { bindings: [] };
          case "enterprise-data.audit-lineage.overview":
            return {
              overview: { lineageCount: 0, supplyAuditCount: 2, materializationFailureCount: 2 },
            };
          case "enterprise-data.connector-actions.list":
            return {
              actions: [
                {
                  connectorId: "crm-salesforce",
                  actionKey: "crm.customer.read_summary",
                  version: "v1",
                  displayName: "客户摘要查询",
                  category: "crm",
                  lifecycle: "active",
                  riskLevel: "LOW",
                  readOnly: true,
                },
              ],
            };
          default:
            return {};
        }
      },
    };
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const projectionsTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("数据产品"),
    );
    clickButton(projectionsTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const outputsSubTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("输出与物化"),
    );
    expect(outputsSubTab).toBeTruthy();
    clickButton(outputsSubTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    // Lean outputs UI keeps the create CTA; the failure chip may be omitted.
    const addProjectionButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("新建输出规格"),
    );
    expect(addProjectionButton).toBeTruthy();
    clickButton(addProjectionButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const text = container.textContent ?? "";
    // Modal opened with both sections + the source-action picker.
    expect(text).toContain("确认创建");
    expect(text).toContain("供给绑定");
    expect(text).toContain("源动作（来自数据能力的动作）");
  });

  it("opens policy and capability editor modals in management sections", async () => {
    const container = document.createElement("div");
    const client = createStubClient();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const authorizationTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("权限与治理"),
    );
    clickButton(authorizationTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const addPolicyButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("新建策略"),
    );
    expect(addPolicyButton).toBeTruthy();
    clickButton(addPolicyButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("保存策略");

    const capabilitiesTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("数据产品"),
    );
    clickButton(capabilitiesTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const addCapabilityButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("新建数据产品"),
    );
    expect(addCapabilityButton).toBeTruthy();
    clickButton(addCapabilityButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("下一步");
  });

  it("loads policy detail and approval detail from management sections", async () => {
    const container = document.createElement("div");
    const client = createStubClient();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const authorizationTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("权限与治理"),
    );
    clickButton(authorizationTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const policyDetailButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "详情",
    );
    expect(policyDetailButton).toBeTruthy();
    clickButton(policyDetailButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("策略详情");
    expect(container.textContent).toContain("已编译授权");
    expect(container.textContent).toContain("撤销授权");

    const approvalsTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("权限与治理"),
    );
    clickButton(approvalsTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const subTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("待审批"),
    );
    expect(subTab).toBeTruthy();
    clickButton(subTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const approvalDetailButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "查看详情",
    );
    expect(approvalDetailButton).toBeTruthy();
    clickButton(approvalDetailButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("申请原因：请开通财务数据查询");
  });

  it("updates source list after creating a source", async () => {
    const container = document.createElement("div");
    const client = createStatefulManagementClient();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const sourcesTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("数据资产"),
    );
    clickButton(sourcesTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const addSourceButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("新增数据资产"),
    );
    clickButton(addSourceButton);
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const modal = container.querySelector(".enterprise-org-modal");
    expect(modal).not.toBeNull();
    const selects = Array.from(modal!.querySelectorAll("select"));
    selects[0].value = "sap-erp";
    selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const modalAfter = container.querySelector(".enterprise-org-modal");
    const inputs = Array.from(modalAfter!.querySelectorAll("input")).filter(
      (input): input is HTMLInputElement =>
        input instanceof HTMLInputElement && input.type !== "checkbox",
    );
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    const keyInput = inputs[0];
    const nameInput = inputs[1];
    keyInput.value = "erp";
    keyInput.dispatchEvent(new Event("input", { bubbles: true }));
    nameInput.value = "ERP";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const saveButton = Array.from(container.querySelectorAll(".enterprise-org-modal button")).find(
      (entry) => entry.textContent?.includes("保存数据资产"),
    );
    expect(saveButton).toBeTruthy();
    clickButton(saveButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("数据源已创建。");
    expect(container.textContent).toContain("ERP");
  });

  it("updates policy detail after compile and revoke grant", async () => {
    const container = document.createElement("div");
    const client = createStatefulManagementClient();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const authorizationTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("权限与治理"),
    );
    clickButton(authorizationTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const detailButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "详情",
    );
    clickButton(detailButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const compileButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "编译为席位授权",
    );
    clickButton(compileButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("已编译 1 条席位授权。");

    const revokeButton = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("撤销授权"),
    );
    clickButton(revokeButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("已撤销：2026-06-12T00:00:00.000Z");
  });

  it("updates capability status after archive action", async () => {
    const container = document.createElement("div");
    const client = createStatefulManagementClient();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const capabilitiesTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("数据产品"),
    );
    clickButton(capabilitiesTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const archiveButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "停用",
    );
    clickButton(archiveButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("已停用 销售分析能力。");
    expect(container.textContent).toContain("停用");
  });

  it("updates approval state after approving a request", async () => {
    const container = document.createElement("div");
    const client = createStatefulManagementClient();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );

    const approvalsTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("权限与治理"),
    );
    clickButton(approvalsTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const subTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("待审批"),
    );
    expect(subTab).toBeTruthy();
    clickButton(subTab);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const approveButton = Array.from(container.querySelectorAll("button")).find(
      (entry) => entry.textContent?.trim() === "批准",
    );
    clickButton(approveButton);
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    const modalApproveButton = Array.from(container.querySelectorAll("button")).find(
      (entry) =>
        entry.textContent?.trim() === "批准" && entry.closest(".enterprise-org-modal") != null,
    );
    clickButton(modalApproveButton);
    await flush();
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("已批准 财务数据访问申请。");

    // 审批后请求从「待我审批」移入「已处理历史」，状态以「已批准」胶囊呈现（不再直出英文 approved）。
    const historyTab = Array.from(container.querySelectorAll("button")).find((entry) =>
      entry.textContent?.includes("已处理历史"),
    );
    clickButton(historyTab);
    render(
      renderEnterpriseDataGovernanceCenterSurface(createProps(client), "/openclaw"),
      container,
    );
    expect(container.textContent).toContain("已批准");
    expect(container.textContent).not.toContain("approved");
  });
});
