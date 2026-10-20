/**
 * Attach agent browser control to an already-RUNNING Account Computer.
 *
 * Control UI `browser.preview` can show the shared desktop while classic
 * `agents.defaults.sandbox.mode=off` + personal_local leave the agent on the
 * host openclaw/chrome profiles. When a worker journal is RUNNING, point the
 * existing browser-control bridge at that container (same screen as 电脑 tab).
 * Does not start a second desktop.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveAccountWorkerBrowserControl } from "./account-worker-browser-bridge.js";
import { isAccountWorkerDockerDriverEnabled } from "./account-worker-driver.js";
import { SANDBOX_STATE_DIR } from "./constants.js";
import type { SandboxBrowserContext } from "./types.js";

/**
 * Legacy local-preview alias. Kept for docs/ops that already set it in
 * ~/.openbot/.env; attach itself is gated by the docker driver below.
 */
export const ACCOUNT_WORKER_LOCAL_PREVIEW_FLAG = "OPENBOT_ACCOUNT_WORKER_LOCAL_PREVIEW";

type WorkerJournalLite = {
  version?: number;
  phase?: string;
  tenantId?: string;
  userId?: string;
  browserContainerName?: string | null;
};

/**
 * Production-appropriate gate: Account Worker docker driver on.
 * Only reuses an already-RUNNING browser container (no create, no second
 * desktop). Does not require sandbox.mode=all. LOCAL_PREVIEW is no longer
 * required — it remains a documented local opt-in alias only.
 */
export function isAccountComputerRunningAttachEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isAccountWorkerDockerDriverEnabled(env);
}

async function readWorkerJournal(
  tenantId: string,
  userId: string,
): Promise<WorkerJournalLite | null> {
  const statePath = path.join(
    SANDBOX_STATE_DIR,
    "account-worker",
    "workers",
    tenantId,
    userId,
    "worker.json",
  );
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw) as WorkerJournalLite;
  } catch {
    return null;
  }
}

/**
 * If the account's Account Worker browser is RUNNING, attach the control bridge.
 * Returns null when docker driver is off, journal missing/not RUNNING, or CDP unavailable.
 */
async function findRunningWorkerForUser(userId: string): Promise<{
  tenantId: string;
  userId: string;
  containerName: string;
} | null> {
  const workersRoot = path.join(SANDBOX_STATE_DIR, "account-worker", "workers");
  let tenants: string[] = [];
  try {
    tenants = await fs.readdir(workersRoot);
  } catch {
    return null;
  }
  for (const tenantId of tenants) {
    const journal = await readWorkerJournal(tenantId, userId);
    if (
      !journal ||
      journal.version !== 1 ||
      journal.phase !== "RUNNING" ||
      journal.userId !== userId
    ) {
      continue;
    }
    const containerName = journal.browserContainerName?.trim() ?? "";
    if (!containerName) {
      continue;
    }
    return {
      tenantId: journal.tenantId?.trim() || tenantId,
      userId,
      containerName,
    };
  }
  return null;
}

export async function tryAttachRunningAccountComputerBrowser(params: {
  tenantId?: string;
  userId: string;
  config?: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<SandboxBrowserContext | null> {
  const env = params.env ?? process.env;
  if (!isAccountComputerRunningAttachEnabled(env)) {
    return null;
  }
  const userId = params.userId.trim();
  if (!userId || userId.includes("@")) {
    return null;
  }
  let tenantId = params.tenantId?.trim() ?? "";
  let containerName = "";
  if (tenantId) {
    const journal = await readWorkerJournal(tenantId, userId);
    if (
      journal &&
      journal.version === 1 &&
      journal.phase === "RUNNING" &&
      journal.userId === userId
    ) {
      containerName = journal.browserContainerName?.trim() ?? "";
      tenantId = journal.tenantId?.trim() || tenantId;
    }
  }
  if (!containerName) {
    const found = await findRunningWorkerForUser(userId);
    if (!found) {
      return null;
    }
    tenantId = found.tenantId;
    containerName = found.containerName;
  }
  if (!tenantId || !containerName) {
    return null;
  }
  const control = await resolveAccountWorkerBrowserControl({
    tenantId,
    userId,
    containerName,
    config: params.config,
    env,
  });
  if (control.status !== "attached") {
    return null;
  }
  return control.browser;
}
