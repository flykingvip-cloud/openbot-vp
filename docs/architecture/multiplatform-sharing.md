# Multi-platform sharing mechanism (draft)

> **Status:** Draft (Stage 43)  
> **Date:** 2026-10-02 (Asia/Shanghai)  
> **Canonical (zh-CN):** [`multiplatform-sharing.zh-CN.md`](./multiplatform-sharing.zh-CN.md)  
> **Base:** `app/stage42-ios-drop-openclaw-compat` (Android stage38 stack + iOS stage39–42)  
> **Do not merge `main` unless explicitly asked.**

This English page is a **short stub**. The full product/architecture draft is maintained in Chinese.

## Established

- **Shared contract:** Gateway RPCs + wire protocol; Web employee UI as behavioral SoT; native clients (Android / OpenBotKit) reuse method names — no per-platform private APIs.
- **Visual SoT:** `openbot-four-tab-frontend-preview` HTML; only **IMPLEMENT** rows are in scope (demo supersets are not).
- **Parallel native shells:** Android Compose + iOS SwiftUI four-tab IA; OpenBotKit shares chat/protocol, **not** a cross-platform UI kit.
- **Calibrated intentional gaps:** preview-only demos, heavy Web wizards on phone; desktop employee UI = **Web shell** (Stage 52 ADR; companion stays Gateway/TCC/node).

## Not established

- Shared UI component library across Compose / SwiftUI / Web
- Single Design Token source of truth: `design/mobile-tokens.json` landed in stage44 as the hex twin (check: `node scripts/check-mobile-tokens.mjs`); platforms are still hand-written, not generated
- Mac / Windows **native** four-tab employee UI (rejected Stage 52; employee UI = Web shell; macOS menu-bar companion = Gateway/TCC/node only)
- Formal feature × platform acceptance matrix
- Coordinated multi-platform release milestones

## Proposed layers

1. **Contract** — Gateway RPC + wire (shared)
2. **Design Tokens** — single JSON/YAML → generate Android / iOS / Web / desktop
3. **Visual SoT** — four-tab HTML IMPLEMENT
4. **Native shells** — Compose / SwiftUI / Mac(?) / Windows(?); recommend deciding **Web shell for desktop employee UI** vs native parity
5. **Acceptance matrix** — feature × platform vs SoT
6. **Process** — stage evidence, PR stack, **do not** use WebView-as-tab (stage30 lesson)

## Next 3 slices

1. Tokens package (`design/mobile-tokens.json` + generate/check)
2. Acceptance matrix doc
3. Mac/Windows path decision (ADR)

## Non-goals

- One codebase for mobile UI
- Stage30-style WebView-as-tab / “embed then replace” interim

See the zh-CN doc for full rationale, tables, and cross-links.

## Progress note (2026-10-07 Stage 51)

Track B1 (tokens JSON + check) and B2 (acceptance matrix) are on `main` after mobile stack [#306](https://github.com/upbeyond/openbot/pull/306); the matrix was recalibrated in Stage 51 against iOS stage46–50 evidence. _(B3 was still pending at Stage 51; superseded by Stage 52 note below.)_

## Progress note (2026-10-07 Stage 52)

Track B3 desktop ADR is **decided: option 1 Web shell** (Daniel). Mac menu-bar companion stays Gateway/TCC/node only. See [`desktop-ui-adr.zh-CN.md`](./desktop-ui-adr.zh-CN.md) and [`desktop-web-shell-checklist.zh-CN.md`](./desktop-web-shell-checklist.zh-CN.md). No native Mac/Windows four-tab.
