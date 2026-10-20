import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEmployeeBuiltinStewardWorkspaceDir } from "../../agents/builtin-steward/employee-isolation.js";
import {
  advanceCutoverOperation,
  createWorkspaceCutoverOperation,
  gateCutoverWrite,
  InMemoryWorkspaceCutoverStore,
  isCutoverSourceWriteBlocked,
} from "../workspace-cutover/index.js";
import { buildUserOwnedWorkspaceCatalogEntry } from "./builders.js";
import { InMemoryWorkspaceResourceCatalog } from "./catalog.js";
import { runEmployeeStewardCutoverPilot } from "./provision-steward-cutover.js";
import { resolveWorkspaceResource } from "./resolve.js";
import {
  buildEmployeeStewardCutoverCatalog,
  resolveEmployeeStewardSourceWorkspaceDir,
  resolveEmployeeStewardTargetWorkspaceDir,
  resolveEmployeeStewardWritableWorkspaceDir,
  verifiedCopyStewardWorkspace,
} from "./steward-write.js";

const managedCfg = { data: { mode: "managed" as const } };

function seedStewardSourceCatalog(params: {
  tenantId: string;
  userId: string;
  sourceRoot: string;
  targetRoot: string;
}): InMemoryWorkspaceResourceCatalog {
  const entry = buildUserOwnedWorkspaceCatalogEntry({
    tenantId: params.tenantId,
    userId: params.userId,
    agentAssetId: "steward:builtin",
    workspaceRoot: params.sourceRoot,
  });
  // Honest SoT: one canonical/active source binding + one compatibility/read_only
  // D1e target binding on the same resource, with distinct locators. The target is
  // never promoted to canonical here (S25 reads it via resolveWorkspaceTargetBinding).
  const targetBinding = {
    bindingId: `${entry.resource.resourceId}:target`,
    resourceId: entry.resource.resourceId,
    role: "compatibility" as const,
    state: "read_only" as const,
    locator: params.targetRoot,
    contentVersion: "v1",
  };
  return new InMemoryWorkspaceResourceCatalog({
    governanceVersion: 1,
    status: "available",
    resources: { [entry.resource.resourceId]: entry.resource },
    bindings: {
      [entry.binding.bindingId]: entry.binding,
      [targetBinding.bindingId]: targetBinding,
    },
  });
}

