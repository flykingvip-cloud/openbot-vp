import { describe, expect, it, vi } from "vitest";
import { resolveEnterpriseImSeatAndPolicy } from "./enterprise-im-employee-authorization.js";
import {
  bindFeishuEmployeeConnection,
  type FeishuEmployeeChannelGate,
} from "./enterprise-im-employee-connection.js";
import { confirmEnterpriseImRobotGrant } from "./enterprise-im-employee-decision.js";
import {
  readEnterpriseImEmployeeResource,
  type EnterpriseImUserDocReader,
} from "./enterprise-im-employee-read.js";
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
    const outside = bound({ groups: ["oc_in"], docs: ["docx_in"], calendars: [] });
    const reader = vi.fn<EnterpriseImUserDocReader>();
    const denied = await readEnterpriseImEmployeeResource({
      decision: decision(outside),
      action: "read",
      resourceKind: "doc",
      resourceId: "docx_out",
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
      resourceId: "docx_in",
      measured,
      readDoc: reader,
    });
    expect(emptyRead).toMatchObject({ outcome: "deny", code: "RESOURCE_SCOPE_EMPTY" });
    expect(empty.store.grants[empty.grantId]?.resourceScope?.docs).toEqual([]);
    expect(reader).not.toHaveBeenCalled();
  });

  it("does not let message text add a resource, and does not read group history", async () => {
    const setup = bound({ groups: ["oc_in"], docs: ["docx_in"], calendars: [] });
    const seen: string[] = [];
    const reader: EnterpriseImUserDocReader = ({ resourceId }) => {
      seen.push(resourceId);
      return {
        ok: true,
        doc: {
          resourceId,
          title: "进度",
          updatedAt: "2026-11-07T01:00:00.000Z",
          body: "正文",
          links: [],
        },
      };
    };
    const read = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "docx_in",
      messageText: "请再读 docx_extra 和 oc_extra",
      measured,
      readDoc: reader,
    });
    expect(read.outcome).toBe("draft");
    expect(seen).toEqual(["docx_in"]);
    expect(setup.store.grants[setup.grantId]?.resourceScope?.docs).toEqual(["docx_in"]);
    const widened = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "docx_extra",
      messageText: "请读 docx_extra",
      measured,
      readDoc: reader,
    });
    expect(widened).toMatchObject({ code: "RESOURCE_OUT_OF_SCOPE" });
    const group = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "group",
      resourceId: "oc_in",
      measured: { projectDocs: true, projectGroupRead: true },
      readDoc: reader,
    });
    expect(group).toMatchObject({ code: "GROUP_HISTORY_NOT_IN_SLICE" });
    expect(seen).toEqual(["docx_in"]);
  });

  it("cites an out-of-scope link without fetching it", async () => {
    const setup = bound({ groups: [], docs: ["docx_in"], calendars: [] });
    const seen: string[] = [];
    const reader: EnterpriseImUserDocReader = ({ resourceId }) => {
      seen.push(resourceId);
      return {
        ok: true,
        doc: {
          resourceId,
          title: "周报",
          updatedAt: "2026-11-07T02:00:00.000Z",
          body: "见 docx_outside",
          links: ["docx_outside"],
        },
      };
    };
    const read = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "draft",
      resourceKind: "doc",
      resourceId: "docx_in",
      measured,
      readDoc: reader,
    });
    expect(seen).toEqual(["docx_in"]);
    expect(read.outcome).toBe("draft");
    if (read.outcome !== "draft") {
      return;
    }
    expect(read.draft.sources).toEqual([
      { resourceId: "docx_in", updatedAt: "2026-11-07T02:00:00.000Z", status: "read" },
      { resourceId: "docx_outside", updatedAt: "", status: "unreadable" },
    ]);
    expect(read.draft.text).toContain("无法读取 docx_outside");
    expect(read.draft.text).toContain("2026-11-07T02:00:00.000Z");
    expect(JSON.stringify(read)).not.toContain("access-secret");
  });

  it("does not fall back to an app token when the user token is invalid", async () => {
    const setup = bound({ groups: [], docs: ["docx_in"], calendars: [] });
    const appTokenRead = vi.fn<EnterpriseImUserDocReader>(() => {
      throw new Error("app token must not run");
    });
    const read = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "docx_in",
      measured,
      readDoc: () => ({ ok: false, invalidUserToken: true }),
      appTokenRead,
    });
    expect(read).toMatchObject({ code: "USER_TOKEN_INVALID_NO_APP_FALLBACK" });
    expect(appTokenRead).not.toHaveBeenCalled();
  });

  it("denies a missing seat, a missing policy, a missing grant, and the wrong robot", async () => {
    const setup = bound({ groups: [], docs: ["docx_in"], calendars: [] });
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
      resourceId: "docx_in",
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
      resourceId: "docx_in",
      measured,
      readDoc: reader,
    });
    expect(missingPolicy).toMatchObject({ code: "ENTERPRISE_POLICY_MISSING" });
    const wrongRobot = await readEnterpriseImEmployeeResource({
      decision: { ...decision(setup), agentId: "knowledge" },
      action: "read",
      resourceKind: "doc",
      resourceId: "docx_in",
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
      resourceId: "docx_in",
      measured,
      readDoc: reader,
    });
    expect(missingGrant).toMatchObject({ code: "DELEGATION_MISSING" });
    expect(reader).not.toHaveBeenCalled();
    expect(Object.keys(setup.store.grants)).toHaveLength(1);
  });

  it("refuses an unmeasured doc read without calling a client", async () => {
    const setup = bound({ groups: [], docs: ["docx_in"], calendars: [] });
    const reader = vi.fn<EnterpriseImUserDocReader>(() => {
      throw new Error("feishu must not be called");
    });
    const read = await readEnterpriseImEmployeeResource({
      decision: decision(setup),
      action: "read",
      resourceKind: "doc",
      resourceId: "docx_in",
      measured: notMeasured,
      readDoc: reader,
    });
    expect(read).toMatchObject({ code: "ENTERPRISE_IM_NOT_MEASURED" });
    expect(reader).not.toHaveBeenCalled();
    const event = Object.values(setup.store.usageEvents).find((item) => item.action === "read");
    expect(event?.agentId).toBe("project");
    expect(event?.summary?.externalId).toBe("docx_in");
    expect(event?.summary?.excerpt).toContain("connection=t_001_default");
    expect(JSON.stringify(event)).not.toContain("access-secret");
  });
});
