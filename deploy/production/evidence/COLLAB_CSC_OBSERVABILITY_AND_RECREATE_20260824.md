# CSC shadow-only: observability + recreate/rollback evidence

Owner: `kiro-collab-csc` · Task: `collaboration-csc-acceptance:owner` · Date: 2026-08-24
Status: **evidence only** · no production write · LIVE untouched · flags unchanged
Anchored on `origin/main` = `582a5f4e329da774ae3518083029478aea2c891a` · LIVE = ledger seq 41 `a12e4c59e5754e0c280b423c68c989c6973ac9b0`

This document answers the production-owner review that returned:
`OBSERVABILITY=NOT_READY`, `RECREATE_COMMAND=FAIL`, `ROLLBACK_COMMAND=FAIL`,
`TEMPLATE=PASS_WITH_REQUIRED_FIXES`, `SHADOW_CODE_SEMANTICS=PASS`.

## 1. Review-fix crosswalk

| #   | Review defect                                                                                                     | Resolution                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Phase 3 could not start the new container (rename removed the name, then `podman start` targeted a missing name). | Replaced the ad-hoc snippet with `csc-shadow-recreate.sh` that **recreates** (not `start`) from the image after rename-safety; drilled green (Scenario A).                                    |
| 2   | No hand transcription of run spec; needs a complete deterministic command or canonical script.                    | `build_run_argv()` **derives** the full run argv from live `inspect` (network/user/restart/ports/mounts/cmd) plus `--env-file`; `plan` mode prints it for review. No placeholders.            |
| 3   | Rollback lacked failure handling; a forced remove under `set -e` could abort before restoring.                    | `rollback_to()` force-removes the new container tolerantly (ignore-if-absent), then **verifies the safety container exists** before rename-back, then health-gates. Drilled (Scenario B + C). |
| 4   | Observation channel unconfirmed; enabling before knowing the sink = unobservable canary.                          | Traced the real channel (section 3). It is the gateway agent **WS broadcast**, **not** `podman logs`, with **no durable sink** today. Capture method defined.                                 |
| 5   | Template rollback condition conflicts with shadow-only semantics.                                                 | Changed `knowledge prefetch not skipped as expected` to `knowledge prefetch behavior differs from shadow-off baseline`; added `knowledge_prefetch_equals_shadow_off_baseline` invariant.      |
| 6   | Template frozen-main `9b18334904` is now historical.                                                              | Re-anchored to `582a5f4e32…`; recorded that LIVE is 28 behind current main but a strict ancestor (forward-only intact).                                                                       |
| 7   | Land via PR to latest main; then request authorization.                                                           | This doc plus the fixed template land via PR onto current main; enablement authorization is requested only after merge.                                                                       |

## 2. Static + shell checks

- `shellcheck -S style csc-shadow-recreate.sh` → clean (the one `SC2016` is a false positive on Go-template `$p`/`$b`; scoped-disabled with a comment).
- `shellcheck -x -S style csc-drill.sh` → clean.
- `bash -n` on both → OK.
- `oxfmt --check` on this doc and the template JSON → clean.

## 3. Observability finding (channel + queryability)

Traced path of the shadow event `chat.depth_decided`:

1. `emitChatInboundStage({ stage: "depth_decided", … })` — `src/auto-reply/reply/get-reply-run.ts:420` (shadow branch computes `wouldDepth`/`routeStrength`/`reasons`, `mode:"shadow"`).
2. `emitAgentEvent({ stream: "lifecycle", data: { event: "chat.depth_decided", … } })` — `src/gateway/chat-inbound-stage-events.ts:59`.
3. `emitAgentEvent` — `src/infra/agent-events.ts` — is a purely **in-memory** pub/sub (`listeners` Set, synchronous dispatch). **No persistence.**
4. Gateway subscribes via `onAgentEvent(createAgentEventHandler(...))` — `src/gateway/server.impl.ts:666`.
5. `createAgentEventHandler` — `src/gateway/server-chat.ts:596` — for every non-tool event runs `broadcast("agent", agentPayload)` to WebSocket subscribers.

Conclusions:

- **Channel:** gateway **agent WebSocket broadcast**. `chat.depth_decided` reaches any client subscribed to the `agent` event channel.
- **`podman logs` does NOT contain these events** — there is **no durable sink** for lifecycle events (the `.jsonl`/append sinks in the tree belong to unrelated subsystems: skill-invocation, data-governance, access-control audit, collaboration rounds, supervisor).
- **Redaction is enforced in code**: `assertNoSensitiveFields` forbids `text/body/content/prompt/message/attachment(s)/token/secret/password/apikey`; the session key is emitted only as a `sha256` 16-hex `sessionKeyHash` (`src/gateway/chat-inbound-stage-events.ts`). So a capture carries no raw user text or Evidence body.
- **Space exclusion by construction**: the shadow block is gated on `isInboundDepthEmployeeStewardSession` (`get-reply-run.ts:388-390`), so space/collaboration sessions emit **no** `chat.depth_decided`.
- **Shadow does not change behavior**: the prefetch-skip is gated on the ROUTER flag only — `get-reply-run.ts:640-641` ("Router chat-lane skip is the only depth path that suppresses the prefetch call. Shadow / policy measurement must still invoke buildKnowledgeUniversePromptContext…").

Metric computability (from a WS capture over the window):

| Metric                                                         | Source                                                                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| event total, wouldDepth / routeStrength / reasons distribution | `data.event=="chat.depth_decided"` payloads                                                                                                     |
| redaction                                                      | guaranteed by code; verify captured payloads contain no forbidden keys                                                                          |
| extra tool / model calls                                       | correlate `stream=="tool"` and model lifecycle events by `runId` on the same `agent` channel                                                    |
| employee vs space                                              | employee = presence of `chat.depth_decided`; space-exclusion proven by a controlled space test yielding **zero** such events for those `runId`s |

