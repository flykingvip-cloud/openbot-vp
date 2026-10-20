import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repairSessionFileIfNeeded } from "./session-file-repair.js";
import {
  appendTranscriptMessageEntry,
  healBareTranscriptEntries,
  isBareTranscriptMessageLine,
  readTranscriptLeafId,
} from "./session-transcript-entry.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const header = (cwd: string) => ({
  type: "session",
  version: CURRENT_SESSION_VERSION,
  id: "session-test-1",
  timestamp: new Date(0).toISOString(),
  cwd,
});

function makeTranscript(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-tx-entry-"));
  tempDirs.push(dir);
  const file = path.join(dir, "session.jsonl");
  const user = {
    type: "message",
    id: "m1",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message: { role: "user", content: "hello" },
  };
  const asst = {
    type: "message",
    id: "m2",
    parentId: "m1",
    timestamp: new Date(0).toISOString(),
    message: {
      role: "assistant",
      content: "hi",
      api: "test",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  };
  fs.writeFileSync(file, `${[header(dir), user, asst].map((e) => JSON.stringify(e)).join("\n")}\n`);
  return { dir, file };
}

function appendBareLine(file: string, id: string) {
  fs.appendFileSync(
    file,
    `${JSON.stringify({
      message: {
        id,
        role: "user",
        content: [{ type: "text", text: "attach" }],
        timestamp: Date.now(),
      },
    })}\n`,
  );
}

describe("session transcript entry append", () => {
  it("detects bare message lines", () => {
    expect(isBareTranscriptMessageLine({ message: { role: "user", content: "x" } })).toBe(true);
    expect(
      isBareTranscriptMessageLine({
        type: "message",
        id: "a",
        parentId: null,
        message: { role: "user", content: "x" },
      }),
    ).toBe(false);
  });

  it("appends type/id/parentId chained to current leaf (attachment early-persist path)", () => {
    const { file } = makeTranscript();
    expect(readTranscriptLeafId(file)).toBe("m2");

    const result = appendTranscriptMessageEntry({
      transcriptPath: file,
      message: {
        id: "local-run-attach",
        role: "user",
        content: [{ type: "text", text: "with screenshot" }],
        timestamp: Date.now(),
        idempotencyKey: "run-attach",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.entry.type).toBe("message");
    expect(result.entry.parentId).toBe("m2");
    // Entry id is fresh (never aliased to message.id); message.id is preserved.
    expect(result.entry.id).not.toBe("local-run-attach");
    expect(result.entry.message.id).toBe("local-run-attach");

    const sm = SessionManager.open(file);
    expect(sm.getLeafId()).toBe(result.entry.id);
    sm.appendModelChange("api-proxy", "deepseek-v4-flash");
    expect(sm.getEntries().at(-1)?.parentId).toBe(result.entry.id);
    expect(sm.buildSessionContext().messages.length).toBeGreaterThanOrEqual(3);
  });

  it("chains consecutive appends and roots on a header-only file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-tx-entry-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(file, `${JSON.stringify(header(dir))}\n`);
    expect(readTranscriptLeafId(file)).toBeNull();

    const first = appendTranscriptMessageEntry({
      transcriptPath: file,
      message: { role: "user", content: "one", timestamp: Date.now() },
    });
    const second = appendTranscriptMessageEntry({
      transcriptPath: file,
      message: { role: "user", content: "two", timestamp: Date.now() },
    });
    expect(first.ok && first.entry.parentId).toBeNull();
    expect(second.ok && first.ok && second.entry.parentId).toBe(first.ok ? first.entry.id : "");
  });

  it("finds the leaf via bounded tail scan when the last entry exceeds the initial window", () => {
    const { file } = makeTranscript();
    const big = appendTranscriptMessageEntry({
      transcriptPath: file,
      message: { role: "user", content: "x".repeat(300 * 1024), timestamp: Date.now() },
    });
    expect(big.ok).toBe(true);
    expect(readTranscriptLeafId(file)).toBe(big.ok ? big.entry.id : "");
  });

  it("skips a trailing bare line and chains to the last well-formed entry", () => {
    const { file } = makeTranscript();
    appendBareLine(file, "local-bare-tail");
    expect(readTranscriptLeafId(file)).toBe("m2");
  });

  it("returns null for a missing transcript", () => {
    expect(readTranscriptLeafId(path.join(os.tmpdir(), "openbot-missing-tx.jsonl"))).toBeNull();
  });
});

describe("legacy bare line heal (via repairSessionFileIfNeeded)", () => {
  it("bare legacy line re-roots SessionManager (regression proof)", () => {
    const { file } = makeTranscript();
    appendBareLine(file, "local-bare");
    const broken = SessionManager.open(file);
    expect(broken.getLeafId()).toBeFalsy();
    broken.appendModelChange("p", "m");
    expect(broken.buildSessionContext().messages.length).toBe(0);
  });

  it("healBareTranscriptEntries is a no-op on clean entries", () => {
    const entries = [
      { type: "session", id: "s" },
      { type: "message", id: "a", parentId: null, message: { role: "user", content: "x" } },
    ];
    const result = healBareTranscriptEntries(entries);
    expect(result.convertedBareLines).toBe(0);
    expect(result.relinkedParents).toBe(0);
    expect(result.entries).toBe(entries);
  });

  it("repairs bare lines atomically with a backup and restores the chain", async () => {
    const { file } = makeTranscript();
    appendBareLine(file, "local-bare-2");
    const before = fs.readFileSync(file, "utf-8");

    const warn = vi.fn();
    const report = await repairSessionFileIfNeeded({ sessionFile: file, warn });
    expect(report.repaired).toBe(true);
    expect(report.convertedBareLines).toBe(1);
    expect(report.droppedLines).toBe(0);
    expect(report.backupPath).toBeTruthy();
    expect(fs.readFileSync(report.backupPath ?? "", "utf-8")).toBe(before);
    expect(warn.mock.calls[0]?.[0]).toContain("converted 1 bare message line(s)");
    // No temp files left behind.
    expect(fs.readdirSync(path.dirname(file)).some((n) => n.endsWith(".tmp"))).toBe(false);

    const fixed = SessionManager.open(file);
    const leaf = fixed.getEntries().at(-1);
    expect(leaf?.parentId).toBe("m2");
    expect(fixed.getLeafId()).toBe(leaf?.id);
    fixed.appendModelChange("p", "m");
    expect(fixed.getEntries().at(-1)?.parentId).toBe(leaf?.id);
    expect(fixed.buildSessionContext().messages.length).toBeGreaterThanOrEqual(3);

    // Idempotent: second pass makes no change and writes no new backup.
    const again = await repairSessionFileIfNeeded({ sessionFile: file });
    expect(again.repaired).toBe(false);
  });

  it("relinks omitted parentId on entries that followed a bare line", async () => {
    const { file } = makeTranscript();
    appendBareLine(file, "local-bare-3");
    // SessionManager append after corrupted leaf: parentId key omitted.
    fs.appendFileSync(
      file,
      `${JSON.stringify({
        type: "model_change",
        id: "mc1",
        timestamp: new Date().toISOString(),
        provider: "api-proxy",
        modelId: "deepseek",
      })}\n`,
    );
    const report = await repairSessionFileIfNeeded({ sessionFile: file });
    expect(report.repaired).toBe(true);
    expect(report.convertedBareLines).toBe(1);
    expect(report.relinkedParents).toBe(1);
    const lines = fs
      .readFileSync(file, "utf-8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            id?: string;
            parentId?: string | null;
            type?: string;
            message?: { id?: string };
          },
      );
    const healed = lines.find((l) => l.message?.id === "local-bare-3");
    const mc = lines.find((l) => l.id === "mc1");
    expect(healed?.type).toBe("message");
    expect(healed?.parentId).toBe("m2");
    expect(mc?.parentId).toBe(healed?.id);
    const sm = SessionManager.open(file);
    expect(sm.buildSessionContext().messages.length).toBeGreaterThanOrEqual(3);
  });

  it("leaves explicit parentId:null roots alone", () => {
    const entries = [
      { type: "session", id: "s" },
      { type: "message", id: "a", parentId: null, message: { role: "user", content: "x" } },
      { type: "message", id: "b", parentId: null, message: { role: "user", content: "y" } },
    ];
    const result = healBareTranscriptEntries(entries);
    expect(result.relinkedParents).toBe(0);
  });
});
