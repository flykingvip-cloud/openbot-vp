# OpenBot Windows — employee Web shell host (Stage 55)

Desktop **employee** UI on Windows follows ADR option 1: a **WebView2 window** that
loads the same Web employee embed as macOS (`/embed/employee/*`, full web parity,
**no** `shell=mobile`). This is **not** a native four-tab port and **not** the
planned Gateway/TCC companion.

| Piece | Path |
| --- | --- |
| Bridge parse | `src/OpenBot.EmployeeShell/Bridge/EmployeeShellBridge.cs` |
| Embed routing | `src/OpenBot.EmployeeShell/Routing/EmployeeEmbedRouting.cs` |
| Auth gate / deeplink | `src/OpenBot.EmployeeShell/Routing/EmployeeShellDeepLinkRouting.cs` + `Host/EmployeeShellController.cs` |
| Bootstrap URLs | `src/OpenBot.EmployeeShell/Bootstrap/EmployeeShellBootstrap.cs` |
| WebView2 host | `src/OpenBot.EmployeeShell/Host/EmployeeShellWebViewHost.cs` |
| WinUI shell window | `src/OpenBot.EmployeeShell/UI/` |
| Evidence | `docs/evidence/stage55-windows-employee-web-shell-host/` |

Web transport: `ui/src/ui/employee-shell/native-host.ts` detects `chrome.webview`
as kind `webview2` (same JSON bridge as Mac/Android).

## Build / test (Windows machine required for C# / WebView2)

```powershell
dotnet test apps/windows/OpenBot.Windows.sln
dotnet build apps/windows/src/OpenBot.EmployeeShell/OpenBot.EmployeeShell.csproj -c Debug -p:Platform=x64
```

Needs: .NET 8 SDK, Windows App SDK workload, WebView2 Runtime.

## Verify on macOS (no Windows box)

```bash
cd ui
pnpm exec vitest run --config vitest.node.config.ts src/ui/employee-shell/windows-host-contract.node.test.ts src/ui/employee-shell/native-host.node.test.ts
```

## Non-goals (still)

- Native four-tab IA
- Full Windows companion (Gateway broker / TCC equivalents)
- Server push → employee window (Wave 2)
- Real-device smoke on this Mac checkout
