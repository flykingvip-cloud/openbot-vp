import { describe, expect, it } from "vitest";
import {
  buildAuditReport,
  buildStagePlan,
  classifyWithRegistry,
  deriveRules,
  findRiskyMix,
  summarizeByRule,
  unmatchedEntries,
} from "../../loom/audit.js";
import type { StatusEntry } from "../../loom/glob.js";
import { policyForLegacyRule } from "../../loom/policy-map.js";
import { type Registry, validateRegistry } from "../../loom/registry.js";

function registryOf(
  streams: Array<{
    id: string;
    paths: string[];
    landingPolicy?: "parallel" | "serial" | "exclusive" | "manual";
    canLandWith?: string[];
  }>,
): Registry {
  return validateRegistry({
    version: 1,
    tasks: [],
    landingStreams: streams,
  });
}

const entry = (xy: string, path: string): StatusEntry => ({ xy, path });

describe("loom/audit — deriveRules", () => {
  it("derives one rule per landing stream carrying policy + canLandWith", () => {
    const registry = registryOf([
      { id: "docs", paths: ["docs/**"], landingPolicy: "parallel" },
      {
        id: "migration",
        paths: ["migration/**"],
        landingPolicy: "exclusive",
        canLandWith: ["docs"],
      },
    ]);
    const rules = deriveRules(registry);
    expect(rules.map((r) => r.streamId)).toEqual(["docs", "migration"]);
    expect(rules[0].landingPolicy).toBe("parallel");
    expect(rules[1].landingPolicy).toBe("exclusive");
    expect(rules[1].canLandWith).toEqual(["docs"]);
  });
});

describe("loom/audit — classify (first match wins, stream order)", () => {
  it("assigns each path to the first matching stream in registry order", () => {
    const registry = registryOf([
      { id: "shared", paths: ["ui/src/shared/**"] },
      { id: "ui", paths: ["ui/src/**"] },
    ]);
    const classified = classifyWithRegistry(registry, [
      entry(" M", "ui/src/shared/model.ts"),
      entry(" M", "ui/src/app.ts"),
    ]);
    expect(classified[0].rule?.streamId).toBe("shared");
    expect(classified[1].rule?.streamId).toBe("ui");
  });

  it("leaves unmatched entries with a null rule", () => {
    const registry = registryOf([{ id: "ui", paths: ["ui/src/**"] }]);
    const classified = classifyWithRegistry(registry, [
      entry(" M", "ui/src/app.ts"),
      entry("??", "weird/path.ts"),
    ]);
    expect(unmatchedEntries(classified).map((e) => e.path)).toEqual(["weird/path.ts"]);
  });

  it("carries through the status kind", () => {
    const registry = registryOf([{ id: "ui", paths: ["ui/src/**"] }]);
    const classified = classifyWithRegistry(registry, [entry("A ", "ui/src/new.ts")]);
    expect(classified[0].kind).toBe("added");
  });
});

describe("loom/policy-map — legacy equivalence", () => {
  it("maps dispositions to generic policies", () => {
    expect(policyForLegacyRule("OPSD", "MERGE")).toBe("serial");
    expect(policyForLegacyRule("AOR", "ISOLATE")).toBe("exclusive");
    expect(policyForLegacyRule("G", "CLEAN")).toBe("manual");
  });

  it("maps the guardrails group D to parallel regardless of disposition", () => {
    expect(policyForLegacyRule("D", "MERGE")).toBe("parallel");
  });
});

