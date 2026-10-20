# Stage 52 — Desktop ADR option 1 landed (Web shell)

Date: 2026-10-07 (Asia/Shanghai). Branch `app/stage52-desktop-web-shell-adr` from `main` @ `0fd9d2c1c` (merge of [#401](https://github.com/upbeyond/openbot/pull/401)).

Docs only. No native Mac/Windows four-tab. No menu-bar companion redesign. No merge in this slice unless asked.

## Decision

Daniel chose **option 1**: desktop employee UI = **Web shell**; Mac menu-bar companion stays Gateway / TCC / node only.

## Files

- `docs/architecture/desktop-ui-adr.zh-CN.md` — status → 已拍板
- `docs/architecture/desktop-web-shell-checklist.zh-CN.md` — scaffolding checklist (not an implementation permit)
- `docs/architecture/multiplatform-sharing*.md` — B3 decided
- `docs/architecture/multiplatform-acceptance-matrix*.md` — Desktop column strategy updated

## Not started

- Mac employee Web shell window POC
- Windows Web shell host
- Token generators

## Acceptance fix

Independent review found leftover「未拍板 / undecided / TBD until decision」wording in EN stubs and early sections of `multiplatform-sharing*.md`. Those were amended on this branch before merge recommendation.