describe("employee steward cutover pilot (Phase 1.1)", () => {
  let fixtureRoot = "";

  afterEach(() => {
    if (fixtureRoot) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      fixtureRoot = "";
    }
  });

  it("advances A_employee through verified copy to resolver_write_cutover", () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-steward-cutover-"));
    const tenantId = "tenant-pilot";
    const userId = "user-elle";
    const sourceRoot = resolveEmployeeStewardSourceWorkspaceDir(userId, fixtureRoot);
    const targetRoot = resolveEmployeeStewardTargetWorkspaceDir({
      tenantId,
      userId,
      stateDir: fixtureRoot,
    });
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "report.md"), "steward-bytes");

    const store = new InMemoryWorkspaceCutoverStore();
    const pilot = runEmployeeStewardCutoverPilot({
      tenantId,
      userId,
      cutoverStore: store,
      placementRoot: fixtureRoot,
      sourceRoot,
      targetRoot,
      operationId: "op-steward-pilot-1",
    });

    expect(pilot.operation.state).toBe("resolver_write_cutover");
    expect(isCutoverSourceWriteBlocked(pilot.operation)).toBe(true);
    expect(
      gateCutoverWrite({ operation: pilot.operation, bindingId: pilot.sourceBindingId }).ok,
    ).toBe(false);
    expect(
      gateCutoverWrite({ operation: pilot.operation, bindingId: pilot.targetBindingId }).ok,
    ).toBe(true);
    expect(fs.existsSync(path.join(pilot.targetRoot, "report.md"))).toBe(true);
    expect(fs.readFileSync(path.join(pilot.targetRoot, "report.md"), "utf8")).toBe("steward-bytes");
    // Source root still exists (no mv/rename cutover).
    expect(fs.existsSync(path.join(sourceRoot, "report.md"))).toBe(true);
  });

  it("routes writable cwd to D1e target after cutover and blocks source writes", () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-steward-write-"));
    const tenantId = "tenant-pilot";
    const userId = "user-elle";
    const sourceRoot = resolveEmployeeStewardSourceWorkspaceDir(userId, fixtureRoot);
    const targetRoot = resolveEmployeeStewardTargetWorkspaceDir({
      tenantId,
      userId,
      stateDir: fixtureRoot,
    });
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "note.txt"), "src");

    const store = new InMemoryWorkspaceCutoverStore();
    const pilot = runEmployeeStewardCutoverPilot({
      tenantId,
      userId,
      cutoverStore: store,
      placementRoot: fixtureRoot,
      sourceRoot,
      targetRoot,
    });

    const writable = resolveEmployeeStewardWritableWorkspaceDir({
      tenantId,
      userId,
      cfg: managedCfg,
      catalog: seedStewardSourceCatalog({
        tenantId,
        userId,
        sourceRoot: pilot.sourceRoot,
        targetRoot: pilot.targetRoot,
      }),
      grant: { kind: "user", subjectId: userId, purpose: "employee.steward.source" },
      cutoverStore: store,
      stateDir: fixtureRoot,
    });
    expect(writable.ok).toBe(true);
    if (!writable.ok) {
      return;
    }
    const targetSuffix = "/tenants/tenant-pilot/users/user-elle/OpenBot/agents/main/workspace";
    expect(writable.cwd.replace(/\\/g, "/").endsWith(targetSuffix)).toBe(true);
    expect(pilot.targetRoot.replace(/\\/g, "/").endsWith(targetSuffix)).toBe(true);
    expect(fs.existsSync(writable.cwd)).toBe(true);
    expect(writable.bindingId).toBe(pilot.targetBindingId);
    expect(writable.cutoverState).toBe("resolver_write_cutover");

    const post = buildEmployeeStewardCutoverCatalog({
      tenantId,
      userId,
      sourceRoot: pilot.sourceRoot,
      targetRoot: pilot.targetRoot,
      cutoverState: "post",
    });
    const sourceWrite = resolveWorkspaceResource({
      catalog: post.catalog,
      cutoverOperations: [pilot.operation],
      actor: { tenantId, userId },
      resourceId: pilot.resourceId,
      operation: "write",
      purpose: "employee.steward.workspace.write",
    });
    expect(sourceWrite.ok).toBe(true);
    if (sourceWrite.ok) {
      expect(sourceWrite.bindingId).toBe(pilot.targetBindingId);
      expect(sourceWrite.bindingId).not.toBe(pilot.sourceBindingId);
    }

    const viaIsolation = resolveEmployeeBuiltinStewardWorkspaceDir(userId, {
      workspaceDirOverride: writable.cwd,
      stateDir: fixtureRoot,
    });
    expect(viaIsolation.replace(/\\/g, "/").endsWith(targetSuffix)).toBe(true);
    expect(viaIsolation.replace(/\\/g, "/")).not.toContain("/agents/main/employees/");
  });

  it("verified copy preserves content and never removes source", () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-steward-digest-"));
    const source = path.join(fixtureRoot, "src");
    const target = path.join(fixtureRoot, "dst");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "a.txt"), "alpha");
    const ok = verifiedCopyStewardWorkspace({ sourceRoot: source, targetRoot: target });
    expect(ok.ok).toBe(true);
    expect(fs.readFileSync(path.join(target, "a.txt"), "utf8")).toBe("alpha");
    expect(fs.existsSync(path.join(source, "a.txt"))).toBe(true);
  });

  it("maps D1e target under tenants/<tenant>/users/<user>/OpenBot/agents/main/workspace", () => {
    const target = resolveEmployeeStewardTargetWorkspaceDir({
      tenantId: "tenant-a",
      userId: "user-elle",
      stateDir: "/tmp/openbot-state",
    });
    expect(target).toBe(
      "/tmp/openbot-state/tenants/tenant-a/users/user-elle/OpenBot/agents/main/workspace",
    );
  });

  it("denies write during write_frozen for steward resource", () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-steward-freeze-"));
    const tenantId = "tenant-pilot";
    const userId = "user-elle";
    const sourceRoot = resolveEmployeeStewardSourceWorkspaceDir(userId, fixtureRoot);
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "x.txt"), "x");

    const store = new InMemoryWorkspaceCutoverStore();
    const built = buildEmployeeStewardCutoverCatalog({
      tenantId,
      userId,
      sourceRoot,
      targetRoot: resolveEmployeeStewardTargetWorkspaceDir({
        tenantId,
        userId,
        stateDir: fixtureRoot,
      }),
    });
    store.save(
      createWorkspaceCutoverOperation({
        operationId: "op-freeze",
        resourceId: built.resourceId,
        sourceBindingId: built.sourceBindingId,
        targetBindingId: built.targetBindingId,
        expectedContentVersion: "v1",
      }),
    );
    advanceCutoverOperation({ store, operationId: "op-freeze", nextState: "prepared" });
    advanceCutoverOperation({ store, operationId: "op-freeze", nextState: "write_frozen" });

    const writable = resolveEmployeeStewardWritableWorkspaceDir({
      tenantId,
      userId,
      cfg: managedCfg,
      catalog: seedStewardSourceCatalog({
        tenantId,
        userId,
        sourceRoot,
        targetRoot: resolveEmployeeStewardTargetWorkspaceDir({
          tenantId,
          userId,
          stateDir: fixtureRoot,
        }),
      }),
      grant: { kind: "user", subjectId: userId, purpose: "employee.steward.source" },
      cutoverStore: store,
      stateDir: fixtureRoot,
    });
    expect(writable.ok).toBe(false);
  });
});
