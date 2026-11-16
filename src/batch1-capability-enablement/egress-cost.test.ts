/**
 * Stronger Batch 1 egress and cost-boundary coverage.
 *
 * Egress: an allow-listed first hop may itself be reached, but a redirect to
 * private / loopback / cloud-metadata addresses must refuse the FINAL target.
 *
 * Cost: record actual official semantics. invokeReadonlySurface has no cost cap
 * of its own. The runner budget gate charges after the call (single-request
 * overshoot window) and blocks the NEXT request before another upstream call.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";
import { SsrFBlockedError, type LookupFn } from "../infra/net/ssrf.js";
import { fetchRemoteMedia } from "../media/fetch.js";
import { invokeReadonlySurface } from "../task-orchestration/readonly-invoke.js";
import { applySpendAndAssess, buildTaskBudgetState } from "../task-outcome/budget.js";
import {
  assessRunnerTurnBudgetGate,
  chargeRunnerTurnBudgetSpend,
  TaskBudgetExceededError,
} from "../task-outcome/runtime-from-runner.js";
import type { TrustedScope } from "../task-outcome/types.js";

const EVIDENCE_DIR = path.join(
  process.env.OPENBOT_BATCH1_EVIDENCE_DIR ?? "/workspace/openbot-vp-audit/batch1-evidence",
  "egress-cost",
);

const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  zone: "Asia/Shanghai",
  productionHostsTouched: false,
  productionLedgerWritten: false,
  cases: {} as Record<string, unknown>,
};

function writeEvidence(): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "egress-cost.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

function record(name: string, value: unknown): void {
  (evidence.cases as Record<string, unknown>)[name] = value;
  writeEvidence();
}

async function listenRedirector(locationFactory: (port: number) => string): Promise<{
  port: number;
  close: () => Promise<void>;
  hits: string[];
}> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(302, { Location: locationFactory((server.address() as { port: number }).port) });
    res.end();
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("failed to bind allow-listed redirector");
      }
      resolve(address.port);
    });
  });
  return {
    port,
    hits,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function pinAllowlistedLookup(hostname: string, address: string): LookupFn {
  const lookupFn: LookupFn = (async (host: string, options?: unknown) => {
    const normalized = String(host).trim().toLowerCase();
    if (normalized !== hostname) {
      throw new Error(`unexpected host in isolated egress test: ${host}`);
    }
    const record = { address, family: 4 as const };
    if (options && typeof options === "object" && (options as { all?: boolean }).all) {
      return [record];
    }
    return record;
  }) as LookupFn;
  return lookupFn;
}

const ALLOW_HOST = "allow.batch1.test";

describe("batch1 egress and cost", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses the final target when an allow-listed hop redirects to private/loopback/metadata", async () => {
    const targets = [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1/",
      "http://10.1.2.3/secret",
      "http://metadata.google.internal/",
    ];
    const results = [];
    for (const location of targets) {
      const redirector = await listenRedirector(() => location);
      try {
        const lookupFn = pinAllowlistedLookup(ALLOW_HOST, "127.0.0.1");
        const policy = { allowedHostnames: [ALLOW_HOST], allowPrivateNetwork: false };
        let blocked = false;
        let errorName = "";
        let errorMessage = "";
        let fetched = false;
        try {
          await fetchWithSsrFGuard({
            url: `http://${ALLOW_HOST}:${redirector.port}/start`,
            policy,
            lookupFn,
            maxRedirects: 3,
          });
          fetched = true;
        } catch (error) {
          blocked = error instanceof SsrFBlockedError;
          errorName = error instanceof Error ? error.name : "unknown";
          errorMessage = error instanceof Error ? error.message : String(error);
        }
        let mediaFetched = false;
        let mediaError = "";
        try {
          await fetchRemoteMedia({
            url: `http://${ALLOW_HOST}:${redirector.port}/start`,
            maxBytes: 1024,
            ssrfPolicy: policy,
            lookupFn,
            maxRedirects: 3,
          });
          mediaFetched = true;
        } catch (error) {
          mediaError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
        expect(fetched).toBe(false);
        expect(mediaFetched).toBe(false);
        expect(blocked || /Blocked|SsrFBlockedError/i.test(`${errorName}: ${errorMessage}`)).toBe(
          true,
        );
        results.push({
          firstHop: `http://${ALLOW_HOST}:${redirector.port}/start`,
          firstHopAllowedByPolicy: true,
          firstHopHits: redirector.hits.length,
          finalLocation: location,
          guardFetched: fetched,
          guardBlocked: blocked,
          guardError: `${errorName}: ${errorMessage}`,
          mediaFetched,
          mediaError,
        });
      } finally {
        await redirector.close();
      }
    }
    expect(results.every((row) => !row.guardFetched && !row.mediaFetched)).toBe(true);
    expect(results.every((row) => row.firstHopHits >= 1)).toBe(true);
    record("egress-final-redirect", { results, result: "pass" });
  });

  it("records official cost-cap semantics: overshoot on the crossing call, next request blocked first", async () => {
    let readonlyUpstreamCalls = 0;
    const first = await invokeReadonlySurface({
      surface: "memory",
      query: "before-cap",
      correlationId: "batch1-cost-1",
      deps: {
        createMemorySearchTool: () =>
          ({
            execute: async () => {
              readonlyUpstreamCalls += 1;
              return { content: [{ type: "text", text: "upstream-1" }] };
            },
          }) as never,
      },
    });
    expect(first.invokedTool).toBe(true);
    const started = buildTaskBudgetState({
      taskLimits: { maxCostUsd: 0.02, maxIterations: 20, maxDurationMinutes: 5 },
    });
    // applySpendAndAssess charges first, then checks — a single request may overshoot.
    const crossing = applySpendAndAssess(started, { costUsd: 0.03, iterations: 1 }, 1_000);
    expect(crossing.exhaustion?.dimension).toBe("cost");
    expect(crossing.state.spentCostUsd).toBeGreaterThan(0.02);
    const secondReadonly = await invokeReadonlySurface({
      surface: "memory",
      query: "after-budget-helper-exhausted",
      correlationId: "batch1-cost-2",
      deps: {
        createMemorySearchTool: () =>
          ({
            execute: async () => {
              readonlyUpstreamCalls += 1;
              return { content: [{ type: "text", text: "upstream-2" }] };
            },
          }) as never,
      },
    });
    expect(secondReadonly.invokedTool).toBe(true);
    expect(readonlyUpstreamCalls).toBe(2);

    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "batch1-budget-"));
    tmpDirs.push(agentDir);
    const cfg = { agents: { list: [{ id: "bot", workspace: agentDir }] } } as never;
    const taskId = "chat:bot:sess:batch1-cost";
    const startedAtMs = Date.now();
    const scope: TrustedScope = {
      kind: "personal",
      personalDomainId: "personal:batch1-cost",
      subjectRef: "u",
      authzScopeRef: "s",
    };
    const g0 = assessRunnerTurnBudgetGate(cfg, "bot", {
      taskId,
      scope,
      startedAtMs,
      budgetLimits: { maxIterations: 20, maxCostUsd: 0.02, maxDurationMinutes: 5 },
    });
    expect(g0.allowed).toBe(true);
    const charged = chargeRunnerTurnBudgetSpend(cfg, "bot", {
      taskId,
      scope,
      runId: "batch1-cost-r1",
      callSeq: 1,
      iterations: 1,
      costUsd: 0.03,
    });
    expect(charged.exhaustion?.dimension).toBe("cost");
    expect(charged.record.budget?.spentCostUsd ?? 0).toBeGreaterThan(0.02);
    const g1 = assessRunnerTurnBudgetGate(cfg, "bot", { taskId, scope, startedAtMs });
    expect(g1.allowed).toBe(false);
    let officialUpstreamCalls = 0;
    const attemptNext = (): void => {
      if (!g1.allowed) {
        throw new TaskBudgetExceededError(taskId, g1.exhaustion);
      }
      officialUpstreamCalls += 1;
    };
    expect(() => attemptNext()).toThrow(TaskBudgetExceededError);
    expect(officialUpstreamCalls).toBe(0);

    record("cost-cap-semantics", {
      readonlyInvokeHasOwnCostCap: false,
      readonlyUpstreamCallsAfterHelperExhausted: readonlyUpstreamCalls,
      budgetHelper: {
        maxCostUsd: 0.02,
        crossingSpendUsd: 0.03,
        spentAfterCrossing: crossing.state.spentCostUsd,
        exhaustion: crossing.exhaustion,
        semantics: "after-the-fact: apply spend, then assess; single-request overshoot window",
      },
      officialRunnerGate: {
        crossingSpendUsd: 0.03,
        spentAfterCrossing: charged.record.budget?.spentCostUsd ?? null,
        closedForBudget: charged.closedForBudget ?? null,
        nextRequestAllowed: g1.allowed,
        nextUpstreamCalls: officialUpstreamCalls,
        semantics:
          "hard cap for the NEXT request (assessRunnerTurnBudgetGate before the call). The request that crosses the cap can overshoot because spend is charged after the call. Not a reserve-before-call hard cap on that crossing request.",
      },
      result: "pass",
    });
  });
});
