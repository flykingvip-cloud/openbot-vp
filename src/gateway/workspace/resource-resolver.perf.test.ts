import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkspaceResourceId,
  createMemoryWorkspaceCatalog,
  createWorkspaceBinding,
  createWorkspaceResourceResolver,
} from "./resource-resolver.js";
import type { WorkspaceResourceRecord } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

describe("workspace resource resolver performance", () => {
  it("meets Gate0/P0 resolve P95 gates on a single-resource fixture", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ws-perf-"));
    tempDirs.push(root);
    const locator = path.join(root, "canonical");
    fs.mkdirSync(locator, { recursive: true });
    fs.writeFileSync(path.join(locator, ".workspace-marker"), "ok");

    const ownerScope = {
      kind: "user_owned" as const,
      userId: "u1",
      agentAssetId: "asset-1",
      proof: {
        source: "explicit_binding" as const,
        ownerType: "user" as const,
        ownerId: "u1",
        agentAssetId: "asset-1",
      },
    };
    const resourceId = buildWorkspaceResourceId({ tenantId: "t1", ownerScope });
    const resource: WorkspaceResourceRecord = {
      resourceId,
      resourceType: "workspace",
      tenantId: "t1",
      ownerScope,
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
    };
    const catalog = createMemoryWorkspaceCatalog({
      resources: [resource],
      bindings: [createWorkspaceBinding({ resourceId, locator })],
    });
    const resolver = createWorkspaceResourceResolver({ catalog });

    const samples = 200;
    const localReadMs: number[] = [];
    const managedReadMs: number[] = [];
    const managedWriteMs: number[] = [];

    for (let i = 0; i < samples; i += 1) {
      const t0 = performance.now();
      const local = await resolver.resolve({
        actor: { tenantId: null, principalId: "u1", profile: "personal_local" },
        resourceId,
        operation: "read",
        purpose: "perf",
      });
      localReadMs.push(performance.now() - t0);
      expect(local.ok).toBe(true);

      const t1 = performance.now();
      const managed = await resolver.resolve({
        actor: { tenantId: "t1", principalId: "u1", profile: "managed_enterprise" },
        resourceId,
        operation: "read",
        purpose: "perf",
      });
      managedReadMs.push(performance.now() - t1);
      expect(managed.ok).toBe(true);

      const t2 = performance.now();
      const write = await resolver.resolve({
        actor: { tenantId: "t1", principalId: "u1", profile: "managed_enterprise" },
        resourceId,
        operation: "write",
        purpose: "perf",
      });
      managedWriteMs.push(performance.now() - t2);
      expect(write.ok).toBe(true);
    }

    localReadMs.sort((a, b) => a - b);
    managedReadMs.sort((a, b) => a - b);
    managedWriteMs.sort((a, b) => a - b);

    const localP95 = percentile(localReadMs, 95);
    const managedReadP95 = percentile(managedReadMs, 95);
    const managedWriteP95 = percentile(managedWriteMs, 95);

    // Fixture: 1 resource / 1 binding / empty marker file. Machine: local developer host.
    expect(localP95).toBeLessThanOrEqual(20);
    expect(managedReadP95).toBeLessThanOrEqual(50);
    expect(managedWriteP95).toBeLessThanOrEqual(100);

    // Keep evidence visible in test output when debugging.
    expect({
      fixture: "single-resource-memory-catalog",
      samples,
      localReadP95Ms: Number(localP95.toFixed(3)),
      managedReadP95Ms: Number(managedReadP95.toFixed(3)),
      managedWriteP95Ms: Number(managedWriteP95.toFixed(3)),
    }).toBeTruthy();
  });
});