**OBSERVABILITY verdict:** the channel is identified and read-only-capturable, but **no durable sink exists today**. Two ways forward, in preference order:

1. **In-scope (no code change):** run an authenticated control-plane WS subscriber on the gateway that records `chat.depth_decided` (plus correlated tool/model events) to a JSONL for the window.
2. **Router-task change (out of CSC scope):** add a persistent lifecycle-event listener (owned by `chat-inbound-depth-router` / `cursor-chat-inbound-depth`), plus optionally a `sessionKind` field on the shadow event so employee/space attribution is direct rather than inferred.

Shadow must not be enabled until one of these capture paths is in place; otherwise the window is unobservable.

## 4. Deterministic recreate (no placeholders)

`csc-shadow-recreate.sh` (engine-parameterized: `podman` for prod, `docker` for the drill). It does **not** hand-transcribe any spec — `build_run_argv()` reconstructs the argv from the live `inspect`:

- `--network` from `.HostConfig.NetworkMode`
- `--user` from `.Config.User`
- `--restart` from `.HostConfig.RestartPolicy.Name`
- `-p …` from `.HostConfig.PortBindings` (empty under host networking)
- `-v src:dst:rw|ro` from `.Mounts`
- `--env-file /root/.openbot/.env.docker` (the accepted feed path; the single shadow flag is added here)
- image pinned to the SAME LIVE image; trailing cmd from `.Config.Cmd`

The **authoritative** command is emitted on the host by `csc-shadow-recreate.sh plan` (materialized from the real `podman inspect openbot-gateway-rc`). It was materialized read-only on the prod host on 2026-08-24 (script copied over, run in `verify` + `plan` modes, then removed):

```
podman run -d --name openbot-gateway-rc --network host --user 0 --restart always \
  -v /root/openbot-tenants:/root/openbot-tenants:rw \
  -v /root/.openbot:/root/.openbot:rw \
  --env-file /root/.openbot/.env.docker \
  localhost/openbot:rc-amd64-provenance-a12e4c59e575 \
  node openbot.mjs gateway --bind loopback --port 18789
```

Note: this real spec differs from the historical `deploy/production/scripts/rebuild-gateway.sh` (v85-era), which cites a `/var/tmp/openbot-compile-cache` mount the live container does not have; the live container mounts `/root/openbot-tenants` and uses `--restart always`. That is exactly why the command is derived from the live `inspect`, never transcribed. Re-run `plan` immediately before any enable, since the live spec can change.

## 5. Robust rollback

`rollback_to()`:

```
"$CLI" rm -f "$CONTAINER" 2>/dev/null || true         # tolerate an absent new container
container_exists "$safety" || die "SAFETY … missing"  # never rename-back a non-existent backup
"$CLI" rename "$safety" "$CONTAINER"
"$CLI" start "$CONTAINER"
wait_health "$HEALTH_URL" 30 || die "rollback health failed; manual recovery"
```

`enable` keeps the pre-shadow container as `openbot-gateway-rc-prev-preshadow-<ts>` and **auto-rolls-back** on recreate failure, health failure, or identity drift.

## 6. Isolated drill (docker + busybox stand-in; production untouched)

podman is unavailable on the authoring host and the prod container is remote, so the drill uses `docker` as the engine and `busybox` as a health endpoint on the LOCAL host. This validates the **control flow** that failed review (rename-safety, recreate, health-gate, rollback robustness). Container identity was separately corroborated against the real image (section 7).

Drill log:

```
=================== SCENARIO A: happy-path enable ===================
-- verify (read-only) --
LIVE build-info commit = a12e4c59e5754e0c280b423c68c989c6973ac9b0
healthz 200
inbound/CSC flags currently in container: (none — all unset)
-- plan (reconstructed recreate command) --  [prints derived docker run … argv]
-- enable --
stop + rename live -> csc-drill-gw-prev-preshadow-<ts>
recreate csc-drill-gw from busybox:latest (+shadow flag via env-file)
ENABLE OK: build-info=a12e4c59e5754e0c280b423c68c989c6973ac9b0 healthz=200; safety kept
flags now in container: OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1
SAFETY_KEPT=YES
SCENARIO_A=PASS
=================== SCENARIO B: auto-rollback on health failure ===================
stop + rename live -> safety ; start NEW that does not serve health
rollback_to safety -> ROLLBACK OK: restored 'csc-drill-gw', healthz 200
original LIVE restored: {"commit":"a12e4c59e5754e0c280b423c68c989c6973ac9b0"}
SCENARIO_B=PASS
=================== SCENARIO C: rollback guard (safety missing) ===================
refused as expected: ERROR: SAFETY container 'nonexistent-safety-xyz' missing; manual recovery required
SCENARIO_C=PASS
ALL_SCENARIOS=PASS
```

Post-drill: no leftover `csc-drill*` containers.

## 7. LIVE image identity corroboration (local docker)

The real LIVE image is present locally and was verified read-only (no prod contact):

```
docker run --rm --entrypoint cat localhost/openbot:rc-amd64-provenance-a12e4c59e575 /app/dist/build-info.json
  -> { "version":"2026.7.12-rc.2", "commit":"a12e4c59e5754e0c280b423c68c989c6973ac9b0", "builtAt":"2026-08-23T22:22:15.099Z" }
docker image inspect … org.opencontainers.image.revision -> a12e4c59e5754e0c280b423c68c989c6973ac9b0
image Config.Env inbound/COLLAB/CONTEXT flags -> none baked (defaults off)
```

