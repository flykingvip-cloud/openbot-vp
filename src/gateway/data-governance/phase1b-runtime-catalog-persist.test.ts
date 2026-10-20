import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertRuntimeCatalogStateDirAllowed,
  persistClassifiedAuthorityRowsToRuntimeCatalog,
} from "./phase1b-runtime-catalog-persist.js";
import { resetSharedDataGovernanceCatalogForTests } from "./runtime-catalog.js";
import { loadExistingGovernedWorkspaceIdentity } from "./workspace-catalog-projection.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function loadProductionCandidate() {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "docs/design/evidence/memory-workspace-phase1b-production-authority-candidate.json",
      ),
      "utf8",
    ),
  ) as {
    candidates: Array<{
      resourceId?: string;
      classification?: string;
      workspaceKind?: string;
    }>;
    rejected: Array<{ reason?: string; resourceId?: string; workspaceKind?: string }>;
  };
}

describe("persistClassifiedAuthorityRowsToRuntimeCatalog", () => {
  it("admits production classified rows into the runtime catalog layout", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase1b-runtime-catalog-"));
    tempDirs.push(stateDir);
    const extracted = loadProductionCandidate();
    const persist = await persistClassifiedAuthorityRowsToRuntimeCatalog({
      stateDir,
      candidates: extracted.candidates,
      rejected: extracted.rejected,
      now: "2026-08-18T00:00:00.000Z",
    });
    expect(persist.catalogPath).toBe(path.join(stateDir, "data-governance", "catalog.json"));
    expect(persist.persisted).toHaveLength(22);
    expect(persist.compareAndPutConfirmed).toEqual(persist.persisted);
    expect(persist.quarantined.some((row) => row.reason === "incomplete_agent_asset")).toBe(true);

    const catalog = JSON.parse(fs.readFileSync(persist.catalogPath, "utf8")) as {
      records: Record<string, { envelope: { resourceId: string } }>;
    };
    expect(Object.keys(catalog.records)).toHaveLength(22);
    expect(Object.keys(catalog.records).every((id) => id.startsWith("ws:ent-1:"))).toBe(true);

    const loaded = await loadExistingGovernedWorkspaceIdentity({
      tenantId: "ent-1",
      userId: "user-1",
      agentId: "main",
      stateDir,
    });
    // user-1 occupancy is unbound; occupancy-minted rows belong to other users.
    expect(loaded).toEqual({});
  });

  it("refuses host ~/.openbot and default stateDir writes", () => {
    expect(() => assertRuntimeCatalogStateDirAllowed(path.join(os.homedir(), ".openbot"))).toThrow(
      /runtime_catalog_host_write_forbidden/,
    );
    expect(() =>
      assertRuntimeCatalogStateDirAllowed(path.join(os.homedir(), ".openbot", "workspace")),
    ).toThrow(/runtime_catalog_host_write_forbidden/);
  });

  it("allows host ~/.openbot when the host-write env is set", () => {
    expect(() =>
      assertRuntimeCatalogStateDirAllowed(path.join(os.homedir(), ".openbot"), {
        OPENBOT_PHASE1B_RUNTIME_CATALOG_HOST_WRITE: "1",
      }),
    ).not.toThrow();
  });
});
