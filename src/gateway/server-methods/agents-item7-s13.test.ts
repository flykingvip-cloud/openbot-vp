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

describe("Item 7 CR S13 agents.delete locator", () => {
  beforeEach(() => {
    resetCrMocks();
  });

  it("does not keep cfg-only locator or empty-string delete root", () => {
    expect(source).not.toMatch(/resolveWorkspaceLocator\(\{\s*cfg/);
    expect(source).not.toContain('r.ok ? r.handle.locator : ""');
  });

  it("fail-before: missing tenant context rejects delete before config or trash", async () => {
    mocks.resolveTenantContext.mockResolvedValue(null);
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.delete"](handlerArgs({ agentId: "research" }, respond));
    expectDenied(respond, "missing_tenant_context");
    expectZeroFileOps();
  });

  it("rejects catalog_projection_miss when identity is incomplete and does not delete or mutate config", async () => {
    installCompleteTrustedContext();
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({});
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.delete"](handlerArgs({ agentId: "research" }, respond));
    expectDenied(respond, "catalog_projection_miss");
    expectZeroFileOps();
  });

  it("rejects catalog miss/ambiguous and does not trash", async () => {
    installCompleteTrustedContext();
    const { ambiguousCatalog } = await import("./agents-item7-batch9-12-cr.test.js");
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
      catalog: ambiguousCatalog(),
      agentAssetId: "asset-alpha",
    });
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.delete"](handlerArgs({ agentId: "research" }, respond));
    const { expectDeniedAny } = await import("./agents-item7-batch9-12-cr.test.js");
    expectDeniedAny(respond, ["catalog_ambiguous", "first_canonical_selection_forbidden"]);
    expectZeroFileOps();
  });

  it("pass-after: trash uses the canonical locator, never empty or cwd", async () => {
    installCompleteTrustedContext();
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.delete"](handlerArgs({ agentId: "research" }, respond));
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(mocks.writeConfigFile).toHaveBeenCalled();
    expect(mocks.movePathToTrash).toHaveBeenCalled();
    expectNoEmptyOrCwdTarget(mocks.movePathToTrash.mock.calls);
    expect(mocks.movePathToTrash.mock.calls.some((args) => args[0] === CANONICAL_LOCATOR)).toBe(
      true,
    );
  });
});
