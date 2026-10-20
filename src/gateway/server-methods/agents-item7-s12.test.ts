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
  expectZeroFileOps,
  handlerArgs,
  installCompleteTrustedContext,
  resetCrMocks,
  trustedClient,
} from "./agents-item7-batch9-12-cr.test.js";

const mocks = getMocks();

const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "agents.ts"),
  "utf8",
);

describe("Item 7 CR S12 agents.update avatar locator", () => {
  beforeEach(() => {
    resetCrMocks();
  });

  it("does not keep cfg-only locator or empty-string avatar workspace", () => {
    expect(source).not.toMatch(/resolveWorkspaceLocator\(\{\s*cfg/);
    expect(source).not.toContain('r.ok ? r.handle.locator : ""');
  });

  it("fail-before: missing tenant context rejects avatar update before config or mkdir", async () => {
    mocks.resolveTenantContext.mockResolvedValue(null);
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.update"](
      handlerArgs({ agentId: "research", avatar: "🙂" }, respond),
    );
    expectDenied(respond, "missing_tenant_context");
    expectZeroFileOps();
    expect(mocks.ensureAgentWorkspace).not.toHaveBeenCalled();
  });

  it("rejects catalog_projection_miss when identity is incomplete", async () => {
    installCompleteTrustedContext();
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({});
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.update"](
      handlerArgs({ agentId: "research", avatar: "🙂" }, respond),
    );
    expectDenied(respond, "catalog_projection_miss");
    expectZeroFileOps();
  });

  it("rejects cross-tenant identity and does not mkdir", async () => {
    installCompleteTrustedContext();
    const { completeCatalog } = await import("./agents-item7-batch9-12-cr.test.js");
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
      catalog: completeCatalog({ tenantId: "tenant-b" }).catalog,
      agentAssetId: "asset-alpha",
    });
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.update"](
      handlerArgs({ agentId: "research", avatar: "🙂" }, respond),
    );
    expectDeniedAny(respond, ["tenant_mismatch", "catalog_miss"]);
    expectZeroFileOps();
  });

  it("pass-after: avatar update writes config only after a canonical locator", async () => {
    installCompleteTrustedContext();
    const respond = vi.fn();
    const { resolveAgentsHandlerWorkspaceLocator } =
      await import("./agents-handler-workspace-locator.js");
    const located = await resolveAgentsHandlerWorkspaceLocator({
      client: trustedClient() as never,
      cfg: { data: { mode: "managed" } } as never,
      agentId: "research",
      purpose: "agents.update.avatar",
    });
    expect(located.ok).toBe(true);
    if (located.ok) {
      expect(located.handle.locator).toBe(CANONICAL_LOCATOR);
      expect(located.handle.locator).not.toBe("");
      expect(located.handle.locator).not.toBe(process.cwd());
    }
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.update"](
      handlerArgs({ agentId: "research", avatar: "🙂" }, respond),
    );
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(mocks.writeConfigFile).toHaveBeenCalled();
  });
});
