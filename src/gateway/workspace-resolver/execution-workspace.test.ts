import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createEmptyAgentRegistryStore } from "../agent-registry/types.js";
import type { CatalogRecord } from "../data-governance/types.js";
import {
  STEWARD_BUILTIN_AGENT_ASSET_ID,
  buildBuiltinStewardWorkspaceResourceId,
} from "./builders.js";
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

function stewardRecord(params: {
  resourceId: string;
  locator: string;
  userId: string;
  tenantId?: string;
}): CatalogRecord {
  const tenantId = params.tenantId ?? "tenant";
  return {
    envelope: {
      resourceId: params.resourceId,
      resourceType: "workspace",
      schemaVersion: 1,
      tenantId,
      owner: { kind: "user", userId: params.userId },
      scope: { kind: "tenant", tenantId },
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
        resourceId: params.resourceId,
        role: "canonical",
        state: "active",
        locator: params.locator,
        storageKind: "filesystem",
        contentVersion: "1",
      },
    ],
  };
}

it("builtin steward uses the official asset:steward:builtin catalog id", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-steward-"));
  roots.push(root);
  const userId = "user-elle";
  const resourceId = buildBuiltinStewardWorkspaceResourceId({ tenantId: "tenant", userId });
  expect(resourceId).toBe(`ws:tenant:user:${userId}:asset:${STEWARD_BUILTIN_AGENT_ASSET_ID}`);
  const written = selectExecutionWorkspace({
    tenantId: "tenant",
    userId,
    agentId: "main",
    registry: createEmptyAgentRegistryStore(),
    records: [stewardRecord({ resourceId, locator: root, userId })],
    operation: "write",
  });
  expect(written.resourceId).toBe(resourceId);
  expect(written.rootPath).toBe(fs.realpathSync(root));
});

it("does not accept a short :steward alias for builtin steward", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-steward-short-"));
  roots.push(root);
  const userId = "user-elle";
  expect(() =>
    selectExecutionWorkspace({
      tenantId: "tenant",
      userId,
      agentId: "main",
      registry: createEmptyAgentRegistryStore(),
      records: [
        stewardRecord({
          resourceId: `ws:tenant:user:${userId}:steward`,
          locator: root,
          userId,
        }),
      ],
      operation: "write",
    }),
  ).toThrow("workspace_binding_required:resource_missing_or_ambiguous");
});

it("resolves a historical /root/.openbot locator onto STATE_DIR and never onto operators", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-state-"));
  roots.push(stateDir);
  const userId = "user-elle";
  const official = path.join(
    stateDir,
    "tenants/001/users",
    userId,
    "OpenBot/agents/main/workspace",
  );
  fs.mkdirSync(official, { recursive: true });
  fs.mkdirSync(path.join(stateDir, "operators", userId, "OpenBot/agents/main/workspace"), {
    recursive: true,
  });
  const resourceId = buildBuiltinStewardWorkspaceResourceId({ tenantId: "001", userId });
  const written = selectExecutionWorkspace({
    tenantId: "001",
    userId,
    agentId: "main",
    registry: createEmptyAgentRegistryStore(),
    records: [
      stewardRecord({
        resourceId,
        locator: `/root/.openbot/tenants/001/users/${userId}/OpenBot/agents/main/workspace`,
        userId,
        tenantId: "001",
      }),
    ],
    operation: "write",
    stateDir,
    tenantsRoot: path.join(stateDir, "tenants"),
  });
  expect(written.rootPath).toBe(fs.realpathSync(official));
  expect(written.rootPath).not.toContain(`${path.sep}operators${path.sep}`);
});

it("fail-closes write when the official workspace directory is not writable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-steward-ro-"));
  roots.push(root);
  fs.chmodSync(root, 0o555);
  const userId = "user-elle";
  const resourceId = buildBuiltinStewardWorkspaceResourceId({ tenantId: "tenant", userId });
  try {
    expect(() =>
      selectExecutionWorkspace({
        tenantId: "tenant",
        userId,
        agentId: "main",
        registry: createEmptyAgentRegistryStore(),
        records: [stewardRecord({ resourceId, locator: root, userId })],
        operation: "write",
      }),
    ).toThrow("workspace_binding_required:directory_not_writable");
    expect(
      selectExecutionWorkspace({
        tenantId: "tenant",
        userId,
        agentId: "main",
        registry: createEmptyAgentRegistryStore(),
        records: [stewardRecord({ resourceId, locator: root, userId })],
        operation: "read",
      }).rootPath,
    ).toBe(fs.realpathSync(root));
  } finally {
    fs.chmodSync(root, 0o755);
  }
});
