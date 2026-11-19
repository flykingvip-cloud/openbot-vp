import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BATCH1_EVIDENCE_ROOT } from "./evidence-root.js";
import {
  T20_DIAGNOSIS_RPC_SPECS,
  deriveCaseHonesty,
  deriveSummaryCases,
  recordsFromJsonl,
  withCombinedConcurrency,
} from "./rpc-summary.js";

const T20_RPC_JSONL = path.join(BATCH1_EVIDENCE_ROOT, "t20-rpc", "rpc.jsonl");

describe("rpc summary honesty", () => {
  it("does not mark pass when an original under-test call failed", () => {
    const honesty = deriveCaseHonesty({ caseName: "concurrency-a", requirePersistence: true }, [
      {
        phase: "under_test",
        caseName: "concurrency-a",
        method: "chat.send",
        ok: false,
        error: null,
        messages: { diff: { beforeCount: 0, afterCount: 0, added: [] } },
      },
    ]);
    expect(honesty.result).toBe("fail");
    expect(honesty.reasons.some((reason) => /original under-test call/.test(reason))).toBe(true);
  });

  it("does not mark pass when official inject is ok but history did not grow", () => {
    const honesty = deriveCaseHonesty(
      {
        caseName: "timeout-fallback",
        requirePersistence: true,
        officialOutcome: "accepted",
        expectedFailures: [{ method: "chat.send", phase: "under_test" }],
      },
      [
        {
          phase: "under_test",
          caseName: "timeout-fallback",
          method: "chat.send",
          ok: false,
          error: "gateway timeout after 200ms (simulated after persist)",
          messages: { diff: { beforeCount: 0, afterCount: 0, added: [] } },
        },
        {
          phase: "under_test",
          caseName: "timeout-fallback",
          method: "chat.inject",
          ok: true,
          error: null,
          messages: { diff: { beforeCount: 0, afterCount: 0, added: [] } },
        },
        {
          phase: "verification",
          caseName: "timeout-fallback",
          method: "chat.history",
          ok: true,
          messages: { diff: { beforeCount: 0, afterCount: 0, added: [] } },
        },
      ],
    );
    expect(honesty.result).toBe("fail");
    expect(
      honesty.reasons.some((reason) =>
        /accepted but the target session history did not grow/.test(reason),
      ),
    ).toBe(true);
    expect(honesty.persistence.observed).toBe(false);
  });

  it("marks pass only when expected failures are declared and persistence is observed", () => {
    const honesty = deriveCaseHonesty(
      {
        caseName: "timeout-fallback",
        requirePersistence: true,
        officialOutcome: "accepted",
        expectedFailures: [{ method: "chat.send", phase: "under_test" }],
      },
      [
        {
          phase: "under_test",
          caseName: "timeout-fallback",
          method: "chat.send",
          ok: false,
          error: "gateway timeout after 200ms",
          messages: { diff: { beforeCount: 0, afterCount: 0, added: [] } },
        },
        {
          phase: "under_test",
          caseName: "timeout-fallback",
          method: "chat.inject",
          ok: true,
          error: null,
          messages: {
            diff: {
              beforeCount: 0,
              afterCount: 1,
              added: [{ role: "assistant", fingerprint: "abc" }],
            },
          },
        },
      ],
    );
    expect(honesty.result).toBe("pass");
    expect(honesty.persistence.observed).toBe(true);
  });

  it.skipIf(!fs.existsSync(T20_RPC_JSONL))(
    "re-evaluates the t20 rpc.jsonl and refuses to relabel failed writes as pass",
    () => {
      expect(fs.existsSync(T20_RPC_JSONL)).toBe(true);
      const records = withCombinedConcurrency(
        recordsFromJsonl(fs.readFileSync(T20_RPC_JSONL, "utf8")),
      );
      const specs = T20_DIAGNOSIS_RPC_SPECS.map((spec) =>
        spec.caseName === "timeout-fallback" ||
        spec.caseName === "concurrency" ||
        spec.caseName === "concurrency-a" ||
        spec.caseName === "concurrency-b"
          ? { ...spec, officialOutcome: "accepted" }
          : spec,
      );
      const cases = deriveSummaryCases(records, specs);
      expect(cases["timeout-fallback"]?.result).toBe("fail");
      expect(cases["concurrency"]?.result).toBe("fail");
      expect(cases["concurrency-a"]?.result).toBe("fail");
      expect(cases["concurrency-b"]?.result).toBe("fail");
      // auth-deny: expected send failure, no write requirement
      expect(cases["auth-deny"]?.result).toBe("pass");
      expect(cases["boundary-deny"]?.result).toBe("pass");
      expect(cases["duplicate-delivery"]?.result).toBe("pass");
    },
  );
});
