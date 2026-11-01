# 10 — Tracked coverage inventory (denominator hardened)

**Pin:** `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c`  
**When:** 2026-11-02 Asia/Shanghai  
**Supersedes soft claim:** “约 N=118” without stable IDs.

## Claim narrowing (mandatory)

| False friend | Correct reading |
| --- | --- |
| Directory PRESENT | ≠ compile PASS ≠ runtime PASS |
| Plugin id ↔ docs filename match | ≠ channel live I/O PASS |
| `pnpm ui:build` / static index.html | ≠ Control UI interactive gateway smoke |
| SBOM / license file exists in tree | ≠ regen / audit PASS |
| CLI `--help` lists a command | ≠ that command’s runtime acceptance |
| P1 DEF-001/002/004 cleared | ≠ fullstack PASS |

## Column legend

- **Cap** — 功能能力 claimed by product/docs  
- **Static** — 静态结构 (files/ids present, docs match)  
- **Compile** — 编译 / package build / typecheck of that surface  
- **Runtime** — 运行 (local smoke or live). Live prod credentials stay **NOT RUN**.

Status vocabulary: `PASS` | `FAIL` | `NOT_RUN` | `BLOCKED` | `N/A`

## Inventory (stable IDs)

### A. Core platform / gateway / CLI (core)

| ID | Item | Cap | Static | Compile | Runtime | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| C-CLI-HELP | openbot CLI help surface | Y | PASS | PASS | PASS | 49 commands, 2026-11-02 smoke |
| C-BACKUP-OMIT | Backup default omit credentials | Y | PASS | PASS | **FAIL** | DEF-008; unit+diag this pin |
| C-BACKUP-CREATE | Backup create (happy path) | Y | PASS | PASS | PARTIAL | create works; omit broken |
| C-BACKUP-VERIFY | Backup verify | Y | PASS | PASS | NOT_RUN | Stage4 suite import flap this WT |
| C-STORE-STAGE4 | Stage4 store evidence suite | Y | PASS | BLOCKED* | NOT_RUN | *adapter resolve via linked nm in isolated WT |
| C-GATEWAY-LOCAL | Local gateway bring-up | Y | PASS | NOT_RUN | NOT_RUN | no live/local full start this run |
| C-DOCTOR | Doctor / health | Y | PASS | NOT_RUN | NOT_RUN | |
| C-CONFIG | Config load/migrate | Y | PASS | NOT_RUN | NOT_RUN | |
| C-MEMORY | Memory / RAG path | Y | PASS | NOT_RUN | NOT_RUN | docs closeout only on tip |
| C-AUTH-PROFILES | Auth profiles plumbing | Y | PASS | NOT_RUN | NOT_RUN | live creds NOT RUN |
| C-SESSION | Session / transcript store | Y | PASS | NOT_RUN | NOT_RUN | |
| C-HOOKS | Hooks pipeline | Y | PASS | NOT_RUN | NOT_RUN | |
| C-PLUGINS-LOAD | Plugin loader | Y | PASS | NOT_RUN | NOT_RUN | |
| C-CRON | Cron / scheduler | Y | PASS | NOT_RUN | NOT_RUN | |
| C-BROWSER-TOOL | Browser tool path | Y | PASS | NOT_RUN | NOT_RUN | |
| C-TTS | TTS path | Y | PASS | NOT_RUN | NOT_RUN | |
| C-MEDIA | Media understand | Y | PASS | NOT_RUN | NOT_RUN | |
| C-AGENT-LOOP | Agent loop smoke | Y | PASS | NOT_RUN | NOT_RUN | |
| C-SECURITY-AUDIT | Security audit command | Y | PASS | NOT_RUN | NOT_RUN | |
| C-UPDATE | Update / migrate CLI | Y | PASS | NOT_RUN | NOT_RUN | |

### B. Control UI (core)

| ID | Item | Cap | Static | Compile | Runtime | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| UI-BUILD | `pnpm ui:build` (vite) | Y | PASS | **PASS** | N/A | 5.78s; dist gitignored |
| UI-STATIC | Serve built index.html HTTP 200 | Y | PASS | N/A | **PASS** | `127.0.0.1:18765` static only |
| UI-INTERACTIVE | Control UI ↔ local gateway | Y | PASS | N/A | **NOT_RUN** | needs gateway; no prod creds |
| UI-I18N | UI i18n bundles | Y | PASS | NOT_RUN | NOT_RUN | |

### C. Channel plugins (24) — static match ≠ live

Each channel has Cap=Y. Static = plugin package + docs id match. Compile/Runtime default NOT_RUN this run unless noted. **Live = NOT_RUN for all.**

