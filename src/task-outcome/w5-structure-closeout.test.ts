/**
 * W5 structure closeout: prove evolution-loop-log capture is bounded, and that
 * call-chain / contract docs no longer claim unbounded captured[] or open W5.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVOLUTION_LOOP_LOG_CAPTURE_MAX,
  getEvolutionLoopLogCaptureStatsForTests,
  listEvolutionLoopLogsForTests,
  logEvolutionLoop,
  resetEvolutionLoopLogsForTests,
} from "../gateway/evolution-control/evolution-loop-log.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(() => {
  resetEvolutionLoopLogsForTests();
});

describe("askOutcome W5 structure closeout", () => {
  it("reuses evolution-loop-log capture as a bounded ring (not a durable ledger)", () => {
    expect(EVOLUTION_LOOP_LOG_CAPTURE_MAX).toBeGreaterThan(0);
    for (let i = 0; i < EVOLUTION_LOOP_LOG_CAPTURE_MAX + 3; i += 1) {
      logEvolutionLoop("evolution.outcome.written", {
        runId: `w5-${i}`,
        reason: "w5_bound",
      });
    }
    expect(listEvolutionLoopLogsForTests()).toHaveLength(EVOLUTION_LOOP_LOG_CAPTURE_MAX);
    expect(getEvolutionLoopLogCaptureStatsForTests().dropped).toBe(3);
  });

  it("call-chain documents W5 bound + residual evolution bypass (not false retirement)", () => {
    const callChain = readFileSync(
      join(root, "docs/design/task-outcome/call-chain-and-replacements.md"),
      "utf8",
    );
    expect(callChain).toMatch(/W5/);
    expect(callChain).toMatch(/EVOLUTION_LOOP_LOG_CAPTURE_MAX|有界|bounded/i);
    expect(callChain).toMatch(/旁路|recordRunOutcome/);
    // Must not claim bypass fully retired without replacement proof
    expect(callChain).not.toMatch(/evolution 旁路.*已退役(?!条件)/);
    expect(callChain).toMatch(/b8ff8ea4|#109|23314d48|#112/);
    expect(callChain).toMatch(/接口可用/);
    expect(callChain).toMatch(/生产接通|行为已验证|未完成/);
  });

  it("contract marks W5 evolution-loop-log closeout (no longer pure non-goal)", () => {
    const contract = readFileSync(join(root, "docs/design/task-outcome/contract.md"), "utf8");
    expect(contract).toMatch(/W5|evolution-loop-log/);
    expect(contract).toMatch(/有界|CAPTURE_MAX|bounded/i);
  });
});
