# Exec efficiency — Inbound Depth LIVE greyscale runbook

**Audience:** platform / SRE  
**Related:** P0 `#649` (sandbox docker + meeting alsoAllow + CSC chat/minimal knowledge skip),
P1 `#650` (on-demand memory / early ACK),
`src/gateway/chat-inbound-flags.ts`,
`docs/design/chat-inbound-depth-router-revised-proposal-2026-08-20.md`,
`docs/design/exec-efficiency-p2-observability-dashboards-2026-10-12.md`.

This runbook governs **env-only** greyscale of inbound depth. Code defaults remain **off**
for the router. Do **not** enable `OPENBOT_CHAT_INBOUND_DEPTH_ROUTER` from an image bake or
compose default in this PR stream — only via host `.env` after shadow evidence is clean.

---

## Flag ladder (all default off in code)

| Env                                                 | Effect when `1` / `true`                                                                                                                                       | Safe default                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW`                 | Classify depth; emit `chat.depth_decided` (`mode=shadow`). **Does not** skip knowledge or strip tools by itself.                                               | OK for LIVE after P0 (may already be on)                             |
| `OPENBOT_CHAT_INBOUND_DEPTH_ROUTER`                 | Apply chat-lane cuts when depth=`chat` for sessions that only classify under ROUTER (steward employee already gets classify-only chat-lane without this flag). | **Off** until shadow window is clean                                 |
| `OPENBOT_CHAT_INBOUND_KNOWLEDGE_POLICY`             | Retrieve-depth source intersection / live-source gate.                                                                                                         | Off until router is stable                                           |
| `OPENBOT_CHAT_INBOUND_TOOL_POLICY`                  | Retrieve-depth read-only tool allowlist.                                                                                                                       | Off until router is stable                                           |
| `OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST`        | Comma-separated agentIds (besides default `main`) in scope. Empty = main steward only.                                                                         | Empty until explicitly expanded                                      |
| `OPENBOT_CHAT_INBOUND_PERSIST_EARLY`                | Persist plain-text user messages before ACK.                                                                                                                   | Independent; enable only if transcript contract approved             |
| `OPENBOT_EXECUTION_ROUTER_OBSERVATION`              | Terminal `chat.execution_observation` with stage latencies.                                                                                                    | Optional for dashboards                                              |
| `OPENBOT_CHAT_INBOUND_DEPTH_HARVEST`                | Durable local JSONL of `chat.depth_decided` under `$OPENBOT_STATE_DIR/inbound-depth-harvest/`.                                                                 | **Auto-on with SHADOW/ROUTER**; set `0` to disable; set `1` to force |
| `OPENBOT_CHAT_INBOUND_DEPTH_HARVEST_RETENTION_DAYS` | Day-file retention for harvest JSONL (default **14**, max 90).                                                                                                 | Optional                                                             |

Independent of these flags (already on main via P0 + classify-only chat-lane): employee-steward
turns always classify depth. When depth=`chat`, the same chat-lane cuts apply even with
ROUTER still off: skip optional knowledge, empty tool ceiling (`disableTools`), empty skill
filter, OI `listingMode=lightweight`, and (after onboarding completes) workspace
`bootstrapContextMode=lightweight`. ROUTER remains the greyscale switch for non-steward /
broader host rollout and related retrieve policies — it is **not** the only path that strips
tools on steward chat. `knowledge_degraded` / `tool_policy_applied` stage events still emit
on those classify-only chat-lane turns.

---

## Current LIVE posture (operators)

1. Confirm sandbox docker bake still green (`run-gateway.sh` probe / no `spawn docker ENOENT`).
2. Confirm steward `alsoAllow` includes `meeting` (P0 provision).
3. If `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1` is already set on the gateway env: leave it;
   harvest `chat.depth_decided` for at least one business day (or ≥N steward turns).
   After a tip that includes the depth harvest sink lands via Path B DIGEST, samples
   append to `$OPENBOT_STATE_DIR/inbound-depth-harvest/depth-decided-YYYY-MM-DD.jsonl`
   automatically (no new mandatory env). Override with
   `OPENBOT_CHAT_INBOUND_DEPTH_HARVEST=0` if disk policy requires.
4. **Do not** set `OPENBOT_CHAT_INBOUND_DEPTH_ROUTER=1` in image/`docker-compose` defaults.
   Enable only per host `.env` after the go/no-go checklist below.

---

## When to enable ROUTER

Enable `OPENBOT_CHAT_INBOUND_DEPTH_ROUTER=1` only when **all** hold:

1. Shadow samples show `wouldDepth=chat` on clearly lightweight turns (greetings / short ACK)
   and `retrieve`/`act` on knowledge or side-effect turns — no systematic under-routing of
   meeting/schedule/write intents to `chat`.
2. P0 path still skips optional knowledge for steward chat/minimal even with ROUTER off
   (regression: cold greetings should not pay full knowledge prefetch).
3. On-call has rollback steps rehearsed (below) and a 30–60 minute watch window booked.
4. Prefer first enable on a **single** gateway / allowlisted agent set
   (`OPENBOT_CHAT_INBOUND_DEPTH_AGENT_ALLOWLIST`) before fleet-wide.

Suggested first wave (optional): keep allowlist empty (main only) or pin one canary
agentId; watch dashboards for 1–2 hours; then widen.

---

## Enable procedure

```bash
# On the LIVE host that owns the gateway .env (example paths — adjust):
# 1) Backup
cp -a /var/lib/openbot/.env.docker /var/lib/openbot/.env.docker.bak.$(date +%Y%m%d%H%M%S)