| ID | Channel | Static | Compile | Runtime |
| --- | --- | --- | --- | --- |
| CH-telegram | telegram | PASS | NOT_RUN | NOT_RUN |
| CH-whatsapp | whatsapp | PASS | NOT_RUN | NOT_RUN |
| CH-discord | discord | PASS | NOT_RUN | NOT_RUN |
| CH-irc | irc | PASS | NOT_RUN | NOT_RUN |
| CH-googlechat | googlechat | PASS | NOT_RUN | NOT_RUN |
| CH-slack | slack | PASS | NOT_RUN | NOT_RUN |
| CH-signal | signal | PASS | NOT_RUN | NOT_RUN |
| CH-imessage | imessage | PASS | NOT_RUN | NOT_RUN |
| CH-msteams | msteams | PASS | NOT_RUN | NOT_RUN |
| CH-mattermost | mattermost | PASS | NOT_RUN | NOT_RUN |
| CH-matrix | matrix | PASS | NOT_RUN | NOT_RUN |
| CH-feishu | feishu | PASS | NOT_RUN | NOT_RUN |
| CH-wecom | wecom | PASS | NOT_RUN | NOT_RUN |
| CH-wecom-app | wecom-app | PASS | NOT_RUN | NOT_RUN |
| CH-dingtalk | dingtalk | PASS | NOT_RUN | NOT_RUN |
| CH-qqbot | qqbot | PASS | NOT_RUN | NOT_RUN |
| CH-openclaw-weixin | openclaw-weixin | PASS | NOT_RUN | NOT_RUN |
| CH-bluebubbles | bluebubbles | PASS | NOT_RUN | NOT_RUN |
| CH-line | line | PASS | NOT_RUN | NOT_RUN |
| CH-zalo | zalo | PASS | NOT_RUN | NOT_RUN |
| CH-zalouser | zalouser | PASS | NOT_RUN | NOT_RUN |
| CH-synology-chat | synology-chat | PASS | NOT_RUN | NOT_RUN |
| CH-tlon | tlon | PASS | NOT_RUN | NOT_RUN |
| CH-nextcloud-talk | nextcloud-talk | PASS | NOT_RUN | NOT_RUN |

Static 24↔24 docs/plugin inventory reconfirmed earlier coverage work; not re-audited line-by-line this run.

### D. Multi-end clients (core surfaces; toolchain often peripheral BLOCKED)

| ID | Surface | Cap | Static | Compile | Runtime | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| ME-MAC-APP | macOS app | Y | PASS | **BLOCKED** | NOT_RUN | SwiftPM policy / prior hang; disk 98% — no install |
| ME-IOS | iOS | Y | PASS | **BLOCKED** | NOT_RUN | xcodegen / signing |
| ME-ANDROID | Android | Y | PASS | **BLOCKED** | NOT_RUN | SDK/gradle env |
| ME-WINDOWS | Windows | Y | PASS | **BLOCKED** | NOT_RUN | no Windows SDK on this Mac |
| ME-HARMONY | HarmonyOS | Y | PASS | **BLOCKED** | NOT_RUN | hvigor missing |
| ME-NODE-MINI | Node mini/companion | Y | PASS | NOT_RUN | NOT_RUN | |

### E. Supply chain / docs / acceptance meta (mostly peripheral)

| ID | Item | Cap | Static | Compile | Runtime | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| SC-SBOM-FILE | SBOM file present | Y | PASS | N/A | N/A | ≠ regen |
| SC-SBOM-REGEN | SBOM regenerate | Y | PASS | **BLOCKED** | NOT_RUN | prior timeout / network |
| SC-LICENSE | License inventory | Y | PASS | NOT_RUN | NOT_RUN | |
| SC-DEP-AUDIT | Dependency audit | Y | PASS | **BLOCKED** | NOT_RUN | |
| DOC-ACCEPT | Acceptance docs tree | Y | PASS | N/A | N/A | this PR |
| DOC-LOOM | Loom register/claim | Y | PASS | N/A | N/A | follow process on edit |
| TEST-UNIT-CORE | Core unit tests subset | Y | PASS | PASS | PARTIAL | backup omit FAIL |
| TEST-STAGE4 | Stage4 acceptance file | Y | PASS | BLOCKED* | FAIL† | †historical+same codepath; *import |

### F. P1 defect clearances (product already on main) — not fullstack

| ID | Defect | Cap | Static | Compile | Runtime |
| --- | --- | --- | --- | --- | --- |
| P1-DEF001 | (merged PR192) | Y | PASS | PASS | PASS |
| P1-DEF002 | (merged PR192) | Y | PASS | PASS | PASS |
| P1-DEF004 | (merged PR192) | Y | PASS | PASS | PASS |
| P1-DEF008 | credentials-omit | Y | PASS | PASS | **FAIL** | new this run |

## Counts (row-tracked)

| Bucket | Rows | Notes |
| --- | --- | --- |
| **Total tracked IDs** | **66** | A20 + B4 + C24 + D6 + E8 + F4 = 66 (stable; replaces soft “≈118”) |
| Prior soft “≈118” | — | Inflated by per-command/per-file micro-rows without IDs; **do not use** |
| Runtime **FAIL** (core) | **1** | C-BACKUP-OMIT / DEF-008 (P1-DEF008) |
| Runtime **PASS** (this run, credential-free) | **2** | C-CLI-HELP, UI-STATIC (+ UI-BUILD compile PASS) |
| Compile **PASS** this run | **2+** | UI-BUILD; backup unit compiles (assertion FAIL) |
| **Core NOT_RUN / BLOCKED** (runtime or compile blocking core claim) | **~28** | Most of A except help/omit; UI-INTERACTIVE; ME-* compiles; Stage4 full |
| **Peripheral NOT_RUN / BLOCKED** | **~30** | All 24 CH-* live/compile; SC-* regen/audit; DOC meta N/A |

### Core vs peripheral unverified (explicit)

**Core unverified (NOT_RUN or BLOCKED, excluding already FAIL omit):** ≈ **27–30** items spanning gateway, doctor, sessions, plugins-load, agent loop, Control UI interactive, multi-end compiles, Stage4 suite execution.

**Peripheral unverified:** ≈ **24+** channel lives + supply-chain regen/audit + optional media/TTS deep paths already listed NOT_RUN.

**Conclusion:** Denominator is **66 trackable rows**. Fullstack PASS requires core runtime clears including DEF-008 fix + gateway/UI interactive + policy decision on multi-end BLOCKED. **P1 clear ≠ PASS.**