describe("loom/audit — findRiskyMix (generalized legacy semantics)", () => {
  const classify = (streams: Parameters<typeof registryOf>[0], entries: StatusEntry[]) =>
    classifyWithRegistry(registryOf(streams), entries);

  it("returns null when only one stream is active", () => {
    const classified = classify(
      [{ id: "ui", paths: ["ui/**"], landingPolicy: "serial" }],
      [entry(" M", "ui/a.ts"), entry(" M", "ui/b.ts")],
    );
    expect(findRiskyMix(classified)).toBeNull();
  });

  it("returns null for one non-manual primary accompanied by parallel streams", () => {
    const classified = classify(
      [
        { id: "ui", paths: ["ui/**"], landingPolicy: "serial" },
        { id: "guardrails", paths: ["config/**"], landingPolicy: "parallel" },
      ],
      [entry(" M", "ui/a.ts"), entry(" M", "config/x.json")],
    );
    expect(findRiskyMix(classified)).toBeNull();
  });

  it("flags a lone manual stream mixed with anything (must land alone)", () => {
    const classified = classify(
      [
        { id: "generated", paths: ["gen/**"], landingPolicy: "manual" },
        { id: "guardrails", paths: ["config/**"], landingPolicy: "parallel" },
      ],
      [entry(" M", "gen/x.js"), entry(" M", "config/x.json")],
    );
    expect(findRiskyMix(classified)).not.toBeNull();
  });

  it("flags two unrelated primaries", () => {
    const classified = classify(
      [
        { id: "ui", paths: ["ui/**"], landingPolicy: "serial" },
        { id: "auth", paths: ["src/auth/**"], landingPolicy: "serial" },
      ],
      [entry(" M", "ui/a.ts"), entry(" M", "src/auth/login.ts")],
    );
    expect(findRiskyMix(classified)).not.toBeNull();
  });

  it("allows multiple primaries that are mutually canLandWith-linked", () => {
    const classified = classify(
      [
        {
          id: "ui",
          paths: ["ui/**"],
          landingPolicy: "exclusive",
          canLandWith: ["auth"],
        },
        {
          id: "auth",
          paths: ["src/auth/**"],
          landingPolicy: "exclusive",
          canLandWith: ["ui"],
        },
      ],
      [entry(" M", "ui/a.ts"), entry(" M", "src/auth/login.ts")],
    );
    expect(findRiskyMix(classified)).toBeNull();
  });

  it("still flags primaries with only a one-directional canLandWith link", () => {
    const classified = classify(
      [
        {
          id: "ui",
          paths: ["ui/**"],
          landingPolicy: "exclusive",
          canLandWith: ["auth"],
        },
        { id: "auth", paths: ["src/auth/**"], landingPolicy: "exclusive" },
      ],
      [entry(" M", "ui/a.ts"), entry(" M", "src/auth/login.ts")],
    );
    expect(findRiskyMix(classified)).not.toBeNull();
  });
});

describe("loom/audit — output shaping", () => {
  const registry = registryOf([{ id: "ui", paths: ["ui/**"], landingPolicy: "serial" }]);

  it("summarizeByRule groups entries with kind counts", () => {
    const classified = classifyWithRegistry(registry, [
      entry(" M", "ui/a.ts"),
      entry("A ", "ui/b.ts"),
      entry("??", "weird/x.ts"),
    ]);
    const buckets = summarizeByRule(classified);
    const ui = buckets.find((b) => b.streamId === "ui");
    const unmatched = buckets.find((b) => b.streamId === null);
    expect(ui?.kinds).toEqual({ modified: 1, added: 1 });
    expect(unmatched?.entries).toHaveLength(1);
  });

  it("buildStagePlan separates deleted (-u) from add paths and shell-quotes", () => {
    const classified = classifyWithRegistry(registry, [
      entry(" M", "ui/a b.ts"),
      entry(" D", "ui/gone.ts"),
    ]);
    const plan = buildStagePlan(classified);
    expect(plan[0]).toBe("git add -- 'ui/a b.ts'");
    expect(plan[1]).toBe("git add -u -- 'ui/gone.ts'");
  });

  it("buildAuditReport carries totals, unmatched, and riskyMix", () => {
    const classified = classifyWithRegistry(registry, [
      entry(" M", "ui/a.ts"),
      entry("??", "weird/x.ts"),
    ]);
    const report = buildAuditReport(classified);
    expect(report.total).toBe(2);
    expect(report.unmatched).toBe(1);
    expect(report.riskyMix).toBeNull();
    expect(unmatchedEntries(classified)).toHaveLength(1);
  });
});
