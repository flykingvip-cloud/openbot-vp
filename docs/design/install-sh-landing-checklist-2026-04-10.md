# `scripts/install.sh` Landing Checklist

## Scope

This note classifies the current `scripts/install.sh` dirty diff into three landing buckets:

- `LAND NOW`: compatibility-only changes that do not redefine state ownership.
- `VERIFY FIRST`: install-chain changes that are reasonable, but must be proven against legacy installs.
- `DEFER`: changes that redefine default state/config/workspace behavior or trigger migration side effects.

The key guardrail is simple: `scripts/install.sh` must not be landed as a single file-level batch. The diff currently mixes copy, install identity, wrapper behavior, default state paths, and post-install migration actions.

## LAND NOW

These changes are compatibility-oriented and can be landed first once extracted into their own batch.

- Branding and non-behavioral installer copy:
  - `scripts/install.sh:4`
  - `scripts/install.sh:18`
  - `scripts/install.sh:238-249`
  - success and warning copy such as `scripts/install.sh:698`, `scripts/install.sh:794-837`
- New env aliases while preserving legacy keys:
  - `scripts/install.sh:76`
  - `scripts/install.sh:971-990`
  - `scripts/install.sh:993`
  - `scripts/install.sh:995-998`
- Dual-name binary discovery and PATH diagnostics:
  - `scripts/install.sh:1607-1627`
  - `scripts/install.sh:1631-1637`
  - `scripts/install.sh:1837-1925`

Reasoning:

- These changes let the installer understand both `openbot` and `openbot`.
- They do not force the user onto a new state directory or config filename.
- They improve forward compatibility without taking ownership of migration policy.

## VERIFY FIRST

These changes are plausible, but they must be verified on real legacy states before landing.

- npm conflict cleanup now removes both `openbot` and `openbot` directories/binaries:
  - `scripts/install.sh:477-529`
- npm install target shifts to `openbot`, including latest/beta retry flow:
  - `scripts/install.sh:784-837`
  - `scripts/install.sh:1986-2046`
- git install now creates a primary `~/.local/bin/openbot` wrapper and keeps `openbot` as a legacy alias:
  - `scripts/install.sh:1929-1984`

Verification required:

- Upgrade from global `openbot` npm install to `openbot` without leaving a broken shim.
- Upgrade when `/usr/local/bin/openbot` or `/opt/homebrew/bin/openbot` already exists.
- Git install with existing `~/.local/bin/openbot`, existing checkout, and dirty checkout.
- `openbot` and `openbot` both resolve after install, and both reach the same entrypoint.

## H1A1B: Windows And Docker Support Surface

The current `H1A1B` remainder is small by file count, but it is still not a pure copy-only batch.

- `scripts/install.ps1`
- `scripts/docker/install-sh-e2e/run.sh`

Current classification:

- `VERIFY FIRST`
  - package lookup switches from `openbot` to `openbot`
  - global npm install switches from `openbot@...` to `openbot@...`
  - primary CLI invocation switches from `openbot` to `openbot`
  - git wrapper support now emits both `openbot.cmd` and legacy `openbot.cmd`
- `DEFER`
  - default git checkout path changes from `~/openbot` to `~/openbot`
  - docker e2e session/state roots switch from `~/.openbot-*` and `/tmp/openbot-*` to `~/.openbot-*` and `/tmp/openbot-*`
  - install-time onboarding, health, and gateway orchestration now run through `openbot` as the primary operational surface

Practical consequence:

- `H1A1B` should not be landed as one two-file batch.
- The Windows installer and docker e2e script currently still mix install identity changes with state-path and post-install orchestration changes.
- If this batch is landed too early, the verification harness itself becomes part of the migration policy.

## DEFER

These changes should not land until there is an explicit migration policy for state ownership.

- Default checkout path changes:
  - `scripts/install.sh:991-992`
  - `scripts/install.sh:1015`
- Default workspace and config path changes:
  - `scripts/install.sh:2078-2094`
  - `scripts/install.sh:2483-2489`
- Installer-driven onboarding and bootstrap decisions keyed off the new state path:
  - `scripts/install.sh:2087-2125`
- Install-time doctor, plugin update, and daemon restart using `openbot` as the primary operational surface:
  - `scripts/install.sh:2440-2528`

Why deferred:

- This is no longer simple compatibility. It changes the product's default ownership of:
  - checkout directory
  - workspace directory
  - config filename
  - post-install migration and restart timing
- If landed prematurely, the installer becomes the migration authority before the broader CLI/state compatibility baseline is finalized.

## Safe Extraction Order

1. Extract and land `LAND NOW` only.
2. Add explicit install regression coverage for legacy npm and git installs.
3. Land `VERIFY FIRST` after those scenarios pass.
4. Keep `DEFER` blocked until `H1A0`, `H2`, and the broader state migration baseline are settled together.

For the current remainder, apply that order separately to both `H1A1A` and `H1A1B`.

- `H1A1A`
  - first extract shell copy/env/binary-discovery compatibility only
  - then verify npm/git/wrapper identity changes
  - keep state/config/workspace and install-time orchestration deferred
- `H1A1B`
  - first isolate Windows/docker copy and legacy alias compatibility
  - then verify install target and wrapper behavior against legacy installs
  - keep docker state-root and orchestration changes deferred

## Non-Goals For The First Landing

- Do not switch the default checkout from `~/openbot` to `~/openbot`.
- Do not switch the default config from `~/.gmood2008/openbot.json` to `~/.openbot/openbot.json`.
- Do not switch the default workspace from `~/.openbot/workspace` to `~/.openbot/workspace`.
- Do not make install-time `doctor`, `plugins update`, `onboard`, or `daemon restart` the vehicle for migration.

## Decision

`scripts/install.sh` is a valid historical cleanup target, but only if it is internally split by behavior. Treating the file as one "small single-file change" would hide the highest-risk state migration changes inside a mostly-benign compatibility diff.
