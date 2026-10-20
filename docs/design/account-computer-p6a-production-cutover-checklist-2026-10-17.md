# Account Computer P6a — production cutover checklist

**Date:** 2026-10-17 (Asia/Shanghai)  
**Scope:** Ops honesty for Docker Account Worker e2e + cutover checklist.  
**P6b follow-up:** Dual-flag default-ON is documented in `account-computer-p6b-production-default-on-2026-10-17.md` (this P6a file stays the Docker e2e / honesty checklist).

## Status snapshot

| Layer | State |
|---|---|
| Secure Form + handoff / await_return (P5a/P5b code on tip) | Present on tip; product login path coded |
| Dual-flag Docker Account Worker (prototype) | Opt-in only; memory driver remains default |
| Signed third-party login golden-path e2e | Deferred (P6 golden-path); fixture HTML only |
| Production default-on cutover | See **P6b** brief (`account-computer-p6b-production-default-on-2026-10-17.md`) |

Do **not** claim historical P0–P4 GitHub PRs `#366`–`#372` were merged on GitHub; capability landed later on `main` via subsequent work. Record the **tip SHA** you verified, not a PR number story.

Hand-back Tab label (locked): **「交给AI」** (`computerHandBack`).

## Dual flags (must both be on for Docker path)

| Env | Role |
|---|---|
| `OPENBOT_ACCOUNT_WORKER=1` | Enable Account Worker path |
| `OPENBOT_ACCOUNT_WORKER_DOCKER=1` | Second opt-in: real Docker driver (not memory) |

- Either flag alone is **not** production Docker cutover.
- **P6b:** defaults are **ON** when unset (explicit `0`/`false`/`off` to roll back). Prototype enablement still requires `managed_enterprise` + shared addressing. Live device cutover still needs ops Docker + tip SHA.
- Security profile: **`managed_enterprise` only** for this path. **`personal_local` is never forced** onto Account Worker / Docker (shared addressing stays off for personal).

## Docker Desktop / `DOCKER_HOST`

Vitest isolates `HOME` (`test/setup.ts` → `withIsolatedTestHome`). Docker Desktop on macOS often listens at:

```text
unix://$REAL_HOME/.docker/run/docker.sock
```

not `/var/run/docker.sock`. Gated e2e (`OPENBOT_ACCOUNT_WORKER_DOCKER_E2E=1`) honors an existing `DOCKER_HOST`, else auto-detects the Desktop sock via `OPENCLAW_REAL_HOME` / passwd homedir. If the gate is on and the daemon is still unreachable, the test **fails loud** (no soft-pass).

```bash
# Optional explicit host (Desktop)
export DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock"

OPENBOT_ACCOUNT_WORKER_DOCKER_E2E=1 pnpm exec vitest run \
  src/agents/sandbox/account-worker-driver.test.ts
```

## Image tags (defaults)

| Role | Default tag |
|---|---|
| Exec / sandbox | `openbot-sandbox:bookworm-slim` |
| Browser | `openbot-sandbox-browser:bookworm-slim` |

Overrides: `OPENBOT_ACCOUNT_WORKER_EXEC_IMAGE`, `OPENBOT_ACCOUNT_WORKER_BROWSER_IMAGE` (and legacy image env where documented). See `src/agents/sandbox/ACCOUNT_WORKER_SANDBOX_IMAGES.md`.

## Before calling cutover “done”

1. Record **tip SHA** under test (and this checklist date).
2. Dual flags: P6a required default-off; **P6b** flips unset→ON (see P6b brief).
3. Real-daemon e2e PASSes with `OPENBOT_ACCOUNT_WORKER_DOCKER_E2E=1` (~create/start/stop, not soft-pass).
4. Managed-enterprise path only; personal_local unchanged.
5. Product hand-back copy remains **「交给AI」**.
6. Third-party login golden path (Form → fill → SSO/passkey → 给AI → await_return) signed separately — optional static fixture: `docs/design/account-computer-login-password-fixture.html`.

## P6b

Implemented separately: `docs/design/account-computer-p6b-production-default-on-2026-10-17.md`.
Dual-flag unset→ON + personal_local still gated. Device-bound live cutover / third-party SSO remain ops/acceptance outside this checklist.