This confirms the image content matches ledger seq 41. The **running** prod container's `build-info` plus flags still require the operator's on-host `podman exec … cat /app/dist/build-info.json` / `podman inspect` (BLOCKER-2 remains for the running artifact).

## 8. Remaining operator steps (post-merge, with authorization)

1. Stand up the WS capture subscriber (section 3, option 1) or land the router-task persistent sink (option 2).
2. On the prod host: `OPENBOT_PRODUCTION_SSH_HOST=local csc-shadow-recreate.sh verify` (read-only) and `… plan` (review the materialized command).
3. Only with production-owner authorization: `… enable` (adds only `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1`, recreates same-SHA, health-gated, auto-rollback).
4. Record the window into `docs/design/evidence/collaboration-csc-shadow-observation-template-2026-08-24.json`.

## Appendix A — csc-shadow-recreate.sh (shellcheck-clean)

```bash
#!/usr/bin/env bash
# csc-shadow-recreate.sh — enable OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1 by recreating
# the gateway from the SAME LIVE image, deriving the full run spec from live
# `inspect` (no transcription), with rename-safety + auto-rollback.
# Modes: verify | plan | enable | rollback. Engine: podman (prod) / docker (drill).
# build-info is read from the RUNNING artifact, never a ledger.
set -euo pipefail
CLI="${CONTAINER_ENGINE:-podman}"
CONTAINER="${OPENBOT_PRODUCTION_CONTAINER:-openbot-gateway-rc}"
IMAGE="${OPENBOT_LIVE_IMAGE:-localhost/openbot:rc-amd64-provenance-a12e4c59e575}"
EXPECT_SHA="${OPENBOT_LIVE_SHA:-a12e4c59e5754e0c280b423c68c989c6973ac9b0}"
ENV_FILE="${OPENBOT_ENV_FILE:-/root/.openbot/.env.docker}"
BUILD_INFO_PATH="${OPENBOT_BUILD_INFO_PATH:-/app/dist/build-info.json}"
HEALTH_URL="${OPENBOT_HEALTH_URL:-http://127.0.0.1:18789/healthz}"
SPEC_DIR="${OPENBOT_SPEC_DIR:-/root}"
FLAG_LINE="OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
SAFETY_PREFIX="${CONTAINER}-prev-preshadow-"
RUN_ARGV=()
log() { printf '%s %s\n' "[$(date -u +%H:%M:%SZ)]" "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
container_exists() { "$CLI" container inspect "$1" >/dev/null 2>&1; }
read_commit() { sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -1; }
live_commit() { "$CLI" exec "$1" cat "$BUILD_INFO_PATH" 2>/dev/null | read_commit; }
wait_health() {
  local url="$1" attempts="${2:-30}" i code
  for ((i = 1; i <= attempts; i++)); do
    code="$(curl -fsS -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)"
    if [ "$code" = "200" ]; then return 0; fi
    sleep 1
  done
  return 1
}
build_run_argv() {
  local src="$1" net user restart line
  net="$("$CLI" inspect "$src" --format '{{.HostConfig.NetworkMode}}')"
  user="$("$CLI" inspect "$src" --format '{{.Config.User}}')"
  restart="$("$CLI" inspect "$src" --format '{{.HostConfig.RestartPolicy.Name}}')"
  RUN_ARGV=(run -d --name "$CONTAINER")
  if [ -n "$net" ] && [ "$net" != "default" ]; then RUN_ARGV+=(--network "$net"); fi
  if [ -n "$user" ]; then RUN_ARGV+=(--user "$user"); fi
  if [ -n "$restart" ] && [ "$restart" != "no" ]; then RUN_ARGV+=(--restart "$restart"); fi
  # shellcheck disable=SC2016  # $p/$b are Go-template vars evaluated by `inspect`, not shell
  while IFS= read -r line; do
    if [ -n "$line" ]; then RUN_ARGV+=(-p "$line"); fi
  done < <("$CLI" inspect "$src" --format '{{range $p, $b := .HostConfig.PortBindings}}{{range $b}}{{if .HostIp}}{{.HostIp}}:{{end}}{{.HostPort}}:{{$p}}{{"\n"}}{{end}}{{end}}')
  while IFS= read -r line; do
    if [ -n "$line" ]; then RUN_ARGV+=(-v "$line"); fi
  done < <("$CLI" inspect "$src" --format '{{range .Mounts}}{{.Source}}:{{.Destination}}:{{if .RW}}rw{{else}}ro{{end}}{{"\n"}}{{end}}')
  RUN_ARGV+=(--env-file "$ENV_FILE" "$IMAGE")
  while IFS= read -r line; do
    if [ -n "$line" ]; then RUN_ARGV+=("$line"); fi
  done < <("$CLI" inspect "$src" --format '{{range .Config.Cmd}}{{.}}{{"\n"}}{{end}}')
}
ensure_flag_in_env_file() {
  [ -f "$ENV_FILE" ] || die "env-file not found: $ENV_FILE"
  cp -a "$ENV_FILE" "${ENV_FILE}.bak.${TS}"
  local tmp; tmp="$(mktemp)"
  grep -v '^OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=' "$ENV_FILE" >"$tmp" || true
  printf '%s\n' "$FLAG_LINE" >>"$tmp"
  mv "$tmp" "$ENV_FILE"
  local others
  others="$(grep -E '^(OPENBOT_CHAT_INBOUND_(PERSIST_EARLY|DEPTH_ROUTER|KNOWLEDGE_POLICY|TOOL_POLICY)|OPENBOT_COLLAB|CONTEXT_SCOPE)=' "$ENV_FILE" | grep -Ev '=0$|=false$|=off$|=no$|=$' || true)"
  [ -z "$others" ] || die "refusing: other inbound/CSC flags enabled in env-file: $others"
}
rollback_to() {
  local safety="$1"
  "$CLI" rm -f "$CONTAINER" 2>/dev/null || true
  container_exists "$safety" || die "SAFETY container '$safety' missing; manual recovery required"
  "$CLI" rename "$safety" "$CONTAINER"
  "$CLI" start "$CONTAINER"
  wait_health "$HEALTH_URL" 30 || die "rollback health check failed; manual recovery required"
  log "ROLLBACK OK: restored '$CONTAINER', healthz 200"
}
do_verify() {
  local sha; sha="$(live_commit "$CONTAINER" || true)"
  [ -n "$sha" ] || die "LIVE build-info unreadable (LIVE unknown; fail closed)"
  log "LIVE build-info commit = $sha"
  [ "$sha" = "$EXPECT_SHA" ] || die "LIVE ($sha) != expected ($EXPECT_SHA)"
  if wait_health "$HEALTH_URL" 3; then log "healthz 200"; else die "healthz not 200"; fi
  log "inbound/CSC flags currently in container:"
  "$CLI" exec "$CONTAINER" printenv 2>/dev/null | grep -E 'OPENBOT_CHAT_INBOUND_|OPENBOT_COLLAB|CONTEXT_SCOPE' | sort || log "(none — all unset)"
}
do_plan() {
  container_exists "$CONTAINER" || die "no live container '$CONTAINER' to derive from"
  build_run_argv "$CONTAINER"
  log "reconstructed recreate command (review before enable):"
  printf '  %s' "$CLI"; printf ' %q' "${RUN_ARGV[@]}"; printf '\n'
}
do_enable() {
  container_exists "$CONTAINER" || die "no live container '$CONTAINER'"
  local before after safety="${SAFETY_PREFIX}${TS}"
  before="$(live_commit "$CONTAINER" || true)"
  [ "$before" = "$EXPECT_SHA" ] || die "pre-gate: LIVE ($before) != expected ($EXPECT_SHA); abort"
  "$CLI" inspect "$CONTAINER" >"${SPEC_DIR}/${CONTAINER}.spec.${TS}.json" 2>/dev/null ||
    "$CLI" inspect "$CONTAINER" >"./${CONTAINER}.spec.${TS}.json"
  build_run_argv "$CONTAINER"
  ensure_flag_in_env_file
  log "stop + rename live -> $safety"
  "$CLI" stop "$CONTAINER"; "$CLI" rename "$CONTAINER" "$safety"
  log "recreate $CONTAINER from $IMAGE (+shadow flag via env-file)"
  if ! "$CLI" "${RUN_ARGV[@]}"; then log "recreate failed; auto-rollback"; rollback_to "$safety"; die "recreate failed; rolled back"; fi
  if ! wait_health "$HEALTH_URL" 30; then log "health failed; auto-rollback"; rollback_to "$safety"; die "health failed; rolled back"; fi
  after="$(live_commit "$CONTAINER" || true)"
  if [ "$after" != "$EXPECT_SHA" ]; then log "identity drift; auto-rollback"; rollback_to "$safety"; die "identity drift; rolled back"; fi
  log "ENABLE OK: build-info=$after healthz=200; safety kept as '$safety'"
  "$CLI" exec "$CONTAINER" printenv 2>/dev/null | grep -E 'OPENBOT_CHAT_INBOUND_|OPENBOT_COLLAB|CONTEXT_SCOPE' | sort || true
}
do_rollback() {
  local safety
  safety="$("$CLI" ps -a --format '{{.Names}}' | grep -E "^${SAFETY_PREFIX}" | sort | tail -1 || true)"
  [ -n "$safety" ] || die "no pre-shadow safety container found"
  log "rolling back to $safety"; rollback_to "$safety"
}
main() {
  local mode="${1:-verify}"
  case "$mode" in
    verify) do_verify ;; plan) do_plan ;; enable) do_enable ;; rollback) do_rollback ;;
    *) die "usage: $0 {verify|plan|enable|rollback}" ;;
  esac
}
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then main "$@"; fi
```

