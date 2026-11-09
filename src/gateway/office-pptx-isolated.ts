import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const INPUT_LIMIT = 50 * 1024 * 1024;
const OUTPUT_LIMIT = 34 * 1024 * 1024;
// Single process-local conversion, with same-content in-flight sharing. No unbounded job queue.
const log = createSubsystemLogger("gateway/pptx-preview");
let cleanupFailed = false;
const daemon =
  process.platform === "darwin"
    ? `unix://${path.join(os.homedir(), ".docker/run/docker.sock")}`
    : "unix:///var/run/docker.sock";

let active: { key: string; result: Promise<string | null> } | undefined;

function convert(buffer: Buffer, pages: number): Promise<string | null> {
  return new Promise((resolve) => {
    const name = `openbot-pptx-preview-${randomUUID()}`;
    const args = [
      "--host",
      daemon,
      "run",
      "--pull=never",
      "--rm",
      "-i",
      "--name",
      name,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      "768m",
      "--cpus",
      "1",
      "--pids-limit",
      "64",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=256m",
      "openbot-pptx-renderer:1",
      String(pages),
    ];
    const child = execFile(
      "docker",
      args,
      {
        timeout: 35_000,
        maxBuffer: OUTPUT_LIMIT,
        killSignal: "SIGKILL",
        windowsHide: true,
        // Do not pass Gateway secrets or remote daemon configuration to the renderer client.
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      },
      (error, stdout) => {
        if (error) {
          // A killed Docker client can leave the worker alive. Bounded cleanup targets our UUID only.
          execFile(
            "docker",
            ["--host", daemon, "rm", "-f", name],
            { timeout: 5_000, env: { PATH: process.env.PATH, HOME: process.env.HOME } },
            (cleanupError) => {
              if (cleanupError) {
                cleanupFailed = true;
                log.warn(
                  "PPTX renderer cleanup failed; further conversions disabled until restart",
                );
              }
              resolve(null);
            },
          );
          return;
        }
        resolve(stdout.includes("data:image/png;base64,") ? stdout : null);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(buffer);
  });
}

/** Local isolated static rendering; unavailable capacity/capability preserves the labelled fallback. */
export async function renderPptxIsolatedPreview(
  buffer: Buffer,
  _title: string,
  pages: number,
): Promise<string | null> {
  if (
    cleanupFailed ||
    !buffer.length ||
    buffer.length > INPUT_LIMIT ||
    !Number.isSafeInteger(pages) ||
    pages < 1 ||
    pages > 60
  ) {
    return null;
  }
  const key = createHash("sha256").update(buffer).update(String(pages)).digest("hex");
  if (active) {
    return active.key === key ? active.result : null;
  }
  const result = convert(buffer, pages);
  active = { key, result };
  try {
    return await result;
  } finally {
    if (active?.result === result) {
      active = undefined;
    }
  }
}
