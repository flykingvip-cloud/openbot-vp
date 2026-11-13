import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import type { ShadowHostPorts } from "../../contracts/rule-adaptation-shadow.js";
import { runShadowRuleAdaptation } from "./run.js";
import { createFixtureControlBoard } from "./test-support.js";
import {
  fixtureHost,
  fixtureRequest,
  messageStep,
  proposalOutput,
  scriptedModel,
  toolStep,
  tightenProposal,
} from "./test-support.js";

const PRODUCT_ROOTS = [
  "src/agent-runtime/command/rule-adaptation",
  "src/agent-runtime/model/rule-adaptation",
  "src/agent-runtime/context/rule-adaptation",
  "src/agent-runtime/contracts/rule-adaptation-shadow.ts",
];

const BANNED_IMPORT_SNIPPETS = [
  "agent-runtime/command/task-status.js",
  "agent-runtime/command/current-task-control",
  "agent-runtime/command/amend-active-task",
  "agent-runtime/command/gateway-task-stop",
  "agent-runtime/state/mutations/",
  "agent-runtime/policy/explicit-task-control",
  "commitAutomaticPark",
];

function listProductFiles(target: string): string[] {
  const found: string[] = [];
  const visit = (path: string): void => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        visit(join(path, entry));
      }
      return;
    }
    if (!path.endsWith(".ts")) {
      return;
    }
    const base = path.split("/").pop() ?? "";
    if (base.endsWith(".test.ts") || base === "test-support.ts") {
      return;
    }
    found.push(path);
  };
  visit(target);
  return found;
}

it("does not escalate task control, and product imports plus host ports lack mutators", async () => {
  const { host, board } = fixtureHost();
  const before = board.snapshot();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("searchRules", { query: "contextTokens" }),
      toolStep("createTask", { title: "do it live" }),
      toolStep("activatePolicy", { now: true }),
      messageStep(proposalOutput(tightenProposal(24000))),
    ]),
  });
  expect(result.controlUnchanged).toBe(true);
  expect(result.controlSnapshotBefore).toEqual(before);
  expect(result.controlSnapshotAfter).toEqual(before);
  expect(board.mutations()).toEqual([]);
  expect(result.businessToolsExecuted).toEqual([]);
  expect(result.executionModeOpened).toBe(false);

  // Snapshot equality and empty execution lists are necessary but not
  // independent proof. Also check product sources and injected port shapes.
  const files = PRODUCT_ROOTS.flatMap((root) => listProductFiles(root));
  expect(files.length).toBeGreaterThan(8);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const banned of BANNED_IMPORT_SNIPPETS) {
      expect(source, `${relative(process.cwd(), file)} must not include ${banned}`).not.toContain(
        banned,
      );
    }
    expect(source).not.toMatch(/\bmutate(Task|Claim|Plan|Todo|TaskControl)\b/);
  }

  const hostKeys = Object.keys(host).toSorted();
  expect(hostKeys).toEqual(["controlBoard", "now", "view"]);
  expect(host.controlBoard).not.toHaveProperty("mutateTask");
  expect(host.controlBoard).not.toHaveProperty("mutateClaim");
  expect(host.controlBoard).not.toHaveProperty("mutatePlan");
  expect(host.controlBoard).not.toHaveProperty("mutateTodo");
  expect(host.controlBoard).not.toHaveProperty("mutateTaskControl");
  const portShape: ShadowHostPorts = host;
  expect(portShape.controlBoard).toEqual(before);

  const fixture = createFixtureControlBoard();
  expect(typeof fixture.mutateTask).toBe("function");
  expect(Object.hasOwn(host, "mutateTask")).toBe(false);
});