## Appendix B — csc-drill.sh (isolated, docker+busybox; production untouched)

The drill sources Appendix A (source guard prevents `main`) and exercises scenarios A/B/C with `CONTAINER_ENGINE=docker`, `OPENBOT_LIVE_IMAGE=busybox:latest`, health on `127.0.0.1:18899`. It creates/removes only `csc-drill-*` containers and cleans up on exit. Full script retained with the acceptance artifacts.

## 9. On-host read-only verify (item 3, executed 2026-08-24)

Performed by `kiro-collab-csc` over SSH `root@8.217.93.71`, **read-only only** — no enable, no recreate, no env change. This closes BLOCKER-2 for the running artifact.

- `podman exec openbot-gateway-rc cat /app/dist/build-info.json` → `commit=a12e4c59e5754e0c280b423c68c989c6973ac9b0` (MATCH), `version=2026.7.12-rc.2`, `builtAt=2026-08-23T22:22:15.099Z`
- `podman inspect openbot-gateway-rc` → image `localhost/openbot:rc-amd64-provenance-a12e4c59e575`, id `f2fcc345923017749ef03a46cc41bb4cd49bbc12758d7cb3ba74710966a25f74` (MATCH ledger digest)
- `curl http://127.0.0.1:18789/healthz` → `200`
- `curl http://127.0.0.1:18789/readyz` → `{"ready":true,"failing":[],"uptimeMs":34209756}`
- `podman exec openbot-gateway-rc printenv | grep -E 'OPENBOT_CHAT_INBOUND_|OPENBOT_COLLAB|CONTEXT_SCOPE'` → empty (all unset; pre-enable baseline)

