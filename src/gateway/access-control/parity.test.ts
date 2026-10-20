// Feature: shared-agent-identity-access-control-plane

import { describe, expect, it } from "vitest";
import { createAgentAsset } from "../agent-registry/registry.js";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import { checkAccessParity, resolveParityExpectations, type ParityExpectation } from "./parity.js";
import type { AccessSubject, EnterpriseAccessPolicyV2 } from "./policy-v2-types.js";

const NOW = "2026-07-31T00:00:00.000Z";

const MEMBER: AccessSubject = {
  subjectType: "membership",
  subjectId: "membership-1",
  status: "active",
};

function registry() {
  const store = createEmptyAgentRegistryStore();
  createAgentAsset({
    store,
    enterpriseId: "ent-a",
    agentSlug: "sales-bot",
    displayName: "Sales Bot",
    nowIso: NOW,
    legacyAgentId: "legacy-1",
  });
  return store;
}

function memoryPolicy(overrides: Partial<EnterpriseAccessPolicyV2> = {}): EnterpriseAccessPolicyV2 {
  return {
    policyId: "v2-1",
    version: 2,
    enterpriseId: "ent-a",
    subjectType: "membership",
    subjectId: "membership-1",
    resourceType: "memory",
    resourceId: "mem-1",
    permission: "memory.read",
    effect: "allow",
    createdAt: NOW,
    ...overrides,
  };
}

function expectation(overrides: Partial<ParityExpectation> = {}): ParityExpectation {
  return {
    sourcePolicyId: "v1-1",
    subject: MEMBER,
    resource: { enterpriseId: "ent-a", resourceType: "memory", resourceId: "mem-1" },
    permission: "memory.read",
    expected: "allow",
    ...overrides,
  };
}

describe("access parity check", () => {
  it("agrees when V2 grants what v1 grants", () => {
    const report = checkAccessParity({
      expectations: [expectation()],
      policies: [memoryPolicy()],
      registry: registry(),
    });
    expect(report).toMatchObject({ checked: 1, agreed: 1, divergences: [] });
  });

  it("reports a grant v1 has but V2 would deny, with the reason", () => {
    const report = checkAccessParity({
      expectations: [expectation()],
      policies: [],
      registry: registry(),
    });
    expect(report.agreed).toBe(0);
    expect(report.divergences).toEqual([
      {
        sourcePolicyId: "v1-1",
        subjectType: "membership",
        subjectId: "membership-1",
        resourceType: "memory",
        resourceId: "mem-1",
        permission: "memory.read",
        expected: "allow",
        actual: "deny",
        reason: "no-matching-policy",
      },
    ]);
    expect(report.reasonCounts).toEqual({ "no-matching-policy": 1 });
  });

  it("reports a grant V2 would add that v1 does not have", () => {
    const report = checkAccessParity({
      expectations: [expectation({ expected: "deny" })],
      policies: [memoryPolicy()],
      registry: registry(),
    });
    expect(report.divergences).toHaveLength(1);
    expect(report.divergences[0]).toMatchObject({ expected: "deny", actual: "allow" });
    // An unexpected allow has no deny reason to report.
    expect(report.reasonCounts).toEqual({});
  });

  it("groups divergence reasons for triage", () => {
    const report = checkAccessParity({
      expectations: [
        expectation({ sourcePolicyId: "a" }),
        expectation({ sourcePolicyId: "b", subject: { ...MEMBER, status: "suspended" } }),
      ],
      policies: [memoryPolicy()],
      registry: registry(),
    });
    expect(report.checked).toBe(2);
    expect(report.agreed).toBe(1);
    expect(report.reasonCounts).toEqual({ "subject-inactive": 1 });
  });

  it("passes the real evaluator an agent asset resource unchanged", () => {
    const store = registry();
    const [asset] = Object.values(store.assets);
    const report = checkAccessParity({
      expectations: [
        expectation({
          resource: {
            enterpriseId: "ent-a",
            resourceType: "agent_asset",
            resourceId: asset.agentAssetId,
          },
          permission: "agent.execute",
        }),
      ],
      policies: [
        memoryPolicy({
          resourceType: "agent_asset",
          resourceId: asset.agentAssetId,
          permission: "agent.execute",
        }),
      ],
      registry: store,
    });
    expect(report).toMatchObject({ checked: 1, agreed: 1 });
  });

  it("treats a revoked grant as denied when nothing else grants it", () => {
    const rows = resolveParityExpectations([
      {
        sourcePolicyId: "v1-revoked",
        subject: MEMBER,
        resource: { enterpriseId: "ent-a", resourceType: "memory", resourceId: "mem-1" },
        permission: "memory.read",
        revoked: true,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourcePolicyId: "v1-revoked", expected: "deny" });
  });

  it("keeps a grant allowed when an active row shadows a revoked one", () => {
    const resource = {
      enterpriseId: "ent-a",
      resourceType: "memory" as const,
      resourceId: "mem-1",
    };
    // A historic revoke followed by a live re-grant: v1 allows this today.
    const rows = resolveParityExpectations([
      {
        sourcePolicyId: "v1-revoked",
        subject: MEMBER,
        resource,
        permission: "memory.read",
        revoked: true,
      },
      {
        sourcePolicyId: "v1-active",
        subject: MEMBER,
        resource,
        permission: "memory.read",
        revoked: false,
      },
    ]);
    expect(rows).toEqual([
      {
        sourcePolicyId: "v1-active",
        subject: MEMBER,
        resource,
        permission: "memory.read",
        expected: "allow",
      },
    ]);
  });

  it("does not let a revoked row override an active row seen earlier", () => {
    const resource = {
      enterpriseId: "ent-a",
      resourceType: "memory" as const,
      resourceId: "mem-1",
    };
    const rows = resolveParityExpectations([
      {
        sourcePolicyId: "v1-active",
        subject: MEMBER,
        resource,
        permission: "memory.read",
        revoked: false,
      },
      {
        sourcePolicyId: "v1-revoked",
        subject: MEMBER,
        resource,
        permission: "memory.read",
        revoked: true,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sourcePolicyId: "v1-active", expected: "allow" });
  });

  it("keeps distinct grants separate rather than collapsing them", () => {
    const rows = resolveParityExpectations([
      {
        sourcePolicyId: "a",
        subject: MEMBER,
        resource: { enterpriseId: "ent-a", resourceType: "memory", resourceId: "mem-1" },
        permission: "memory.read",
        revoked: false,
      },
      {
        sourcePolicyId: "b",
        subject: MEMBER,
        resource: { enterpriseId: "ent-a", resourceType: "memory", resourceId: "mem-1" },
        permission: "memory.write",
        revoked: true,
      },
      {
        sourcePolicyId: "c",
        subject: MEMBER,
        resource: { enterpriseId: "ent-a", resourceType: "memory", resourceId: "mem-2" },
        permission: "memory.read",
        revoked: false,
      },
    ]);
    expect(rows.map((row) => `${row.sourcePolicyId}:${row.expected}`)).toEqual([
      "a:allow",
      "b:deny",
      "c:allow",
    ]);
  });

  it("uses an injected evaluator when provided", () => {
    const calls: string[] = [];
    const report = checkAccessParity({
      expectations: [expectation()],
      policies: [],
      registry: registry(),
      evaluate: ({ permission }) => {
        calls.push(permission);
        return { allowed: true, matchedPolicyId: "stub" };
      },
    });
    expect(calls).toEqual(["memory.read"]);
    expect(report.agreed).toBe(1);
  });
});