# 2) Set shadow (if not already) and router — do NOT bake these into the image
#    OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1
#    OPENBOT_CHAT_INBOUND_DEPTH_ROUTER=1

# 3) Recreate gateway so env is picked up (R9: no /app/dist overlay)
#    Prefer deploy/production/scripts/run-gateway.sh or your cutover script.
```

After recreate: send one chat greeting and one retrieve-style question; confirm
`chat.depth_decided` shows `mode=router`, and chat-depth turns emit
`knowledge_degraded` with `knowledgeSkippedReason=depth_chat` (no `knowledge_started`
for pure chat lane).

---

## Rollback

Immediate (preferred):

1. Set `OPENBOT_CHAT_INBOUND_DEPTH_ROUTER=0` (or remove the line) in host `.env`.
2. Leave `OPENBOT_CHAT_INBOUND_DEPTH_SHADOW=1` if you still want classify telemetry.
3. Recreate gateway; verify `mode=shadow` or no router mode on new runs.
4. If knowledge policy / tool policy were also enabled, turn those off in the same change.

Break-glass: restore `.env` from the backup taken in Enable procedure and recreate.

P0 CSC skip and P1 prompt/ACK behavior remain even with ROUTER off — rollback does **not**
undo those merges.

---

## Do / Don't

| Do                                              | Don't                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Toggle via host env + recreate                  | Bake ROUTER=`1` into Dockerfile / compose `environment` defaults                     |
| Keep shadow on during router canary             | Jump to KNOWLEDGE_POLICY + TOOL_POLICY in the same change without evidence           |
| Watch `knowledgeMs` / `modelTtftMs` / depth mix | Push LIVE config JSON (`bootstrapMaxChars` etc.) from agent automation without Owner |

---

## Shadow scorecard (blocker A)

Lifecycle `chat.depth_decided` alone is **not** durable on LIVE (docker logs / session
JSON typically show 0 hits). The harvest sink closes that gap:

1. Confirm tip includes `src/gateway/chat-inbound-depth-harvest.ts` and SHADOW=1.
2. Drive steward turns (clean greet / ACK / retrieve / meeting-or-schedule / write).
3. On the gateway host (or a copied harvest dir):

```bash
bun scripts/ops/inbound-depth-shadow-scorecard.ts \
  --root "$OPENBOT_STATE_DIR/inbound-depth-harvest"
# or: --file /path/to/depth-decided-YYYY-MM-DD.jsonl
```

4. Go/no-go inputs from the JSON output:
   - `byWouldDepth` has non-zero `chat`, `retrieve`, and (ideally) `act`
   - `underRouteRiskCount` is 0 (act-like reasons classified as `chat`)
   - Spot-check known meeting/schedule/write probes still land `act` / not `chat`
5. Then follow **When to enable ROUTER** below. Harvest does **not** flip ROUTER.

Optional kill-switch: `OPENBOT_CHAT_INBOUND_DEPTH_HARVEST=0` (keep SHADOW).

---

## P2 observe standby (not parallel delivery)

Each inbound turn sync-calls several `observe*` helpers from
`dispatch-from-config` (CTR shadow / Activation, orchestration consider,
web_read shadow, reply-completion). They are **standby or opt-in**:

| Surface                                                   | Default                        | Live delivery?                                                 |
| --------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| CTR shadow / Activation `analyzeTurn`/`detectTurn`        | Off until `init*Hook` + flag   | No — observation / gated activation only                       |
| Orchestration consider / web_read shadow                  | Env flags default off          | No — `ORCHESTRATION_LIVE_INVOKE` stays frozen false            |
| SkillExecutionBinding                                     | Always available as projection | No — merges lifecycle skills into the **same** embedded runner |
| `OPENBOT_CANARY_VALIDATORS` (json-canvas / hook-delivery) | Empty / unset                  | No — contracts inert until the env **names** the validator     |
| soft-observe-dh (`OPENBOT_EVOLUTION_SOFT_OBSERVE_DH`)     | Default on                     | **Canary-scoped only** — never production cutover              |

**Do not** bake `OPENBOT_CANARY_VALIDATORS`, Activation live, ORCH live, or soft-observe
active cutover into image / compose `environment` defaults. Host `.env` canary only.

Dashboard KPIs for these standby surfaces:
`docs/design/exec-efficiency-p2-observability-dashboards-2026-10-12.md`.

---

## Pointers

- Observability fields and recommended dashboards:
  `docs/design/exec-efficiency-p2-observability-dashboards-2026-10-12.md`
- Durable shadow harvest + scorecard CLI:
  `src/gateway/chat-inbound-depth-harvest.ts`,
  `scripts/ops/inbound-depth-shadow-scorecard.ts`
- Context budget schema help (recommended steward ranges, not LIVE pushes):
  `agents.defaults.bootstrapMaxChars` / `compaction.*` in `src/config/schema.help.ts`

---

## Related: skills index defaults (code, not env)

Independent of LIVE depth flags, MainPath P1 thins the skills prompt defaults in
`src/agents/skills/workspace.ts`:

- `maxSkillsInPrompt` default **48** (was 150)
- `maxSkillsPromptChars` default **16_000** (was 30_000)
- at most **3** `metadata.openclaw.always` skills keep the always boost after ranking

Prefer turn `preferSkillNames` / agent bindings so truncation keeps the promoted set.
Do **not** treat this as enabling `OPENBOT_CHAT_INBOUND_DEPTH_ROUTER`.
