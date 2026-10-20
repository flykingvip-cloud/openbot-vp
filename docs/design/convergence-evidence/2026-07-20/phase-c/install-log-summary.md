# Phase C — install log summary

| Field                 | Value                                      |
| --------------------- | ------------------------------------------ |
| Command               | `pnpm install` (cwd = openbot-convergence) |
| Result                | **SUCCESS**                                |
| Duration              | ~13.5s                                     |
| Lockfile rewritten?   | **No** (`LOCKFILE_DIRTY=no`)               |
| `package.json` dirty? | **No**                                     |

## Notable warnings

- pnpm ignored build scripts for: `@discordjs/opus`, `@google/genai`, `@tloncorp/tlon-skill`, `msw`, `openclaw`, `tree-sitter-bash` (approve-builds prompt). Does not block install.
- `prepare` hook set `core.hooksPath` to `git-hooks` (expected).

## Side effects (not committed)

- Extension `node_modules/.bin/*` symlink noise after install — left unstaged / discard; not part of Phase C deliverables.

## Verdict

Install baseline is **green** on locked SHA.
