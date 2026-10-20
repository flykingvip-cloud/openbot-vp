# Stage 55 — Windows employee Web shell host (ADR option 1)

Date: 2026-10-08 (Asia/Shanghai). Branch `app/stage55-windows-employee-web-shell-host` (after Stage 54 / [#461](https://github.com/upbeyond/openbot/pull/461)).

## Decision context

Daniel chose desktop **option 1**: employee UI = **Web shell**. Mac Stages 53–54 delivered the employee window + login/deeplink/notification deepen. Checklist item 5: **Windows Web shell host only** — no native four-tab.

## What this slice lands

| Item | Behavior |
| --- | --- |
| Host shell | `apps/windows` WinUI 3 + WebView2 window titled **Employee Workbench / 员工工作台** loads `/embed/employee/*` via `/native/bootstrap` |
| Parity | **No** `shell=mobile` (same as Mac desktop; phone marker stays phone-only) |
| Bridge | Same `openbotEmployeeShell` / versioned JSON protocol; web transport kind `webview2` via `chrome.webview.postMessage` |
| Auth gate | Signed-out open/deeplink → present login + stash `pendingPath`; after login continue (Mac Stage 54 portable pattern). Employee jar ≠ node pairing (documented; full login UI thin stub) |
| Deeplink | `openbot://employee\|chat\|space\|knowledge/…` → embed paths; `agent` / `gateway` / `workspace` do **not** open the shell |
| Device settings | `openDeviceSettings` stays **native host** action (companion still planned) — does **not** navigate employee `me` embed |
| RPC | Reuses Web employee / Gateway; no Windows-only employee API |

## Code anchors

| Path | Role |
| --- | --- |
| `apps/windows/src/OpenBot.EmployeeShell/**` | C# host (bridge / routing / bootstrap / WebView2 / WinUI) |
| `ui/src/ui/employee-shell/native-host.ts` | Detect + deliver `webview2` |
| `ui/src/ui/employee-shell/windows-host-contract.ts` | Node-testable desktop contract twin |
| `docs/platforms/windows.md` | Employee Web shell section |

## Explicit non-goals

- Native four-tab IA on Windows
- Shipping a full Gateway companion (still planned)
- Wave 2 server push
- Claiming WebView2 UI smoke from this Mac agent (no Windows machine in loop)

## Verify

### On macOS (this checkout)

```bash
cd ui
pnpm exec vitest run --config vitest.node.config.ts \
  src/ui/employee-shell/windows-host-contract.node.test.ts \
  src/ui/employee-shell/native-host.node.test.ts
```

### On a Windows machine (follow-up)

```powershell
dotnet test apps/windows/OpenBot.Windows.sln
# Manual smoke: launch Employee Workbench → embed overview; openbot://employee/me;
# device-settings intent does not navigate to /embed/employee/me.
```

## Matrix

Desktop column remains **Web shell 复用** (Mac evidence + this Windows host). Windows companion capabilities stay **N/A / planned**. Do not mark phone-only or刻意不做 rows as Desktop「有」from this slice.
