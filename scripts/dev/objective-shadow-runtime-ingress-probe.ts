/**
 * Run the four real ingress functions once each and keep records off the
 * synthetic observe-API corpus. HMAC comes from KEY_FILE only.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const EVIDENCE_DIR = path.join(
  process.env.HOME ?? "",
  ".openbot",
  "logs",
  "objective-shadow-evidence",
);
const KEY_FILE =
  process.env.OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE?.trim() ||
  path.join(process.env.HOME ?? "", ".openbot", "secrets", "objective-shadow-hmac");

const JOBS = [
  {
    ingress: "chat",
    log: path.join(EVIDENCE_DIR, "chat.jsonl"),
    file: "src/objective-shadow/get-reply-run.ingress.test.ts",
    testName: "ON writes at most one chat record whose objective comes from ConversationTask",
  },
  {
    ingress: "cron_isolated",
    log: path.join(EVIDENCE_DIR, "cron.jsonl"),
    file: "src/cron/isolated-agent/run.objective-shadow.test.ts",
    testName:
      "ON observes a current-format PersonalCron job with stable objective and distinct occurrences",
  },
  {
    ingress: "collaboration_turn",
    log: path.join(EVIDENCE_DIR, "collab.jsonl"),
    file: "src/gateway/collaboration-dispatch/round-runtime.objective-shadow.test.ts",
    testName: "ON records discarded collaboration observation, not exclusive execute",
  },
  {
    ingress: "subagent",
    log: path.join(EVIDENCE_DIR, "subagent.jsonl"),
    file: "src/agents/subagent-spawn.objective-shadow.test.ts",
    testName:
      "ON records inherit_violation when parent snapshot is missing and does not change spawn result",
  },
] as const;

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function runVitest(file: string, testName: string, logPath: string): void {
  const env = {
    ...process.env,
    OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW: "1",
    OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE: KEY_FILE,
    OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_EVIDENCE_LOG: logPath,
    OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_LOG: logPath,
  };
  delete env.OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY;
  const result = spawnSync(
    "pnpm",
    ["exec", "vitest", "run", file, "-t", testName, "--reporter=dot"],
    { cwd: ROOT, env, encoding: "utf8" },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`vitest failed: ${file} :: ${testName}`);
  }
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
if (!KEY_FILE || readFileSync(KEY_FILE, "utf8").trim().length === 0) {
  throw new Error("HMAC key file missing; run scripts/dev/objective-shadow-hmac-inject.sh ensure");
}

for (const job of JOBS) {
  runVitest(job.file, job.testName, job.log);
}

const mergedPath = path.join(EVIDENCE_DIR, "objective-shadow.runtime-callsite.jsonl");
const merged = JOBS.flatMap((job) =>
  readFileSync(job.log, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean),
);
writeFileSync(mergedPath, `${merged.join("\n")}\n`, "utf8");

runVitest(
  "src/agents/subagent-spawn.objective-shadow.test.ts",
  "ON inherits parent snapshot when parentRunId matches a prior chat record",
  mergedPath,
);

const records = readFileSync(mergedPath, "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as { correlation: { runId: string; ingress: string } });

const summary = {
  schemaVersion: "objective-shadow-source-manifest/v1",
  kind: "runtime_callsite_harness",
  hmacHosting: {
    kind: "macos-keychain",
    service: "openbot.objective-shadow.hmac",
    account: "OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY",
    materializedFile: "~/.openbot/secrets/objective-shadow-hmac",
    inject: "OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE",
    keyDisclosed: false,
  },
  mergedLog: mergedPath.replace(process.env.HOME ?? "", "~"),
  sha256: sha256File(mergedPath),
  recordCount: records.length,
  byIngress: Object.fromEntries(
    [...new Set(records.map((record) => record.correlation.ingress))].map((ingress) => [
      ingress,
      records.filter((record) => record.correlation.ingress === ingress).length,
    ]),
  ),
  runIds: records.map((record) => record.correlation.runId),
};
writeFileSync(
  path.join(EVIDENCE_DIR, "runtime-callsite.manifest.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify({ ok: true, ...summary }, null, 2)}\n`);
