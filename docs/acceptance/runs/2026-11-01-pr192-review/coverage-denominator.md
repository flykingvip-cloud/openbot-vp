# Fullstack coverage denominator — expanded beyond 14 wiring rows

**Pin for inventory:** PR HEAD `433906f5b` / main tip at review-end `5815006dc` (inventory shapes match tip `f68a3c56b` trees for apps/extensions/packages).  
**Sources:** `AGENTS.md`, `docs/acceptance/openbot-inventory-acceptance-plan.md`, acceptance worktree `01-module-inventory.md` / `02-wiring-matrix.md` (old pin draft), `docs/channels/`, `extensions/*/openclaw.plugin.json`, `apps/`, `packages/`, CLI `openbot --help`.  
**Rule:** old **14** wiring-matrix rows are a _critical-path slice_, **not** the public-capability denominator.

## Denominator summary

| Bucket                                                      |            Count | Notes                                                                                                                                                                    |
| ----------------------------------------------------------- | ---------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Critical public surfaces (product)                          |           **12** | CLI, Gateway, Control UI/WebChat, Auth/pairing, Agent exec, Tools/skills, Deliverables, Enterprise IM trio, Nodes/apps, Protocol, Memory continuity, Enterprise-data/SAR |
| Messaging channel plugins (`openclaw.plugin.json` channels) |           **24** | Static inventory this run                                                                                                                                                |
| Channel docs under `docs/channels/` (excl. meta pages)      |           **24** | Meta excluded: index, routing, groups\*, location, pairing, troubleshooting, enterprise-im, broadcast-groups                                                             |
| Extensions (all workspace plugins)                          |           **44** | Includes non-channel plugins (memory, auth helpers, diagnostics, …)                                                                                                      |
| Multi-end apps                                              |            **6** | android, harmony, ios, macos, shared, windows — all PRESENT                                                                                                              |
| packages/ workspace libs                                    |           **18** | AOR/collab/constitutional/evolution/toolkit/…                                                                                                                            |
| CLI top-level commands (`openbot --help`)                   |           **49** | Help smoke PASS this run                                                                                                                                                 |
| Acceptance Stage tracks (plan)                              |            **8** | Stages 1–8 in inventory acceptance plan (trust→…→Stage8 eligibility)                                                                                                     |
| External installer surface                                  | **1 (跨仓依赖)** | `../openbot.love` install scripts — **not in this repo**                                                                                                                 |

### Primary denominator used for coverage math

**N = 12 critical surfaces + 24 channel plugins + 6 apps + 49 CLI commands + 18 packages + 8 stages + 1 cross-repo installer = 118**

(Extensions beyond channel plugins and channel docs remain listed below as inventory depth; they are **not double-counted** into N when already represented as channel plugins.)

**Denominator size (primary N):** **118** public capability units.

---

## Critical surfaces — map vs status (tip / PR192 review)

| ID  | Capability                                  | Status          | Notes                                                                                                                                       |
| --- | ------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | CLI entry (`openbot.mjs` / commands)        | **CONDITIONAL** | `--help` / `doctor --help` / `channels --help` PASS (`logs/07-cli-help-doctor-smoke.log`). Live doctor against running gateway **NOT RUN**. |
| S02 | Gateway WS/RPC                              | **CONDITIONAL** | Auth compat 43 PASS; low build PASS. Live multi-tenant connect **NOT RUN**.                                                                 |
| S03 | Control UI / WebChat (`ui/`)                | **CONDITIONAL** | Built in low profile; interactive ports / employee surfaces largely **NOT RUN**.                                                            |
| S04 | Auth / pairing / devices                    | **CONDITIONAL** | Compat baseline PASS; live pairing **NOT RUN**.                                                                                             |
| S05 | Agent execution                             | **CONDITIONAL** | Static wiring known from prior matrix W04; live agent turn **NOT RUN**.                                                                     |
| S06 | Tools / skills                              | **CONDITIONAL** | Prior W05; live tool invoke **NOT RUN**.                                                                                                    |
| S07 | Deliverables / formal root                  | **CONDITIONAL** | Prior W06 units; live UI **NOT RUN**.                                                                                                       |
| S08 | Enterprise IM WeCom                         | **BLOCKED**     | No live credentials                                                                                                                         |
| S09 | Enterprise IM Feishu                        | **BLOCKED**     | No live credentials                                                                                                                         |
| S10 | Enterprise IM DingTalk                      | **BLOCKED**     | No live credentials                                                                                                                         |
| S11 | Protocol / Swift clients                    | **CONDITIONAL** | `protocol:check` PASS on PR HEAD; **SwiftPM compile BLOCKED**                                                                               |
| S12 | Memory continuity + PluginMemoryToolFactory | **CONDITIONAL** | DEF-001 type contract PASS on HEAD; continuity e2e seats **NOT RUN**                                                                        |
| S13 | Enterprise-data events + SAR materializer   | **CONDITIONAL** | DEF-004 import + focused tests PASS; live governed SAR **NOT RUN**                                                                          |

