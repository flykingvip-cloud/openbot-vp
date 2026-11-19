import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  seedSessionTaskBoard,
  sessionTaskBoardPath,
} from "./task-board-file.js";

it("recovers a killed writer's lock without losing the committed snapshot", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-killed-writer-"));
  const sessionFile = path.join(dir, "session.jsonl");
  seedSessionTaskBoard(sessionFile, { parked: [], focusRevision: 7 });
  // A real process acquires the production lock and reports readiness before SIGKILL.
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { acquireFileLockSync } from './src/plugin-sdk/file-lock.ts';
    acquireFileLockSync(process.env.BOARD_PATH, {
      retries: { retries: 0, factor: 1, minTimeout: 1, maxTimeout: 1 }, stale: 15000,
    });
    process.stdout.write('locked');
    setInterval(() => {}, 1000);
  `,
    ],
    {
      env: { ...process.env, BOARD_PATH: sessionTaskBoardPath(sessionFile) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const closed = once(child, "close");
  try {
    const ready = once(child.stdout, "data").then(([data]) => String(data));
    expect(await Promise.race([ready, closed.then(() => "exited before lock")])).toBe("locked");
    child.kill("SIGKILL");
    await closed;
    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: { ...board, focusRevision: board.focusRevision + 1 },
      value: undefined,
    }));
    expect(readSessionTaskBoard(sessionFile)).toMatchObject({ focusRevision: 8, writeEpoch: 2 });
    expect(fs.existsSync(`${sessionTaskBoardPath(sessionFile)}.lock`)).toBe(false);
  } finally {
    child.kill("SIGKILL");
    await closed;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

it("preserves corrupt persisted state instead of resetting it during mutation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-corrupt-"));
  const sessionFile = path.join(dir, "session.jsonl");
  const target = sessionTaskBoardPath(sessionFile);
  try {
    fs.writeFileSync(target, '{"parked":');
    expect(() =>
      mutateSessionTaskBoard(sessionFile, (board) => ({ board, value: undefined })),
    ).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe('{"parked":');
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("keeps the committed snapshot when atomic publication fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-publish-failure-"));
  const sessionFile = path.join(dir, "session.jsonl");
  seedSessionTaskBoard(sessionFile, { parked: [], focusRevision: 7 });
  const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
    throw new Error("injected publication failure");
  });
  try {
    expect(() =>
      mutateSessionTaskBoard(sessionFile, (board) => ({
        board: { ...board, focusRevision: 8 },
        value: undefined,
      })),
    ).toThrow("injected publication failure");
    expect(readSessionTaskBoard(sessionFile)).toMatchObject({ focusRevision: 7, writeEpoch: 1 });
    expect(fs.readdirSync(dir)).toEqual(["session.jsonl.task-board.json"]);
  } finally {
    rename.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