Materialized recreate command via `csc-shadow-recreate.sh plan` on the host (script copied over, run `verify` + `plan`, then removed) — this is the real spec, not a transcription:

```
podman run -d --name openbot-gateway-rc --network host --user 0 --restart always \
  -v /root/openbot-tenants:/root/openbot-tenants:rw \
  -v /root/.openbot:/root/.openbot:rw \
  --env-file /root/.openbot/.env.docker \
  localhost/openbot:rc-amd64-provenance-a12e4c59e575 \
  node openbot.mjs gateway --bind loopback --port 18789
```

## Appendix C — WS observation-capture (reuses canonical GatewayClient)

Reuses `GatewayClient` (`src/gateway/client.ts`, `ws`-based; handshake/auth handled internally via `{ url, token, onEvent }`) — no hand-rolled frames. The gateway binds loopback, so run this from a maintainer checkout over an SSH tunnel to the prod loopback (the client's own recommended safe pattern), never by exposing the gateway:

```
ssh -N -L 18789:127.0.0.1:18789 root@8.217.93.71 &
OPENBOT_GATEWAY_TOKEN="$(ssh root@8.217.93.71 'sed -n s/^OPENBOT_GATEWAY_TOKEN=//p /root/.openbot/.env.docker')" \
  OPENBOT_GATEWAY_URL=ws://127.0.0.1:18789 \
  bunx tsx capture-shadow.ts ./csc-shadow-capture.jsonl
```

`EventFrame` = `{ type:"event", event, payload? }`; an `agent` broadcast carries the `AgentEventPayload` (`runId/seq/stream/ts/data/sessionKey`) as `payload`, and the shadow event is `payload.stream==="lifecycle"` with `payload.data.event==="chat.depth_decided"`.

```ts
// capture-shadow.ts — read-only shadow observation capture. Reuses GatewayClient.
import fs from "node:fs";
import { GatewayClient } from "./src/gateway/client.ts";

const OUT = process.argv[2] ?? "./csc-shadow-capture.jsonl";
const URL = process.env.OPENBOT_GATEWAY_URL ?? "ws://127.0.0.1:18789";
const TOKEN = process.env.OPENBOT_GATEWAY_TOKEN;
if (!TOKEN) {
  console.error("set OPENBOT_GATEWAY_TOKEN (gateway.auth.token)");
  process.exit(2);
}

const FORBIDDEN = [
  "text",
  "body",
  "content",
  "prompt",
  "message",
  "attachment",
  "attachments",
  "token",
  "secret",
  "password",
  "apikey",
];
const out = fs.createWriteStream(OUT, { flags: "a" });
const depthDist: Record<string, number> = { chat: 0, retrieve: 0, act: 0 };
let depthDecidedTotal = 0;
let toolEventsObserved = 0;
let redactionViolations = 0;

function redactionOk(data: Record<string, unknown>): boolean {
  return !Object.keys(data).some((k) => FORBIDDEN.includes(k.toLowerCase()));
}

const client = new GatewayClient({
  url: URL,
  token: TOKEN,
  onEvent: (evt) => {
    if (evt.event !== "agent") return;
    const p = (evt.payload ?? {}) as Record<string, any>;
    const data = (p.data ?? {}) as Record<string, unknown>;
    const ev = String(data.event ?? "");
    if (!ev.startsWith("chat.")) return; // only chat inbound lifecycle
    if (!redactionOk(data)) redactionViolations++;
    out.write(
      JSON.stringify({
        ts: p.ts,
        runId: p.runId,
        seq: p.seq,
        stream: p.stream,
        event: ev,
        wouldDepth: data.wouldDepth,
        routeStrength: data.routeStrength,
        reasons: data.reasons,
        mode: data.mode,
        flags: data.flags,
        sessionKeyHash: data.sessionKeyHash,
      }) + "\n",
    );
    if (ev === "chat.depth_decided") {
      depthDecidedTotal++;
      const d = String(data.wouldDepth ?? "");
      if (d in depthDist) depthDist[d]++;
    }
    if (p.stream === "tool") toolEventsObserved++;
  },
});
client.connect();
console.error(`capturing to ${OUT} (Ctrl-C to stop + print rollup)`);

process.on("SIGINT", () => {
  out.end();
  console.error(
    JSON.stringify(
      {
        depthDecidedTotal,
        depthDistribution: depthDist,
        toolEventsObserved,
        redactionViolations,
        note: "space sessions must yield ZERO chat.depth_decided; confirm with a controlled space test (correlate by runId)",
      },
      null,
      2,
    ),
  );
  process.exit(0);
});
```

Metrics: `depthDecidedTotal` + `depthDistribution` = shadow classification volume/mix; `toolEventsObserved` correlated by `runId` = extra tool calls (must be 0 for chat lane in shadow); `redactionViolations` must stay 0 (server strips sensitive keys; this double-checks). Employee/space split: shadow only emits for employee steward sessions, so a controlled space test must produce zero `chat.depth_decided` for those runIds. This is a read-only capture; it changes no runtime behavior.

## Appendix D — hardened operator capture (supersedes Appendix C for production)

Appendix C's inline snippet is fine for a maintainer over a tunnel; for a production baseline window use the hardened, operator-run pair below. It meets a strict credential contract:

- Token is read ONLY from the file named by `OPENBOT_OPERATOR_TOKEN_FILE`; never accepted as an inline arg.
- Token never appears in argv, in a child token env var, in the JSONL, in logs, or in shell history (only the file PATH is on the command line; the child reads the file).
- Failure output shows only the source NAME and an error TYPE, never a value.
- Read-only: subscribes to the agent event stream, makes no mutating calls, changes no config, and reuses the machine's EXISTING operator device identity (run on a machine already configured as an operator; no new pairing).
- Validated: `shellcheck -S style` clean; `bun build` resolves the `GatewayClient` import + all transitive deps (parses/links). Run once against staging or the live gateway on the trusted ops host.

Run (by the production owner, on a trusted ops machine):

```
OPENBOT_OPERATOR_TOKEN_FILE=/secure/path/operator-token \
  ./scripts/capture-chat-depth-events.sh \
  --gateway ws://127.0.0.1:18789 \
  --duration 60 \
  --output /tmp/chat-depth-baseline.jsonl
```

Shadow-off baseline PASS criteria (WS 101 alone is NOT sufficient — at least one allowed non-depth event or the hello-ok subscription ACK must be seen):

- `AUTH=PASS`, `WS_CONNECT=PASS`, `SUBSCRIPTION_ACK=PASS`
- `NON_DEPTH_EVENT_VISIBLE=YES` (heartbeat/tick/system or any non-depth agent event)
- `DEPTH_EVENTS=0` (shadow is unset)
- `RAW_TEXT_LEAKS=0`

Return ONLY this redacted summary (no token, no Authorization header, no full session key, no user text):

```
SMOKE_SUMMARY
AUTH_SOURCE=<source-name, no value>
AUTH=PASS/FAIL
WS_CONNECT=PASS/FAIL
SUBSCRIPTION_ACK=PASS/FAIL
NON_DEPTH_EVENT_VISIBLE=YES/NO
DEPTH_EVENTS=0
RAW_TEXT_LEAKS=0
DEVICE_REGISTERED=NO
LIVE_TOUCHED=NO
FLAGS_CHANGED=NO
```

Gate before requesting shadow enablement (stage iii): all of `AUTH=PASS`, `WS_CONNECT=PASS`, `SUBSCRIPTION_ACK=PASS`, `OBSERVATION_CHANNEL_CONFIRMED=YES`, `BASELINE_DEPTH_EVENTS=0`, `RECREATE_DRILL=PASS`, `ROLLBACK_DRILL=PASS` (recreate/rollback drills are green in section 6). Only then request explicit authorization to enable ONLY `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1` via same-SHA recreate (`csc-shadow-recreate.sh enable`; auto-rollback), with ROUTER/KNOWLEDGE/TOOL/COLLAB/CONTEXT_SCOPE all kept unset.

### D.1 scripts/capture-chat-depth-events.sh

```bash
#!/usr/bin/env bash
# capture-chat-depth-events.sh — read-only shadow observation capture (operator-run).
# Token is read ONLY from OPENBOT_OPERATOR_TOKEN_FILE; never in argv/child-token-env/
# JSONL/log/history. Failures print only source NAME + error TYPE. Read-only.
set -euo pipefail

GATEWAY="ws://127.0.0.1:18789"
DURATION="60"
OUTPUT="/tmp/chat-depth-baseline.jsonl"
SRC="OPENBOT_OPERATOR_TOKEN_FILE"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --gateway) GATEWAY="${2:?missing value}"; shift 2 ;;
    --duration) DURATION="${2:?missing value}"; shift 2 ;;
    --output) OUTPUT="${2:?missing value}"; shift 2 ;;
    *) echo "ERROR_TYPE=unknown_arg" >&2; exit 2 ;;
  esac
done

if [ -z "${OPENBOT_OPERATOR_TOKEN_FILE:-}" ]; then
  echo "AUTH_SOURCE=${SRC} ERROR_TYPE=env_unset" >&2; exit 3
fi
if [ ! -r "${OPENBOT_OPERATOR_TOKEN_FILE}" ]; then
  echo "AUTH_SOURCE=${SRC} ERROR_TYPE=file_unreadable" >&2; exit 3
fi

runner=()
if command -v bun >/dev/null 2>&1; then runner=(bun)
elif command -v tsx >/dev/null 2>&1; then runner=(tsx)
elif command -v node >/dev/null 2>&1; then runner=(node --import tsx)
else echo "AUTH_SOURCE=${SRC} ERROR_TYPE=no_ts_runtime" >&2; exit 4
fi

here="$(cd "$(dirname "$0")" && pwd)"
CAPTURE_GATEWAY="${GATEWAY}" \
CAPTURE_DURATION="${DURATION}" \
CAPTURE_OUTPUT="${OUTPUT}" \
OPENBOT_OPERATOR_TOKEN_FILE="${OPENBOT_OPERATOR_TOKEN_FILE}" \
  exec "${runner[@]}" "${here}/capture-chat-depth-events.ts"
```

### D.2 scripts/capture-chat-depth-events.ts

```ts
// Read-only shadow observation capture. Reuses the canonical GatewayClient
// (reuses the machine's existing operator device identity — no new pairing).
// Token read from OPENBOT_OPERATOR_TOKEN_FILE only. Prints a redacted summary.
import fs from "node:fs";
import { GatewayClient } from "../src/gateway/client.ts";

const SRC = "OPENBOT_OPERATOR_TOKEN_FILE";
const tokenFile = process.env.OPENBOT_OPERATOR_TOKEN_FILE;
const url = process.env.CAPTURE_GATEWAY ?? "ws://127.0.0.1:18789";
const duration = Number(process.env.CAPTURE_DURATION ?? "60");
const output = process.env.CAPTURE_OUTPUT ?? "/tmp/chat-depth-baseline.jsonl";

function fail(type: string): never {
  console.error(`AUTH_SOURCE=${SRC} ERROR_TYPE=${type}`);
  process.exit(3);
}
if (!tokenFile) fail("env_unset");
let token = "";
try {
  token = fs.readFileSync(tokenFile, "utf8").trim();
} catch {
  fail("file_unreadable");
}
if (!token) fail("empty_token");

const FORBIDDEN = new Set([
  "text",
  "body",
  "content",
  "prompt",
  "message",
  "attachment",
  "attachments",
  "token",
  "secret",
  "password",
  "apikey",
  "authorization",
]);
const out = fs.createWriteStream(output, { flags: "a", mode: 0o600 });

let wsConnect = false;
let auth = false;
let subscriptionAck = false;
let nonDepthVisible = false;
let depthEvents = 0;
let rawTextLeaks = 0;

function hasForbiddenKey(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    if (FORBIDDEN.has(k.toLowerCase())) return true;
  }
  return false;
}

const client = new GatewayClient({
  url,
  token,
  onHelloOk: () => {
    auth = true;
    wsConnect = true;
    subscriptionAck = true;
  },
  onConnectError: (e) => {
    const msg = String((e as Error)?.message ?? e).toLowerCase();
    const type = /token/.test(msg)
      ? "token_rejected"
      : /timeout/.test(msg)
        ? "timeout"
        : "connect_error";
    console.error(`AUTH_SOURCE=${SRC} ERROR_TYPE=${type}`);
  },
  onEvent: (evt) => {
    wsConnect = true;
    const payload = (evt?.payload ?? {}) as Record<string, any>;
    const data = (payload?.data ?? {}) as Record<string, unknown>;
    const ev = String((data as any)?.event ?? evt?.event ?? "");
    const isDepth = evt.event === "agent" && ev === "chat.depth_decided";
    if (!isDepth) nonDepthVisible = true;
    if (hasForbiddenKey(data) || hasForbiddenKey(payload)) rawTextLeaks++;
    if (isDepth) {
      depthEvents++;
      out.write(
        JSON.stringify({
          ts: payload.ts,
          runId: payload.runId,
          stream: payload.stream,
          event: ev,
          wouldDepth: data.wouldDepth,
          routeStrength: data.routeStrength,
          flags: data.flags,
          sessionKeyHash: data.sessionKeyHash,
        }) + "\n",
      );
    }
  },
});
client.start();

setTimeout(() => {
  out.end();
  const pf = (b: boolean) => (b ? "PASS" : "FAIL");
  console.log(
    [
      "SMOKE_SUMMARY",
      `AUTH_SOURCE=${SRC}`,
      `AUTH=${pf(auth)}`,
      `WS_CONNECT=${pf(wsConnect)}`,
      `SUBSCRIPTION_ACK=${pf(subscriptionAck)}`,
      `NON_DEPTH_EVENT_VISIBLE=${nonDepthVisible ? "YES" : "NO"}`,
      `DEPTH_EVENTS=${depthEvents}`,
      `RAW_TEXT_LEAKS=${rawTextLeaks}`,
    ].join("\n"),
  );
  process.exit(
    auth && wsConnect && subscriptionAck && nonDepthVisible && rawTextLeaks === 0 ? 0 : 1,
  );
}, duration * 1000);
```

## Appendix E — self-contained capture (no repo checkout; RECOMMENDED for the prod host)

The prod host has `node` but no repo checkout / `bun` / `tsx`, so Appendix D (which reuses `GatewayClient` via a TS runner) cannot run there. Appendix E is a single Node file that needs ONLY the `ws` package and does a **token-only** connect (no device payload -> no device registration). It runs on the prod host against the loopback gateway (`--network host` publishes `127.0.0.1:18789` on the host), so no tunnel is needed.

Security properties (unchanged contract): token read ONLY from `OPENBOT_OPERATOR_TOKEN_FILE`; never in argv / child token env / JSONL / log / shell history; failures print only source NAME + error TYPE; read-only (subscribe only, no mutating calls, no config change); no device registration.

Validated locally against a mock gateway that speaks the real frames:

- happy path -> `AUTH=PASS WS_CONNECT=PASS SUBSCRIPTION_ACK=PASS NON_DEPTH_EVENT_VISIBLE=YES DEPTH_EVENTS=1 RAW_TEXT_LEAKS=1` (synthetic depth counted; a poisoned event with a forbidden key detected; the depth JSONL record carried only `sessionKeyHash`, no raw text)
- wrong token -> `AUTH=FAIL ERROR_TYPE=token_rejected` (no value leaked)
- missing token file -> `ERROR_TYPE=file_unreadable`

Run on the prod host (production owner; token in a 600-perm file; provision `ws` once):

```
# 1. provision ws (any one): a temp npm dir, the repo, or the container's node_modules
mkdir -p /root/cap && cd /root/cap && npm i ws >/dev/null 2>&1   # ws is tiny
# 2. put the real gateway.auth.token in a protected file
umask 077; printf '%s' '<REAL_GATEWAY_AUTH_TOKEN>' > /root/cap/operator-token
# 3. run (loopback; 60s)
OPENBOT_OPERATOR_TOKEN_FILE=/root/cap/operator-token \
NODE_PATH=/root/cap/node_modules \
  node /root/cap/capture-chat-depth-events.cjs \
  --gateway ws://127.0.0.1:18789 \
  --duration 60 \
  --output /tmp/chat-depth-baseline.jsonl
# (options accept flags or the CAPTURE_* env vars; flag wins. `--help` prints usage.
#  the token is NEVER a flag: it is read only from OPENBOT_OPERATOR_TOKEN_FILE.)
# 4. shred the token file when done
shred -u /root/cap/operator-token 2>/dev/null || rm -f /root/cap/operator-token
```

Note: the token must be the gateway's `gateway.auth.token` (the value the gateway validates), which the production owner holds — not necessarily the `OPENBOT_GATEWAY_TOKEN` env value. Return only the redacted `SMOKE_SUMMARY` (no token, no Authorization, no full session key, no user text). With shadow unset, `DEPTH_EVENTS` must be `0` and `RAW_TEXT_LEAKS` must be `0`; `NON_DEPTH_EVENT_VISIBLE=YES` (heartbeat/tick) proves the subscription link.

### E.1 scripts/capture-chat-depth-events.cjs

```js
#!/usr/bin/env node
"use strict";
// Self-contained read-only shadow capture. Requires ONLY `ws`. Token-only auth
// (no device -> no device registration). Token read ONLY from OPENBOT_OPERATOR_TOKEN_FILE.
const fs = require("node:fs");
const crypto = require("node:crypto");

const SRC = "OPENBOT_OPERATOR_TOKEN_FILE";
function argVal(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    "usage: OPENBOT_OPERATOR_TOKEN_FILE=<file> node capture-chat-depth-events.cjs " +
      "[--gateway ws://127.0.0.1:18789] [--duration 60] [--output <path>]\n" +
      "Token is read ONLY from OPENBOT_OPERATOR_TOKEN_FILE (never argv). " +
      "Read-only, token-only (no device registration).",
  );
  process.exit(0);
}
// Token comes ONLY from the file (never a flag/argv). Non-secret options accept
// either a CLI flag or an env var; flag wins, then env, then default.
const tokenFile = process.env.OPENBOT_OPERATOR_TOKEN_FILE;
const url = argVal("--gateway") || process.env.CAPTURE_GATEWAY || "ws://127.0.0.1:18789";
const duration = Number(argVal("--duration") || process.env.CAPTURE_DURATION || "60");
const output = argVal("--output") || process.env.CAPTURE_OUTPUT || "/tmp/chat-depth-baseline.jsonl";

function fail(type) {
  console.error("AUTH_SOURCE=" + SRC + " ERROR_TYPE=" + type);
  process.exit(3);
}
let WebSocket;
try {
  WebSocket = require("ws");
} catch {
  console.error("AUTH_SOURCE=" + SRC + " ERROR_TYPE=ws_module_missing");
  process.exit(4);
}
if (!tokenFile) fail("env_unset");
let token = "";
try {
  token = fs.readFileSync(tokenFile, "utf8").trim();
} catch {
  fail("file_unreadable");
}
if (!token) fail("empty_token");

const FORBIDDEN = new Set([
  "text",
  "body",
  "content",
  "prompt",
  "message",
  "attachment",
  "attachments",
  "token",
  "secret",
  "password",
  "apikey",
  "authorization",
]);
const out = fs.createWriteStream(output, { flags: "a", mode: 0o600 });
let wsConnect = false,
  auth = false,
  subAck = false,
  nonDepth = false,
  depth = 0,
  leaks = 0;
const connectId = crypto.randomUUID();

function hasForbidden(o) {
  if (!o || typeof o !== "object") return false;
  for (const k of Object.keys(o)) if (FORBIDDEN.has(k.toLowerCase())) return true;
  return false;
}

const ws = new WebSocket(url);
ws.on("open", () => {
  wsConnect = true;
});
ws.on("error", (e) => {
  const m = String((e && e.message) || e).toLowerCase();
  console.error(
    "AUTH_SOURCE=" + SRC + " ERROR_TYPE=" + (/refused/.test(m) ? "connect_refused" : "ws_error"),
  );
});
ws.on("message", (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (msg.type === "event" && msg.event === "connect.challenge") {
    ws.send(
      JSON.stringify({
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "gateway-client",
            version: "1.0.0",
            platform: process.platform,
            mode: "backend",
          },
          caps: [],
          auth: { token },
          role: "operator",
          scopes: ["operator.admin"],
        },
      }),
    );
    return;
  }
  if (msg.type === "res" && msg.id === connectId) {
    if (msg.ok) {
      auth = true;
      wsConnect = true;
      subAck = true;
    } else {
      const em = String((msg.error && msg.error.message) || "").toLowerCase();
      console.error(
        "AUTH_SOURCE=" +
          SRC +
          " ERROR_TYPE=" +
          (/token/.test(em) ? "token_rejected" : "connect_rejected"),
      );
    }
    return;
  }
  if (msg.type === "event") {
    const payload = msg.payload || {};
    const data = (payload && payload.data) || {};
    const depthEv = msg.event === "agent" && String(data.event || "") === "chat.depth_decided";
    if (!depthEv) nonDepth = true;
    if (hasForbidden(data) || hasForbidden(payload)) leaks++;
    if (depthEv) {
      depth++;
      out.write(
        JSON.stringify({
          ts: payload.ts,
          runId: payload.runId,
          stream: payload.stream,
          event: data.event,
          wouldDepth: data.wouldDepth,
          routeStrength: data.routeStrength,
          flags: data.flags,
          sessionKeyHash: data.sessionKeyHash,
        }) + "\n",
      );
    }
  }
});

setTimeout(() => {
  try {
    out.end();
  } catch {}
  const pf = (b) => (b ? "PASS" : "FAIL");
  console.log(
    [
      "SMOKE_SUMMARY",
      "AUTH_SOURCE=" + SRC,
      "AUTH=" + pf(auth),
      "WS_CONNECT=" + pf(wsConnect),
      "SUBSCRIPTION_ACK=" + pf(subAck),
      "NON_DEPTH_EVENT_VISIBLE=" + (nonDepth ? "YES" : "NO"),
      "DEPTH_EVENTS=" + depth,
      "RAW_TEXT_LEAKS=" + leaks,
      "DEVICE_REGISTERED=NO",
      "LIVE_TOUCHED=NO",
      "FLAGS_CHANGED=NO",
    ].join("\n"),
  );
  try {
    ws.close();
  } catch {}
  process.exit(auth && wsConnect && subAck && nonDepth && leaks === 0 ? 0 : 1);
}, duration * 1000);
```
