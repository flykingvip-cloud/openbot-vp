---
summary: "CLI reference for `openbot local-files` (grant and answer reads of a user's own computer)"
read_when:
  - You want a digital employee to read a file on a user's own machine
  - You need to bind or revoke a read-only device
  - You need to answer a pending disk read request from the terminal
title: "local-files"
---

# `openbot local-files`

Grant and answer reads of a user's own computer.

A digital employee running on the gateway cannot see files on a user's laptop: the file is on another machine, and gateway-side execution stays inside the employee's workspace root. This command group manages the authorization that lets one bound, read-only device be read on the user's behalf.

Reads are **read only**. There is no write, delete, move or execute path, and the shell is never used.

<Note>
This is a non-production prototype. Production node pairing and rollout are not enabled. Use it against a non-production gateway.
</Note>

Related:

- Nodes: [`openbot nodes`](/cli/nodes)
- Exec approvals, a separate mechanism for shell: [Exec approvals](/tools/exec-approvals)

## How the authorization works

Three things must all hold before a read happens:

1. **A device binding.** An administrator binds one connected read-only node to one user and names which digital employees may read it. The device key comes from the live authenticated node connection, never from the command line.
2. **Authority for the specific read.** Either the user named the path in their own message this turn, or they answered an approval request for it.
3. **A single-use capability.** The gateway mints one short-lived token per read, bound to the exact path and operation, and redeems it atomically so it cannot be replayed.

Directory-level and long-lived directory grants are deliberately not offered. Each file is authorized on its own.

## Bindings

Show which devices may be read. Revoked rows are kept as an audit trail.

```bash
openbot local-files binding list
```

Bind a connected read-only node to one user's digital employees. Repeat `--agent` for several.

```bash
openbot local-files binding create \
  --node <nodeId> \
  --tenant <tenantId> \
  --user <userId> \
  --agent bot-skill
```

Withdraw a binding immediately. Capabilities already issued under it stop working.

```bash
openbot local-files binding revoke --node <nodeId>
```

## Approvals

When an employee wants to read a path the user did not name this turn, the read waits for an answer.

```bash
openbot local-files approval list
```

Answer one request. These two verbs match the two buttons on the approval card.

```bash
openbot local-files approval allow <id>
openbot local-files approval deny <id>
```

There is deliberately no "allow always". Each grant covers one read, because the capability is single use by construction.

## Options

Every subcommand accepts:

| Option                | Meaning                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `--url <url>`         | Gateway WebSocket URL. Defaults to `gateway.remote.url` when set. |
| `--token <token>`     | Gateway token, when the gateway requires one.                     |
| `--password <password>` | Gateway password, when the gateway uses password auth.          |
| `--timeout <ms>`      | Timeout in milliseconds. Defaults to `10000`.                     |
| `--json`              | Output JSON instead of a table.                                   |

These options inherit Gateway auth: `local-files` RPCs go through `callGatewayFromCli` (CLI client name/mode). Device binding keys are taken from the live authenticated node connection gateway-side, never from the CLI argv.

## What a bound device may do

A device bound for disk reads runs a restricted command set and nothing else. Both the gateway and the node refuse anything outside it, so a configuration mistake on one side does not open the other.

Permitted: file stat, directory list, bounded file read, archive list, archive entry read.

Refused on such a device: every `system.*` command, including shell execution.

## Paths that are never readable

Credential and system locations are refused outright, at three independent layers, with the node as the last check. Sensitive names and content types inside an archive are refused the same way. Files with more than one hard link are refused by default, because checking the final path name cannot prove the same inode is not also linked into a sensitive directory.
