import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureShadowRecordForTest,
  resetShadowRecordForTest,
} from "../../../../packages/toolkit/src/execution-router/index.js";
import {
  configureExecutionRouterObservationForTest,
  executionRouterObservationSize,
  observeChatInboundStage,
  peekExecutionRouterObservation,
  resetExecutionRouterObservationForTest,
  type ChatRunObservation,
} from "../../../gateway/execution-router-observation.js";
import type { SkillEntry } from "../../skills.js";
import { applyEmbeddedCustomToolPolicy } from "../tool-split.js";
import {
  countInjectedSkillsFromPrompt,
  measureExposedToolSchemaChars,
  measureSkillBaseline,
  measureToolBaseline,
  observeAttemptSkillPreparation,
  observeAttemptSystemPromptReady,
  observeAttemptToolPreparation,
  resolveEligibleSkillCount,
  stableSchemaStringify,
  usedSkillsSnapshotPrompt,
  wrapCreateToolsForObservation,
  type NamedToolSchema,
} from "./execution-router-baselines.js";
import type { ClientToolDefinition } from "./params.js";
import { resolveEmbeddedAttemptToolsRaw } from "./resolve-embedded-tools.js";

afterEach(() => {
  resetExecutionRouterObservationForTest();
  resetShadowRecordForTest();
  vi.unstubAllEnvs();
});

function officialSkillPrompt(names: string[], extraNote = ""): string {
  const blocks = names.map(
    (name) =>
      `<skill>\n<name>${name}</name>\n<description>Official ${name} skill.</description>\n</skill>`,
  );
  return [extraNote, ...blocks].filter(Boolean).join("\n");
}

function skillEntry(name: string): SkillEntry {
  return {
    skill: {
      name,
      description: `${name} description`,
      filePath: `/tmp/skills/${name}/SKILL.md`,
      baseDir: `/tmp/skills/${name}`,
      sourceInfo: {
        path: `/tmp/skills/${name}/SKILL.md`,
        source: "test",
        scope: "project",
        origin: "top-level",
      },
      disableModelInvocation: false,
    },
    frontmatter: {},
    metadata: { always: true },
    invocation: { userInvocable: true, disableModelInvocation: false },
  };
}

function serverTool(name: string, parameters: Record<string, unknown>): AgentTool {
  return {
    name,
    label: name,
    description: `${name} tool`,
    parameters,
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
  } as unknown as AgentTool;
}

function clientTool(name: string, parameters: Record<string, unknown>): ClientToolDefinition {
  return {
    type: "function",
    function: { name, description: `${name} client`, parameters },
  };
}

function asFiltered(tool: AgentTool): NamedToolSchema {
  return { name: tool.name, parameters: tool.parameters };
}

function asClientFiltered(tool: ClientToolDefinition): NamedToolSchema {
  return { name: tool.function.name, parameters: tool.function.parameters };
}

const attemptSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "attempt.ts"),
  "utf8",
);

describe("Skill baseline from the already-built prompt", () => {
  it("takes promptChars from the final skillsPrompt and injectedCount from official skill blocks", () => {
    const skillsPrompt = officialSkillPrompt(["weather", "search"]);
    const baseline = measureSkillBaseline({ skillsPrompt, eligibleCount: 4 });
    expect(baseline.eligibleCount).toBe(4);
    expect(baseline.injectedCount).toBe(2);
    expect(baseline.promptChars).toBe(skillsPrompt.length);
    expect(baseline.eligibleCount).toBeGreaterThanOrEqual(baseline.injectedCount);
    expect(JSON.stringify(baseline)).not.toContain("Official weather skill");
    expect(JSON.stringify(baseline)).not.toContain("SKILL.md");
  });

  it("does not treat char-budget truncation notes as extra injected skills", () => {
    const truncationNote =
      "⚠️ Skills truncated: included 1 of 6. Run `openbot skills check` to audit.";
    const skillsPrompt = officialSkillPrompt(["only-kept"], truncationNote);
    const baseline = measureSkillBaseline({ skillsPrompt, eligibleCount: 6 });
    expect(baseline.injectedCount).toBe(1);
    expect(baseline.eligibleCount).toBe(6);
    expect(baseline.promptChars).toBe(skillsPrompt.length);
    expect(baseline.promptChars).toBeGreaterThan(countInjectedSkillsFromPrompt(skillsPrompt));
  });

  it("returns 0 for an empty Skill prompt", () => {
    expect(measureSkillBaseline({ skillsPrompt: "", eligibleCount: 0 })).toEqual({
      eligibleCount: 0,
      injectedCount: 0,
      promptChars: 0,
    });
  });

  it("uses snapshot.skills.length when the run reused the snapshot prompt", () => {
    expect(
      usedSkillsSnapshotPrompt({
        preferLiveEntries: false,
        snapshot: { prompt: officialSkillPrompt(["a"]), skills: [{ name: "a" }, { name: "b" }] },
      }),
    ).toBe(true);
    expect(
      resolveEligibleSkillCount({
        usedSnapshotPrompt: true,
        snapshot: { prompt: officialSkillPrompt(["a"]), skills: [{ name: "a" }, { name: "b" }] },
        liveEntries: [skillEntry("ignored")],
      }),
    ).toBe(2);
  });

  it("counts already-loaded live entries after workspace eligibility, without rescanning", () => {
    const liveEntries = [skillEntry("weather"), skillEntry("search")];
    expect(
      resolveEligibleSkillCount({
        usedSnapshotPrompt: false,
        liveEntries,
      }),
    ).toBe(2);
  });
});

