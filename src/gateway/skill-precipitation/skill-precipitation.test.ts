import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSkillAutoEvolutionEnabled } from "../evolution-governance/skill-auto-evolution.js";
import { renderSkillMarkdown } from "../skill-execution-binding/materialize.js";

const { CONFIG_DIR } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require("node:os") as typeof import("node:os");
  return {
    CONFIG_DIR: nodePath.join(
      nodeOs.tmpdir(),
      `openbot-skill-precipitation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ),
  };
});

vi.mock("../../utils.js", () => ({ CONFIG_DIR }));

const {
  detectPrecipitationCandidate,
  extractSkillDraftFromCandidate,
  persistPrecipitationDraft,
  precipitationSignature,
  stripEphemeralFromText,
} = await import("./index.js");
const { getSkillRuntimeDefinitionForBinding, resetSkillHealthWindowsCacheForTests } =
  await import("../skill-lifecycle-store.js");

describe("skill precipitation pipeline", () => {
  beforeEach(async () => {
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  });

  afterEach(async () => {
    resetSkillHealthWindowsCacheForTests();
    await fs.rm(CONFIG_DIR, { recursive: true, force: true });
  });

  it("multi-step success trajectory yields when/steps/redLines and strips ephemeral", () => {
    const tipSha = "d0a5336f10ac4d4ead7319c130e852a9a03f1bcc";
    const detected = detectPrecipitationCandidate({
      whenToUse: `Use when running dual-track PRODUCTION_GO DIGEST for tip ${tipSha}`,
      nameHint: "Dual-track Path B cutover",
      steps: [
        {
          instruction: `Pin tip >= ${tipSha}; copy mac-oneshot under /workspace/hk-cutover-abc123/`,
          tools: ["shell"],
        },
        {
          instruction: "Build linux/amd64 image then Path B recreate LIVE",
          tools: ["docker", "ssh"],
        },
        {
          instruction: "Ensure LIVE openbot.json has tools.exec.host=sandbox",
          tools: ["ssh"],
        },
        {
          instruction: "Write releases.jsonl ledger and send OHBE before merge",
          tools: ["gh"],
        },
      ],
      redLines: [
        "No PROMOTE / public DNS without OHBE PASS",
        `Never set DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED on ${tipSha}`,
      ],
      acceptance: ["build-info.commit matches tip", "healthz/readyz OK"],
      failureModes: ["gateway crash-loop if exec.host=node"],
      toolsUsed: ["shell", "docker", "ssh", "gh"],
      succeeded: true,
      sourceEvidenceRefs: ["run:cutover-1", "proposal:gap-1"],
      knownEphemeralParams: ["tipSha", "evidenceDir"],
    });

    expect(detected.kind).toBe("candidate");
    if (detected.kind !== "candidate") {
      return;
    }
    const candidate = detected.candidate;
    expect(candidate.whenToUse).not.toContain(tipSha);
    expect(candidate.whenToUse.toLowerCase()).toContain("dual-track");
    expect(candidate.steps.length).toBeGreaterThanOrEqual(3);
    expect(candidate.steps[0]?.instruction).not.toContain(tipSha);
    expect(candidate.steps[0]?.instruction).not.toContain("/workspace/hk-cutover-abc123");
    expect(candidate.redLines.length).toBeGreaterThanOrEqual(1);
    expect(candidate.redLines.join(" ")).not.toContain(tipSha);
    expect(candidate.sourceEvidenceRefs).toEqual(
      expect.arrayContaining(["run:cutover-1", "proposal:gap-1"]),
    );
    expect(candidate.confidence).toBeGreaterThanOrEqual(0.7);
    expect(candidate.completeness).toBe("full");
    expect(candidate.ephemeralParams.length).toBeGreaterThan(0);
  });

  it("missing evidence refs skips without writing an asset", async () => {
    const detected = detectPrecipitationCandidate({
      whenToUse: "Weekly report recipe",
      steps: ["Gather metrics", "Draft summary", "Send to channel"],
      redLines: ["Do not invent numbers"],
      succeeded: true,
      sourceEvidenceRefs: [],
    });
    expect(detected.kind).toBe("skip");
    if (detected.kind === "skip") {
      expect(detected.reason).toBe("missing_source_evidence_refs");
    }

    const persisted = persistPrecipitationDraft({
      trajectory: {
        whenToUse: "Weekly report recipe",
        steps: ["a", "b", "c"],
        succeeded: true,
        sourceEvidenceRefs: [],
      },
      sourceAgentId: "bot-precip",
    });
    expect(persisted.kind).toBe("skipped");
  });

  it("low confidence trajectory does not persist a draft", () => {
    const persisted = persistPrecipitationDraft({
      trajectory: {
        whenToUse: "vague",
        steps: [],
        succeeded: false,
        sourceEvidenceRefs: ["ev-1"],
      },
      sourceAgentId: "bot-precip",
    });
    expect(persisted.kind).toBe("skipped");
    if (persisted.kind === "skipped") {
      expect(persisted.reason).toMatch(/confidence|insufficient|missing/i);
    }
  });

  it("persist writes draft with materializable steps and autoInstallEnabled=false", () => {
    const first = persistPrecipitationDraft({
      trajectory: {
        whenToUse: "Use when cutting over dual-track Path B after PRODUCTION_GO DIGEST",
        nameHint: "Path B cutover recipe",
        steps: [
          "Pin tip SHA and update oneshot templates",
          "Build amd64 image and recreate LIVE Path B",
          "Verify sandbox exec.host and health endpoints",
          "Write ledger entry and OHBE before merge",
        ],
        redLines: ["No self-merge without OHBE PASS", "Do not enable auto failover"],
        acceptance: ["LIVE healthz OK", "ledger seq+1"],
        toolsUsed: ["shell", "ssh", "gh"],
        succeeded: true,
        sourceEvidenceRefs: ["run:rich-1"],
      },
      sourceAgentId: "bot-precip",
      ownerUserId: "user-precip",
    });
    expect(first.kind).toBe("created");
    if (first.kind !== "created") {
      return;
    }

    const binding = getSkillRuntimeDefinitionForBinding(first.skillId);
    expect(binding.lifecycle).toBe("draft");
    expect(binding.runtimeDefinition.prompts.join("\n")).toMatch(/Pipeline|1\./);
    expect(binding.runtimeDefinition.prompts.join("\n")).toMatch(/Red lines/i);
    const md = renderSkillMarkdown({
      skillId: first.skillId,
      installedVersion: binding.version,
      profile: binding.profile,
      runtimeDefinition: binding.runtimeDefinition,
    });
    expect(md).toMatch(/Pin tip SHA|Build amd64|Verify sandbox|Write ledger/i);
    expect(md).toMatch(/Red lines|No self-merge/i);

    // Dedupe: second identical signature must reuse, not create a third asset.
    const second = persistPrecipitationDraft({
      trajectory: {
        whenToUse: "Use when cutting over dual-track Path B after PRODUCTION_GO DIGEST",
        nameHint: "Path B cutover recipe",
        steps: [
          "Pin tip SHA and update oneshot templates",
          "Build amd64 image and recreate LIVE Path B",
          "Verify sandbox exec.host and health endpoints",
          "Write ledger entry and OHBE before merge",
        ],
        redLines: ["No self-merge without OHBE PASS", "Do not enable auto failover"],
        acceptance: ["LIVE healthz OK", "ledger seq+1"],
        toolsUsed: ["shell", "ssh", "gh"],
        succeeded: true,
        sourceEvidenceRefs: ["run:rich-2"],
      },
      sourceAgentId: "bot-precip",
      ownerUserId: "user-precip",
    });
    expect(second.kind).toBe("reused");
    if (second.kind === "reused") {
      expect(second.skillId).toBe(first.skillId);
      expect(second.signature).toBe(precipitationSignature(first.candidate));
    }
  });

  it("extract marks partial when red lines missing", () => {
    const detected = detectPrecipitationCandidate({
      whenToUse: "Use when exporting weekly CSV reports",
      steps: ["Collect rows", "Normalize columns", "Upload artifact"],
      succeeded: true,
      sourceEvidenceRefs: ["run:partial-1"],
      toolsUsed: ["notes", "fs"],
    });
    expect(detected.kind).toBe("candidate");
    if (detected.kind !== "candidate") {
      return;
    }
    expect(detected.candidate.completeness).toBe("partial");
    const extracted = extractSkillDraftFromCandidate(detected.candidate);
    const hints = extracted.runtimeDefinition.routingHints as {
      precipitation?: { completeness?: string };
    };
    expect(hints.precipitation?.completeness).toBe("partial");
    expect(extracted.employeeHint).toContain("可复用的能力");
  });

  it("stripEphemeral replaces tip SHA and workspace paths", () => {
    const stripped = stripEphemeralFromText(
      "Pin d0a5336f10 then write /workspace/hk-cutover-abcd/evidence.md on 2026-10-13",
    );
    expect(stripped).not.toMatch(/d0a5336f10/);
    expect(stripped).not.toMatch(/\/workspace\/hk-cutover/);
    expect(stripped).not.toMatch(/2026-10-13/);
  });

  it("fail-closed: skill auto-evolution stays off by default", () => {
    const prev = process.env.OPENBOT_SKILL_AUTO_EVOLUTION;
    delete process.env.OPENBOT_SKILL_AUTO_EVOLUTION;
    try {
      expect(isSkillAutoEvolutionEnabled()).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env.OPENBOT_SKILL_AUTO_EVOLUTION;
      } else {
        process.env.OPENBOT_SKILL_AUTO_EVOLUTION = prev;
      }
    }
  });
});