(Old 14-row matrix W01–W14 maps into S01–S13; W10/W12 broken on old pin are addressed by PR #192.)

---

## Channel plugins (24) — static inventory

```
bluebubbles, dingtalk, discord, feishu, googlechat, imessage, irc, line,
matrix, mattermost, msteams, nextcloud-talk, nostr, signal, slack,
synology-chat, telegram, tlon, twitch, wechat, wecom, whatsapp, zalo, zalouser
```

| Status class     | Channels                | Meaning                                                                                           |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| BLOCKED (live)   | wecom, feishu, dingtalk | Enterprise IM — credentials not authorized                                                        |
| NOT RUN (live)   | all other 24 plugins    | Adapter entry present; inbound/outbound live **NOT RUN**                                          |
| Covered (static) | all 24                  | Listed via `openclaw.plugin.json` + docs/channels this run (`logs/08-static-inventory-smoke.log`) |

---

## Apps (6)

| App                 | Presence | Coverage                                                                        |
| ------------------- | -------- | ------------------------------------------------------------------------------- |
| macos               | PRESENT  | Protocol models regen checked; full app build **NOT RUN** / SwiftPM **BLOCKED** |
| ios                 | PRESENT  | **NOT RUN**                                                                     |
| android             | PRESENT  | **NOT RUN**                                                                     |
| harmony             | PRESENT  | **NOT RUN**                                                                     |
| windows             | PRESENT  | **NOT RUN**                                                                     |
| shared (OpenBotKit) | PRESENT  | GatewayModels regen checked                                                     |

---

## Packages (18) — presence only

aor-backend-graph, aor-backend-openbot, aor-backend-stub, aor-core, aor-sdk-node, aor-sdk-python, clawdbot, cogniweave-sdk, collaboration-core, collaboration-openbot-adapter, collaboration-runtime, constitutional-conformance, constitutional-contracts, constitutional-registry, constitutional-runtime, evolution-core, moltbot, toolkit

Status: **NOT RUN** as product capability (tree presence only this pass).

---

## CLI commands (49) — help smoke

Help enumeration PASS (`logs/07-cli-help-doctor-smoke.log`). Examples: gateway, agent, channels, doctor, models, nodes, plugins, sandbox, skills, status, tui, update, …

Per-command behavioral coverage: **NOT RUN** (except help text). Risk queue prioritizes `doctor`, `channels status`, `gateway`, `agents`, `onboard`, `plugins`.

---

## Stages 1–8 (acceptance plan)

| Stage | Theme                                                                   | This pass                                                           |
| ----: | ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
|     1 | Trust / security profiles                                               | Prior narrow PASS evidence exists in plan; **not re-executed** here |
|     2 | Architecture / transcript                                               | Prior narrow PASS; **not re-executed**                              |
|     3 | API / CLI authz evidence tests present under `docs/acceptance/stage3-*` | **NOT RUN** this review                                             |
|   4–6 | Broader product / CI / install matrices                                 | **NOT RUN** / historically CONDITIONAL—top risk queue below         |
|     7 | Product-surface authority                                               | Inventory anchors only                                              |
|     8 | Eligibility rollup                                                      | `stage8_eligible` remains false until fuller CURRENT evidence       |

---

## 跨仓依赖 (external installers)

Cited by `AGENTS.md:51` only (do **not** invent other repos):

- Sibling repo path: `../openbot.love`
- Artifacts: `public/install.sh`, `public/install-cli.sh`, `public/install.ps1`
- Served from: `https://openbot.love/*`
- Local sibling on this Mac at review time: **ABSENT**
- Status: **跨仓依赖 / NOT RUN** inside `openbot-vp`

Remotes verified for this work: **only** `flykingvip-cloud/openbot-vp`.

---

## Credential-free expansion executed (this review)

| Check                                                | Result              | Log                                                        |
| ---------------------------------------------------- | ------------------- | ---------------------------------------------------------- |
| CLI `--help` / `doctor --help` / `channels --help`   | PASS                | `logs/07-cli-help-doctor-smoke.log`                        |
| Static channel + extension + app + package inventory | PASS (presence)     | `logs/08-static-inventory-smoke.log`                       |
| SBOM script presence (`pnpm sbom:cyclonedx`)         | PRESENT             | script found                                               |
| SBOM generation                                      | **PASS (artifact)** | `logs/sbom-cyclonedx.json` (~32MB CycloneDX; long runtime) |
| Live channel/agent/credential tests                  | **NOT RUN**         | authorized exclusion                                       |

**Do not claim live PASS.**

---

## Risk-ordered next checks (Stages 4–6, CLI, install, channels, multi-end)

1. **Rebase PR #192 onto main `5815006dc`** and re-run tsgo / protocol:check / focused DEFs (merge hygiene).
2. **Format** the 4 PR acceptance docs failing oxfmt.
3. **Stage 4–6:** pin CURRENT evidence rows for CI gate / install-smoke / checks-windows from inventory plan — no HISTORICAL inheritance.
4. **CLI doctor** non-interactive against local loopback gateway (still credential-light; no third-party IM tokens).
5. **Channels static deeper:** load each channel plugin module + `channels capabilities` offline; keep live probes NOT RUN until creds authorized.
6. **Control UI:** enumerate ports/surfaces from `ui/src/ui/ports` and mark CONDITIONAL vs NOT RUN (no claim from build alone).
7. **Multi-end apps:** macos `swift build` unblocking (dep fetch), android assembleDebug smoke, ios/harmony/windows presence→compile ladder.
8. **Install/delivery:** clone or fetch `openbot.love` as explicit 跨仓任务; dry-run install scripts in a disposable dir.
9. **Collab/AOR packages:** `pnpm build:collaboration:packages` + focused runtime lifecycle tests.
10. **SBOM:** diagnose hang; produce CycloneDX artifact under acceptance runs.
11. **Enterprise IM live** (WeCom/Feishu/DingTalk) only with explicit credential authorization.
12. **Memory continuity e2e** with real seats after DEF-001 land.

### Top gaps (by risk)

1. Live IM + agent + credentials (**BLOCKED/NOT RUN**)
2. SwiftPM / native app compiles (**BLOCKED/NOT RUN**)
3. Installer 跨仓 + Stage 4–6 CURRENT CI/install evidence (**NOT RUN**)
4. CLI/doctor beyond help; Control UI interactive ports (**NOT RUN**)
5. Packages (collab/AOR/evolution) runtime (**NOT RUN**)

## Remediation follow-up (credential-free, light)

- Post-rebase gates reconfirmed 2026-11-01 Asia/Shanghai — see `REVIEW.md` Remediation; does not expand Stage 4–6 live coverage.
- Extra static: `package.json` scripts containing doctor/cli/channel/install/sbom/protocol/gateway — count **22** names (inventory only; not executed beyond prior CLI help/doctor smoke + protocol:check). Sample: android:install, gateway:dev, gateway:dev:reset, gateway:watch, lint:gateway:isolation-fail-closed, lint:gateway:method-packs, lint:tmp:channel-agnostic-boundaries, lint:tmp:no-raw-channel-fetch, protocol:check, protocol:gen, protocol:gen:swift, sbom:cyclonedx
- SBOM JSON relocated out of worktree (`/tmp/pr192-review-artifacts/`) so format delta stays 0; summary remains in `logs/09-sbom-smoke.SUMMARY.md`.