describe("Tool baseline domains and schemaChars", () => {
  const readSchema = serverTool("read", {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  });
  const writeSchema = serverTool("write", {
    type: "object",
    properties: { path: { type: "string" }, text: { type: "string" } },
  });
  const hosted = clientTool("browser_open", {
    type: "object",
    properties: { url: { type: "string" } },
  });

  it("keeps constructedCount as server-tool construction only; client tools join exposedCount after policy", () => {
    const constructed = [readSchema, writeSchema];
    const createTools = vi.fn(() => constructed);
    const afterPolicy = resolveEmbeddedAttemptToolsRaw({
      createTools,
    });
    const exposed = [afterPolicy[0]];
    const filteredCustomTools = [asFiltered(exposed[0]), asClientFiltered(hosted)];
    const baseline = measureToolBaseline({
      constructedCount: constructed.length,
      afterPolicyCount: afterPolicy.length,
      exposedAllowlist: ["read", "browser_open"],
      filteredCustomTools,
    });
    expect(createTools).toHaveBeenCalledTimes(1);
    expect(baseline.constructedCount).toBe(2);
    expect(baseline.afterPolicyCount).toBe(2);
    expect(baseline.constructedCount).toBeGreaterThanOrEqual(baseline.afterPolicyCount);
    expect(baseline.exposedCount).toBe(2);
    expect(baseline.schemaChars).toBeGreaterThan(0);
    expect(JSON.stringify(baseline)).not.toContain("browser_open");
    expect(JSON.stringify(baseline)).not.toContain('"url"');
    expect(JSON.stringify(baseline)).not.toContain("parameters");
  });

  it("records constructedCount=0 when createTools is never invoked", () => {
    const createTools = vi.fn(() => [readSchema, writeSchema]);
    const afterPolicy = resolveEmbeddedAttemptToolsRaw({
      disableTools: true,
      createTools,
    });
    const baseline = measureToolBaseline({
      constructedCount: 0,
      afterPolicyCount: afterPolicy.length,
      exposedAllowlist: [],
      filteredCustomTools: [],
    });
    expect(createTools).not.toHaveBeenCalled();
    expect(baseline.constructedCount).toBe(0);
    expect(baseline.afterPolicyCount).toBe(0);
    expect(baseline.exposedCount).toBe(0);
  });

  it("counts after-policy server tools separately from later client-tool exposure", () => {
    const baseline = measureToolBaseline({
      constructedCount: 2,
      afterPolicyCount: 1,
      exposedAllowlist: ["read", "browser_open"],
      filteredCustomTools: [asFiltered(readSchema), asClientFiltered(hosted)],
    });
    expect(baseline.constructedCount).toBe(2);
    expect(baseline.afterPolicyCount).toBe(1);
    expect(baseline.exposedCount).toBe(2);
    expect(baseline.constructedCount).toBeGreaterThanOrEqual(baseline.afterPolicyCount);
  });

  it("does not count client tools in constructedCount when createTools never saw them", () => {
    const baseline = measureToolBaseline({
      constructedCount: 1,
      afterPolicyCount: 1,
      exposedAllowlist: ["read", "browser_open", "browser_click"],
      filteredCustomTools: [
        asFiltered(readSchema),
        asClientFiltered(hosted),
        asClientFiltered(clientTool("browser_click", { type: "object" })),
      ],
    });
    expect(baseline.constructedCount).toBe(1);
    expect(baseline.exposedCount).toBe(3);
  });

  it("produces deterministic schemaChars regardless of object key order", () => {
    const first = serverTool("search", {
      required: ["q"],
      type: "object",
      properties: { q: { type: "string" }, limit: { type: "number" } },
    });
    const second = serverTool("search", {
      properties: { limit: { type: "number" }, q: { type: "string" } },
      type: "object",
      required: ["q"],
    });
    const hostedSchema = asClientFiltered(hosted);
    expect(
      measureExposedToolSchemaChars({
        exposedAllowlist: ["search", "browser_open"],
        filteredCustomTools: [asFiltered(first), hostedSchema],
      }),
    ).toBe(
      measureExposedToolSchemaChars({
        exposedAllowlist: ["search", "browser_open"],
        filteredCustomTools: [asFiltered(second), hostedSchema],
      }),
    );
    expect(stableSchemaStringify({ b: 1, a: 2 })).toBe(stableSchemaStringify({ a: 2, b: 1 }));
  });

  it("omits function implementations from schemaChars", () => {
    const encoded = stableSchemaStringify({
      name: "read",
      parameters: { type: "object" },
      execute: () => "secret-impl",
    });
    expect(encoded).not.toContain("secret-impl");
    expect(encoded).not.toContain("execute");
  });

  it("degrades schemaChars to 0 when serialization throws, without losing counts", () => {
    const boomSchema: NamedToolSchema = {
      name: "boom",
      get parameters() {
        throw new Error("cannot serialize schema");
      },
    };
    const baseline = measureToolBaseline({
      constructedCount: 3,
      afterPolicyCount: 2,
      exposedAllowlist: ["boom"],
      filteredCustomTools: [boomSchema],
    });
    expect(baseline.constructedCount).toBe(3);
    expect(baseline.afterPolicyCount).toBe(2);
    expect(baseline.exposedCount).toBe(1);
    expect(baseline.schemaChars).toBe(0);
  });
});

