import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverWorkspaceCandidates } from "./discover-candidates.js";
import { runWorkspaceInventory } from "./inventory.js";
import { assertSafePathSegment, isPathInside } from "./path-safety.js";
import { scanWorkspaceRoot } from "./scan-root.js";
import { toRedactedInventorySummary, verifySummarySha256 } from "./summary.js";

function mkFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-ws-inv-"));
  const tenant = "tenant-a";
  const user = "user-elle";

  const employeeWs = path.join(root, "agents", "main", "employees", user, "workspace");
  fs.mkdirSync(employeeWs, { recursive: true });
  fs.writeFileSync(path.join(employeeWs, "report.pdf"), "employee-copy");

  const flatWs = path.join(root, "tenants", tenant, "users", user, "OpenBot", "workspace");
  fs.mkdirSync(flatWs, { recursive: true });
  fs.writeFileSync(path.join(flatWs, "report.pdf"), "employee-copy");

  const assetWs = path.join(
    root,
    "tenants",
    tenant,
    "users",
    user,
    "OpenBot",
    "agent-assets",
    "asset-001",
  );
  fs.mkdirSync(assetWs, { recursive: true });
  fs.writeFileSync(path.join(assetWs, "MEMORY.md"), "memory");

  const groupDir = path.join(root, "collaboration", "groups", "group-1");
  fs.mkdirSync(groupDir, { recursive: true });
  fs.writeFileSync(path.join(groupDir, "notes.md"), "group notes");

  fs.mkdirSync(path.join(root, "canvas"), { recursive: true });
  fs.writeFileSync(path.join(root, "canvas", "scratch.canvas"), "{}");

  return root;
}

describe("workspace-inventory path-safety", () => {
  it("rejects unsafe segments", () => {
    expect(() => assertSafePathSegment("../x", "test")).toThrow(/unsafe/);
    expect(isPathInside("/tmp/a", "/tmp/a/b")).toBe(true);
    expect(isPathInside("/tmp/a", "/tmp/b")).toBe(false);
  });
});

describe("discoverWorkspaceCandidates", () => {
  let fixtureRoot = "";

  afterEach(() => {
    if (fixtureRoot) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      fixtureRoot = "";
    }
  });

  it("discovers employee, flat, asset, group, and risk candidates", () => {
    fixtureRoot = mkFixture();
    const { candidates } = discoverWorkspaceCandidates({
      containmentRoot: fixtureRoot,
      maxCandidates: 100,
    });
    const classes = new Set(candidates.map((c) => c.normalizedRootClass));
    expect(classes.has("employee_isolation_root")).toBe(true);
    expect(classes.has("data_space_flat_workspace")).toBe(true);
    expect(classes.has("agent_assets_user")).toBe(true);
    expect(classes.has("collaboration_group")).toBe(true);
    expect(classes.has("canvas_risk")).toBe(true);
  });
});

describe("runWorkspaceInventory", () => {
  let fixtureRoot = "";

  afterEach(() => {
    if (fixtureRoot) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      fixtureRoot = "";
    }
  });

  it("marks duplicate content across roots and quarantines unknown ownership", () => {
    fixtureRoot = mkFixture();
    const report = runWorkspaceInventory({
      containmentRoot: fixtureRoot,
      limits: {
        maxCandidates: 50,
        maxFiles: 100,
        maxDepth: 8,
        maxBytesRead: 1024 * 1024,
        maxFullHashBytes: 1024 * 1024,
      },
      inventoryUtc: "2026-08-12T00:00:00.000Z",
    });

    expect(report.records.length).toBeGreaterThan(0);
    expect(report.quarantine.unknownOwnershipCandidateIds.length).toBe(report.records.length);
    expect(report.quarantine.duplicateContentGroups.length).toBeGreaterThan(0);

    const dupGroup = report.quarantine.duplicateContentGroups[0];
    expect(dupGroup.candidateIds.length).toBeGreaterThanOrEqual(2);
    const dupRecords = report.records.filter((r) => dupGroup.candidateIds.includes(r.candidateId));
    expect(dupRecords.some((r) => r.bindingRole === "duplicate")).toBe(true);
  });

  it("respects scan byte limits and sets truncated", () => {
    fixtureRoot = mkFixture();
    const scan = scanWorkspaceRoot({
      containmentRoot: fixtureRoot,
      candidateRoot: path.join(fixtureRoot, "canvas"),
      limits: { maxFiles: 1, maxDepth: 2, maxBytesRead: 1, maxFullHashBytes: 1024 },
    });
    expect(scan.truncated).toBe(true);
  });

  it("produces deterministic redacted summary with verifiable summarySha256", () => {
    fixtureRoot = mkFixture();
    const report = runWorkspaceInventory({
      containmentRoot: fixtureRoot,
      inventoryUtc: "2026-08-12T00:00:00.000Z",
    });
    const summary = toRedactedInventorySummary(report, "workspace-inventory-test-001");
    expect(verifySummarySha256(summary)).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("user-elle");
    expect(JSON.stringify(summary)).not.toContain("tenant-a");
    expect(summary.records[0]?.tenantRef).toBe("<tenant>");
  });
});
