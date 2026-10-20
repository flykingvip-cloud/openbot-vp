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

describe("Item 7 CR S11 agents.files.set host-fallback removal", () => {
  beforeEach(() => {
    resetCrMocks();
  });

  it("does not keep the empty-string host fallback", () => {
    expect(source).not.toMatch(/resolveWorkspaceLocator\(\{\s*cfg/);
    expect(source).not.toContain('r.ok ? r.handle.locator : ""');
    expect(source).not.toContain("process.cwd()");
  });

  it("fail-before: missing tenant context rejects set and never mkdirs", async () => {
    mocks.resolveTenantContext.mockResolvedValue(null);
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.set"](
      handlerArgs({ agentId: "research", name: "IDENTITY.md", content: "x" }, respond),
    );
    expectDenied(respond, "missing_tenant_context");
    expectZeroFileOps();
  });

  it("rejects catalog miss and does not write", async () => {
    installCompleteTrustedContext();
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({});
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.set"](
      handlerArgs({ agentId: "research", name: "IDENTITY.md", content: "x" }, respond),
    );
    expectDenied(respond, "catalog_projection_miss");
    expectZeroFileOps();
  });

  it("rejects catalog ambiguous and does not write", async () => {
    installCompleteTrustedContext();
    const { ambiguousCatalog } = await import("./agents-item7-batch9-12-cr.test.js");
    mocks.loadExistingGovernedWorkspaceIdentity.mockResolvedValue({
      catalog: ambiguousCatalog(),
      agentAssetId: "asset-alpha",
    });
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.set"](
      handlerArgs({ agentId: "research", name: "IDENTITY.md", content: "x" }, respond),
    );
    const { expectDeniedAny } = await import("./agents-item7-batch9-12-cr.test.js");
    expectDeniedAny(respond, ["catalog_ambiguous", "first_canonical_selection_forbidden"]);
    expectZeroFileOps();
  });

  it("pass-after: write uses the canonical locator, never empty or cwd", async () => {
    installCompleteTrustedContext();
    const respond = vi.fn();
    const { agentsHandlers } = await import("./agents.js");
    await agentsHandlers["agents.files.set"](
      handlerArgs({ agentId: "research", name: "IDENTITY.md", content: "x" }, respond),
    );
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(mocks.writeFileWithinRoot).toHaveBeenCalled();
    expectNoEmptyOrCwdTarget(
      mocks.writeFileWithinRoot.mock.calls.map((args) => [args[0]?.rootDir]),
    );
    expect(mocks.writeFileWithinRoot.mock.calls[0]?.[0]).toMatchObject({
      rootDir: CANONICAL_LOCATOR,
    });
  });
});
