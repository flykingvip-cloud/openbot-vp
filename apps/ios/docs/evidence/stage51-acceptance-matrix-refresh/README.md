# Stage 51 — Acceptance matrix refresh + iOS 26 SDK upload fix

Date: 2026-10-07 (Asia/Shanghai). Branch `app/stage51-acceptance-matrix-refresh` from `main` @ `a0303a926` (includes merged [#306](https://github.com/upbeyond/openbot/pull/306)).

Primarily docs. One small iOS compile fix so `OpenBot` builds on the installed iOS 26.5 Simulator + Xcode 26.6 SDK. No four-tab IA change. No WebView-as-tab. No merge to `main` in this slice.

## Why

1. The Stage 45 matrix still listed iOS Chat/Tasks/Knowledge/Me deepen as **无 / 部分** (stage39 stubs). Stages 46–50 were already on `main` via #306, so handoff agents were misled.
2. Fresh `xcodebuild` on this Mac (runtime now installed) failed in `EmployeeShellUploadPicker.copyPhoto`: iOS 26 SDK exposes `NSItemProvider.loadTransferable` as completion-handler-only.

## Landed

- Rewrote `docs/architecture/multiplatform-acceptance-matrix.zh-CN.md` (+ English stub) against stage46–50 evidence.
- Progress note on `docs/architecture/multiplatform-sharing*.md` (B1/B2 landed; B3 ADR still recommendation-only).
- `EmployeeShellUploadPicker.copyPhoto` wraps `loadTransferable(type:completionHandler:)` in `withCheckedThrowingContinuation`.

## Checks

```bash
node scripts/check-mobile-tokens.mjs
```

Result (2026-10-07 ~19:52 CST): **exit 0**.

## Build

```bash
cd apps/ios && xcodegen generate
xcodebuild -project OpenBot.xcodeproj -scheme OpenBot \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  -configuration Debug build
```

Result (2026-10-07 ~19:57 CST): **BUILD SUCCEEDED** (after the upload-picker fix; SPM deps reused from a warm DerivedData `SourcePackages` cache because raw GitHub HTTPS timed out).

## Not done / next

- Desktop column still **TBD** — product must pick [`desktop-ui-adr.zh-CN.md`](../../../../../docs/architecture/desktop-ui-adr.zh-CN.md) (建议选项 1 Web shell).
- Token **generators** (Kotlin/Swift/CSS) still not built.
- Remaining intentional phone gaps: Chat deliverable footer (iOS), Me OAuth/改密 wizard on device, KB write menus, task result card, Strip+, in-bubble STT.
- No merge.
