/**
 * Cross-process helper for FileExecStore single-writer tests.
 * Usage: node --import tsx src/exec-protocol/store-lock-worker.ts <dir> <readyPath> <resultPath> <mode>
 *   hold              – acquire, write ready, hold until SIGTERM (graceful close) or SIGKILL
 *   acquire-once      – acquire, write result, hold until SIGTERM
 */
import { writeFile } from "node:fs/promises";
import { FileExecStore } from "./store.js";

const [dir, readyPath, resultPath, mode] = process.argv.slice(2);

if (!dir || !readyPath || !resultPath || !mode) {
  process.stderr.write("store-lock-worker: missing arguments\n");
  process.exit(2);
}

const store = new FileExecStore(dir);

async function writeResult(payload: Record<string, unknown>): Promise<void> {
  await writeFile(resultPath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function writeReady(): Promise<void> {
  await writeFile(readyPath, `${JSON.stringify({ pid: process.pid, ready: true })}\n`, "utf8");
}

try {
  await store.load();
  await writeResult({ ok: true, pid: process.pid, mode });
  await writeReady();
  const shutdown = async () => {
    await store.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  if (mode !== "hold" && mode !== "acquire-once") {
    await store.close();
    process.exit(0);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await writeResult({ ok: false, pid: process.pid, mode, error: message });
    await writeReady();
  } catch {
    // The parent times out if this process cannot write a result.
  }
  process.exit(1);
}