describe("observation flag and attempt hooks", () => {
  it("does not wrap createTools or create observer state when the flag is off", () => {
    const constructed = [serverTool("read", { type: "object" })];
    const original = () => constructed;
    const wrapped = wrapCreateToolsForObservation(original);
    expect(wrapped.createTools).toBe(original);
    expect(wrapped.readConstructedCount()).toBe(0);
    expect(wrapped.createTools()).toBe(constructed);

    observeAttemptSkillPreparation({
      runId: "run-off",
      skillsPrompt: officialSkillPrompt(["weather"]),
      liveEntries: [skillEntry("weather")],
    });
    observeAttemptToolPreparation({
      runId: "run-off",
      constructedCount: 1,
      afterPolicyCount: 1,
      exposedAllowlist: ["read"],
      filteredCustomTools: [asFiltered(serverTool("read", { type: "object" }))],
    });
    observeAttemptSystemPromptReady({ runId: "run-off" });
    expect(executionRouterObservationSize()).toBe(0);
    expect(peekExecutionRouterObservation("run-off")).toBeNull();
  });

  it("records Skill/Tool baselines from real prompt and tool definitions into the same runId", () => {
    const delivered: ChatRunObservation[] = [];
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => 9_000,
      sink: (observation) => delivered.push(observation),
    });
    const skillsPrompt = officialSkillPrompt(["weather", "search"]);
    const tools = [
      serverTool("read", { type: "object", properties: { path: { type: "string" } } }),
    ];
    observeAttemptSkillPreparation({
      runId: "run-b2",
      sessionKey: "agent:main:demo",
      skillsPrompt,
      liveEntries: [skillEntry("weather"), skillEntry("search"), skillEntry("unused")],
    });
    observeAttemptToolPreparation({
      runId: "run-b2",
      constructedCount: 4,
      afterPolicyCount: 1,
      exposedAllowlist: ["read", "browser_open"],
      filteredCustomTools: [
        asFiltered(tools[0]),
        asClientFiltered(clientTool("browser_open", { type: "object" })),
      ],
    });
    observeAttemptSystemPromptReady({ runId: "run-b2" });

    const snap = peekExecutionRouterObservation("run-b2");
    expect(snap?.skillBaseline).toEqual({
      eligibleCount: 3,
      injectedCount: 2,
      promptChars: skillsPrompt.length,
    });
    expect(snap?.toolBaseline?.constructedCount).toBe(4);
    expect(snap?.toolBaseline?.afterPolicyCount).toBe(1);
    expect(snap?.toolBaseline?.exposedCount).toBe(2);
    expect(snap?.toolBaseline?.schemaChars).toBeGreaterThan(0);
    expect(snap?.stages.skill_snapshot_ready).toBe(9_000);
    expect(snap?.stages.tool_set_ready).toBe(9_000);
    expect(snap?.stages.system_prompt_ready).toBe(9_000);
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("Official weather skill");
    expect(serialized).not.toContain("agent:main:demo");
    expect(serialized).not.toContain("sk-user-secret");
    expect(serialized).not.toMatch(/"parameters"/);
    expect(serialized).not.toContain("browser_open");

    observeChatInboundStage({ runId: "run-b2", stage: "assistant_persisted" });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.skillBaseline?.injectedCount).toBe(2);
    expect(delivered[0]?.toolBaseline?.exposedCount).toBe(2);
    expect(executionRouterObservationSize()).toBe(0);
  });

  it("swallows observation failures so tool and prompt construction stay unchanged", () => {
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => {
        throw new Error("clock boom");
      },
    });
    const constructed = [serverTool("read", { type: "object" })];
    expect(() =>
      observeAttemptSkillPreparation({
        runId: "run-throw",
        skillsPrompt: officialSkillPrompt(["weather"]),
        liveEntries: [skillEntry("weather")],
      }),
    ).not.toThrow();
    expect(() =>
      observeAttemptToolPreparation({
        runId: "run-throw",
        constructedCount: constructed.length,
        afterPolicyCount: constructed.length,
        exposedAllowlist: ["read"],
        filteredCustomTools: [asFiltered(constructed[0])],
      }),
    ).not.toThrow();
    expect(() => observeAttemptSystemPromptReady({ runId: "run-throw" })).not.toThrow();
    expect(constructed[0]?.name).toBe("read");
  });

  it("returns the same constructed tool array when observation wrapping is on", () => {
    configureExecutionRouterObservationForTest({ enabled: true });
    const constructed = [serverTool("read", { type: "object" })];
    const createTools = () => constructed;
    const wrapped = wrapCreateToolsForObservation(createTools);
    expect(wrapped.createTools()).toBe(constructed);
    expect(wrapped.readConstructedCount()).toBe(1);
  });
});

