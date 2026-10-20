/**
 * `openbot local-files` — operate the local disk read grant.
 *
 * Two groups, matching the two authorities the design separates:
 *
 * - `binding`: which device's disk may be read, for which user, by which digital
 *   humans. A standing grant.
 * - `approval`: answering one card for one bounded task. Single use.
 *
 * Kept out of the existing `approvals` group on purpose: that group edits shell-exec
 * approval *configuration*, while these commands answer live disk-read prompts. Same
 * word, different authority.
 *
 * Note `binding create` takes no device key. The key is read from the live
 * authenticated node connection gateway-side, so there is nothing here for an
 * operator to mistype or substitute.
 * Design: docs/design/openbot-local-disk-read-grant-2026-09-29.md sections 4.3, 4.11.
 */

import type { Command } from "commander";
import { formatTimeAgo } from "../infra/format-time/format-relative.ts";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { renderTable } from "../terminal/table.js";
import { isRich, theme } from "../terminal/theme.js";
import { describeUnknownError } from "./gateway-cli/shared.js";
import { callGatewayFromCli, type GatewayRpcOpts } from "./gateway-rpc.js";
import { formatHelpExamples } from "./help-format.js";

type LocalFilesCliOpts = GatewayRpcOpts & {
  node?: string;
  tenant?: string;
  user?: string;
  agent?: string[];
};

type BindingRow = {
  nodeId: string;
  tenantId: string;
  userId: string;
  allowedAgentIds: string[];
  status: "active" | "revoked";
  createdAtMs: number;
  revokedAtMs?: number;
  devicePublicKeyFingerprint: string;
};

type PendingRow = {
  id: string;
  canonicalPath: string;
  targetKind: string;
  task: string;
  taskDescription: string;
  agentId: string;
  userId: string;
  createdAtMs: number;
  expiresAtMs: number;
};

function tableWidth(): number {
  return Math.max(60, (process.stdout.columns ?? 120) - 1);
}

function muted(text: string): string {
  return isRich() ? theme.muted(text) : text;
}

function heading(text: string): string {
  return isRich() ? theme.heading(text) : text;
}

async function run(label: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    const message = describeUnknownError(err);
    defaultRuntime.error(`local-files ${label} failed: ${message.split("\n")[0]}`);
    defaultRuntime.exit(1);
  }
}

