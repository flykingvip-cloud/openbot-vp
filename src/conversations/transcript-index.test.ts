import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseTranscriptLine,
  readPagedChatHistoryMessages,
  syncTranscriptIndex,
  transcriptIndexPath,
} from "./transcript-index.js";

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function makeJsonl(lines: string[]): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-transcript-idx-"));
  tempDirs.push(dir);
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return { dir, file };
}

function messageLine(id: string, role: string, text: string): string {
  return JSON.stringify({
    type: "message",
    id,
    timestamp: "2026-08-20T10:00:00.000Z",
    message: { role, content: text, id },
  });
}

describe("transcript index", () => {
  it("keeps the JSONL entry id beside a different message id", () => {
    const parsed = parseTranscriptLine(
      JSON.stringify({
        type: "message",
        id: "env-1",
        message: { role: "user", content: "hello", id: "local-run" },
      }),
    ) as { id?: string; transcriptEntryId?: string };
    expect(parsed.id).toBe("local-run");
    expect(parsed.transcriptEntryId).toBe("env-1");
  });

  it("rebuilds from JSONL and pages without loading skipped lines", () => {
    const lines: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      lines.push(messageLine(`u${i}`, "user", `user-${i}`));
      lines.push(messageLine(`a${i}`, "assistant", `assistant-${i}`));
    }
    const { file } = makeJsonl(lines);
    const page = readPagedChatHistoryMessages({
      jsonlPath: file,
      sessionId: "sess-idx-1",
      limit: 10,
      includeTools: true,
    });
    expect(page.messages).toHaveLength(10);
    expect((page.messages[0] as { content?: string }).content).toBe("user-25");
    expect((page.messages[9] as { content?: string }).content).toBe("assistant-29");
    expect(page.hasMore).toBe(true);
    expect(page.nextBefore).toBeTruthy();
    expect(fs.existsSync(transcriptIndexPath(file))).toBe(true);

    const page2 = readPagedChatHistoryMessages({
      jsonlPath: file,
      sessionId: "sess-idx-1",
      limit: 10,
      before: page.nextBefore,
      includeTools: true,
    });
    expect((page2.messages[0] as { content?: string }).content).toBe("user-20");
    expect((page2.messages[9] as { content?: string }).content).toBe("assistant-24");
  });

  it("treats the index as derived: JSONL append updates via tail scan, JSONL remains source of truth", () => {
    const { file } = makeJsonl([messageLine("u0", "user", "hello")]);
    const first = syncTranscriptIndex(file);
    expect(first.entries).toHaveLength(1);
    fs.appendFileSync(file, `${messageLine("a0", "assistant", "hi")}\n`, "utf8");
    const second = syncTranscriptIndex(file);
    expect(second.entries).toHaveLength(2);
    expect(second.entries[0]?.messageId).toBe("u0");
    expect(second.entries[1]?.messageId).toBe("a0");
    expect(fs.readFileSync(file, "utf8")).toContain("hello");
    expect(fs.readFileSync(file, "utf8")).toContain("hi");
  });

  it("rebuilds a size-matched sidecar whose offsets no longer parse", () => {
    const { file } = makeJsonl([
      messageLine("u0", "user", "hello"),
      messageLine("a0", "assistant", "hi"),
    ]);
    const fresh = syncTranscriptIndex(file);
    const stat = fs.statSync(file);
    fs.writeFileSync(
      transcriptIndexPath(file),
      `${JSON.stringify({
        version: 1,
        fileSize: stat.size,
        mtimeMs: stat.mtimeMs,
        entries: [
          {
            offsetStart: Math.max(0, stat.size - 40),
            offsetEnd: stat.size,
            role: "assistant",
            messageId: "stale",
          },
        ],
      })}\n`,
      "utf8",
    );
    const page = readPagedChatHistoryMessages({
      jsonlPath: file,
      sessionId: "sess-stale-offsets",
      limit: 10,
      includeTools: true,
    });
    expect(page.messages).toHaveLength(2);
    expect(fresh.entries).toHaveLength(2);
    expect((page.messages[1] as { content?: string }).content).toBe("hi");
  });

  it("rebuilds when the sidecar is dirty or truncated", () => {
    const { file } = makeJsonl([
      messageLine("u0", "user", "one"),
      messageLine("a0", "assistant", "two"),
    ]);
    syncTranscriptIndex(file);
    fs.writeFileSync(
      transcriptIndexPath(file),
      `${JSON.stringify({ version: 1, fileSize: 999999, mtimeMs: 1, dirty: true, entries: [] })}\n`,
      "utf8",
    );
    const rebuilt = syncTranscriptIndex(file);
    expect(rebuilt.dirty).toBeUndefined();
    expect(rebuilt.entries).toHaveLength(2);
  });

  it("filters tool results before paging when includeTools is false", () => {
    const { file } = makeJsonl([
      messageLine("u0", "user", "ask"),
      messageLine("t0", "toolResult", "secret-tool"),
      messageLine("a0", "assistant", "done"),
    ]);
    const page = readPagedChatHistoryMessages({
      jsonlPath: file,
      sessionId: "sess-tools",
      limit: 10,
      includeTools: false,
    });
    expect(page.messages).toHaveLength(2);
    expect(page.messages.map((msg) => (msg as { role?: string }).role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("pages CJK group lines using byte offsets, not JS string indexes", () => {
    const groupLine = (id: string, text: string) =>
      JSON.stringify({
        message: {
          id,
          role: id.startsWith("u") ? "user" : "assistant",
          content: [{ type: "text", text }],
          timestamp: 1_788_312_672_303,
        },
      });
    const { file } = makeJsonl([
      groupLine("u0", "你好"),
      groupLine("a0", "你好老大！👋 有什么需要我帮忙的吗？"),
      groupLine("u1", "路径探测B"),
      groupLine("a1", "CEO好，我在这里 👋"),
    ]);
    const page = readPagedChatHistoryMessages({
      jsonlPath: file,
      sessionId: "space-cjk",
      limit: 10,
      includeTools: false,
    });
    expect(page.messages).toHaveLength(4);
    expect((page.messages[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(
      "你好",
    );
    expect((page.messages[3] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(
      "CEO好，我在这里 👋",
    );
  });

  it("indexes the last JSONL line even without a trailing newline", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-transcript-idx-"));
    tempDirs.push(dir);
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      file,
      `${messageLine("u0", "user", "hello")}\n${messageLine("a0", "assistant", "hi")}`,
      "utf8",
    );
    const index = syncTranscriptIndex(file);
    expect(index.entries).toHaveLength(2);
    expect(index.entries[1]?.messageId).toBe("a0");
  });

  it("rebuilds when a rewritten JSONL keeps growing but earlier offsets are stale", () => {
    const { file } = makeJsonl([
      messageLine("u0", "user", "old-hello"),
      messageLine("a0", "assistant", "old-reply"),
    ]);
    const first = syncTranscriptIndex(file);
    expect(first.entries).toHaveLength(2);

    const rewritten: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      rewritten.push(messageLine(`u${i}`, "user", `new-user-${i}`));
      rewritten.push(messageLine(`a${i}`, "assistant", `new-assistant-${i}`));
    }
    fs.writeFileSync(file, `${rewritten.join("\n")}\n`, "utf8");

    const page = readPagedChatHistoryMessages({
      jsonlPath: file,
      sessionId: "sess-rewrite",
      limit: 4,
      includeTools: true,
    });
    expect(page.messages).toHaveLength(4);
    expect((page.messages[0] as { content?: string }).content).toBe("new-user-6");
    expect((page.messages[3] as { content?: string }).content).toBe("new-assistant-7");
    expect(page.hasMore).toBe(true);
  });

  it("pages group public transcript wrappers after a stale sidecar", () => {
    const groupLine = (id: string, role: string, text: string) =>
      JSON.stringify({
        message: {
          id,
          role,
          content: [{ type: "text", text }],
          timestamp: 1_788_312_672_303,
        },
      });
    const { file } = makeJsonl([
      groupLine("u0", "user", "你好"),
      groupLine("a0", "assistant", "在"),
    ]);
    syncTranscriptIndex(file);
    fs.writeFileSync(
      file,
      `${[
        groupLine("u1", "user", "路径探测B"),
        groupLine("a1", "assistant", "CEO好，我在这里"),
        groupLine("u2", "user", "继续"),
        groupLine("a2", "assistant", "收到"),
      ].join("\n")}\n`,
      "utf8",
    );
    const page = readPagedChatHistoryMessages({
      jsonlPath: file,
      sessionId: "space-074bcebcdb21206137cf2531c6c0b215",
      limit: 20,
      includeTools: false,
    });
    expect(page.messages).toHaveLength(4);
    expect((page.messages[0] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(
      "路径探测B",
    );
    expect((page.messages[3] as { content?: Array<{ text?: string }> }).content?.[0]?.text).toBe(
      "收到",
    );
    expect(page.hasMore).toBe(false);
  });

  it("does not throw when the sidecar cannot be written", () => {
    const { file, dir } = makeJsonl([messageLine("u0", "user", "hello")]);
    fs.chmodSync(dir, 0o555);
    try {
      expect(() => syncTranscriptIndex(file)).not.toThrow();
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });
});
