import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import type { CatalogRecord } from "../data-governance/types.js";
import { selectExecutionWorkspace } from "./execution-workspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-chain-"));
  roots.push(root);
  const registry = createEmptyAgentRegistryStore();
  registry.assets.asset = {
    agentAssetId: "asset",
    enterpriseId: "tenant",
    agentSlug: "display-alias",
    legacyAgentId: "robot",
    displayName: "Robot",
    status: "active",
    createdAt: "now",
    updatedAt: "now",
  };
  registry.ownerBindings.owner = {
    bindingId: "owner",
    enterpriseId: "tenant",
    agentAssetId: "asset",
    ownerType: "seat",
    ownerId: "seat",
    isPrimary: true,
    effectiveAt: "now",
  };
  const resourceId = "ws:tenant:seat:seat:asset:asset";
  const record: CatalogRecord = {
    envelope: {
      resourceId,
      resourceType: "workspace",
      schemaVersion: 1,
      tenantId: "tenant",
      owner: { kind: "position", seatId: "seat" },
      scope: { kind: "tenant", tenantId: "tenant" },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: "binding",
      createdAt: "now",
      updatedAt: "now",
    },
    bindings: [
      {
        bindingId: "binding",
        resourceId,
        role: "canonical",
        state: "active",
        locator: root,
        storageKind: "filesystem",
        contentVersion: "1",
      },
    ],
  };
  return {
    tenantId: "tenant",
    userId: "user-a",
    agentId: "robot",
    registry,
    records: [record],
    operation: "write" as const,
  };
}

it("all execution and read operations resolve the same exact canonical root independent of chatting user", () => {
  const p = fixture();
  const written = selectExecutionWorkspace(p);
  fs.writeFileSync(path.join(written.rootPath, "result.md"), "verified");
  for (const userId of ["user-a", "user-b"]) {
    const read = selectExecutionWorkspace({ ...p, userId, operation: "read" });
    expect(read).toEqual(written);
    expect(fs.readFileSync(path.join(read.rootPath, "result.md"), "utf8")).toBe("verified");
  }
});
it.each(["unplaced", "missing", "duplicate", "foreign", "retired", "owner-conflict", "binding-id"])(
  "blocks %s instead of using a login-user directory",
  (kind) => {
    const p = fixture(),
      r = p.records[0];
    if (kind === "unplaced") {
      r.bindings[0].locator = "unplaced://classified/workspace";
    }
    if (kind === "missing") {
      r.bindings[0].locator += "/missing";
    }
    if (kind === "duplicate") {
      r.bindings.push({ ...r.bindings[0], bindingId: "other" });
    }
    if (kind === "foreign") {
      r.envelope.tenantId = "other";
    }
    if (kind === "retired") {
      r.envelope.lifecycleState = "retired";
    }
    if (kind === "owner-conflict") {
      p.registry.ownerBindings.second = {
        ...p.registry.ownerBindings.owner,
        bindingId: "second",
        ownerId: "other",
      };
    }
    if (kind === "binding-id") {
      r.envelope.canonicalBindingId = "other";
    }
    expect(() => selectExecutionWorkspace(p)).toThrow("workspace_binding_required");
  },
);
it("never treats an alias/display name as asset identity", () => {
  expect(() => selectExecutionWorkspace({ ...fixture(), agentId: "display-alias" })).toThrow(
    "agent_not-found",
  );
});

it("accepts the canonical asset id as well as its exact registered runtime id", () => {
  const p = fixture();
  expect(selectExecutionWorkspace({ ...p, agentId: "asset" })).toEqual(selectExecutionWorkspace(p));
});
it("read-only is readable but cannot execute writes", () => {
  const p = fixture();
  p.records[0].envelope.lifecycleState = "read_only";
  p.records[0].bindings[0].state = "read_only";
  expect(selectExecutionWorkspace({ ...p, operation: "read" }).bindingId).toBe("binding");
  expect(() => selectExecutionWorkspace(p)).toThrow("lifecycle_denied");
});
it("groups and personal robots use owner-specific canonical rows, never another robot root", () => {
  const p = fixture(),
    r = p.records[0];
  r.envelope.resourceId = "ws:tenant:group:group";
  r.envelope.owner = { kind: "group", groupId: "group" };
  r.bindings[0].resourceId = r.envelope.resourceId;
  expect(selectExecutionWorkspace({ ...p, groupId: "group" }).rootPath).toBe(
    fs.realpathSync(r.bindings[0].locator),
  );
  expect(() => selectExecutionWorkspace({ ...p, groupId: "other" })).toThrow("resource_missing");
  p.registry.ownerBindings.owner.ownerType = "membership";
  r.envelope.resourceId = "ws:tenant:user:user-a:asset:asset";
  r.envelope.owner = { kind: "user", userId: "user-a" };
  r.bindings[0].resourceId = r.envelope.resourceId;
  expect(selectExecutionWorkspace(p).rootPath).toBe(fs.realpathSync(r.bindings[0].locator));
  expect(() => selectExecutionWorkspace({ ...p, userId: "other" })).toThrow("resource_missing");
});

it("personal and group write-then-read use the same canonical file and never another robot root", () => {
  const p = fixture();
  const written = selectExecutionWorkspace(p);
  fs.writeFileSync(path.join(written.rootPath, "personal.md"), "personal-ok");
  const personalRead = selectExecutionWorkspace({ ...p, operation: "read" });
  expect(personalRead).toEqual(written);
  expect(fs.readFileSync(path.join(personalRead.rootPath, "personal.md"), "utf8")).toBe(
    "personal-ok",
  );

  const group = fixture();
  const record = group.records[0];
  record.envelope.resourceId = "ws:tenant:group:group";
  record.envelope.owner = { kind: "group", groupId: "group" };
  record.bindings[0].resourceId = record.envelope.resourceId;
  const groupWritten = selectExecutionWorkspace({ ...group, groupId: "group" });
  fs.writeFileSync(path.join(groupWritten.rootPath, "group.md"), "group-ok");
  const groupRead = selectExecutionWorkspace({ ...group, groupId: "group", operation: "read" });
  expect(groupRead).toEqual(groupWritten);
  expect(fs.readFileSync(path.join(groupRead.rootPath, "group.md"), "utf8")).toBe("group-ok");
  expect(() => selectExecutionWorkspace({ ...group, groupId: "other" })).toThrow(
    "resource_missing",
  );
});

it.each(["archived", "deletion_pending", "purged", "quarantined", "recovery_required", "pending"])(
  "blocks lifecycle %s instead of falling back to a login-user directory",
  (state) => {
    const p = fixture();
    p.records[0].envelope.lifecycleState =
      state as (typeof p.records)[number]["envelope"]["lifecycleState"];
    expect(() => selectExecutionWorkspace(p)).toThrow("workspace_binding_required");
    expect(() => selectExecutionWorkspace({ ...p, operation: "read" })).toThrow(
      "workspace_binding_required",
    );
  },
);
