// @vitest-environment node
// Feature: shared-agent-identity-access-control-plane

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countActiveTenantPolicies,
  createEmptyAccessPolicyStore,
  listTenantPolicies,
  loadAccessPolicyStore,
  revokeAccessPolicy,
  saveAccessPolicyStore,
  upsertAccessPolicies,
} from "./policy-store.js";
import type { EnterpriseAccessPolicyV2 } from "./policy-v2-types.js";

const NOW = "2026-07-31T00:00:00.000Z";

let dir = "";
let storePath = "";

function policy(overrides: Partial<EnterpriseAccessPolicyV2>): EnterpriseAccessPolicyV2 {
  return {
    policyId: "p1",
    version: 2,
    enterpriseId: "ent-a",
    subjectType: "membership",
    subjectId: "membership-1",
    resourceType: "agent_asset",
    resourceId: "asset-1",
    permission: "agent.read",
    effect: "allow",
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-access-policies-"));
  storePath = path.join(dir, "openbot-access-policies.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("access policy store", () => {
  it("treats a missing or malformed file as an empty (default deny) set", async () => {
    expect(await loadAccessPolicyStore(storePath)).toEqual(createEmptyAccessPolicyStore());
    await fs.writeFile(storePath, "{ not json");
    expect(await loadAccessPolicyStore(storePath)).toEqual(createEmptyAccessPolicyStore());
  });

  it("round-trips policies and leaves no temp file", async () => {
    const store = createEmptyAccessPolicyStore();
    upsertAccessPolicies(store, [policy({})]);
    await saveAccessPolicyStore(store, storePath);

    expect((await loadAccessPolicyStore(storePath)).policies.p1).toMatchObject({
      enterpriseId: "ent-a",
      permission: "agent.read",
    });
    expect(await fs.readdir(dir)).toEqual(["openbot-access-policies.json"]);
  });

  it("makes a re-upsert of the same id a no-op instead of a duplicate grant", () => {
    const store = createEmptyAccessPolicyStore();
    expect(upsertAccessPolicies(store, [policy({})])).toEqual({ inserted: 1, updated: 0 });
    expect(upsertAccessPolicies(store, [policy({})])).toEqual({ inserted: 0, updated: 1 });
    expect(Object.keys(store.policies)).toEqual(["p1"]);
  });

  it("scopes listing to one enterprise and excludes revoked rows", () => {
    const store = createEmptyAccessPolicyStore();
    upsertAccessPolicies(store, [
      policy({ policyId: "a" }),
      policy({ policyId: "b", enterpriseId: "ent-b" }),
      policy({ policyId: "c", revokedAt: NOW }),
    ]);
    expect(listTenantPolicies(store, "ent-a").map((entry) => entry.policyId)).toEqual(["a"]);
    expect(countActiveTenantPolicies(store, "ent-b")).toBe(1);
  });

  it("soft-revokes once so audit history survives", () => {
    const store = createEmptyAccessPolicyStore();
    upsertAccessPolicies(store, [policy({})]);
    expect(revokeAccessPolicy(store, "p1", NOW)?.revokedAt).toBe(NOW);
    expect(revokeAccessPolicy(store, "p1", NOW)).toBeUndefined();
    expect(store.policies.p1).toBeDefined();
    expect(countActiveTenantPolicies(store, "ent-a")).toBe(0);
  });
});
