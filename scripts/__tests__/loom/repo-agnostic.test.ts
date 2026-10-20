import { describe, expect, it } from "vitest";
import { attribute, verdictOf } from "../../loom/attribution.js";
import { classifyWithRegistry, findRiskyMix } from "../../loom/audit.js";
import type { StatusEntry } from "../../loom/glob.js";
import { type Registry, validateRegistry } from "../../loom/registry.js";
import { buildStatus } from "../../loom/status.js";

/**
 * Requirement 7.1 / 7.2: the Loom core (registry / glob / attribution / audit /
 * status / lifecycle / register / derive / lint) must be repo-agnostic — no
 * OpenBot-specific paths baked in. This exercises the core against an invented
 * project layout with zero OpenBot conventions.
 */
const entry = (path: string): StatusEntry => ({ xy: " M", path });

function fictionalRegistry(): Registry {
  return validateRegistry({
    version: 1,
    tasks: [
      { id: "frontend", owner: "alice", paths: ["app/web/**"], state: "active", sessions: [] },
      { id: "backend", owner: "bob", paths: ["server/**"], state: "active", sessions: [] },
    ],
    landingStreams: [
      { id: "web", paths: ["app/web/**"], landingPolicy: "serial" },
      { id: "db", paths: ["server/migrations/**"], landingPolicy: "manual" },
      { id: "docs", paths: ["handbook/**"], landingPolicy: "parallel" },
    ],
  });
}

describe("loom core — repo-agnostic (no OpenBot paths)", () => {
  it("attributes files in an invented layout", () => {
    const registry = fictionalRegistry();
    const results = attribute(registry, [
      entry("app/web/login.tsx"),
      entry("server/api.go"),
      entry("unknown/thing.rb"),
    ]);
    expect(verdictOf(results[0])).toBe("ATTRIBUTED");
    expect(results[0].owners[0].owner).toBe("alice");
    expect(verdictOf(results[1])).toBe("ATTRIBUTED");
    expect(results[1].owners[0].owner).toBe("bob");
    expect(verdictOf(results[2])).toBe("UNATTRIBUTED");
  });

  it("classifies + risk-checks landing streams in an invented layout", () => {
    const registry = fictionalRegistry();
    // one serial primary (web) + one parallel (docs) → not risky
    const ok = classifyWithRegistry(registry, [
      entry("app/web/login.tsx"),
      entry("handbook/intro.md"),
    ]);
    expect(findRiskyMix(ok)).toBeNull();
    // a lone manual stream (db) mixed with web → risky (manual must land alone)
    const risky = classifyWithRegistry(registry, [
      entry("server/migrations/001.sql"),
      entry("app/web/login.tsx"),
    ]);
    expect(findRiskyMix(risky)).not.toBeNull();
  });

  it("builds a status view without any OpenBot assumptions", () => {
    const view = buildStatus(fictionalRegistry());
    expect(view.totals.tasks).toBe(2);
    expect(view.tasks.map((t) => t.owner).toSorted()).toEqual(["alice", "bob"]);
  });
});
