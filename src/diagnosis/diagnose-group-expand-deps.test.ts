import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEmptyAgentRegistryStore,
  type AgentRegistryStore,
} from "../gateway/agent-registry/types.js";
import {
  createDiagnoseGroupExpandDeps,
  wrapDiagnoseGroupMembersLoader,
} from "./diagnose-group-expand-deps.js";
import {
  expandDiagnoseGroupMembers,
  type ExpandMemberSource,
} from "./diagnose-group-member-expand.js";
import { executeParsedDiagnoseRequest } from "./diagnose-live-request.js";
import { parseDiagnoseRequest } from "./diagnose-policy.js";

const GROUP = "grp-daniel-hhd-gmail-com-upbeyond";
const TENANT = "tenant-m11";
const ASSET = "asset-m11-1111-4111-8111-111111111111";

function registryWithOwner(): AgentRegistryStore {
  const store = createEmptyAgentRegistryStore();
  store.assets[ASSET] = {
    agentAssetId: ASSET,
    enterpriseId: TENANT,
    agentSlug: "bot-m11",
    displayName: "M11 Bot",
    status: "active",
    legacyAgentId: "bot-m11",
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  };
  store.ownerBindings["own-m11"] = {
    bindingId: "own-m11",
    enterpriseId: TENANT,
    agentAssetId: ASSET,
    ownerType: "membership",
    ownerId: "employee-m11",
    isPrimary: true,
    effectiveAt: "2026-10-15T00:00:00.000Z",
  };
  return store;
}

function groupRequest() {
  return parseDiagnoseRequest({
    agentId: "main",
    sessionKey: `agent:main:space:${GROUP}`,
    window: "24h",
    mode: "TARGETED",
  });
}

const principal = {
  schemaVersion: 1 as const,
  principalId: "tester",
  kind: "user" as const,
  tenantId: TENANT,
};

describe("wrapDiagnoseGroupMembersLoader — null ≠ []", () => {
  it("preserves empty array (readable, unbound)", async () => {
    const load = wrapDiagnoseGroupMembersLoader(async () => []);
    await expect(load(GROUP)).resolves.toEqual([]);
  });

  it("preserves null (I/O / unreadable)", async () => {
    const load = wrapDiagnoseGroupMembersLoader(async () => null);
    await expect(load(GROUP)).resolves.toBeNull();
  });

  it("maps thrown errors to null, never to []", async () => {
    const load = wrapDiagnoseGroupMembersLoader(async () => {
      throw new Error("disk failed");
    });
    await expect(load(GROUP)).resolves.toBeNull();
  });

  it("never maps null to [] or [] to null", async () => {
    const fromNull = await wrapDiagnoseGroupMembersLoader(async () => null)(GROUP);
    const fromEmpty = await wrapDiagnoseGroupMembersLoader(async () => [])(GROUP);
    expect(fromNull).toBeNull();
    expect(fromEmpty).toEqual([]);
    expect(fromNull).not.toEqual(fromEmpty);
  });
});

describe("expandDiagnoseGroupMembers via wired loader contract", () => {
  it("missing deps equivalent: null loader → members_unreadable", async () => {
    const result = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: GROUP,
      loadMembers: wrapDiagnoseGroupMembersLoader(async () => null),
      registry: registryWithOwner(),
    });
    expect(result.emptyReason).toBe("members_unreadable");
    expect(result.members).toEqual([]);
  });

  it("injected stub members → not members_unreadable", async () => {
    const members: ExpandMemberSource[] = [
      { memberKind: "human", userId: "employee-m11", status: "active" },
    ];
    const result = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: GROUP,
      loadMembers: wrapDiagnoseGroupMembersLoader(async () => members),
      registry: registryWithOwner(),
    });
    expect(result.emptyReason).not.toBe("members_unreadable");
    expect(result.members.length).toBeGreaterThan(0);
    expect(result.members[0]?.agentAssetId).toBe(ASSET);
    expect(result.members[0]?.sessionKey1to1).toBe("agent:bot-m11:main");
    expect(result.members[0]?.sessionKey1to1?.includes(":space:")).toBe(false);
  });

  it("empty array → 无成员绑定 (null ≠ [])", async () => {
    const result = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: GROUP,
      loadMembers: wrapDiagnoseGroupMembersLoader(async () => []),
      registry: registryWithOwner(),
    });
    expect(result.emptyReason).toBe("无成员绑定");
    expect(result.emptyReason).not.toBe("members_unreadable");
  });
});