function collectAgent(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function registerBindingCommands(parent: Command): void {
  const binding = parent
    .command("binding")
    .description("Grant or withdraw disk read access for a bound device");

  const list = binding
    .command("list")
    .description("Show device bindings (revoked rows are kept as an audit trail)")
    .action(async (opts: LocalFilesCliOpts) => {
      await run("binding list", async () => {
        const res = (await callGatewayFromCli("localFiles.binding.list", opts, {})) as {
          bindings?: BindingRow[];
        };
        const bindings = res?.bindings ?? [];
        if (opts.json) {
          defaultRuntime.log(JSON.stringify(bindings));
          return;
        }
        if (bindings.length === 0) {
          defaultRuntime.log(muted("No device bindings. No device disk can be read."));
          return;
        }
        const now = Date.now();
        defaultRuntime.log(heading("Device bindings"));
        defaultRuntime.log(
          renderTable({
            width: tableWidth(),
            columns: [
              { key: "Status", header: "Status", minWidth: 8 },
              { key: "Node", header: "Node", minWidth: 12, flex: true },
              { key: "User", header: "User", minWidth: 10 },
              { key: "Agents", header: "Digital humans", minWidth: 12 },
              { key: "Device", header: "Device key", minWidth: 14 },
              { key: "Age", header: "Created", minWidth: 8 },
            ],
            rows: bindings.map((row) => ({
              Status: row.status,
              Node: row.nodeId,
              User: `${row.userId}@${row.tenantId}`,
              Agents: row.allowedAgentIds.join(", "),
              Device: row.devicePublicKeyFingerprint,
              Age: formatTimeAgo(Math.max(0, now - row.createdAtMs)),
            })),
          }).trimEnd(),
        );
      });
    });
  addOptions(list);

  const create = binding
    .command("create")
    .description("Bind a connected read-only node to one user's digital humans")
    .requiredOption("--node <nodeId>", "Node id of the currently connected read-only node")
    .requiredOption("--tenant <tenantId>", "Tenant the device belongs to")
    .requiredOption("--user <userId>", "User whose disk may be read")
    .requiredOption(
      "--agent <agentId>",
      "Digital human allowed to read (repeat for several)",
      collectAgent,
    )
    .addHelpText(
      "after",
      () =>
        `\n${muted(
          "The device key is taken from the live authenticated node connection, not from this command.",
        )}\n`,
    )
    .action(async (opts: LocalFilesCliOpts) => {
      await run("binding create", async () => {
        const res = (await callGatewayFromCli("localFiles.binding.create", opts, {
          nodeId: opts.node,
          tenantId: opts.tenant,
          userId: opts.user,
          allowedAgentIds: opts.agent ?? [],
        })) as { binding?: BindingRow };
        if (opts.json) {
          defaultRuntime.log(JSON.stringify(res?.binding ?? {}));
          return;
        }
        const created = res?.binding;
        defaultRuntime.log(
          `Bound ${created?.nodeId ?? opts.node} to ${created?.userId ?? opts.user} ` +
            `for ${created?.allowedAgentIds.join(", ") ?? ""} (device ${created?.devicePublicKeyFingerprint ?? "?"}).`,
        );
      });
    });
  addOptions(create);

  const revoke = binding
    .command("revoke")
    .description("Withdraw a device binding immediately")
    .requiredOption("--node <nodeId>", "Node id to revoke")
    .action(async (opts: LocalFilesCliOpts) => {
      await run("binding revoke", async () => {
        await callGatewayFromCli("localFiles.binding.revoke", opts, { nodeId: opts.node });
        if (opts.json) {
          defaultRuntime.log(JSON.stringify({ ok: true }));
          return;
        }
        defaultRuntime.log(`Revoked binding for ${opts.node}.`);
      });
    });
  addOptions(revoke);
}

function registerApprovalCommands(parent: Command): void {
  const approval = parent.command("approval").description("Answer a pending disk read request");

  const list = approval
    .command("list")
    .description("Show read requests awaiting an answer")
    .action(async (opts: LocalFilesCliOpts) => {
      await run("approval list", async () => {
        const res = (await callGatewayFromCli("localFiles.approval.list", opts, {})) as {
          pending?: PendingRow[];
        };
        const pending = res?.pending ?? [];
        if (opts.json) {
          defaultRuntime.log(JSON.stringify(pending));
          return;
        }
        if (pending.length === 0) {
          defaultRuntime.log(muted("Nothing awaiting an answer."));
          return;
        }
        const now = Date.now();
        defaultRuntime.log(heading("Pending read requests"));
        defaultRuntime.log(
          renderTable({
            width: tableWidth(),
            columns: [
              { key: "Id", header: "Id", minWidth: 10 },
              { key: "Wants", header: "Wants to", minWidth: 18 },
              { key: "Path", header: "Path", minWidth: 20, flex: true },
              { key: "Agent", header: "Digital human", minWidth: 10 },
              { key: "Expires", header: "Expires in", minWidth: 10 },
            ],
            rows: pending.map((row) => ({
              Id: row.id.slice(0, 8),
              Wants: row.taskDescription,
              Path: row.canonicalPath,
              Agent: row.agentId,
              Expires: formatTimeAgo(Math.max(0, row.expiresAtMs - now)),
            })),
          }).trimEnd(),
        );
        defaultRuntime.log("");
        defaultRuntime.log(
          muted("Answer with: openbot local-files approval allow <id>  |  deny <id>"),
        );
      });
    });
  addOptions(list);

  // Two verbs only, matching the card's two buttons. There is deliberately no
  // "allow always" here: the grant is single use by construction (design 4.11).
  for (const [name, decision, description] of [
    ["allow", "allow-once", "Allow this one read"],
    ["deny", "deny", "Refuse this read"],
  ] as const) {
    const cmd = approval
      .command(`${name} <id>`)
      .description(description)
      .action(async (id: string, opts: LocalFilesCliOpts) => {
        await run(`approval ${name}`, async () => {
          await callGatewayFromCli("localFiles.approval.resolve", opts, { id, decision });
          if (opts.json) {
            defaultRuntime.log(JSON.stringify({ ok: true, id, decision }));
            return;
          }
          defaultRuntime.log(`${name === "allow" ? "Allowed" : "Denied"} ${id}.`);
        });
      });
    addOptions(cmd);
  }
}

function addOptions(cmd: Command): Command {
  return cmd
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--password <password>", "Gateway password (password auth)")
    .option("--timeout <ms>", "Timeout in ms", "10000")
    .option("--json", "Output JSON", false);
}

export function registerLocalFilesCli(program: Command): void {
  const localFiles = program
    .command("local-files")
    .description("Grant and answer reads of a user's own computer")
    .addHelpText(
      "after",
      () =>
        `\n${heading("Examples:")}\n${formatHelpExamples([
          ["openbot local-files binding list", "Show which devices may be read."],
          [
            "openbot local-files binding create --node <id> --tenant <t> --user <u> --agent bot-skill",
            "Bind a connected read-only node to one user.",
          ],
          ["openbot local-files approval list", "Show read requests awaiting an answer."],
          ["openbot local-files approval allow <id>", "Allow one read."],
        ])}\n\n${theme.muted("Docs:")} ${formatDocsLink(
          "/cli/local-files",
          "docs.openbot.love/cli/local-files",
        )}\n`,
    );

  registerBindingCommands(localFiles);
  registerApprovalCommands(localFiles);
}
