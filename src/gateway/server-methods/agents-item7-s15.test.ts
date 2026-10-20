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
} from "./agents-item7-batch9-12-cr.test.js";

const mocks = getMocks();

const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "agents.ts"),
  "utf8",
);

describe("Item 7 CR S15 agents.files.list host retirement", () => {
  beforeEach(() => {
    resetCrMocks();
  });

  it("does not keep the S15 host or empty-string list root", () => {
    expect(source).not.toMatch(/resolveWorkspaceLocator\(\{\s*cfg/);
    expect(source).not.toContain('r.ok ? r.handle.locator : ""');
    expect(source).not.toContain("resolveAgentWorkspaceDir(");
    expect(source).toContain('purpose: "agents.files.list"');
    expect(source).toContain("resolveAgentsHandlerWorkspaceLocatorOrRespond");
  });

  it("fail-before: missing tenant context rejects list and performs zero file ops", async () => {
    mocks.resolveTenantContext.mockResolvedValue(null);
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.list"](handlerArgs({ agentId: "research" }, respond));
    expectDenied(respond, "missing_tenant_context");
    expectZeroFileOps();
  });

  it("rejects catalog_projection_miss when identity is incomplete and does not list", async () => {
    installCompleteTrustedContext();
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({});
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.list"](handlerArgs({ agentId: "research" }, respond));
    expectDenied(respond, "catalog_projection_miss");
    expectZeroFileOps();
  });

  it("rejects catalog miss/ambiguous and does not list", async () => {
    installCompleteTrustedContext();
    const { ambiguousCatalog } = await import("./agents-item7-batch9-12-cr.test.js");
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
      catalog: ambiguousCatalog(),
      agentAssetId: "asset-alpha",
    });
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.list"](handlerArgs({ agentId: "research" }, respond));
    expectDeniedAny(respond, ["catalog_ambiguous", "first_canonical_selection_forbidden"]);
    expectZeroFileOps();
  });

  it("pass-after: list responds with the canonical locator, never empty or cwd", async () => {
    installCompleteTrustedContext();
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.list"](handlerArgs({ agentId: "research" }, respond));
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]).toMatchObject({
      agentId: "research",
      workspace: CANONICAL_LOCATOR,
    });
    expect(respond.mock.calls[0]?.[1]?.workspace).not.toBe("");
    expect(respond.mock.calls[0]?.[1]?.workspace).not.toBe(process.cwd());
  });
});
