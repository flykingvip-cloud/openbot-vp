import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { truncateTranscriptToBoundary } from "./transcript-truncate.js";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

async function writeTranscript(lines: Array<Record<string, unknown>>): Promise<string> {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-truncate-"));
  const transcriptPath = path.join(tempDir, "sess-1.jsonl");
  await fs.writeFile(transcriptPath, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");
  return transcriptPath;
}

async function readLines(file: string): Promise<Array<Record<string, unknown>>> {
  const content = await fs.readFile(file, "utf8");
  return content
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("truncateTranscriptToBoundary", () => {
  it("truncates to the boundary and archives the removed tail (reversible)", async () => {
    const transcriptPath = await writeTranscript([
      { type: "session", id: "sess-1" },
      { type: "message", id: "m1", message: { role: "user", content: "a" } },
      { type: "message", id: "m2", message: { role: "assistant", content: "b" } },
      { type: "message", id: "m3", message: { role: "user", content: "c" } },
      { type: "message", id: "m4", message: { role: "assistant", content: "d" } },
    ]);
    const archivePath = path.join(tempDir, "sess-1.jsonl.archive", "cp-1.jsonl");

    const result = await truncateTranscriptToBoundary({
      transcriptPath,
      boundaryMessageId: "m2",
      archivePath,
    });

    expect(result).toMatchObject({ boundaryFound: true, removedCount: 2, truncated: true });
    const remaining = await readLines(transcriptPath);
    expect(remaining.map((l) => l.id)).toEqual(["sess-1", "m1", "m2"]);
    // Tail archived and fully recoverable.
    const archived = await readLines(archivePath);
    expect(archived.map((l) => l.id)).toEqual(["m3", "m4"]);
  });

  it("is a no-op when the boundary is the last line", async () => {
    const transcriptPath = await writeTranscript([
      { type: "session", id: "sess-1" },
      { type: "message", id: "m1", message: { role: "user", content: "a" } },
    ]);
    const result = await truncateTranscriptToBoundary({
      transcriptPath,
      boundaryMessageId: "m1",
      archivePath: path.join(tempDir, "arch", "cp.jsonl"),
    });
    expect(result).toMatchObject({ boundaryFound: true, removedCount: 0, truncated: false });
    expect((await readLines(transcriptPath)).map((l) => l.id)).toEqual(["sess-1", "m1"]);
  });

  it("does not touch the transcript when the boundary is not found", async () => {
    const transcriptPath = await writeTranscript([
      { type: "session", id: "sess-1" },
      { type: "message", id: "m1", message: { role: "user", content: "a" } },
      { type: "message", id: "m2", message: { role: "assistant", content: "b" } },
    ]);
    const before = await fs.readFile(transcriptPath, "utf8");
    const result = await truncateTranscriptToBoundary({
      transcriptPath,
      boundaryMessageId: "does-not-exist",
      archivePath: path.join(tempDir, "arch", "cp.jsonl"),
    });
    expect(result).toMatchObject({ boundaryFound: false, truncated: false });
    expect(await fs.readFile(transcriptPath, "utf8")).toBe(before);
  });

  it("clears messages but keeps the session header for the start-boundary sentinel", async () => {
    const transcriptPath = await writeTranscript([
      { type: "session", id: "sess-1" },
      { type: "message", id: "m1", message: { role: "user", content: "a" } },
      { type: "message", id: "m2", message: { role: "assistant", content: "b" } },
    ]);
    const archivePath = path.join(tempDir, "arch", "cp-start.jsonl");
    const result = await truncateTranscriptToBoundary({
      transcriptPath,
      boundaryMessageId: "__openbot_transcript_start__",
      archivePath,
    });
    expect(result).toMatchObject({ boundaryFound: true, removedCount: 2, truncated: true });
    expect((await readLines(transcriptPath)).map((l) => l.id)).toEqual(["sess-1"]);
    expect((await readLines(archivePath)).map((l) => l.id)).toEqual(["m1", "m2"]);
  });

  it("is a no-op when boundaryMessageId is undefined", async () => {
    const transcriptPath = await writeTranscript([
      { type: "session", id: "sess-1" },
      { type: "message", id: "m1", message: { role: "user", content: "a" } },
    ]);
    const result = await truncateTranscriptToBoundary({
      transcriptPath,
      boundaryMessageId: undefined,
      archivePath: path.join(tempDir, "arch", "cp.jsonl"),
    });
    expect(result).toMatchObject({ boundaryFound: false, truncated: false });
  });
});
