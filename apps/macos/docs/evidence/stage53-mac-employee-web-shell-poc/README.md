# Stage 53 — Mac employee Web shell POC (ADR option 1)

Date: 2026-10-07 (Asia/Shanghai). Branch `app/stage53-mac-employee-web-shell-poc` (stacked on stage52 / [#402](https://github.com/upbeyond/openbot/pull/402)).

## Decision context

Daniel chose desktop **option 1**: employee UI = **Web shell**; Mac menu-bar companion = Gateway / TCC / node only. **No** native Mac/Windows four-tab.

## What already existed

The macOS companion already hosted an employee **main window** Web embed:

| Piece | Path |
| --- | --- |
| Menu entry | `MenuContentView` → `EmployeeShellController.shared.open()` |
| Controller | `apps/macos/Sources/OpenBot/EmployeeShell/EmployeeShellController.swift` |
| Window | `EmployeeShellWindowController` (not a menu-bar popover) |
| WebView | `EmployeeShellWebViewController` → `/embed/employee/*` via `/native/bootstrap` |
| Deep links | `DeepLinkHandler` → employee/chat/space/knowledge grammar |
| Tests | `EmployeeShellBridgeTests` (no `shell=mobile` on Mac) |

## Stage 53 POC delta

1. **Boundary fix:** `openDeviceSettings` native intent now opens **companion** `SettingsWindowOpener` (TCC/settings), instead of navigating the employee embed to `me`. Matches ADR: companion owns device permissions.
2. **Copy:** menu + window title clarify 「员工工作台 / Employee Workbench」 vs companion tools.
3. **Docs:** `docs/platforms/macos.md` employee Web shell section; checklist item 2 marked done; matrix IMP-SHELL Desktop cites this evidence.
4. **Tests:** `EmployeeShellWebShellBoundaryTests` pins embed default target, no mobile shell marker, device-settings stay native.

## Explicit non-goals (still)

- Native four-tab IA on Mac/Windows
- Folding employee tabs into the menu-bar popover
- Windows Web shell host (later, optional)
- Merging without independent acceptance + Daniel authorize

## Verify

`swift test --filter EmployeeShellWebShellBoundaryTests` was started on 2026-10-07 but stalled on GitHub HTTPS SPM fetches (Peekaboo / Sparkle / …). Re-run when network to github.com:443 is healthy. Tests are compile-time pure (`EmployeeEmbedRouting` / strings / bootstrap URL).

## Verify (command)

```bash
cd apps/macos
swift test --filter EmployeeShellWebShellBoundaryTests
# or Xcode: OpenBotTests / EmployeeShellWebShellBoundaryTests
```

Manual smoke: menu bar → 员工工作台 → separate window loads employee embed; embed-triggered device settings opens companion Settings.

## Acceptance fix

Independent review (#408):
- Window title strings aligned to **Employee Workbench** / **员工工作台** (menu + window; was briefly `OpenBot Workbench`).
- Matrix header no longer claims 「本切片不实现桌面壳」 after Stage 53 POC.
