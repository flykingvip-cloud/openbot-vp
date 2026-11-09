import { describe, expect, it, vi } from "vitest";
import {
  readEnterpriseImMeasuredChecklist,
  resolveEnterpriseImSeatAndPolicy,
} from "./enterprise-im-employee-authorization.js";
import {
  bindFeishuEmployeeConnection,
  type FeishuEmployeeChannelGate,
} from "./enterprise-im-employee-connection.js";
import { confirmEnterpriseImRobotGrant } from "./enterprise-im-employee-decision.js";
import {
  readEnterpriseImEmployeeResource,
  type EnterpriseImUserDocReader,
} from "./enterprise-im-employee-read.js";
import { FEISHU_USER_DOCX_RAW_CONTENT_API } from "./enterprise-im-feishu-doc-reader.js";
import type {
  EnterpriseImResourceScope,
  UserOperationalIdentityCredentialSecretStore,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

const openGate: FeishuEmployeeChannelGate = {
  accountId: "t_001_default",
  employeeUiHint: "app_can_attempt",
  loginEnabled: true,
  statusLabel: "可绑定",
  platformEnterpriseId: "tenant-key-1",
  childExecutionBlocked: false,
};
const now = "2026-11-07T00:00:00.000Z";
const measured = { projectDocs: true, projectGroupRead: false };
const notMeasured = { projectDocs: false, projectGroupRead: false };

function emptyStore(): UserOperationalIdentityStore {
  return {
    version: 5,
    identities: {},
    grants: {},
    bindingRequests: {},
    usageEvents: {},
    lifecycleEvents: {},
    continuations: {},
    credentialHandles: {},
    oauthSessions: {},
  };
}

function bound(
  scope: EnterpriseImResourceScope,
  actions: Array<"read" | "draft" | "send"> = ["read", "draft"],
) {
  const store = emptyStore();
  const secrets: UserOperationalIdentityCredentialSecretStore = { version: 1, secrets: {} };
  const identity = bindFeishuEmployeeConnection({
    store,
    secretStore: secrets,
    ownerId: "emp-a",
    tenantId: "001",
    gate: openGate,
    nowIso: now,
    observation: {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      openId: "ou_a",
      tenantKey: "tenant-key-1",
      scopeNames: ["offline_access", "docx:document:readonly"],
    },
  });
  const confirmed = confirmEnterpriseImRobotGrant({
    store,
    secretStore: secrets,
    ownerId: "emp-a",
    identityId: identity.identityId!,
    agentId: "project",
    agentScope: "owned",
    allowedActions: actions,
    gate: openGate,
    tenantId: "001",
    confirmExplicit: true,
    resourceScope: scope,
    confirmMode: actions.includes("send") ? "draft_then_confirm" : "draft_then_confirm",
    nowIso: now,
  });
  if (!("grant" in confirmed)) {
    throw new Error("confirm failed");
  }
  return { store, secrets, identityId: identity.identityId!, grantId: confirmed.grant.grantId };
}

function authorization(action: string) {
  return resolveEnterpriseImSeatAndPolicy({
    tenantId: "001",
    ownerId: "emp-a",
    agentId: "project",
    action,
    seatStore: {
      bindings: {
        b1: {
          bindingId: "b1",
          seatId: "seat-1",
          tenantId: "001",
          employeeId: "emp-a",
          bindingStatus: "active",
          effectiveAt: now,
        },
      },
    } as never,
    policies: [
      {
        policyId: "policy-project",
        employeeId: "emp-a",
        seatId: "seat-1",
        agentId: "project",
        actions: ["read", "draft"],
      },
    ],
  });
}

function decision(setup: ReturnType<typeof bound>, action: "read" | "draft" = "read") {
  return {
    store: setup.store,
    secretStore: setup.secrets,
    ownerId: "emp-a",
    agentId: "project",
    action,
    tenantId: "001",
    identityId: setup.identityId,
    gate: openGate,
    authorization: authorization(action),
    nowIso: now,
  };
}

describe("enterprise IM controlled read (slice 3)", () => {
  it("refuses a doc outside the delegation and an empty resource scope", async () => {
    const outside = bound({
      groups: ["oc_a0553eda9014c201e6969b478895c230"],
      docs: ["doxcnInScopeDocument0000001"],
      calendars: [],
    });
    const reader = vi.fn<EnterpriseImUserDocReader>();
    const denied = await readEnterpriseImEmployeeResource({
      decision: decision(outside),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnOtherDocument000000001",
      measured,
      readDoc: reader,
    });
    expect(denied.outcome).toBe("deny");
    if (denied.outcome === "deny") {
      expect(denied.code).toBe("RESOURCE_OUT_OF_SCOPE");
    }
    expect(reader).not.toHaveBeenCalled();

    const empty = bound({ groups: [], docs: [], calendars: [] });
    const emptyRead = await readEnterpriseImEmployeeResource({
      decision: decision(empty),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: reader,
    });
    expect(emptyRead).toMatchObject({ outcome: "deny", code: "RESOURCE_SCOPE_EMPTY" });
    expect(empty.store.grants[empty.grantId]?.resourceScope?.docs).toEqual([]);
    expect(reader).not.toHaveBeenCalled();
  });

  it("does not let message text add a resource, and does not read group history", async () => {
    const setup = bound({
      groups: ["oc_a0553eda9014c201e6969b478895c230"],
      docs: ["doxcnInScopeDocument0000001"],
      calendars: [],
    });
    const seen: string[] = [];
    const reader: EnterpriseImUserDocReader = ({ resourceId }) => {
      seen.push(resourceId);
      return {
        ok: true,
        doc: {
          resourceId,
          title: "进度",
          updatedAt: "",
          revisionId: "3",
          body: "本周三完成接口联调，剩余风险是权限审批。",
          links: [],
        },
      };
    };
    const read = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      messageText:
        "请再读 https://example.feishu.cn/docx/doxcnMessageOnlyDoc00000001 和 oc_b1664feb0125d312f7070c589906d341",
      measured,
      readDoc: reader,
    });
    expect(read.outcome).toBe("draft");
    if (read.outcome === "draft") {
      expect(read.draft.text).toContain("本周三完成接口联调，剩余风险是权限审批。");
    }
    expect(seen).toEqual(["doxcnInScopeDocument0000001"]);
    expect(setup.store.grants[setup.grantId]?.resourceScope?.docs).toEqual([
      "doxcnInScopeDocument0000001",
    ]);
    const widened = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnMessageOnlyDoc00000001",
      messageText: "请读 https://example.feishu.cn/docx/doxcnMessageOnlyDoc00000001",
      measured,
      readDoc: reader,
    });
    expect(widened).toMatchObject({ code: "RESOURCE_OUT_OF_SCOPE" });
    const group = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "group",
      resourceId: "oc_a0553eda9014c201e6969b478895c230",
      measured: { projectDocs: true, projectGroupRead: true },
      readDoc: reader,
    });
    expect(group).toMatchObject({ code: "GROUP_HISTORY_NOT_IN_SLICE" });
    expect(seen).toEqual(["doxcnInScopeDocument0000001"]);
  });

  it("cites an out-of-scope link without fetching it", async () => {
    const setup = bound({ groups: [], docs: ["doxcnInScopeDocument0000001"], calendars: [] });
    const seen: string[] = [];
    const reader: EnterpriseImUserDocReader = ({ resourceId }) => {
      seen.push(resourceId);
      return {
        ok: true,
        doc: {
          resourceId,
          title: "周报",
          updatedAt: "",
          revisionId: "8",
          body: "本周三完成接口联调。详见 https://example.feishu.cn/docx/doxcnOutOfScopeLink00000001",
          links: [],
        },
      };
    };
    const read = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "draft",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: reader,
    });
    expect(seen).toEqual(["doxcnInScopeDocument0000001"]);
    expect(read.outcome).toBe("draft");
    if (read.outcome !== "draft") {
      return;
    }
    expect(read.draft.text).toContain("本周三完成接口联调");
    expect(read.draft.text).toContain("doxcnOutOfScopeLink00000001");
    expect(read.draft.inventory.unreadable).toEqual(["doxcnOutOfScopeLink00000001"]);
    expect(read.draft.sources.map((source) => source.resourceId)).toEqual([
      "doxcnInScopeDocument0000001",
      "doxcnOutOfScopeLink00000001",
    ]);
    expect(JSON.stringify(read)).not.toContain("access-secret");
  });

  it("does not fall back to an app token when the user token is invalid", async () => {
    const setup = bound({ groups: [], docs: ["doxcnInScopeDocument0000001"], calendars: [] });
    const appTokenRead = vi.fn<EnterpriseImUserDocReader>(() => {
      throw new Error("app token must not run");
    });
    const read = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: () => ({ ok: false, kind: "invalid_user_token" }),
      appTokenRead,
    });
    expect(read).toMatchObject({ code: "USER_TOKEN_INVALID_NO_APP_FALLBACK" });
    expect(appTokenRead).not.toHaveBeenCalled();
    expect(setup.store.identities[setup.identityId]?.status).toBe("reauth_required");
  });

  it("denies a missing seat, a missing policy, a missing grant, and the wrong robot", async () => {
    const setup = bound({ groups: [], docs: ["doxcnInScopeDocument0000001"], calendars: [] });
    const reader = vi.fn<EnterpriseImUserDocReader>();
    const missingSeat = await readEnterpriseImEmployeeResource({
      decision: {
        ...decision(setup),
        authorization: resolveEnterpriseImSeatAndPolicy({
          tenantId: "001",
          ownerId: "emp-a",
          agentId: "project",
          action: "read",
          seatStore: { bindings: {} } as never,
          policies: [],
        }),
      },
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: reader,
    });
    expect(missingSeat).toMatchObject({ code: "SEAT_MISSING" });
    const missingPolicy = await readEnterpriseImEmployeeResource({
      decision: {
        ...decision(setup),
        authorization: resolveEnterpriseImSeatAndPolicy({
          tenantId: "001",
          ownerId: "emp-a",
          agentId: "project",
          action: "read",
          seatStore: decision(setup).authorization.ok
            ? ({
                bindings: {
                  b1: {
                    bindingId: "b1",
                    seatId: "seat-1",
                    tenantId: "001",
                    employeeId: "emp-a",
                    bindingStatus: "active",
                    effectiveAt: now,
                  },
                },
              } as never)
            : null,
          policies: [],
        }),
      },
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: reader,
    });
    expect(missingPolicy).toMatchObject({ code: "ENTERPRISE_POLICY_MISSING" });
    const wrongRobot = await readEnterpriseImEmployeeResource({
      decision: { ...decision(setup), agentId: "knowledge" },
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: reader,
    });
    expect(wrongRobot.outcome).toBe("deny");
    setup.store.grants[setup.grantId].status = "revoked";
    setup.store.grants[setup.grantId].revokedAt = now;
    const missingGrant = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: reader,
    });
    expect(missingGrant).toMatchObject({ code: "DELEGATION_MISSING" });
    expect(reader).not.toHaveBeenCalled();
    expect(Object.keys(setup.store.grants)).toHaveLength(1);
  });

  it("refuses an unmeasured doc read without calling a client", async () => {
    const setup = bound({ groups: [], docs: ["doxcnInScopeDocument0000001"], calendars: [] });
    const reader = vi.fn<EnterpriseImUserDocReader>(() => {
      throw new Error("feishu must not be called");
    });
    const read = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured: notMeasured,
      readDoc: reader,
    });
    expect(read).toMatchObject({ code: "ENTERPRISE_IM_NOT_MEASURED" });
    expect(reader).not.toHaveBeenCalled();
    const event = Object.values(setup.store.usageEvents).find((item) => item.action === "read");
    expect(event?.agentId).toBe("project");
    expect(event?.summary?.externalId).toBe("doxcnInScopeDocument0000001");
    expect(event?.summary?.excerpt).toContain("connection=t_001_default");
    expect(JSON.stringify(event)).not.toContain("access-secret");
  });

  it("keeps an unwired reader distinct from an unmeasured row", async () => {
    const setup = bound({ groups: [], docs: ["doxcnInScopeDocument0000001"], calendars: [] });
    const unwired = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
    });
    expect(unwired).toMatchObject({ code: "ENTERPRISE_IM_READER_NOT_WIRED" });
  });

  it("refuses a returned document id that does not match the request and does not emit the body", async () => {
    const setup = bound({ groups: [], docs: ["doxcnInScopeDocument0000001"], calendars: [] });
    const read = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: () => ({
        ok: true,
        doc: {
          resourceId: "doxcnOtherDocument000000001",
          title: "别的文档",
          updatedAt: "",
          body: "这是另一份文档的正文，不能出现在结果里。",
          links: [],
        },
      }),
    });
    expect(read).toMatchObject({ code: "RESOURCE_ID_MISMATCH" });
    expect(JSON.stringify(read)).not.toContain("另一份文档的正文");
  });

  it("does not treat a boolean measured flag as an observation", () => {
    expect(
      readEnterpriseImMeasuredChecklist({
        enterpriseImEmployeeProxy: { measured: { projectDocs: true } },
      }).projectDocs,
    ).toBe(false);
    expect(
      readEnterpriseImMeasuredChecklist({
        enterpriseImEmployeeProxy: {
          measured: {
            projectDocs: {
              status: "measured",
              api: FEISHU_USER_DOCX_RAW_CONTENT_API,
              tokenType: "user_access_token",
              scopes: ["docx:document:readonly"],
              observedAt: "2026-11-07T03:00:00.000Z",
            },
          },
        },
      }).projectDocs,
    ).toBe(true);
  });

  it("audits rate limit, missing document, and network failure without an app-token call", async () => {
    const setup = bound({ groups: [], docs: ["doxcnInScopeDocument0000001"], calendars: [] });
    const appTokenRead = vi.fn<EnterpriseImUserDocReader>();
    const rate = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: () => ({ ok: false, kind: "rate_limited" }),
      appTokenRead,
    });
    const missing = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: () => ({ ok: false, kind: "not_found" }),
      appTokenRead,
    });
    const network = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "doxcnInScopeDocument0000001",
      measured,
      readDoc: () => {
        throw new Error("socket hang up");
      },
      appTokenRead,
    });
    expect(rate).toMatchObject({ code: "READ_RATE_LIMITED" });
    expect(missing).toMatchObject({ code: "READ_RESOURCE_NOT_FOUND" });
    expect(network).toMatchObject({ code: "READ_NETWORK_ERROR" });
    const codes = Object.values(setup.store.usageEvents).map((event) => event.denialCode);
    expect(codes).toEqual(
      expect.arrayContaining([
        "READ_RATE_LIMITED",
        "READ_RESOURCE_NOT_FOUND",
        "READ_NETWORK_ERROR",
      ]),
    );
    expect(appTokenRead).not.toHaveBeenCalled();
    expect(setup.store.identities[setup.identityId]?.status).toBe("active");
  });
});
