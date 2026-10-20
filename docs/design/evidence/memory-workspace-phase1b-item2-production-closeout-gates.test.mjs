import assert from "node:assert/strict";
import test from "node:test";
import { measureProductionCatalogSotGates } from "./memory-workspace-phase1b-item2-production-closeout-gates.mjs";

function row(resourceId, tenantId, owner, extras = {}) {
  return {
    envelope: {
      resourceId,
      resourceType: "workspace",
      tenantId,
      owner,
      lifecycleState: "active",
      governanceVersion: 2,
      ...extras.envelope,
    },
    bindings: extras.bindings ?? [
      {
        bindingId: `bind:${resourceId}`,
        resourceId,
        role: "canonical",
        locator: `fs://${resourceId}`,
        state: "active",
      },
    ],
  };
}

void test("duplicate canonical locator fails uniqueness", () => {
  const measured = measureProductionCatalogSotGates({
    records: [
      row(
        "ws:t1:user:u1:asset:a1",
        "t1",
        { kind: "user", userId: "u1" },
        {
          bindings: [
            {
              bindingId: "b1",
              resourceId: "ws:t1:user:u1:asset:a1",
              role: "canonical",
              locator: "shared",
              state: "active",
            },
          ],
        },
      ),
      row(
        "ws:t1:user:u2:asset:a2",
        "t1",
        { kind: "user", userId: "u2" },
        {
          bindings: [
            {
              bindingId: "b2",
              resourceId: "ws:t1:user:u2:asset:a2",
              role: "canonical",
              locator: "shared",
              state: "active",
            },
          ],
        },
      ),
    ],
  });
  assert.equal(measured.gates.binding_canonical_uniqueness.gate, "fail");
  assert.equal(measured.fourGates100, false);
});

void test("opaque workspace ids fail all-workspace gates and stay outside authority-shaped gates", () => {
  const records = [
    row("opaque-token", "t1", { kind: "user", userId: "u1" }),
    row("ws:t1:user:u2:asset:a2", "t1", { kind: "user", userId: "u2" }),
  ];
  const allWorkspace = measureProductionCatalogSotGates({
    records,
    population: "all-workspace",
  });
  const authorityShaped = measureProductionCatalogSotGates({
    records,
    population: "authority-shaped",
  });
  assert.equal(allWorkspace.residualOpaqueWorkspaceRecords, 1);
  assert.equal(allWorkspace.gates.authority.gate, "fail");
  assert.equal(allWorkspace.fourGates100, false);
  assert.equal(authorityShaped.residualOpaqueWorkspaceRecords, 1);
  assert.equal(authorityShaped.fourGates100, true);
  assert.equal(authorityShaped.uniqueUserOwnedEquivalent, 1);
});

void test("quarantined rows stay out of the normal Catalog count", () => {
  const measured = measureProductionCatalogSotGates({
    records: [
      row("ws:t1:user:u1:asset:a1", "t1", { kind: "user", userId: "u1" }),
      row(
        "ws:t1:user:u9:asset:bad",
        "t1",
        { kind: "user", userId: "u9" },
        {
          envelope: { lifecycleState: "quarantined" },
        },
      ),
    ],
  });
  assert.equal(measured.normalWorkspaceRecords, 1);
  assert.equal(measured.quarantinedWorkspaceRecords, 1);
  assert.equal(measured.gates.lifecycle_conflict_quarantine.gate, "pass");
});
