import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  pathContainsOpenclawSegment,
  rewriteOpenclawPathToOpenbotIfPresent,
} from "./openbot-path-rewrite.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fsp.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("rewriteOpenclawPathToOpenbotIfPresent", () => {
  it("rewrites sessionFile to the live .openbot transcript when that file exists", async () => {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), "openbot-rewrite-home-"));
    tempDirs.push(home);
    const group = "grp-glen";
    const rel = path.join(
      "workspace",
      ".openbot",
      "collaboration",
      "groups",
      group,
      "runtime",
      "transcript.jsonl",
    );
    const openclawFile = path.join(home, ".openclaw", rel);
    const openbotFile = path.join(home, ".openbot", rel);
    await fsp.mkdir(path.dirname(openbotFile), { recursive: true });
    await fsp.writeFile(openbotFile, '{"type":"session"}\n', "utf8");
    expect(fs.existsSync(openclawFile)).toBe(false);

    expect(rewriteOpenclawPathToOpenbotIfPresent(openclawFile)).toBe(path.resolve(openbotFile));
    expect(pathContainsOpenclawSegment(openclawFile)).toBe(true);
    expect(pathContainsOpenclawSegment(openbotFile)).toBe(false);
  });

  it("keeps .openclaw when no .openbot equivalent exists", async () => {
    const home = await fsp.mkdtemp(path.join(os.tmpdir(), "openbot-rewrite-legacy-"));
    tempDirs.push(home);
    const openclawFile = path.join(
      home,
      ".openclaw",
      "workspace",
      ".openbot",
      "collaboration",
      "groups",
      "grp-legacy",
      "runtime",
      "transcript.jsonl",
    );
    await fsp.mkdir(path.dirname(openclawFile), { recursive: true });
    await fsp.writeFile(openclawFile, '{"type":"session"}\n', "utf8");
    expect(rewriteOpenclawPathToOpenbotIfPresent(openclawFile)).toBe(path.resolve(openclawFile));
  });
});
