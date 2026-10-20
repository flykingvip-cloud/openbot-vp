// @vitest-environment node
// Feature: P3a 往期/归档会话访问 —— cwd 归属安全闸门（防跨员工越权 + 防路径穿越）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listOwnedSessionArchives, readOwnedArchiveMessages } from "./chat.js";

let sessionsDir: string; // shared per-agent transcripts dir (steward is employee-shared)
let cwdA: string; // employee A workspace
let cwdB: string; // employee B workspace

const ARCHIVE_A1 = "aaaaaaaa-1111.jsonl.reset.2026-07-10T17-21-29.418Z";
const ARCHIVE_A2 = "cccccccc-3333.jsonl.deleted.2026-07-08T09-00-00.000Z";
const ARCHIVE_B1 = "bbbbbbbb-2222.jsonl.reset.2026-07-09T10-00-00.000Z";

function writeArchive(name: string, cwd: string, text: string) {
  const lines = [
    JSON.stringify({ type: "session", version: 1, id: name.split(".")[0], cwd }),
    JSON.stringify({ message: { role: "user", content: [{ type: "text", text }] } }),
    JSON.stringify({
      message: { role: "assistant", content: [{ type: "text", text: `reply-${text}` }] },
    }),
  ];
  fs.writeFileSync(path.join(sessionsDir, name), `${lines.join("\n")}\n`, "utf8");
}

beforeAll(() => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "p3a-arch-")));
  sessionsDir = path.join(base, "sessions");
  fs.mkdirSync(sessionsDir);
  cwdA = path.join(base, "wsA");
  fs.mkdirSync(cwdA);
  cwdB = path.join(base, "wsB");
  fs.mkdirSync(cwdB);
  writeArchive(ARCHIVE_A1, cwdA, "A-one");
  writeArchive(ARCHIVE_A2, cwdA, "A-two");
  writeArchive(ARCHIVE_B1, cwdB, "B-secret");
});

afterAll(() => {
  try {
    fs.rmSync(path.dirname(sessionsDir), { recursive: true, force: true });
  } catch {
    // ignore cleanup failure
  }
});

describe("P3a archived-session cwd-ownership gate", () => {
  it("lists only archives owned by the caller workspace cwd (cross-employee denied)", () => {
    const ids = listOwnedSessionArchives({ transcriptsDir: sessionsDir, callerWorkspaceCwd: cwdA })
      .map((entry) => entry.archiveId)
      .toSorted();
    expect(ids).toEqual([ARCHIVE_A1, ARCHIVE_A2].toSorted());
    expect(ids.includes(ARCHIVE_B1)).toBe(false);
  });

  it("reads an owned archive's messages", () => {
    const res = readOwnedArchiveMessages({
      transcriptsDir: sessionsDir,
      callerWorkspaceCwd: cwdA,
      archiveId: ARCHIVE_A1,
      limit: 200,
      includeTools: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.messages.length).toBeGreaterThan(0);
    }
  });

  it("DENIES reading another employee's archive (cwd mismatch) — the core leak guard", () => {
    const res = readOwnedArchiveMessages({
      transcriptsDir: sessionsDir,
      callerWorkspaceCwd: cwdA,
      archiveId: ARCHIVE_B1,
      limit: 200,
      includeTools: false,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects path traversal / invalid archiveId", () => {
    for (const bad of [
      "../evil.jsonl.reset.x",
      "a/b.jsonl.reset.x",
      "..",
      "foo.txt",
      "foo.jsonl.reset.",
      ".hidden.jsonl.reset.x",
    ]) {
      const res = readOwnedArchiveMessages({
        transcriptsDir: sessionsDir,
        callerWorkspaceCwd: cwdA,
        archiveId: bad,
        limit: 200,
        includeTools: false,
      });
      expect(res.ok).toBe(false);
    }
  });

  it("fail-closed when the caller workspace cwd is unknown", () => {
    expect(
      listOwnedSessionArchives({ transcriptsDir: sessionsDir, callerWorkspaceCwd: null }),
    ).toEqual([]);
    const res = readOwnedArchiveMessages({
      transcriptsDir: sessionsDir,
      callerWorkspaceCwd: null,
      archiveId: ARCHIVE_A1,
      limit: 200,
      includeTools: false,
    });
    expect(res.ok).toBe(false);
  });
});
