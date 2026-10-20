import { describe, expect, it } from "vitest";
import { AdapterRegistry, AdapterRegistryError, BUILTIN_ADAPTERS } from "./adapter-registry.js";
import { GENERIC_ADAPTERS, GIT_ADAPTER } from "./adapters/shell-git.js";

describe("AdapterRegistry", () => {
  it("seeds built-in adapters and resolves their tool names", () => {
    const reg = new AdapterRegistry();
    expect(reg.resolve("exec")?.id).toBe("builtin.exec");
    expect(reg.resolve("apply_patch")?.id).toBe("builtin.apply_patch");
    expect(reg.list()).toHaveLength(BUILTIN_ADAPTERS.length);
  });

  it("returns null for an unknown tool name (no silent execution)", () => {
    const reg = new AdapterRegistry();
    expect(reg.resolve("nonexistent-tool")).toBeNull();
  });

  it("registers a new adapter and resolves all its tool names", () => {
    const reg = new AdapterRegistry();
    reg.register(GIT_ADAPTER);
    expect(reg.resolve("git")?.id).toBe("generic.git");
  });

  it("rejects duplicate adapter ids", () => {
    const reg = new AdapterRegistry();
    reg.register(GIT_ADAPTER);
    expect(() => reg.register(GIT_ADAPTER)).toThrow(AdapterRegistryError);
  });

  it("schema-validates on register (rejects malformed adapter)", () => {
    const reg = new AdapterRegistry();
    expect(() =>
      reg.register({ id: "bad", match: { toolNames: [] }, execute: { command: "x" } }),
    ).toThrow();
  });

  it("generic shell/git adapters are repo-agnostic; git declares network:false", () => {
    const reg = new AdapterRegistry([...BUILTIN_ADAPTERS, ...GENERIC_ADAPTERS]);
    expect(reg.resolve("bash")?.id).toBe("generic.shell");
    expect(reg.resolve("git")?.capabilities.network).toBe(false);
  });
});
