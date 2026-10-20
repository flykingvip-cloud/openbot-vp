import { buildCrawlArgv } from "./contract.js";
import { runAdapterProcess, type RunAdapterProcessParams } from "./process-runner.js";
import type { CrawlMode, MonitorPlatform, ProcessRunResult } from "./types.js";

export type CrawlRequest = {
  platform: MonitorPlatform;
  accountId: string;
  accountUrl?: string;
  mode: CrawlMode;
  contentId?: string;
  command: string[];
  cwd?: string;
  cookieValue?: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  signal?: AbortSignal;
};

export async function crawlViaAdapter(req: CrawlRequest): Promise<ProcessRunResult> {
  const extraArgv = buildCrawlArgv({
    platform: req.platform,
    accountId: req.accountId,
    accountUrl: req.accountUrl,
    mode: req.mode,
    contentId: req.contentId,
  });

  const env: RunAdapterProcessParams["env"] = {};
  if (req.cookieValue) {
    // Passed only via env; never argv and never logs.
    env.OPENBOT_MEDIA_COOKIE = req.cookieValue;
  }

  return await runAdapterProcess({
    command: req.command,
    extraArgv,
    cwd: req.cwd,
    env,
    timeoutMs: req.timeoutMs,
    maxStdoutBytes: req.maxStdoutBytes,
    signal: req.signal,
  });
}
