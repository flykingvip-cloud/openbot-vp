import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveJsonFile } from "./json-file.js";
import { writeJsonAtomic, writeJsonAtomicSync } from "./json-files.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "json-atomic-"));
  tmpDirs.push(dir);
  return path.join(dir, name);
}

/** chmod 0o600 is best-effort; Windows reports 0o666. */
function expectSecureMode(filePath: string) {
  if (process.platform === "win32") {
    return;
  }
  expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
}

describe("writeJsonAtomic / writeJsonAtomicSync", () => {
  it("writes atomically with mode 0o600 and trailing newline", () => {
    const filePath = tmpFile("store.json");
    writeJsonAtomicSync(filePath, { ok: true }, { trailingNewline: true, ensureDirMode: 0o700 });
    const raw = fs.readFileSync(filePath, "utf8");
    expect(raw).toBe(`${JSON.stringify({ ok: true }, null, 2)}\n`);
    expectSecureMode(filePath);
    const leftovers = fs
      .readdirSync(path.dirname(filePath))
      .filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("async writeJsonAtomic matches the sync protocol", async () => {
    const filePath = tmpFile("async.json");
    await writeJsonAtomic(filePath, { n: 1 }, { trailingNewline: true });
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({ n: 1 });
    expectSecureMode(filePath);
  });

  it("deprecated saveJsonFile delegates to the atomic sync writer", () => {
    const filePath = tmpFile("legacy.json");
    saveJsonFile(filePath, { legacy: true });
    expect(fs.readFileSync(filePath, "utf8")).toBe(
      `${JSON.stringify({ legacy: true }, null, 2)}\n`,
    );
    expectSecureMode(filePath);
  });
});