describe("B2.1 final allowlist and schema boundary", () => {
  const readSchema = {
    name: "read",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  };
  const writeSchema = {
    name: "write",
    parameters: { type: "object", properties: { text: { type: "string" } } },
  };
  const hostedSchema = {
    name: "browser_open",
    parameters: { type: "object", properties: { url: { type: "string" } } },
  };
  const clientReadSchema = {
    name: "read",
    parameters: { type: "object", properties: { url: { type: "string" } } },
  };

  it("does not count a client tool rejected by skillPolicy in exposedCount or schemaChars", () => {
    const allCustomTools = [readSchema, hostedSchema];
    const { tools: filteredCustomTools, allowlist } = applyEmbeddedCustomToolPolicy(
      allCustomTools,
      { allow: ["read"], block: [] },
    );
    const baseline = measureToolBaseline({
      constructedCount: 1,
      afterPolicyCount: 1,
      exposedAllowlist: allowlist,
      filteredCustomTools,
    });
    const allowedOnly = measureExposedToolSchemaChars({
      exposedAllowlist: ["read"],
      filteredCustomTools: [readSchema],
    });
    const withRejectedClient = measureExposedToolSchemaChars({
      exposedAllowlist: ["read", "browser_open"],
      filteredCustomTools: allCustomTools,
    });
    expect(allowlist).toEqual(["read"]);
    expect(filteredCustomTools.map((tool) => tool.name)).toEqual(["read"]);
    expect(baseline.exposedCount).toBe(allowlist.length);
    expect(baseline.exposedCount).toBe(1);
    expect(baseline.schemaChars).toBe(allowedOnly);
    expect(baseline.schemaChars).not.toBe(withRejectedClient);
    expect(JSON.stringify(baseline)).not.toContain("browser_open");
    expect(JSON.stringify(baseline)).not.toContain("url");
  });

  it("uses the final allowlist and first actual filtered schema when server and client share a name", () => {
    const allCustomTools = [readSchema, writeSchema, clientReadSchema];
    const { tools: filteredCustomTools, allowlist } = applyEmbeddedCustomToolPolicy(
      allCustomTools,
      { allow: ["read", "write"], block: [] },
    );
    const baseline = measureToolBaseline({
      constructedCount: 2,
      afterPolicyCount: 2,
      exposedAllowlist: allowlist,
      filteredCustomTools,
    });
    const firstWins = measureExposedToolSchemaChars({
      exposedAllowlist: ["read", "write"],
      filteredCustomTools: [readSchema, writeSchema],
    });
    const clientSchemaOnly = measureExposedToolSchemaChars({
      exposedAllowlist: ["read"],
      filteredCustomTools: [clientReadSchema],
    });
    expect(allowlist).toEqual(["read", "write"]);
    expect(filteredCustomTools).toHaveLength(3);
    expect(baseline.exposedCount).toBe(2);
    expect(baseline.schemaChars).toBe(firstWins);
    expect(baseline.schemaChars).not.toBe(clientSchemaOnly);
  });

  it("does not serialize filtered schemas when observation is disabled", () => {
    const filteredCustomTools = [
      {
        name: "read",
        get parameters() {
          throw new Error("must not serialize schema when observation is disabled");
        },
      },
    ];
    expect(() =>
      observeAttemptToolPreparation({
        runId: "run-disabled-schema",
        constructedCount: 1,
        afterPolicyCount: 1,
        exposedAllowlist: ["read"],
        filteredCustomTools,
      }),
    ).not.toThrow();
    expect(executionRouterObservationSize()).toBe(0);
  });

  it("keeps createAgentSession and prompt callable when observation throws", async () => {
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => {
        throw new Error("clock boom");
      },
    });
    const prompt = vi.fn(async (_text: string) => "ok");
    const createAgentSession = vi.fn(async () => ({ session: { prompt } }));
    expect(() =>
      observeAttemptToolPreparation({
        runId: "run-session-safe",
        constructedCount: 1,
        afterPolicyCount: 1,
        exposedAllowlist: ["read"],
        filteredCustomTools: [readSchema],
      }),
    ).not.toThrow();
    expect(() => observeAttemptSystemPromptReady({ runId: "run-session-safe" })).not.toThrow();
    const { session } = await createAgentSession();
    await session.prompt("hello");
    expect(createAgentSession).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith("hello");
  });
});

