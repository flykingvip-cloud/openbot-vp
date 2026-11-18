import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * seedSessionTaskBoard is a test fixture (no writeEpoch CAS). Production call
 * chains must not import or invoke it.
 */
describe("seedSessionTaskBoard production-call-chain audit", () => {
  it("does not restore retired inbound inference in production sources", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    const retired = [
      "applyIncomingUserMessage",
      "isSureDistinctWork",
      "evaluateFocusSwitch",
      "applyLegacyTaskControl",
      "applyFocusSwitchGate",
      "isLikelyContinuation",
    ];
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          const source = fs.readFileSync(full, "utf8");
          for (const symbol of retired) {
            if (source.includes(symbol)) {
              hits.push(`${path.relative(root, full)}: ${symbol}`);
            }
          }
        }
      }
    };
    walk(path.join(root, "src"));
    expect(hits).toEqual([]);
  });

  it("is only referenced from tests, docs, or its definition", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    const hits: string[] = [];

    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name === "dist" || ent.name === ".git") {
          continue;
        }
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|md)$/.test(ent.name)) {
          continue;
        }
        const rel = path.relative(root, full).replaceAll("\\", "/");
        const text = fs.readFileSync(full, "utf8");
        if (!text.includes("seedSessionTaskBoard")) {
          continue;
        }
        hits.push(rel);
      }
    };

    walk(path.join(root, "src"));
    walk(path.join(root, "docs"));

    const allowed = new Set(
      hits.filter((rel) => {
        if (rel.endsWith(".test.ts") || rel.endsWith(".test.mts") || rel.endsWith(".test.mjs")) {
          return true;
        }
        if (rel.startsWith("docs/")) {
          return true;
        }
        // Sole definition is in the repository; the old board only re-exports it.
        if (
          rel === "src/agent-runtime/command/rule-adaptation/activation-test-support.ts" ||
          rel === "src/conversation-task/session-task-board.ts" ||
          rel === "src/agent-runtime/state/repository/task-board-file.ts"
        ) {
          return true;
        }
        // Cross-process child is a test helper process, not a production entry.
        if (rel === "src/conversation-task/session-task-board.cross-process-child.ts") {
          return !fs.readFileSync(path.join(root, rel), "utf8").includes("seedSessionTaskBoard");
        }
        return false;
      }),
    );

    const banned = hits.filter((rel) => !allowed.has(rel));
    expect(banned).toEqual([]);

    // Sanity: definition exists and tests use it.
    expect(hits).toContain("src/agent-runtime/state/repository/task-board-file.ts");
    expect(hits.some((h) => h.includes(".test.ts"))).toBe(true);

    // Production board module must document test-only + must not call seed from other exports' bodies via import cycle — check no other src non-test imports the symbol.
    const productionImporters = hits.filter(
      (rel) =>
        rel.startsWith("src/") &&
        !rel.endsWith(".test.ts") &&
        rel !== "src/agent-runtime/command/rule-adaptation/activation-test-support.ts" &&
        rel !== "src/conversation-task/session-task-board.ts" &&
        rel !== "src/agent-runtime/state/repository/task-board-file.ts",
    );
    expect(productionImporters).toEqual([]);
  });
});
