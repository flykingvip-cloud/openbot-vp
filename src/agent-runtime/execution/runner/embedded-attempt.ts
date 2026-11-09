import fs from "node:fs/promises";
import { log } from "../../../agents/pi-embedded-runner/logger.js";
import type {
  EmbeddedRunAttemptParams,
  EmbeddedRunAttemptResult,
} from "../../../agents/pi-embedded-runner/run/types.js";
import {
  accountComputerTurnPrompt,
  resolveAccountComputerWebRoute,
} from "../../../agents/sandbox/account-computer-browser-routing.js";
import { resolveEffectiveSandboxWorkspaceDir } from "../../../agents/sandbox/effective-workspace.js";
import { ensureGlobalUndiciStreamTimeouts } from "../../../infra/net/undici-global-dispatcher.js";
import { resolveUserPath } from "../../../utils.js";
import { resolveAttemptSandbox } from "../../capabilities/index.js";
import {
  cleanupEmbeddedAttemptSession,
  cleanupEmbeddedAttemptSubscription,
  runEmbeddedAttemptCloseout,
} from "./embedded-attempt-closeout.js";
import { runEmbeddedAttemptContinue } from "./embedded-attempt-continue.js";
import {
  createEmbeddedAttemptState,
  runEmbeddedAttemptPreflight,
} from "./embedded-attempt-preflight.js";
import { runEmbeddedAttemptPrompt } from "./embedded-attempt-prompt.js";
import { runEmbeddedAttemptStreamInner } from "./embedded-attempt-stream-inner.js";
import { runEmbeddedAttemptStream } from "./embedded-attempt-stream.js";
import { runEmbeddedAttemptTools } from "./embedded-attempt-tools.js";

export async function runEmbeddedAttempt(
  params: EmbeddedRunAttemptParams,
): Promise<EmbeddedRunAttemptResult> {
  const s = createEmbeddedAttemptState();
  s.resolvedWorkspace = resolveUserPath(params.workspaceDir);
  s.prevCwd = process.cwd();
  s.runAbortController = new AbortController();
  ensureGlobalUndiciStreamTimeouts();

  log.debug(
    `embedded run start: runId=${params.runId} sessionId=${params.sessionId} provider=${params.provider} model=${params.modelId} thinking=${params.thinkLevel} messageChannel=${params.messageChannel ?? params.messageProvider ?? "unknown"}`,
  );

  await fs.mkdir(s.resolvedWorkspace, { recursive: true });

  s.sandboxSessionKey = params.sessionKey?.trim() || params.sessionId;
  s.sandbox = await resolveAttemptSandbox(params, s.resolvedWorkspace);
  s.accountComputerRoute =
    s.sandbox?.accountComputerBrowser === true
      ? resolveAccountComputerWebRoute(params.prompt)
      : undefined;
  s.accountComputerTurnPromptText = s.accountComputerRoute
    ? accountComputerTurnPrompt(s.accountComputerRoute)
    : undefined;
  s.effectiveWorkspace = resolveEffectiveSandboxWorkspaceDir({
    resolvedWorkspace: s.resolvedWorkspace,
    sandbox: s.sandbox,
  });
  await fs.mkdir(s.effectiveWorkspace, { recursive: true });

  process.chdir(s.effectiveWorkspace);
  await runEmbeddedAttemptPreflight(params, s);
  try {
    await runEmbeddedAttemptTools(params, s);
    try {
      await runEmbeddedAttemptStream(params, s);
      await runEmbeddedAttemptStreamInner(params, s);
      try {
        await runEmbeddedAttemptPrompt(params, s);
        await runEmbeddedAttemptContinue(params, s);
        return await runEmbeddedAttemptCloseout(params, s);
      } finally {
        cleanupEmbeddedAttemptSubscription(params, s);
      }
    } finally {
      await cleanupEmbeddedAttemptSession(params, s);
    }
  } finally {
    s.restoreSkillEnv?.();
    process.chdir(s.prevCwd);
  }
}