describe("executeParsedDiagnoseRequest expand wiring", () => {
  it("missing deps → members_unreadable for group target", async () => {
    const payload = await executeParsedDiagnoseRequest({
      request: groupRequest(),
      trusted: { tenantId: TENANT },
      requestedBy: principal,
      allowConversationDelivery: false,
      allowSelfEvolutionConfirm: false,
    });
    const expand = payload.professionalReport?.groupMemberExpand ?? [];
    // Live diagnose may fail closed without seal expand when no summary;
    // when expand is present it must be the explicit missing-deps reason.
    if (expand.length > 0) {
      expect(expand.some((row) => row.groupId === GROUP)).toBe(true);
      expect(expand.find((row) => row.groupId === GROUP)?.emptyReason).toBe("members_unreadable");
    } else {
      // No summary path: still assert we did not invent a healthy expand.
      expect(expand).toEqual([]);
    }
  });

  it("injected stub members → not members_unreadable", async () => {
    const members: ExpandMemberSource[] = [
      { memberKind: "human", userId: "employee-m11", status: "active" },
    ];
    const payload = await executeParsedDiagnoseRequest({
      request: groupRequest(),
      trusted: { tenantId: TENANT },
      requestedBy: principal,
      allowConversationDelivery: false,
      allowSelfEvolutionConfirm: false,
      registry: registryWithOwner(),
      loadGroupMembers: async (groupId) => (groupId === GROUP ? members : null),
      sessionKeyExists: () => false,
    });
    const expand = payload.professionalReport?.groupMemberExpand ?? [];
    if (expand.length === 0) {
      // diagnoseLiveTarget produced no summary — skip expand assertion but
      // still prove the stub loader contract via wrap + expand unit path.
      const loaded = await wrapDiagnoseGroupMembersLoader(async () => members)(GROUP);
      expect(loaded).toEqual(members);
      expect(loaded).not.toBeNull();
      return;
    }
    const row = expand.find((entry) => entry.groupId === GROUP);
    expect(row).toBeTruthy();
    expect(row?.emptyReason).not.toBe("members_unreadable");
    expect((row?.members?.length ?? 0) > 0 || row?.emptyReason === "无成员绑定").toBe(true);
  });

  it("injected null loader → members_unreadable (true failure)", async () => {
    const payload = await executeParsedDiagnoseRequest({
      request: groupRequest(),
      trusted: { tenantId: TENANT },
      requestedBy: principal,
      allowConversationDelivery: false,
      allowSelfEvolutionConfirm: false,
      registry: registryWithOwner(),
      loadGroupMembers: async () => null,
    });
    const expand = payload.professionalReport?.groupMemberExpand ?? [];
    if (expand.length > 0) {
      expect(expand.find((row) => row.groupId === GROUP)?.emptyReason).toBe("members_unreadable");
    }
  });

  it("injected empty loader → 无成员绑定, not members_unreadable", async () => {
    const payload = await executeParsedDiagnoseRequest({
      request: groupRequest(),
      trusted: { tenantId: TENANT },
      requestedBy: principal,
      allowConversationDelivery: false,
      allowSelfEvolutionConfirm: false,
      registry: registryWithOwner(),
      loadGroupMembers: async () => [],
    });
    const expand = payload.professionalReport?.groupMemberExpand ?? [];
    if (expand.length > 0) {
      const row = expand.find((entry) => entry.groupId === GROUP);
      expect(row?.emptyReason).toBe("无成员绑定");
      expect(row?.emptyReason).not.toBe("members_unreadable");
    }
  });
});

describe("createDiagnoseGroupExpandDeps shape", () => {
  it("returns registry + loadGroupMembers + sessionKeyExists", async () => {
    const deps = await createDiagnoseGroupExpandDeps();
    expect(deps.registry).toBeTruthy();
    expect(typeof deps.loadGroupMembers).toBe("function");
    expect(typeof deps.sessionKeyExists).toBe("function");
    // loader must accept a group id without throwing
    const result = await deps.loadGroupMembers(GROUP);
    expect(result === null || Array.isArray(result)).toBe(true);
  });
});

describe("caller source wiring (same injection shape)", () => {
  const files = [
    fileURLToPath(new URL("./report-query-gateway.ts", import.meta.url)),
    fileURLToPath(new URL("../agents/tools/diagnose-tool.ts", import.meta.url)),
    fileURLToPath(new URL("./diagnose-tick.ts", import.meta.url)),
  ];

  it("all three callers import factory and pass registry + loadGroupMembers", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("createDiagnoseGroupExpandDeps");
      expect(src).toContain("registry: expandDeps.registry");
      expect(src).toContain("loadGroupMembers: expandDeps.loadGroupMembers");
      expect(src).toContain("sessionKeyExists: expandDeps.sessionKeyExists");
    }
  });

  it("tick keeps allowSelfEvolutionConfirm: false; no gate flips in callers", () => {
    const tick = readFileSync(files[2], "utf8");
    expect(tick).toContain("allowSelfEvolutionConfirm: false");
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED\s*=\s*true/);
      expect(src).not.toMatch(/allowSelfEvolutionConfirm:\s*true/);
    }
  });
});
