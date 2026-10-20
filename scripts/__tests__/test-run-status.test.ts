import { describe, expect, it } from "vitest";
import { normalizeChildExit, resolveDefaultShardCount } from "../test-run-status.mjs";

describe("normalizeChildExit", () => {
  it("keeps a clean zero and a normal failure", () => {
    expect(normalizeChildExit(0, null)).toBe(0);
    expect(normalizeChildExit(1, null)).toBe(1);
    expect(normalizeChildExit(137, undefined)).toBe(137);
  });

  it("fails when the child is killed by a signal, including OOM SIGKILL", () => {
    expect(normalizeChildExit(null, "SIGKILL")).toBe(1);
    expect(normalizeChildExit(null, "SIGABRT")).toBe(1);
    expect(normalizeChildExit(0, "SIGKILL")).toBe(1);
  });

  it("fails when the exit status is missing", () => {
    expect(normalizeChildExit(null, null)).toBe(1);
    expect(normalizeChildExit(undefined, undefined)).toBe(1);
  });
});

describe("resolveDefaultShardCount", () => {
  it("splits CI unit runs into smaller shards and leaves local runs whole", () => {
    expect(resolveDefaultShardCount({ isCI: true, override: null })).toBe(4);
    expect(resolveDefaultShardCount({ isCI: false, override: null })).toBe(1);
  });

  it("honors an explicit shard count above 1", () => {
    expect(resolveDefaultShardCount({ isCI: false, override: 6 })).toBe(6);
    expect(resolveDefaultShardCount({ isCI: true, override: 1 })).toBe(4);
  });
});
