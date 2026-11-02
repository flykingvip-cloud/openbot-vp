# 10 — Tracked coverage inventory (denominator hardened)

**Pin:** `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c`  
**When:** 2026-11-02 Asia/Shanghai（含独立复核口径收紧）  
**Supersedes soft claim:** “约 N=118” without stable IDs.  
**重要：** 「表行数 / ~70」= 证据与检查行，**不是**公开能力分母；行数**不能**证明覆盖完整，也**不能**当成「覆盖了 N 个功能」。见 [`../runs/2026-11-02-independent-reviewer-corrections/00-exhaustiveness-note.md`](../runs/2026-11-02-independent-reviewer-corrections/00-exhaustiveness-note.md) 与 [`../runs/2026-11-02-independent-reviewer-corrections/01-owner-confirm-round2.md`](../runs/2026-11-02-independent-reviewer-corrections/01-owner-confirm-round2.md)。

## Claim narrowing (mandatory)

| False friend | Correct reading |
| --- | --- |
| Directory PRESENT | ≠ compile PASS ≠ runtime PASS |
| Plugin id ↔ docs filename match | ≠ channel live I/O PASS |
| `pnpm ui:build` / static index.html | ≠ Control UI interactive gateway smoke |
| SBOM / license file exists in tree | ≠ regen / audit PASS |
| CLI `--help` lists a command | ≠ that command’s runtime acceptance |
| P1 DEF-001/002/004 cleared | ≠ fullstack PASS |
| 团队诊断脚本 FAIL | ≠ 验收方已独立复现 |
| Tracked N（任意固定行数） | ≠ 公开入口已穷尽 |
| 「表行数 / ~70」 | = **证据与检查行**，**不是**公开能力 / 功能覆盖分母 |
| DEF-008 相关多行（团队诊断 / 独立复现 / 登记别名 / 单测 / 缺陷行） | = **同一缺陷的多证据面**；计数按 **1 个缺陷 / 1 个 backup-create 能力点** |
| 66/70 或任意「已覆盖 N 个功能」 | **禁止** — 行数 ≠ 功能数 |

## Column legend

- **Cap** — 功能能力 claimed by product/docs  
- **Static** — 静态结构 (files/ids present, docs match)  
- **Compile** — 编译 / package build / typecheck of that surface  
- **Runtime** — 运行 (local smoke or live). Live prod credentials stay **NOT_RUN**.

Status vocabulary（**仅允许**）: `PASS` | `FAIL` | `NOT_RUN` | `BLOCKED` | `N/A`  
**禁止 `PARTIAL`。** 原含糊项已拆成原子行。

## Inventory (stable IDs)

### A. Core platform / gateway / CLI (core)

| ID | Item | Cap | Static | Compile | Runtime | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| C-CLI-HELP | openbot CLI help surface | Y | PASS | PASS | PASS | 49 top-level commands listed; ≠ per-command runtime |
| C-BACKUP-CREATE-STATIC | Backup create 静态入口 / 单测期望存在 | Y | PASS | PASS | N/A | 命令与单测入口在树中；不作 runtime 宣称 |
| C-BACKUP-OMIT-TEAM-DIAG | 默认 omit（团队诊断证据） | Y | PASS | PASS | **FAIL** | DEF-008 **证据面**（团队）；≠ 独立能力；与同缺陷其他行合计按 1 缺陷计 |
| C-BACKUP-OMIT-INDEP-REPRO | 默认 omit（验收方独立复现） | Y | PASS | **BLOCKED** | **BLOCKED** | DEF-008 **证据面**；双阻断：缺 `node_modules/@openbot` 链接 **且** 无 `packages/collaboration-core/dist`；单项恢复未必够；**未完成** |
| C-BACKUP-INCLUDE-CREDS | 显式 includeCredentials 预期行为 | Y | PASS | PASS | **NOT_RUN** | 须保留 opt-in；本轮未独立跑通；unit 中相关用例曾 skip |
| C-BACKUP-OMIT | Backup default omit（登记别名） | Y | PASS | PASS | **FAIL** | DEF-008 **登记别名**（非第五项独立能力）；对齐团队诊断 FAIL；非独立复现成功 |
| C-BACKUP-VERIFY | Backup verify | Y | PASS | PASS | NOT_RUN | Stage4 suite import flap this WT |
| C-STORE-STAGE4 | Stage4 store evidence suite | Y | PASS | BLOCKED | NOT_RUN | collaboration workspace resolve 阻断完整套件 |
| C-GATEWAY-LOCAL | Local gateway bring-up | Y | PASS | NOT_RUN | NOT_RUN | |
| C-DOCTOR | Doctor / health | Y | PASS | NOT_RUN | NOT_RUN | |
| C-CONFIG | Config load/migrate | Y | PASS | NOT_RUN | NOT_RUN | |
| C-MEMORY | Memory / RAG path | Y | PASS | NOT_RUN | NOT_RUN | |
| C-AUTH-PROFILES | Auth profiles plumbing | Y | PASS | NOT_RUN | NOT_RUN | live creds NOT_RUN |
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
| UI-BUILD | `pnpm ui:build` (vite) | Y | PASS | **PASS** | N/A | dist gitignored |
| UI-STATIC | Serve built index.html HTTP 200 | Y | PASS | N/A | **PASS** | static only |
| UI-INTERACTIVE | Control UI ↔ local gateway | Y | PASS | N/A | **NOT_RUN** | |
| UI-I18N | UI i18n bundles | Y | PASS | NOT_RUN | NOT_RUN | |

