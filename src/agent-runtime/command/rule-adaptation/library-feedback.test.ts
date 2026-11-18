import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../../contracts/rule-adaptation-activation.js";
import { refuseCandidateSubmission } from "./candidate-entry.js";
import {
  loadRuleLibrary,
  ruleLibraryPath,
  runRuleAgentLibraryCycle,
  type RuleLibraryDocument,
  type RuleLibraryWritePermission,
} from "./library-feedback.js";

const dirs: string[] = [];

function sessionFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rule-library-"));
  dirs.push(dir);
  return path.join(dir, "session.jsonl");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function permission(patch: Partial<RuleLibraryWritePermission> = {}): RuleLibraryWritePermission {
  return {
    caller: "rule-agent",
    mode: "dynamic",
    authorized: true,
    bindingCurrent: true,
    cancelled: false,
    collaboration: false,
    ...patch,
  };
}

function cycle(
  file: string,
  message: string,
  patch: Partial<Parameters<typeof runRuleAgentLibraryCycle>[0]> = {},
) {
  return runRuleAgentLibraryCycle({
    permission: permission(),
    sessionFile: file,
    message,
    currentTokens: 32_000,
    ruleVersion: "inventory:test",
    ...patch,
  });
}

it("fills a context-pressure gap and the next decision uses that parameter", () => {
  const file = sessionFile();
  const first = cycle(file, "上下文太大，这段材料放不进窗口");
  expect(first).toMatchObject({
    applied: true,
    wrote: true,
    problem: "gap",
    sceneClass: "context_pressure",
    disposition: "use_parameter",
    effectiveTokens: 24_000,
    revision: 1,
  });
  const second = cycle(file, "context window is still too large");
  expect(second).toMatchObject({
    applied: true,
    wrote: false,
    problem: null,
    effectiveTokens: 24_000,
    revision: 1,
  });
  expect(loadRuleLibrary(file).entries).toEqual([
    expect.objectContaining({
      ruleId: "model.context_window.guard",
      sceneClass: "context_pressure",
      parameter: 24_000,
      problem: "gap",
    }),
  ]);
});

it("prefers an in-bounds shadow tune when filling a gap, then keeps it", () => {
  const file = sessionFile();
  const first = cycle(file, "上下文太大", { shadowProposedTokens: 20_000 });
  expect(first).toMatchObject({ wrote: true, effectiveTokens: 20_000, problem: "gap" });
  const second = cycle(file, "上下文太大", { shadowProposedTokens: 28_000 });
  expect(second).toMatchObject({ wrote: false, effectiveTokens: 20_000, revision: 1 });
});

it("records an inapplicable shrink for an ordinary task and does not reuse a pressure cap", () => {
  const file = sessionFile();
  expect(cycle(file, "上下文太大").effectiveTokens).toBe(24_000);
  const ordinary = cycle(file, "请回复这封短消息");
  expect(ordinary).toMatchObject({
    applied: true,
    wrote: true,
    problem: "inapplicable",
    sceneClass: "ordinary_task",
    disposition: "keep_resolved",
    effectiveTokens: 32_000,
    revision: 2,
  });
  const again = cycle(file, "请再回复一句");
  expect(again).toMatchObject({
    wrote: false,
    problem: null,
    disposition: "keep_resolved",
    effectiveTokens: 32_000,
    revision: 2,
  });
  expect(cycle(file, "上下文太大")).toMatchObject({
    wrote: false,
    effectiveTokens: 24_000,
    revision: 2,
  });
  const library = loadRuleLibrary(file);
  expect(library.entries.map((entry) => entry.sceneClass).toSorted()).toEqual([
    "context_pressure",
    "ordinary_task",
  ]);
});

