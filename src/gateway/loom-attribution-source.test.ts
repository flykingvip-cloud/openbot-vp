import { describe, expect, it } from "vitest";
import type { ToolRequest } from "../fabric/contract.js";
import { loadLoomAttributionSource, loomGlobToRegExp } from "./loom-attribution-source.js";

const REGISTRY = `
version: 1
tasks:
  - id: openbot-fabric
    owner: kiro-fabric
    paths:
      - src/fabric/**
      - src/gateway/server-methods/fabric.*
    metadata:
      spec: openbot-fabric
  - id: model-entitlement
    owner: kiro-me
    paths:
      - src/gateway/model-entitlement/**
landingStreams: []
`;

function reqWith(input: { cwd?: string; args?: string[] }): ToolRequest {
  return {
    id: "r1",
    source: { type: "cursor" },
    tool: { name: "exec" },
    input,
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
}

describe("loomGlobToRegExp", () => {
  it("matches ** across path segments", () => {
    expect(loomGlobToRegExp("src/fabric/**").test("src/fabric/probes.ts")).toBe(true);
    expect(loomGlobToRegExp("src/fabric/**").test("src/fabric/graph/state.ts")).toBe(true);
    expect(loomGlobToRegExp("src/fabric/**").test("src/agents/x.ts")).toBe(false);
  });

  it("treats * as a single-segment wildcard", () => {
    const re = loomGlobToRegExp("src/gateway/server-methods/fabric.*");
    expect(re.test("src/gateway/server-methods/fabric.ts")).toBe(true);
    expect(re.test("src/gateway/server-methods/fabric.test.ts")).toBe(true);
    expect(re.test("src/gateway/server-methods/other.ts")).toBe(false);
  });
});

describe("loadLoomAttributionSource", () => {
  it("returns null when registry text yields no tasks", () => {
    expect(loadLoomAttributionSource({ registryText: "version: 1\ntasks: []\n" })).toBeNull();
  });

  it("returns null when no registry file is present (production install)", () => {
    // A temp dir with no .loom/registry.yaml.
    expect(loadLoomAttributionSource({ cwd: "/nonexistent-repo-root-xyz" })).toBeNull();
  });

  it("attributes a cwd under a task's path glob to that owner", () => {
    const src = loadLoomAttributionSource({ cwd: "/repo", registryText: REGISTRY })!;
    const attr = src.attributionFor(reqWith({ cwd: "/repo/src/fabric" }));
    expect(attr).toEqual({
      owner: "kiro-fabric",
      taskId: "openbot-fabric",
      matchedRules: ["loom:openbot-fabric"],
    });
  });

  it("attributes a path-like arg to its owner", () => {
    const src = loadLoomAttributionSource({ cwd: "/repo", registryText: REGISTRY })!;
    const attr = src.attributionFor(
      reqWith({ cwd: "/repo", args: ["cat", "src/gateway/model-entitlement/x.ts"] }),
    );
    expect(attr?.owner).toBe("kiro-me");
  });

  it("flags conflict when paths of two owners both match", () => {
    const src = loadLoomAttributionSource({ cwd: "/repo", registryText: REGISTRY })!;
    const attr = src.attributionFor(
      reqWith({ args: ["src/fabric/probes.ts", "src/gateway/model-entitlement/y.ts"] }),
    );
    expect(attr?.conflict).toBe(true);
    expect(attr?.owner).toBeUndefined();
  });

  it("marks unattributed when a candidate path matches no task", () => {
    const src = loadLoomAttributionSource({ cwd: "/repo", registryText: REGISTRY })!;
    const attr = src.attributionFor(reqWith({ cwd: "/repo/src/unowned" }));
    expect(attr).toEqual({ unattributed: true });
  });

  it("returns undefined when there are no path candidates (no signal)", () => {
    const src = loadLoomAttributionSource({ cwd: "/repo", registryText: REGISTRY })!;
    expect(src.attributionFor(reqWith({ args: ["status"] }))).toBeUndefined();
  });

  it("ignores paths outside the repo root", () => {
    const src = loadLoomAttributionSource({ cwd: "/repo", registryText: REGISTRY })!;
    expect(src.attributionFor(reqWith({ cwd: "/etc" }))).toBeUndefined();
  });
});
