# Account Computer P6b — production dual-flag default-ON

**Date:** 2026-10-17 (Asia/Shanghai)  
**Scope:** Flip `OPENBOT_ACCOUNT_WORKER` / `OPENBOT_ACCOUNT_WORKER_DOCKER` so **unset defaults ON**.  
**Base tip (main after rebase):** `9ea92d728bb85b997818b0adb647ce263471aa8e` (#802 / origin/main).
**Head (this PR):** `e0821b86d9b608242033b98be53afb5cf04230ba`.
**Not claimed:** Live production cutover on a customer device; third-party real-site login e2e.

## What flipped

| Env                                           | Before (P6a) | After (P6b)    |
| --------------------------------------------- | ------------ | -------------- |
| `OPENBOT_ACCOUNT_WORKER` unset / empty        | OFF          | **ON**         |
| `OPENBOT_ACCOUNT_WORKER_DOCKER` unset / empty | OFF          | **ON**         |
| Explicit `0` / `false` / `no` / `off`         | OFF          | OFF (rollback) |
| Explicit `1` / `true` / `yes` / `on`          | ON           | ON             |

Shared parser: `src/agents/sandbox/account-worker-flags.ts` → `isAccountWorkerEnvFlagOn`.

## Still gated (personal_local never forced)

Product worker enablement (`isAccountWorkerPrototypeEnabled`) still requires:

1. Worker flag on (now default when unset), and
2. Shared tenant addressing (`managed` data mode + `OPENBOT_MULTITENANT`), and
3. Security profile **`managed_enterprise`**

So:

| Context                                   | Worker path                               |
| ----------------------------------------- | ----------------------------------------- |
| `personal_local` / local data mode        | **OFF** (even if flags unset or set to 1) |
| Managed + multitenant, flags unset        | **ON** (P6b)                              |
| Managed + multitenant, either flag `0`    | **OFF** (ops rollback)                    |
| Unset enterprise (no managed/multitenant) | Prototype **OFF**                         |

Docker execution boundary (`dockerAccountWorkerExecutionBoundary`) uses the same default-ON dual-flag rule (startup gate for managed multitenant).

Hand-back Tab label (locked): **「交给AI」** (`computerHandBack`).

## Rollback

```bash
export OPENBOT_ACCOUNT_WORKER=0
export OPENBOT_ACCOUNT_WORKER_DOCKER=0
# or either alone — boundary / prototype disable accordingly
```

Restart the gateway after changing env.

## Claim level

- **Code default + unit tests** for dual-flag default-ON and personal_local still-off.
- **Not** a signed live prod cutover. Ops must still have Docker images/daemon, `sandbox.mode=all`, and tenants root for managed multitenant startup to pass Gate 0.
- Fixture golden-path (#793) remains mocked CDP / fixture HTML — not a third-party SSO claim.

## Residual risks

1. **`isAccountComputerRunningAttachEnabled`** follows the docker flag → defaults ON when unset. Attach still requires a RUNNING worker journal; no second desktop is created. personal_local without journals is a no-op probe.
2. **`resolveDefaultAccountWorkerSandboxDriver`** selects Docker when the docker flag is unset. Unit tests that need memory must set `OPENBOT_ACCOUNT_WORKER_DOCKER=0` or inject the memory driver.
3. Managed multitenant with flags unset now expects a reachable Docker runtime at startup (Gate 0). Hosts without Docker must set flags OFF or provide CLI/socket.
4. This brief does **not** flip device-bound credential cutover or mark historical P0–P4 PR numbers as GitHub-merged.

## Verify (local)

```bash
pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-worker.test.ts \
  src/agents/sandbox/account-worker-driver.test.ts \
  src/agents/sandbox/account-worker-lifecycle.test.ts \
  src/agents/sandbox/account-worker-embedded.test.ts \
  src/agents/sandbox/account-computer-running-attach.test.ts \
  src/agents/sandbox/gateway-docker-probe.test.ts \
  src/gateway/security-profile/security-profile.test.ts
```

Optional gated e2e (unchanged honesty from P6a):

```bash
OPENBOT_ACCOUNT_WORKER_DOCKER_E2E=1 pnpm exec vitest run --config vitest.config.ts \
  src/agents/sandbox/account-worker-driver.test.ts
```
