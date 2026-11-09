import type { ImageContent } from "@earendil-works/pi-ai/compat";
import {
  appendImagePathsToPrompt,
  buildCliArgs,
  buildCliSupervisorScopeKey,
  enqueueCliRun,
  parseCliJson,
  parseCliJsonl,
  resolveCliNoOutputTimeoutMs,
  resolvePromptInput,
  resolveSessionIdToSend,
  resolveSystemPromptUsage,
  writeCliImages,
} from "../../../agents/cli-runner/helpers.js";
import { FailoverError, resolveFailoverStatus } from "../../../agents/failover-error.js";
import { classifyFailoverReason } from "../../../agents/pi-embedded-helpers.js";
import type { CliBackendConfig } from "../../../config/types.js";
import { shouldLogVerbose } from "../../../globals.js";
import { isTruthyEnvValue } from "../../../infra/env.js";
import { requestHeartbeatNow } from "../../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../../infra/system-events.js";
import type { SubsystemLogger } from "../../../logging/subsystem.js";
import { getProcessSupervisor } from "../../../process/supervisor/index.js";
import { scopedHeartbeatWakeOptions } from "../../../routing/session-key.js";

export type CliSpawnSessionOutput = {
  text: string;
  sessionId?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
};

/** Single CLI spawn+parse for a given session id (or new session when undefined). */
export async function executeCliWithSession(args: {
  cliSessionIdToUse?: string;
  backend: CliBackendConfig;
  backendId: string;
  systemPrompt: string;
  prompt: string;
  images?: ImageContent[];
  normalizedModel: string;
  modelId: string;
  provider: string;
  runId: string;
  sessionId: string;
  sessionKey?: string;
  timeoutMs: number;
  workspaceDir: string;
  abortSignal?: AbortSignal;
  credentialEnv?: Record<string, string>;
  assertNotAborted: () => void;
  log: SubsystemLogger;
}): Promise<CliSpawnSessionOutput> {
  const {
    cliSessionIdToUse,
    backend,
    backendId,
    systemPrompt,
    images,
    normalizedModel,
    modelId,
    provider,
    runId,
    sessionId,
    sessionKey,
    timeoutMs,
    workspaceDir,
    abortSignal,
    credentialEnv,
    assertNotAborted,
    log,
  } = args;
  let prompt = args.prompt;

  const { sessionId: resolvedSessionId, isNew } = resolveSessionIdToSend({
    backend,
    cliSessionId: cliSessionIdToUse,
  });
  const useResume = Boolean(
    cliSessionIdToUse && resolvedSessionId && backend.resumeArgs && backend.resumeArgs.length > 0,
  );
  const systemPromptArg = resolveSystemPromptUsage({
    backend,
    isNewSession: isNew,
    systemPrompt,
  });

  let imagePaths: string[] | undefined;
  let cleanupImages: (() => Promise<void>) | undefined;
  if (images && images.length > 0) {
    const imagePayload = await writeCliImages(images);
    imagePaths = imagePayload.paths;
    cleanupImages = imagePayload.cleanup;
    if (!backend.imageArg) {
      prompt = appendImagePathsToPrompt(prompt, imagePaths);
    }
  }

  const { argsPrompt, stdin } = resolvePromptInput({
    backend,
    prompt,
  });
  const stdinPayload = stdin ?? "";
  const baseArgs = useResume ? (backend.resumeArgs ?? backend.args ?? []) : (backend.args ?? []);
  const resolvedArgs = useResume
    ? baseArgs.map((entry) => entry.replaceAll("{sessionId}", resolvedSessionId ?? ""))
    : baseArgs;
  const cliArgs = buildCliArgs({
    backend,
    baseArgs: resolvedArgs,
    modelId: normalizedModel,
    sessionId: resolvedSessionId,
    systemPrompt: systemPromptArg,
    imagePaths,
    promptArg: argsPrompt,
    useResume,
  });

  const serialize = backend.serialize ?? true;
  const queueKey = serialize ? backendId : `${backendId}:${runId}`;

  try {
    const output = await enqueueCliRun(queueKey, async () => {
      assertNotAborted();
      log.info(
        `cli exec: provider=${provider} model=${normalizedModel} promptChars=${args.prompt.length}`,
      );
      const logOutputText = isTruthyEnvValue(process.env.OPENCLAW_CLAUDE_CLI_LOG_OUTPUT);
      if (logOutputText) {
        const logArgs: string[] = [];
        for (let i = 0; i < cliArgs.length; i += 1) {
          const arg = cliArgs[i] ?? "";
          if (arg === backend.systemPromptArg) {
            const systemPromptValue = cliArgs[i + 1] ?? "";
            logArgs.push(arg, `<systemPrompt:${systemPromptValue.length} chars>`);
            i += 1;
            continue;
          }
          if (arg === backend.sessionArg) {
            logArgs.push(arg, cliArgs[i + 1] ?? "");
            i += 1;
            continue;
          }
          if (arg === backend.modelArg) {
            logArgs.push(arg, cliArgs[i + 1] ?? "");
            i += 1;
            continue;
          }
          if (arg === backend.imageArg) {
            logArgs.push(arg, "<image>");
            i += 1;
            continue;
          }
          logArgs.push(arg);
        }
        if (argsPrompt) {
          const promptIndex = logArgs.indexOf(argsPrompt);
          if (promptIndex >= 0) {
            logArgs[promptIndex] = `<prompt:${argsPrompt.length} chars>`;
          }
        }
        log.info(`cli argv: ${backend.command} ${logArgs.join(" ")}`);
      }

      const env = (() => {
        const next = { ...process.env, ...backend.env };
        for (const key of backend.clearEnv ?? []) {
          delete next[key];
        }
        // Governed, SecretRef-resolved per-run credentials win over host env
        // and clearEnv (injected last). Values are never logged.
        if (credentialEnv) {
          Object.assign(next, credentialEnv);
        }
        return next;
      })();
      const noOutputTimeoutMs = resolveCliNoOutputTimeoutMs({
        backend,
        timeoutMs,
        useResume,
      });
      const supervisor = getProcessSupervisor();
      const scopeKey = buildCliSupervisorScopeKey({
        backend,
        backendId,
        cliSessionId: useResume ? resolvedSessionId : undefined,
      });

      assertNotAborted();
      const managedRun = await supervisor.spawn({
        sessionId,
        backendId,
        scopeKey,
        replaceExistingScope: Boolean(useResume && scopeKey),
        mode: "child",
        argv: [backend.command, ...cliArgs],
        timeoutMs,
        noOutputTimeoutMs,
        cwd: workspaceDir,
        env,
        input: stdinPayload,
      });
      const onAbort = () => {
        try {
          managedRun.cancel("manual-cancel");
        } catch {
          log.warn("CLI supervisor cancellation failed; run remains cancelled");
        }
      };
      abortSignal?.addEventListener("abort", onAbort, { once: true });
      let result: Awaited<ReturnType<typeof managedRun.wait>>;
      try {
        // A stop during asynchronous spawn must reach the newly available handle.
        if (abortSignal?.aborted) {
          onAbort();
        }
        result = await managedRun.wait();
        assertNotAborted();
      } finally {
        abortSignal?.removeEventListener("abort", onAbort);
      }

      const stdout = result.stdout.trim();
      const stderr = result.stderr.trim();
      if (logOutputText) {
        if (stdout) {
          log.info(`cli stdout:\n${stdout}`);
        }
        if (stderr) {
          log.info(`cli stderr:\n${stderr}`);
        }
      }
      if (shouldLogVerbose()) {
        if (stdout) {
          log.debug(`cli stdout:\n${stdout}`);
        }
        if (stderr) {
          log.debug(`cli stderr:\n${stderr}`);
        }
      }

      if (result.exitCode !== 0 || result.reason !== "exit") {
        if (result.reason === "no-output-timeout" || result.noOutputTimedOut) {
          const timeoutReason = `CLI produced no output for ${Math.round(noOutputTimeoutMs / 1000)}s and was terminated.`;
          log.warn(
            `cli watchdog timeout: provider=${provider} model=${modelId} session=${resolvedSessionId ?? sessionId} noOutputTimeoutMs=${noOutputTimeoutMs} pid=${managedRun.pid ?? "unknown"}`,
          );
          if (sessionKey) {
            const stallNotice = [
              `CLI agent (${provider}) produced no output for ${Math.round(noOutputTimeoutMs / 1000)}s and was terminated.`,
              "It may have been waiting for interactive input or an approval prompt.",
              "For Claude Code, prefer --permission-mode bypassPermissions --print.",
            ].join(" ");
            enqueueSystemEvent(stallNotice, { sessionKey });
            requestHeartbeatNow(
              scopedHeartbeatWakeOptions(sessionKey, { reason: "cli:watchdog:stall" }),
            );
          }
          throw new FailoverError(timeoutReason, {
            reason: "timeout",
            provider,
            model: modelId,
            status: resolveFailoverStatus("timeout"),
          });
        }
        if (result.reason === "overall-timeout") {
          const timeoutReason = `CLI exceeded timeout (${Math.round(timeoutMs / 1000)}s) and was terminated.`;
          throw new FailoverError(timeoutReason, {
            reason: "timeout",
            provider,
            model: modelId,
            status: resolveFailoverStatus("timeout"),
          });
        }
        const err = stderr || stdout || "CLI failed.";
        const reason = classifyFailoverReason(err) ?? "unknown";
        const status = resolveFailoverStatus(reason);
        throw new FailoverError(err, {
          reason,
          provider,
          model: modelId,
          status,
        });
      }

      const outputMode = useResume ? (backend.resumeOutput ?? backend.output) : backend.output;

      if (outputMode === "text") {
        return { text: stdout, sessionId: undefined };
      }
      if (outputMode === "jsonl") {
        const parsed = parseCliJsonl(stdout, backend);
        return parsed ?? { text: stdout };
      }

      const parsed = parseCliJson(stdout, backend);
      return parsed ?? { text: stdout };
    });

    return output;
  } finally {
    if (cleanupImages) {
      await cleanupImages();
    }
  }
}
