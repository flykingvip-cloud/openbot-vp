# Scope coverage — 14 wiring-matrix rows vs public feature inventory

Pin for this mapping: tip `f68a3c56b00fe060209678921bfdc28dbd4138b5`.  
Prior 14-row matrix source (context only): old fullstack acceptance at pin `3f7786f4…` (`02-wiring-matrix.md`).  
Public inventory anchors: `docs/acceptance/fullstack-2026-11-01/01-module-inventory.md` (old pin draft), `AGENTS.md`, `docs/acceptance/openbot-inventory-acceptance-plan.md` Stage 7 product-surface authority, `docs/design/openbot-product-entry-matrix-2026-04-11.md`.

## Matrix → inventory map

| Matrix ID | Path | Public inventory surface | Coverage note on tip after P1 fix |
|-----------|------|--------------------------|-----------------------------------|
| W01 | Auth connect (WS/RPC + auth compat) | Auth / pairing; Gateway WS/RPC | Compat suite PASS this run. Live multi-tenant connect NOT RUN. |
| W02 | Security profile startup | Auth / SECURITY profiles | Units previously COMPLETE on old pin; not re-full-gated here beyond build/tsgo. Live managed_enterprise boot NOT RUN. |
| W03 | memory-core → memory_search/get | Tools / skills + memory-core extension | DEF-001 fixed on tip (type contract aligned + regression). Continuity live e2e NOT RUN. |
| W04 | Chat send → agent run | Agent execution; UI/WebChat | Static wiring present historically. Live model turn NOT RUN. DEF-006/007 class unit drifts still open (out of P1). |
| W05 | Agent tools / skills | Tools / skills | Registry path present. DEF-005 tool-policy expectation drift still open (P3, out of P1). |
| W06 | Deliverables | Deliverables / persist | Code path present. Live UI NOT RUN. |
| W07 | Enterprise IM — WeCom | Enterprise IM | Adapter present. Live credentials BLOCKED/NOT RUN. |
| W08 | Enterprise IM — Feishu | Enterprise IM | Same. |
| W09 | Enterprise IM — DingTalk | Enterprise IM | Same. |
| W10 | Protocol clients (Swift / protocol:check) | Protocol schema + macOS/shared clients | DEF-002 fixed via regen + commit. Light swiftc OK; full SwiftPM build BLOCKED. |
| W11 | Enterprise-data event bus | Gateway enterprise-data | Units historically COMPLETE; not the DEF-004 locus. |
| W12 | Event-driven projection materializer | Gateway enterprise-data | DEF-004 fixed (import from sar-governance-bridge); focused tests PASS. |
| W13 | Controlled SAR / data-gateway | Gateway enterprise-data | Units PASS with materializer suite this run. Live SAR seat NOT RUN. |
| W14 | Build / quality gates | Aggregate gates | tsgo PASS; protocol:check PASS after commit; build low PASS; format:check repo-wide still FAIL pre-existing. |

## Public surfaces outside the 14-row matrix (gaps)

These appear in module/public inventory or AGENTS but were **not** denominator rows in the prior 14-path wiring matrix:

1. **CLI** (`openbot.mjs`, `src/cli`, `src/commands`) — Stage 3 CLI evidence exists elsewhere; not a W0x row.
2. **Nodes / desktop & mobile apps** (`apps/android`, `apps/harmony`, `apps/ios`, `apps/macos` beyond GatewayModels, `apps/windows`, `src/node-host`) — only Swift protocol models touched via W10; app UX/node host unscoped.
3. **Non-enterprise messaging channels** (WhatsApp, Telegram, Discord, Slack, Matrix, Signal, iMessage, Line, IRC, MS Teams, Google Chat, Twitch, Zalo, WeChat, BlueBubbles, Nextcloud, Nostr, Synology, Tlon, …) — 40+ extensions beyond WeCom/Feishu/DingTalk.
4. **Control UI port surfaces beyond chat/auth** — employee / enterprise / platform / diagnosis ports, supervisor board, workbench, knowledge universe, personal email browser, model routing UI (tip #190), daibai guide, etc.
5. **Collaboration runtime packages** (`packages/collaboration-*`, AOR stack, constitutional-*, evolution-core, cogniweave-sdk).
6. **Installers / public web entry** (`https://www.openbot.love/`, sibling `openbot.love` installers) — publication/delivery alignment, not wiring-matrix.
7. **Doctor / migration / HA / SBOM / supply-chain** (Stage 4–6 acceptance evidence) — orthogonal to the 14 critical paths.
8. **Voice / phone-control / media-monitor / talk-voice** extensions.
9. **Plugin auth portals** (minimax/qwen/google-gemini CLI auth, copilot-proxy, device-pair).
10. **Windows / Harmony / iOS / Android native protocol clients** parity with Swift GatewayModels.

## Explicit judgment

- Clearing DEF-001/002/004 on tip unblocks the **quality-gate / contract** subset of W03, W10, W12, W14.
- It does **not** make the 14-row matrix COMPLETE overall, and does **not** equal fullstack Stage PASS.
- Gap list above must be scheduled separately if inventory acceptance requires Stage 7 surface completeness.
