/**
 * 跨进程复用计数安全性（真实多进程）。
 *
 * 进程内 `createAsyncLock` 只能串行同一 gateway 内的 turn；多个 gateway 实例共享同一
 * workspace 时仍会丢计数。这里用**两个真实 node 子进程**同时对同一作用域记账，验证
 * 外层文件锁把它们互斥开：最终计数必须等于总记账次数，不能丢。
 *
 * 注意：`withFileLock` 在同一进程内是可重入的（按路径引用计数），所以这个用例只能用
 * 真子进程来证明跨进程互斥，单进程并发只覆盖到内层锁。
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const WORKER = path.join(REPO_ROOT, "src/auto-reply/reply/__fixtures__/learning-reuse-worker.mjs");

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-xproc-reuse-"));

afterAll(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

const SCOPE_ID = "agent:xproc-bot";
const ASSET_ID = "asset-hot";
const INCREMENTS_PER_WORKER = 12;

function seedAsset(): string {
  const groupDir = path.join(
    stateDir,
    "workspace",
    ".openbot",
    "collaboration",
    "groups",
    encodeURIComponent(SCOPE_ID),
  );
  fs.mkdirSync(groupDir, { recursive: true });
  const file = path.join(groupDir, "learning-assets.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      assets: [
        {
          assetId: ASSET_ID,
          botId: "xproc-bot",
          sourceGroupId: SCOPE_ID,
          sourceCapsuleId: "cap-1",
          assetType: "lesson",
          status: "active",
          reuseCount: 0,
          abstractedContent: { lesson: "跨进程复用计数" },
        },
      ],
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(stateDir, "openbot.json"),
    JSON.stringify({ agents: { defaults: { workspace: path.join(stateDir, "workspace") } } }),
    "utf-8",
  );
  return file;
}

function readReuseCount(file: string): number {
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    assets?: Array<{ assetId: string; reuseCount?: number }>;
  };
  return raw.assets?.find((a) => a.assetId === ASSET_ID)?.reuseCount ?? -1;
}

describe("cross-process learning reuse accounting", () => {
  it("two separate processes do not lose reuse increments", async () => {
    const file = seedAsset();
    expect(readReuseCount(file)).toBe(0);

    const env = {
      ...process.env,
      OPENBOT_STATE_DIR: stateDir,
      OPENBOT_CONFIG_PATH: path.join(stateDir, "openbot.json"),
      OPENCLAW_CONFIG_PATH: path.join(stateDir, "openbot.json"),
      CLAWDBOT_CONFIG_PATH: path.join(stateDir, "openbot.json"),
      OPENBOT_XPROC_SCOPE: SCOPE_ID,
      OPENBOT_XPROC_ASSET: ASSET_ID,
      OPENBOT_XPROC_COUNT: String(INCREMENTS_PER_WORKER),
    };

    const run = () =>
      execFileAsync(process.execPath, ["--import", "tsx", WORKER], {
        cwd: REPO_ROOT,
        env,
        timeout: 120_000,
      });

    const [a, b] = await Promise.all([run(), run()]);
    expect(a.stdout).toContain("worker-done");
    expect(b.stdout).toContain("worker-done");

    // 两个进程各记 N 次，无丢失则总数为 2N。
    expect(readReuseCount(file)).toBe(INCREMENTS_PER_WORKER * 2);
  }, 180_000);
});
