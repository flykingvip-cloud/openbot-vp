import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMocks } from "./agents-item7-batch9-12-cr.test.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const m = getMocks();
  return {
    ...actual,
    mkdir: (...args: unknown[]) => m.mkdir(...args),
    appendFile: (...args: unknown[]) => m.appendFile(...args),
    access: (...args: unknown[]) => m.access(...args),
  };
});

import {
  CANONICAL_LOCATOR,
  expectDenied,
  expectDeniedAny,
  expectNoEmptyOrCwdTarget,
  expectZeroFileOps,
  handlerArgs,
  installCompleteTrustedContext,
  resetCrMocks,
} from "./agents-item7-batch9-12-cr.test.js";

const mocks = getMocks();

const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "agents.ts"),
  "utf8",
);

describe("Item 7 CR S10 agents.files.get trusted locator", () => {
  beforeEach(() => {
    resetCrMocks();
  });

  it("does not keep the cfg-only or empty-string locator fallback", () => {
    expect(source).not.toMatch(/resolveWorkspaceLocator\(\{\s*cfg/);
    expect(source).not.toContain('r.ok ? r.handle.locator : ""');
    expect(source).toContain("resolveAgentsHandlerWorkspaceLocator");
  });

  it("fail-before: missing tenant context rejects get and performs zero file ops", async () => {
    mocks.resolveTenantContext.mockResolvedValue(null);
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.get"](
      handlerArgs({ agentId: "research", name: "IDENTITY.md" }, respond),
    );
    expectDenied(respond, "missing_tenant_context");
    expectZeroFileOps();
    expect(mocks.readLocalFileSafely).not.toHaveBeenCalled();
  });

  it("rejects catalog_projection_miss when identity is incomplete and does not read files", async () => {
    installCompleteTrustedContext();
    mocks.resolveEmployeeWorkbenchActor.mockResolvedValue({
      userId: "user-elle",
      userEmail: "elle@example.com",
      tenantId: "tenant-a",
      seatAgentIds: ["research"],
      seatSpaceIds: [],
    });
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({});
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.get"](
      handlerArgs({ agentId: "research", name: "IDENTITY.md" }, respond),
    );
    expectDenied(respond, "catalog_projection_miss");
    expect(mocks.readLocalFileSafely).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant catalog rows", async () => {
    installCompleteTrustedContext();
    const { completeCatalog } = await import("./agents-item7-batch9-12-cr.test.js");
    const foreign = completeCatalog({ tenantId: "tenant-b", userId: "user-elle" });
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
      catalog: foreign.catalog,
      agentAssetId: "asset-alpha",
    });
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.get"](
      handlerArgs({ agentId: "research", name: "IDENTITY.md" }, respond),
    );
    expectDeniedAny(respond, ["tenant_mismatch", "catalog_miss"]);
    expect(mocks.readLocalFileSafely).not.toHaveBeenCalled();
  });

  it("pass-after: complete trusted query uses the canonical locator", async () => {
    installCompleteTrustedContext();
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.get"](
      handlerArgs({ agentId: "research", name: "IDENTITY.md" }, respond),
    );
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]?.workspace).toBe(CANONICAL_LOCATOR);
    expectNoEmptyOrCwdTarget(mocks.readLocalFileSafely.mock.calls);
  });
});
