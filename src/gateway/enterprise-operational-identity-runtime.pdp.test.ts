// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  computeEffectiveAccess,
  computeEffectiveAccessEntries,
  computeEffectiveActions,
  formatOperationalIdentityRuntimePrompt,
} from "./enterprise-operational-identity-runtime.js";
import {
  registerEnterpriseIdentity,
  upsertEmployeeEnterpriseIdentityEnrollment,
  upsertIdentityUsagePolicy,
} from "./enterprise-operational-identity-store.js";
import { normalizeEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-backend.js";
import {
  registerConnectorCredentialBinding,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

const NOW = "2026-09-25T00:00:00.000Z";

function createStore(): EnterpriseSeatAssetsStore {
  return normalizeEnterpriseSeatAssetsStore(null, 4);
}

function seedWechatIdentity(
  store: EnterpriseSeatAssetsStore,
  params?: { capabilities?: string[]; policyActions?: string[] },
): string {
  store.seats["seat-1"] = {
    seatId: "seat-1",
    tenantId: "acme",
    title: "Ops",
    status: "occupied",
    defaultSpaceIds: [],
    defaultAgentAssetIds: ["agent-1"],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const credential = registerConnectorCredentialBinding({
    store,
    tenantId: "acme",
    connectorId: "wechat-official",
    ownerType: "seat",
    ownerId: "seat-1",
    nowIso: NOW,
  });
  const identity = registerEnterpriseIdentity({
    store,
    tenantId: "acme",
    displayName: "OA Bot",
    credentialBindingId: credential.credentialBindingId,
    nowIso: NOW,
  });
  if (!identity.ok) {
    throw new Error("failed to register identity");
  }
  if (params?.capabilities) {
    const row = store.enterpriseIdentities[identity.identity.identityId];
    if (row) {
      row.capabilities = params.capabilities;
    }
  }
  upsertIdentityUsagePolicy({
    store,
    tenantId: "acme",
    identityId: identity.identity.identityId,
    seatIds: ["seat-1"],
    allowedAgentIds: [],
    allowedActions: params?.policyActions ?? [
      "publish_draft",
      "upload_thumb",
      "publish_article",
      "broadcast_article",
    ],
    nowIso: NOW,
  });
  return identity.identity.identityId;
}

describe("computeEffectiveActions (unique PDP intersection)", () => {
  it("intersects policy ∩ enrollment ∩ capabilities", () => {
    expect(
      computeEffectiveActions({
        provider: "wechat-official",
        policyActions: ["publish_draft", "publish_article", "broadcast_article"],
        capabilities: ["publish_draft", "publish_article"],
        enrollmentActions: ["publish_draft", "upload_thumb"],
        agentHasEnrollments: true,
      }),
    ).toEqual(["publish_draft"]);
  });

  it("strips high-risk actions when identity has zero enrollment (seat-inherit compat for low)", () => {
    expect(
      computeEffectiveActions({
        provider: "wechat-official",
        policyActions: ["publish_draft", "publish_article", "broadcast_article"],
        capabilities: null,
        enrollmentActions: null,
        agentHasEnrollments: false,
      }),
    ).toEqual(["publish_draft"]);
  });

  it("returns empty when agent is curated but this identity is not enrolled", () => {
    expect(
      computeEffectiveActions({
        provider: "wechat-official",
        policyActions: ["publish_draft", "publish_article"],
        enrollmentActions: null,
        agentHasEnrollments: true,
      }),
    ).toEqual([]);
  });

  it("keeps medium risk under zero enrollment (P0 compat)", () => {
    expect(
      computeEffectiveActions({
        provider: "github-org",
        policyActions: ["create_issue", "create_comment"],
        enrollmentActions: null,
        agentHasEnrollments: false,
      }),
    ).toEqual(["create_comment", "create_issue"]);
  });
});

describe("computeEffectiveAccess / entries (PDP)", () => {
  it("denies newly expanded policy actions that are outside the enrollment snapshot", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store, {
      policyActions: ["publish_draft", "upload_thumb"],
    });
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_draft", "upload_thumb"],
      nowIso: NOW,
    });
    // Policy expands after enroll — execute must still deny the new action.
    upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId,
      seatIds: ["seat-1"],
      allowedAgentIds: [],
      allowedActions: ["publish_draft", "upload_thumb", "publish_article"],
      nowIso: NOW,
    });

    const denied = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_article",
      nowIso: NOW,
    });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.code).toBe("OWNER_GRANT_ACTION_DENIED");
    }

    const allowed = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_draft",
      nowIso: NOW,
    });
    expect(allowed.allowed).toBe(true);
  });

  it("denies high-risk with zero enrollment (employee path)", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_article",
      nowIso: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("OWNER_GRANT_REQUIRED");
      expect(decision.meta?.risk).toBe("high");
    }
  });

  it("denies high-risk with zero enrollment for collaboration-owner employeeId (same PDP)", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    // collaboration-owner scope uses the owner's employeeId but the same PDP.
    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "owner-emp",
      identityId,
      action: "broadcast_article",
      nowIso: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("OWNER_GRANT_REQUIRED");
    }
  });

  it("allows low-risk with zero enrollment (seat-inherit compat)", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_draft",
      nowIso: NOW,
    });
    expect(decision.allowed).toBe(true);
  });

  it("allows high-risk once the identity is enrolled with that action", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "acme",
      employeeId: "emp-1",
      agentId: "agent-1",
      identityId,
      allowedActions: ["publish_article", "publish_draft"],
      nowIso: NOW,
    });
    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_article",
      nowIso: NOW,
    });
    expect(decision.allowed).toBe(true);
  });

  it("keeps list / prompt / enforce action-set parity", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    const entries = computeEffectiveAccessEntries({
      store,
      scope: {
        tenantId: "acme",
        seatId: "seat-1",
        agentId: "agent-1",
        employeeId: "emp-1",
      },
      nowIso: NOW,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.identityId).toBe(identityId);
    // high stripped; low kept
    expect(entries[0]?.allowedActions).toEqual(["publish_draft", "upload_thumb"]);

    const prompt = formatOperationalIdentityRuntimePrompt(entries);
    expect(prompt).toContain("publish_draft");
    expect(prompt).toContain("upload_thumb");
    expect(prompt).not.toContain("publish_article");
    expect(prompt).not.toContain("broadcast_article");

    for (const action of entries[0].allowedActions) {
      const decision = computeEffectiveAccess({
        store,
        tenantId: "acme",
        seatId: "seat-1",
        agentId: "agent-1",
        employeeId: "emp-1",
        identityId,
        action,
        nowIso: NOW,
      });
      expect(decision.allowed).toBe(true);
    }
    for (const action of ["publish_article", "broadcast_article"]) {
      const decision = computeEffectiveAccess({
        store,
        tenantId: "acme",
        seatId: "seat-1",
        agentId: "agent-1",
        employeeId: "emp-1",
        identityId,
        action,
        nowIso: NOW,
      });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe("OWNER_GRANT_REQUIRED");
      }
    }
  });

  it("denies tencent-meeting schedule_meeting with zero enrollment (OWNER_GRANT_REQUIRED)", () => {
    const store = createStore();
    store.seats["seat-1"] = {
      seatId: "seat-1",
      tenantId: "acme",
      title: "Ops",
      status: "occupied",
      defaultSpaceIds: [],
      defaultAgentAssetIds: ["agent-1"],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const credential = registerConnectorCredentialBinding({
      store,
      tenantId: "acme",
      connectorId: "tencent-meeting",
      ownerType: "seat",
      ownerId: "seat-1",
      nowIso: NOW,
    });
    const identity = registerEnterpriseIdentity({
      store,
      tenantId: "acme",
      displayName: "TM",
      credentialBindingId: credential.credentialBindingId,
      nowIso: NOW,
    });
    if (!identity.ok) {
      throw new Error("failed to register identity");
    }
    upsertIdentityUsagePolicy({
      store,
      tenantId: "acme",
      identityId: identity.identity.identityId,
      seatIds: ["seat-1"],
      allowedAgentIds: [],
      allowedActions: ["schedule_meeting", "cancel_meeting", "list_meetings"],
      nowIso: NOW,
    });
    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId: identity.identity.identityId,
      action: "schedule_meeting",
      nowIso: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("OWNER_GRANT_REQUIRED");
      expect(decision.meta?.risk).toBe("high");
    }
    const low = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId: identity.identity.identityId,
      action: "list_meetings",
      nowIso: NOW,
    });
    expect(low.allowed).toBe(true);
  });

  it("PEP denies high-risk without relying on prompt contents", () => {
    const store = createStore();
    const identityId = seedWechatIdentity(store);
    // Deliberately feed a deceptive "full" prompt-like entry set; PDP still denies.
    const deceptivePrompt = formatOperationalIdentityRuntimePrompt([
      {
        identityId,
        displayName: "OA Bot",
        provider: "wechat-official",
        providerLabel: "微信公众号",
        status: "active",
        allowedActions: ["publish_article", "broadcast_article"],
        policyIds: ["policy-x"],
      },
    ]);
    expect(deceptivePrompt).toContain("publish_article");

    const decision = computeEffectiveAccess({
      store,
      tenantId: "acme",
      seatId: "seat-1",
      agentId: "agent-1",
      employeeId: "emp-1",
      identityId,
      action: "publish_article",
      nowIso: NOW,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe("OWNER_GRANT_REQUIRED");
    }
  });
});