> Control UI 导航还有 enterprise / platform / console / frontstage 等多路由；**未**按路由逐条列入本表 → 穷尽性缺口（见独立复核笔记）。

### C. Channel plugins — static match ≠ live

Each channel Cap=Y. Static = plugin package + docs id match where applicable. Compile/Runtime default NOT_RUN. **Live = NOT_RUN for all.**

| ID | Channel | Static | Compile | Runtime | Notes |
| --- | --- | --- | --- | --- | --- |
| CH-telegram | telegram | PASS | NOT_RUN | NOT_RUN | |
| CH-whatsapp | whatsapp | PASS | NOT_RUN | NOT_RUN | |
| CH-discord | discord | PASS | NOT_RUN | NOT_RUN | |
| CH-irc | irc | PASS | NOT_RUN | NOT_RUN | |
| CH-googlechat | googlechat | PASS | NOT_RUN | NOT_RUN | |
| CH-slack | slack | PASS | NOT_RUN | NOT_RUN | |
| CH-signal | signal | PASS | NOT_RUN | NOT_RUN | |
| CH-imessage | imessage | PASS | NOT_RUN | NOT_RUN | |
| CH-msteams | msteams | PASS | NOT_RUN | NOT_RUN | |
| CH-mattermost | mattermost | PASS | NOT_RUN | NOT_RUN | |
| CH-matrix | matrix | PASS | NOT_RUN | NOT_RUN | |
| CH-feishu | feishu | PASS | NOT_RUN | NOT_RUN | |
| CH-wecom | wecom | PASS | NOT_RUN | NOT_RUN | |
| CH-dingtalk | dingtalk | PASS | NOT_RUN | NOT_RUN | |
| CH-bluebubbles | bluebubbles | PASS | NOT_RUN | NOT_RUN | |
| CH-line | line | PASS | NOT_RUN | NOT_RUN | |
| CH-zalo | zalo | PASS | NOT_RUN | NOT_RUN | |
| CH-zalouser | zalouser | PASS | NOT_RUN | NOT_RUN | |
| CH-synology-chat | synology-chat | PASS | NOT_RUN | NOT_RUN | |
| CH-tlon | tlon | PASS | NOT_RUN | NOT_RUN | |
| CH-nextcloud-talk | nextcloud-talk | PASS | NOT_RUN | NOT_RUN | |
| CH-nostr | nostr | PASS | NOT_RUN | NOT_RUN | 本轮核对补入（plugin+docs 存在；旧表曾漏） |
| CH-twitch | twitch | PASS | NOT_RUN | NOT_RUN | 本轮核对补入 |
| CH-wechat | wechat | PASS | NOT_RUN | NOT_RUN | 本轮核对补入 |

**清单不一致 / 未穷尽（明确记缺口，不宣称 PASS）：**

| 线索 | 状态 |
| --- | --- |
| 旧表曾列 `CH-wecom-app` / `CH-qqbot` / `CH-openclaw-weixin` | **未列入本表** — tip 上未见对应 `extensions/*/openclaw.plugin.json` channels 入口；属**疑似过时 ID 或未核对入口**，不得虚构成 PASS |
| 非 channel 的 extensions（memory-core、voice-call、acpx、…） | **未列入**稳定 ID → 缺口 |
| 49 个 CLI 子命令各自 runtime | 仅 C-CLI-HELP → **未穷尽** |

### D. Multi-end clients

| ID | Surface | Cap | Static | Compile | Runtime | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| ME-MAC-APP | macOS app | Y | PASS | **BLOCKED** | NOT_RUN | SwiftPM policy |
| ME-IOS | iOS | Y | PASS | **BLOCKED** | NOT_RUN | xcodegen / signing |
| ME-ANDROID | Android | Y | PASS | **BLOCKED** | NOT_RUN | SDK/gradle env |
| ME-WINDOWS | Windows | Y | PASS | **BLOCKED** | NOT_RUN | no Windows SDK |
| ME-HARMONY | HarmonyOS | Y | PASS | **BLOCKED** | NOT_RUN | hvigor missing |
| ME-NODE-MINI | Node mini/companion | Y | PASS | NOT_RUN | NOT_RUN | |

### E. Supply chain / docs / acceptance meta

