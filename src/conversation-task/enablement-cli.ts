import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { ConversationTaskConfigStore } from "./config-store.js";
import {
  readEnablementStatusView,
  setShadowFlag,
  setTenantAllowlistEntry,
  type EnablementWriteResult,
} from "./enablement.js";
import { ConversationTaskStoreError } from "./errors.js";

type WriteOpts = {
  actor?: string;
  reason?: string;
  confirm?: boolean;
  json?: boolean;
};

function logLine(line: string): void {
  defaultRuntime.log(line);
}

function printResult(result: EnablementWriteResult, json: boolean): void {
  if (json) {
    logLine(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.applied) {
    logLine(`dry-run ${result.kind}; pass --confirm to apply`);
    return;
  }
  logLine(`applied ${result.kind} stateVersion=${result.stateVersion}`);
}

/** Parent `--json` is captured on `conversation-task`; subcommands must still honor it. */
function wantsJson(opts: WriteOpts, command: Command): boolean {
  return Boolean(opts.json) || Boolean(command.parent?.opts<{ json?: boolean }>().json);
}

function fail(error: unknown): void {
  const message =
    error instanceof ConversationTaskStoreError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  defaultRuntime.error(message);
  process.exitCode = error instanceof ConversationTaskStoreError ? 2 : 1;
}

function withStore<T>(fn: (store: ConversationTaskConfigStore) => T): T {
  const store = new ConversationTaskConfigStore();
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

export function registerConversationTaskCli(program: Command): void {
  const cmd = program
    .command("conversation-task")
    .description("Shadow-only ConversationTask enablement (ops). Does not activate tasks.")
    .option("--json", "Print JSON", false)
    .action((opts: { json?: boolean }) => {
      withStore((store) => {
        const view = readEnablementStatusView(store);
        logLine(JSON.stringify(view, null, opts.json ? 2 : 2));
      });
    });

  cmd
    .command("status")
    .description(
      "Read detection/qualification flags and allowlist counts (no plaintext tenant ids)",
    )
    .option("--json", "Print JSON", true)
    .action((opts: { json?: boolean }) => {
      withStore((store) => {
        const view = readEnablementStatusView(store);
        logLine(JSON.stringify(view, null, 2));
        void opts;
      });
    });

  cmd
    .command("allow-tenant")
    .description("Allow a tenant on the shadow allowlist (dry-run unless --confirm)")
    .argument("<tenantId>", "Trusted tenant id")
    .requiredOption("--actor <id>", "Operator identity recorded in the store")
    .requiredOption("--reason <text>", "Why this change is being made")
    .option("--confirm", "Apply the change", false)
    .option("--json", "Print JSON", false)
    .action((tenantId: string, opts: WriteOpts, command: Command) => {
      try {
        const result = withStore((store) =>
          setTenantAllowlistEntry({
            store,
            tenantId,
            enabled: true,
            actor: opts.actor ?? "",
            reason: opts.reason ?? "",
            confirm: Boolean(opts.confirm),
          }),
        );
        printResult(result, wantsJson(opts, command));
      } catch (error) {
        fail(error);
      }
    });

  cmd
    .command("deny-tenant")
    .description("Remove a tenant from the shadow allowlist (dry-run unless --confirm)")
    .argument("<tenantId>", "Trusted tenant id")
    .requiredOption("--actor <id>", "Operator identity recorded in the store")
    .requiredOption("--reason <text>", "Why this change is being made")
    .option("--confirm", "Apply the change", false)
    .option("--json", "Print JSON", false)
    .action((tenantId: string, opts: WriteOpts, command: Command) => {
      try {
        const result = withStore((store) =>
          setTenantAllowlistEntry({
            store,
            tenantId,
            enabled: false,
            actor: opts.actor ?? "",
            reason: opts.reason ?? "",
            confirm: Boolean(opts.confirm),
          }),
        );
        printResult(result, wantsJson(opts, command));
      } catch (error) {
        fail(error);
      }
    });

  cmd
    .command("enable")
    .description("Enable detection or qualification (dry-run unless --confirm)")
    .argument("<flag>", "detection | qualification")
    .requiredOption("--actor <id>", "Operator identity recorded in the store")
    .requiredOption("--reason <text>", "Why this change is being made")
    .option("--confirm", "Apply the change", false)
    .option("--json", "Print JSON", false)
    .action((flag: string, opts: WriteOpts, command: Command) => {
      try {
        const result = withStore((store) =>
          setShadowFlag({
            store,
            flag,
            enabled: true,
            actor: opts.actor ?? "",
            reason: opts.reason ?? "",
            confirm: Boolean(opts.confirm),
          }),
        );
        printResult(result, wantsJson(opts, command));
      } catch (error) {
        fail(error);
      }
    });

  cmd
    .command("disable")
    .description("Disable detection or qualification (dry-run unless --confirm)")
    .argument("<flag>", "detection | qualification")
    .requiredOption("--actor <id>", "Operator identity recorded in the store")
    .requiredOption("--reason <text>", "Why this change is being made")
    .option("--confirm", "Apply the change", false)
    .option("--json", "Print JSON", false)
    .action((flag: string, opts: WriteOpts, command: Command) => {
      try {
        const result = withStore((store) =>
          setShadowFlag({
            store,
            flag,
            enabled: false,
            actor: opts.actor ?? "",
            reason: opts.reason ?? "",
            confirm: Boolean(opts.confirm),
          }),
        );
        printResult(result, wantsJson(opts, command));
      } catch (error) {
        fail(error);
      }
    });
}