describe("formatOperationalIdentityRuntimePrompt projection boundary", () => {
  it("projects EffectiveAccess menu only — no enrollment/high/denial-rule sentences", () => {
    const prompt = formatOperationalIdentityRuntimePrompt([
      {
        identityId: "id-oa",
        displayName: "AI数字替身",
        provider: "wechat-official",
        providerLabel: "微信公众号",
        status: "active",
        allowedActions: ["publish_draft", "upload_thumb"],
        policyIds: ["policy-1"],
      },
    ]);
    expect(prompt).toBeDefined();
    const text = prompt ?? "";
    expect(text).toContain("AI数字替身");
    expect(text).toContain("publish_draft");
    expect(text).toContain("Server re-validates every operational_identity execute call.");
    // Ops tip OK:
    expect(text).toContain("thumbUrl");
    // Forbidden rule prose:
    expect(text.toLowerCase()).not.toMatch(/enrollment/);
    expect(text.toLowerCase()).not.toMatch(/\bhigh[- ]risk\b|\brisk\s*=?\s*high\b|高风险/);
    expect(text).not.toMatch(/OWNER_GRANT_/);
    expect(text).not.toMatch(/IDENTITY_ACTION_DENIED/);
    expect(text.toLowerCase()).not.toMatch(/must be enrolled|owner grant required|先.*绑定|拒绝码/);
  });
});