| ID | Item | Cap | Static | Compile | Runtime | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| SC-SBOM-FILE | SBOM file present | Y | PASS | N/A | N/A | ≠ regen |
| SC-SBOM-REGEN | SBOM regenerate | Y | PASS | **BLOCKED** | NOT_RUN | |
| SC-LICENSE | License inventory | Y | PASS | NOT_RUN | NOT_RUN | |
| SC-DEP-AUDIT | Dependency audit | Y | PASS | **BLOCKED** | NOT_RUN | |
| DOC-ACCEPT | Acceptance docs tree | Y | PASS | N/A | N/A | PR scope: docs/acceptance/** + .loom/registry.yaml（管理登记） |
| DOC-LOOM | Loom register/claim | Y | PASS | N/A | N/A | |
| TEST-UNIT-BACKUP-OMIT | Unit: default omit credentials | Y | PASS | PASS | **FAIL** | DEF-008 **单测证据面**；`backup.test.ts` omit assert；≠独立诊断复现完成 |
| TEST-UNIT-CORE-OTHER | Other core unit subset | Y | PASS | NOT_RUN | NOT_RUN | 本轮未跑全量；禁止用 PARTIAL 概括 |
| TEST-STAGE4 | Stage4 acceptance file | Y | PASS | **BLOCKED** | **FAIL** | FAIL=缺陷登记/历史同 codepath；本轮套件加载 BLOCKED |

### F. P1 defect clearances — not fullstack

| ID | Defect | Cap | Static | Compile | Runtime | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| P1-DEF001 | (merged PR192) | Y | PASS | PASS | PASS | |
| P1-DEF002 | (merged PR192) | Y | PASS | PASS | PASS | |
| P1-DEF004 | (merged PR192) | Y | PASS | PASS | PASS | |
| P1-DEF008 | credentials-omit | Y | PASS | PASS | **FAIL** | DEF-008 **缺陷状态行**；与上列证据面合计按 1 缺陷 / 1 backup-create 能力点；独立复现双阻断 |

## Counts (row-tracked) — 行数 ≠ 功能数

> **口径（强制）：** 「表行数 / ~70」= **证据与检查行**，**不是**公开能力分母。  
> DEF-008 相关多行（团队诊断 / 独立复现 / 登记别名 / 单测 / 缺陷行）是**同一缺陷的多证据面**，计数时按 **1 个缺陷 / 1 个 backup-create 能力点** 理解。  
> **禁止**把 66/70 或任意总行数写成「覆盖了 N 个功能」。

| Bucket | Rows | Notes |
| --- | --- | --- |
| **Total tracked IDs（证据/检查行）** | **~70** | A23 + B4 + C24 + D6 + E9 + F4；**仅行计数**，≠ 功能覆盖分母 |
| Prior soft “≈118” | — | **do not use** as authoritative |
| Prior “N=66” | — | 曾作分母硬化改进；**仍不是**能力分母，也不能证明完整 |
| DEF-008 多证据面 | **按 1 计** | 团队诊断 + 独立复现(BLOCKED) + 登记别名 + 单测 + P1-DEF008 状态行 |
| Runtime **FAIL**（缺陷登记口径） | **DEF-008 / omit** | 团队诊断 + unit 旁证；**非**独立复现完成 |
| Runtime **PASS**（本轮 credential-free） | **C-CLI-HELP, UI-STATIC** | |
| **禁止 PARTIAL** | 已拆 | C-BACKUP-* 原子行；TEST-UNIT-* 原子行 |

**Recount check（行数，非能力数）:**  
A: C-CLI-HELP, C-BACKUP-CREATE-STATIC, C-BACKUP-OMIT-TEAM-DIAG, C-BACKUP-OMIT-INDEP-REPRO, C-BACKUP-INCLUDE-CREDS, C-BACKUP-OMIT, C-BACKUP-VERIFY, C-STORE-STAGE4, C-GATEWAY-LOCAL, C-DOCTOR, C-CONFIG, C-MEMORY, C-AUTH-PROFILES, C-SESSION, C-HOOKS, C-PLUGINS-LOAD, C-CRON, C-BROWSER-TOOL, C-TTS, C-MEDIA, C-AGENT-LOOP, C-SECURITY-AUDIT, C-UPDATE = **23**  
B: **4**  
C: **24**  
D: **6**  
E: SC×4 + DOC×2 + TEST×3 = **9**  
F: **4**  
**Total rows = 23+4+24+6+9+4 = 70**（证据行合计）

### Core vs peripheral unverified

**Core unverified / blocked / fail：** omit FAIL + 独立复现双阻断（缺 `@openbot` 链接 **且** 无 `collaboration-core/dist`；单项恢复未必够）+ gateway/UI interactive/multi-end/Stage4 等大量 NOT_RUN/BLOCKED。

**Peripheral：** 全部 CH-* live、非 channel extensions、packages runtime、CLI 逐命令、Control UI 各路由、跨仓 install — **未穷尽**。

**Conclusion:** Tracked **~70 行**是证据与检查行清单，**不是**功能覆盖分母，也**不能**证明公开入口完整。Fullstack 继续 **FAIL / NOT READY**。**P1 clear ≠ PASS。不据此批准 #193 合并。**