it("resolves conflicting parameters to the tighter legal cap", () => {
  const file = sessionFile();
  const seeded: RuleLibraryDocument = {
    schema: "rule-library/v1",
    scope: { type: "personal", sessionFile: file },
    revision: 3,
    entries: [
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        sceneClass: "context_pressure",
        problem: "gap",
        disposition: "use_parameter",
        parameter: 28_000,
        sourceVersion: "inventory:test",
        revision: 2,
      },
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        sceneClass: "context_pressure",
        problem: "gap",
        disposition: "use_parameter",
        parameter: 20_000,
        sourceVersion: "inventory:test",
        revision: 3,
      },
    ],
  };
  fs.writeFileSync(ruleLibraryPath(file), `${JSON.stringify(seeded)}\n`);
  const decided = cycle(file, "上下文太大");
  expect(decided).toMatchObject({
    wrote: true,
    problem: "conflict",
    effectiveTokens: 20_000,
    revision: 4,
  });
  expect(loadRuleLibrary(file).entries).toHaveLength(1);
  expect(cycle(file, "上下文太大")).toMatchObject({
    wrote: false,
    effectiveTokens: 20_000,
    revision: 4,
  });
});

it("repairs a parameter outside the hard bounds and the next decision uses the repair", () => {
  const file = sessionFile();
  const seeded: RuleLibraryDocument = {
    schema: "rule-library/v1",
    scope: { type: "personal", sessionFile: file },
    revision: 1,
    entries: [
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        sceneClass: "context_pressure",
        problem: "gap",
        disposition: "use_parameter",
        parameter: 1_000,
        sourceVersion: "inventory:test",
        revision: 1,
      },
    ],
  };
  fs.writeFileSync(ruleLibraryPath(file), `${JSON.stringify(seeded)}\n`);
  expect(cycle(file, "上下文太大")).toMatchObject({
    wrote: true,
    problem: "hole",
    effectiveTokens: 16_000,
    revision: 2,
  });
  expect(cycle(file, "上下文太大")).toMatchObject({
    wrote: false,
    effectiveTokens: 16_000,
    revision: 2,
  });
});

it("does not write when the platform switch is off or the caller is not the rule agent", () => {
  const legacy = sessionFile();
  expect(cycle(legacy, "上下文太大", { permission: permission({ mode: "legacy" }) })).toEqual({
    applied: false,
    wrote: false,
    reason: "legacy_mode",
  });
  expect(fs.existsSync(ruleLibraryPath(legacy))).toBe(false);

  const employee = sessionFile();
  expect(
    cycle(employee, "上下文太大", { permission: permission({ caller: "employee-advice" }) }),
  ).toMatchObject({ applied: false, reason: "caller_not_rule_agent" });
  expect(fs.existsSync(ruleLibraryPath(employee))).toBe(false);
});

it("refuses unauthorized, stale, cancelled, and collaboration writes", () => {
  for (const patch of [
    { authorized: false, reason: "host_unauthorized" },
    { bindingCurrent: false, reason: "stale_or_cancelled" },
    { cancelled: true, reason: "stale_or_cancelled" },
    { collaboration: true, reason: "collaboration_unwired" },
  ] as const) {
    const file = sessionFile();
    const { reason, ...rest } = patch;
    expect(cycle(file, "上下文太大", { permission: permission(rest) })).toMatchObject({
      applied: false,
      wrote: false,
      reason,
    });
    expect(fs.existsSync(ruleLibraryPath(file))).toBe(false);
  }
});

it("keeps one session's library from applying to another session", () => {
  const first = sessionFile();
  const second = sessionFile();
  expect(cycle(first, "上下文太大").effectiveTokens).toBe(24_000);
  expect(loadRuleLibrary(second).revision).toBe(0);
  expect(cycle(second, "上下文太大").revision).toBe(1);
  expect(loadRuleLibrary(first).entries[0]?.parameter).toBe(24_000);
});

it("leaves production activation and the shadow candidate writer closed", () => {
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
  expect(refuseCandidateSubmission({ enablePersist: true }).persisted).toBe(false);
});
