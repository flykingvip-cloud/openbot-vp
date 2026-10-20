import { describe, expect, it, vi } from "vitest";
import { runDeliveryCli } from "./cli.js";
import type { GitRunner } from "./forward-guard.js";
import type { LiveShaReaders } from "./resolve-live-sha.js";

const live = "1".repeat(40);
const candidate = "2".repeat(40);

function readers(endpointValue: string | null, ledgerText: string | null = null): LiveShaReaders {
  return {
    endpoint: vi.fn(async () => endpointValue),
    container: vi.fn(async () => null),
    stoppedContainer: vi.fn(async () => null),
    releaseRecord: vi.fn(async () => null),
    ledger: vi.fn(async () => ledgerText),
  };
}

/** An open (liveTo-less) releases.jsonl row for `sha`. */
function openLedger(sha: string): string {
  return `${JSON.stringify({
    seq: 51,
    gatewaySha: sha,
    uiSha: sha,
    imageTag: `rc-amd64-provenance-${sha.slice(0, 12)}`,
    tag: `provenance/sha-${sha.slice(0, 12)}`,
    liveFrom: "2026-08-29T13:15:53Z",
  })}\n`;
}

/** Git runner for the check-sot path: provenance tag + trunk ancestry are configurable. */
function sotGit(opts: { tagResolvesTo?: string; trunkContains: boolean }): GitRunner {
  return (args) => {
    if (args[0] === "rev-parse") {
      return opts.tagResolvesTo
        ? { code: 0, stdout: `${opts.tagResolvesTo}\n` }
        : { code: 1, stdout: "" };
    }
    if (args[0] === "merge-base") {
      return { code: opts.trunkContains ? 0 : 1, stdout: "" };
    }
    return { code: 0, stdout: "" };
  };
}

function git(forward: boolean): GitRunner {
  return (args) => {
    if (args[0] === "rev-parse") {
      return { code: 0, stdout: `${candidate}\n` };
    }
    if (args[0] === "merge-base") {
      return { code: forward ? 0 : 1, stdout: "" };
    }
    return { code: 0, stdout: "src/deleted.ts\n" };
  };
}

describe("delivery CLI", () => {
  it("returns 0 for a forward candidate", async () => {
    const result = await runDeliveryCli(["verify", "--candidate", candidate], {
      git: git(true),
      readers: readers(JSON.stringify({ commit: live })),
    });

    expect(result.code).toBe(0);
    expect(result.payload).toMatchObject({ verdict: "allow", forwardOnly: true });
  });

  it("returns 20 for a known LIVE regression", async () => {
    const result = await runDeliveryCli(["verify", "--candidate", candidate], {
      git: git(false),
      readers: readers(JSON.stringify({ commit: live })),
    });

    expect(result.code).toBe(20);
    expect(result.payload).toMatchObject({ verdict: "block", live });
  });

  it("returns 21 when LIVE is unknown", async () => {
    const result = await runDeliveryCli(["verify", "--candidate", candidate], {
      git: git(true),
      readers: readers(null),
    });

    expect(result.code).toBe(21);
  });

  it("allows unknown LIVE only with an explicit override", async () => {
    const result = await runDeliveryCli(
      ["verify", "--candidate", candidate, "--allow-unknown-live"],
      { git: git(true), readers: readers(null) },
    );

    expect(result.code).toBe(0);
    expect(result.payload).toMatchObject({ verdict: "allow", live: null });
  });

  it("allows an intentional revert and records the reason", async () => {
    const result = await runDeliveryCli(
      ["verify", "--candidate", candidate, "--intentional-revert", "approved rollback"],
      { git: git(false), readers: readers(JSON.stringify({ commit: live })) },
    );

    expect(result.code).toBe(0);
    expect(result.payload.intentionalRevert).toEqual({
      approved: true,
      reason: "approved rollback",
    });
  });

  it("check-sot allows when ledger row, provenance tag, and trunk all name LIVE", async () => {
    const result = await runDeliveryCli(["check-sot", "--live-sha", live], {
      git: sotGit({ tagResolvesTo: live, trunkContains: true }),
      readers: readers(null, openLedger(live)),
    });

    expect(result.code).toBe(0);
    expect(result.payload).toMatchObject({ command: "check-sot", verdict: "allow", live });
  });

  it("check-sot blocks when the open ledger row does not match LIVE", async () => {
    const result = await runDeliveryCli(["check-sot", "--live-sha", live], {
      git: sotGit({ tagResolvesTo: candidate, trunkContains: true }),
      readers: readers(null, openLedger(candidate)),
    });

    expect(result.code).toBe(20);
    expect(result.payload.verdict).toBe("block");
  });

  it("check-sot blocks (missing provenance tag) even when the row matches LIVE", async () => {
    const result = await runDeliveryCli(["check-sot", "--live-sha", live], {
      git: sotGit({ trunkContains: true }),
      readers: readers(null, openLedger(live)),
    });

    expect(result.code).toBe(20);
    expect(String(result.payload.reasons)).toMatch(/missing provenance tag/i);
  });

  it("check-sot fails closed (21) when LIVE is unknown", async () => {
    const result = await runDeliveryCli(["check-sot"], {
      git: sotGit({ tagResolvesTo: live, trunkContains: true }),
      readers: readers(null, openLedger(live)),
    });

    expect(result.code).toBe(21);
    expect(result.payload.verdict).toBe("unknown");
  });
});