describe("B2.1 collection sites in attempt.ts", () => {
  it("collects the Tool baseline after applyEmbeddedCustomToolPolicy and before createAgentSession", () => {
    const applyIdx = attemptSource.indexOf("applyEmbeddedCustomToolPolicy(allCustomTools");
    const observeIdx = attemptSource.indexOf("observeAttemptToolPreparation({");
    const sessionIdx = attemptSource.indexOf("createAgentSession({");
    expect(applyIdx).toBeGreaterThan(-1);
    expect(observeIdx).toBeGreaterThan(applyIdx);
    expect(sessionIdx).toBeGreaterThan(observeIdx);
    expect(attemptSource.split("observeAttemptToolPreparation(").length - 1).toBe(1);
  });

  it("records system_prompt_ready after context-engine and hook assembly, immediately before prompt", () => {
    const contextIdx = attemptSource.indexOf("prependSystemPromptAddition({");
    const hookOverrideIdx = attemptSource.indexOf("hookResult?.systemPrompt");
    const hookComposeIdx = attemptSource.indexOf("composeSystemPromptWithHookContext({");
    const observeIdx = attemptSource.indexOf("observeAttemptSystemPromptReady({");
    const promptIdx = attemptSource.indexOf("activeSession.prompt(effectivePrompt");
    expect(contextIdx).toBeGreaterThan(-1);
    expect(hookOverrideIdx).toBeGreaterThan(contextIdx);
    expect(hookComposeIdx).toBeGreaterThan(hookOverrideIdx);
    expect(observeIdx).toBeGreaterThan(hookComposeIdx);
    expect(promptIdx).toBeGreaterThan(observeIdx);
    expect(attemptSource.split("observeAttemptSystemPromptReady(").length - 1).toBe(1);
    expect(attemptSource.indexOf("observeAttemptSystemPromptReady({", observeIdx + 1)).toBe(-1);
  });

  it("records system_prompt_ready only after a hook mutates the system prompt", () => {
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => 4_000,
    });
    let systemPromptText = "base-system";
    expect(peekExecutionRouterObservation("run-hook-ready")).toBeNull();
    const hookOverride = "hook-system-override";
    const prependSystemContext = "hook-prepend";
    const appendSystemContext = "hook-append";
    systemPromptText = hookOverride;
    systemPromptText = [prependSystemContext, systemPromptText, appendSystemContext]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");
    expect(systemPromptText).toContain("hook-system-override");
    expect(systemPromptText).toContain("hook-prepend");
    expect(systemPromptText).toContain("hook-append");
    observeAttemptSystemPromptReady({ runId: "run-hook-ready" });
    expect(peekExecutionRouterObservation("run-hook-ready")?.stages.system_prompt_ready).toBe(
      4_000,
    );
    expect(attemptSource.indexOf("observeAttemptSystemPromptReady({")).toBeGreaterThan(
      attemptSource.indexOf("composeSystemPromptWithHookContext({"),
    );
  });

  it("records system_prompt_ready only after a context-engine addition", () => {
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => 5_000,
    });
    let systemPromptText = "base-system";
    expect(peekExecutionRouterObservation("run-context-ready")).toBeNull();
    const systemPromptAddition = "context-engine-addition";
    systemPromptText = `${systemPromptAddition}\n\n${systemPromptText}`;
    expect(systemPromptText.startsWith("context-engine-addition")).toBe(true);
    observeAttemptSystemPromptReady({ runId: "run-context-ready" });
    expect(peekExecutionRouterObservation("run-context-ready")?.stages.system_prompt_ready).toBe(
      5_000,
    );
    expect(attemptSource.indexOf("observeAttemptSystemPromptReady({")).toBeGreaterThan(
      attemptSource.indexOf("prependSystemPromptAddition({"),
    );
  });

  it("keeps first-write-wins if system_prompt_ready is observed twice", () => {
    let now = 6_000;
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => now,
    });
    observeAttemptSystemPromptReady({ runId: "run-first-write" });
    now = 9_000;
    observeAttemptSystemPromptReady({ runId: "run-first-write" });
    expect(peekExecutionRouterObservation("run-first-write")?.stages.system_prompt_ready).toBe(
      6_000,
    );
  });

  it("wires default-off shadow-record without changing Skill/Tool identity", () => {
    const sink = vi.fn();
    const skillsPrompt = officialSkillPrompt(["clock-kind-lookup"]);
    const allowlist = ["read_clock_kind"] as const;
    const tools = [serverTool("read_clock_kind", { type: "object" })];
    observeAttemptSkillPreparation({
      runId: "run-i2-off",
      skillsPrompt,
      liveEntries: [skillEntry("clock-kind-lookup")],
    });
    observeAttemptToolPreparation({
      runId: "run-i2-off",
      constructedCount: 1,
      afterPolicyCount: 1,
      exposedAllowlist: allowlist,
      filteredCustomTools: tools,
    });
    expect(sink).not.toHaveBeenCalled();
    expect(allowlist).toEqual(["read_clock_kind"]);
    expect(tools[0]?.name).toBe("read_clock_kind");

    configureShadowRecordForTest({ recordEnabled: true, sink });
    observeAttemptSkillPreparation({
      runId: "run-i2-on",
      skillsPrompt,
      liveEntries: [skillEntry("clock-kind-lookup")],
    });
    observeAttemptToolPreparation({
      runId: "run-i2-on",
      constructedCount: 1,
      afterPolicyCount: 1,
      exposedAllowlist: allowlist,
      filteredCustomTools: tools,
    });
    expect(sink).toHaveBeenCalledTimes(1);
    const event = sink.mock.calls[0]?.[0] as { apply?: boolean };
    expect(event.apply).toBe(false);
    expect(JSON.stringify(event)).not.toContain("clock-kind-lookup");
    expect(JSON.stringify(event)).not.toContain("read_clock_kind");
  });
});
