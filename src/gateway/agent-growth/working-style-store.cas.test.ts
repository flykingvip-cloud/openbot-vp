import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, it, expect } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "./genome.js";
import {
  compareAndSwapRobotWorkingStyle,
  readRobotWorkingStyleOrDefault,
  workingStyleVersion,
  writeRobotWorkingStyle,
  updateRobotWorkingStyle,
} from "./working-style-store.js";
const roots: string[] = [];
const run = promisify(execFile);
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "working-style-cas-"));
  roots.push(root);
  const cfg: OpenBotConfig = { agents: { list: [{ id: "bot", agentDir: root }] } };
  return { root, cfg };
}
describe("WorkingStyle locked content CAS", () => {
  it("serializes two independent processes sharing one expected content version", async () => {
    const { root, cfg } = await setup();
    const module = fileURLToPath(new URL("./working-style-store.ts", import.meta.url));
    const version = workingStyleVersion(DEFAULT_WORKING_STYLE);
    const worker = path.join(root, "worker.mjs");
    await fs.writeFile(
      worker,
      "import {compareAndSwapRobotWorkingStyle} from " +
        JSON.stringify(module) +
        ';const cfg=JSON.parse(process.argv[2]);const r=await compareAndSwapRobotWorkingStyle(cfg,"bot",process.argv[3],current=>({...current,communicationTone:process.argv[4]}));process.stdout.write(JSON.stringify(r));',
    );
    const results = await Promise.all(
      ["friendly", "formal"].map((tone) =>
        run(process.execPath, ["--import", "tsx", worker, JSON.stringify(cfg), version, tone]),
      ),
    );
    const parsed = results.map((r) => JSON.parse(r.stdout) as { ok: boolean });
    expect(parsed.filter((r) => r.ok)).toHaveLength(1);
    expect(parsed.filter((r) => !r.ok)).toHaveLength(1);
  });
  it("fails closed on corrupt JSON across all mutation entry points", async () => {
    const { root, cfg } = await setup();
    await fs.writeFile(path.join(root, "working-style.json"), "{broken");
    await expect(
      compareAndSwapRobotWorkingStyle(
        cfg,
        "bot",
        workingStyleVersion(DEFAULT_WORKING_STYLE),
        (x) => x,
      ),
    ).rejects.toThrow();
    await expect(updateRobotWorkingStyle(cfg, "bot", (x) => x)).rejects.toThrow();
    await expect(writeRobotWorkingStyle(cfg, "bot", DEFAULT_WORKING_STYLE)).rejects.toThrow();
    expect(await fs.readFile(path.join(root, "working-style.json"), "utf8")).toBe("{broken");
  });
  it("initializes a missing file and rejects a stale version without writing", async () => {
    const { cfg } = await setup();
    const version = workingStyleVersion(DEFAULT_WORKING_STYLE);
    const first = await compareAndSwapRobotWorkingStyle(cfg, "bot", version, (x) => ({
      ...x,
      riskPreference: "conservative",
    }));
    expect(first.ok).toBe(true);
    expect(
      (
        await compareAndSwapRobotWorkingStyle(cfg, "bot", version, (x) => ({
          ...x,
          communicationTone: "formal",
        }))
      ).ok,
    ).toBe(false);
    expect((await readRobotWorkingStyleOrDefault(cfg, "bot")).communicationTone).toBe("neutral");
  });
  it("rejects invalid next values without altering bytes", async () => {
    const { root, cfg } = await setup();
    await writeRobotWorkingStyle(cfg, "bot", DEFAULT_WORKING_STYLE);
    const file = path.join(root, "working-style.json");
    const before = await fs.readFile(file, "utf8");
    const invalid = {
      ...DEFAULT_WORKING_STYLE,
      riskPreference: "invalid",
    } as unknown as typeof DEFAULT_WORKING_STYLE;
    await expect(writeRobotWorkingStyle(cfg, "bot", invalid)).rejects.toThrow();
    await expect(updateRobotWorkingStyle(cfg, "bot", () => invalid)).rejects.toThrow();
    await expect(
      compareAndSwapRobotWorkingStyle(
        cfg,
        "bot",
        workingStyleVersion(DEFAULT_WORKING_STYLE),
        () => invalid,
      ),
    ).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
  it("shares a lock for symlinked agent directories", async () => {
    const { root, cfg } = await setup();
    const alias = root + "-alias";
    roots.push(alias);
    await fs.symlink(root, alias);
    const other: OpenBotConfig = { agents: { list: [{ id: "bot", agentDir: alias }] } };
    const version = workingStyleVersion(DEFAULT_WORKING_STYLE);
    const results = await Promise.all([
      compareAndSwapRobotWorkingStyle(cfg, "bot", version, (x) => ({
        ...x,
        communicationTone: "friendly",
      })),
      compareAndSwapRobotWorkingStyle(other, "bot", version, (x) => ({
        ...x,
        communicationTone: "formal",
      })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
