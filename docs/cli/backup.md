---
summary: "CLI reference for `openbot backup` (create local backup archives)"
read_when:
  - You want a first-class backup archive for local OpenBot state
  - You want to preview which paths would be included before reset or uninstall
title: "backup"
---

# `openbot backup`

Create a local backup archive for OpenBot state, config, sessions, and optionally workspaces. OAuth/credentials are **excluded by default**; pass `--include-credentials` to opt in.

**Trust assumption (local filesystem command):** `backup` does **not** call the Gateway. It reads and writes paths resolved under the process OS user's local OpenBot state/config (usually `~/.openbot`). Whoever can run the CLI as that OS user can archive those files. There is no Gateway token/role check on this path.

```bash
openbot backup create
openbot backup create --output ~/Backups
openbot backup create --dry-run --json
openbot backup create --verify
openbot backup create --no-include-workspace
openbot backup create --include-credentials
openbot backup create --only-config
openbot backup verify ./2026-03-09T00-00-00.000Z-openclaw-backup.tar.gz
```

## Notes

- The archive includes a `manifest.json` file with the resolved source paths and archive layout.
- Default output is a timestamped `.tar.gz` archive in the current working directory.
- If the current working directory is inside a backed-up source tree, OpenBot falls back to your home directory for the default archive location.
- Existing archive files are never overwritten.
- Output paths inside the source state/workspace trees are rejected to avoid self-inclusion.
- `openbot backup verify <archive>` validates that the archive contains exactly one root manifest, rejects traversal-style archive paths, and checks that every manifest-declared payload exists in the tarball.
- `openbot backup create --verify` runs that validation immediately after writing the archive.
- `openbot backup create --only-config` backs up just the active JSON config file.
- `openbot backup create --include-credentials` opts in to packing the OAuth/credentials directory (excluded by default, including when it lives under the state directory).

## What gets backed up

`openbot backup create` plans backup sources from your local OpenBot install:

- The state directory returned by OpenBot's local state resolver, usually `~/.openbot` (legacy installs may still use `~/.openclaw`)
- The active config file path
- Workspace directories discovered from the current config, unless you pass `--no-include-workspace`
- The OAuth / credentials directory **only when** you pass `--include-credentials`

If you use `--only-config`, OpenBot skips state, credentials, and workspace discovery and archives only the active config file path.

OpenBot canonicalizes paths before building the archive. If config or a workspace already live inside the state directory, they are not duplicated as separate top-level backup sources. Missing paths are skipped. When credentials are excluded (default), the credentials path is recorded as skipped with reason `excluded`, and any credentials tree under state is filtered out of the archive payload.

The archive payload stores file contents from those source trees, and the embedded `manifest.json` records the resolved absolute source paths plus the archive layout used for each asset.

## Invalid config behavior

`openbot backup` intentionally bypasses the normal config preflight so it can still help during recovery. Because workspace discovery depends on a valid config, `openbot backup create` now fails fast when the config file exists but is invalid and workspace backup is still enabled.

If you still want a partial backup in that situation, rerun:

```bash
openbot backup create --no-include-workspace
```

That keeps state and config in scope while skipping workspace discovery entirely. Credentials remain excluded unless you also pass `--include-credentials`.

If you only need a copy of the config file itself, `--only-config` also works when the config is malformed because it does not rely on parsing the config for workspace discovery.

## Size and performance

OpenBot does not enforce a built-in maximum backup size or per-file size limit.

Practical limits come from the local machine and destination filesystem:

- Available space for the temporary archive write plus the final archive
- Time to walk large workspace trees and compress them into a `.tar.gz`
- Time to rescan the archive if you use `openbot backup create --verify` or run `openbot backup verify`
- Filesystem behavior at the destination path. OpenBot prefers a no-overwrite hard-link publish step and falls back to exclusive copy when hard links are unsupported

Large workspaces are usually the main driver of archive size. If you want a smaller or faster backup, use `--no-include-workspace`.

For the smallest archive, use `--only-config`.
