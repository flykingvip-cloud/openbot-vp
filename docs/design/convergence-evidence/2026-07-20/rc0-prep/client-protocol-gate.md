# Client protocol gate

## Control UI / gateway contract

| Check                                     | Result                                                          |
| ----------------------------------------- | --------------------------------------------------------------- |
| `pnpm build` (includes Control UI bundle) | **PASS** exit 0                                                 |
| Gateway HTTP / contract sources present   | `src/gateway/control-ui-contract.ts`, `control-ui.http.test.ts` |
| Focused vitest pack (tenant/history/KB)   | **PASS** 40/40                                                  |

**Staging impact:** Control UI path covered enough for **GO_WITH_GATES**.

## Android

| Check             | Result                                         |
| ----------------- | ---------------------------------------------- |
| Toolchain         | `apps/android/gradlew` present; `java` on PATH |
| Compile this wave | **NOT RUN** (time/scope)                       |

**RISK:** Medium for native shell login/roster UX; **does not block staging** of gateway tip if smoke is web Control UI first. Blocks claiming full mobile RC0.

## iOS / macOS

| Check                  | Result                        |
| ---------------------- | ----------------------------- |
| Toolchain              | `/usr/bin/xcodebuild` present |
| `xcodebuild` this wave | **NOT RUN**                   |

**RISK:** Medium — native EmployeeShell / protocol clients not recompiled against tip. Staging should not claim mobile parity.

## Summary

| Surface              | Status                    | Block staging?         |
| -------------------- | ------------------------- | ---------------------- |
| Control UI + gateway | GREEN (build + tests)     | No                     |
| Android              | **RISK** — toolchain only | No (web-first staging) |
| iOS/macOS            | **RISK** — toolchain only | No (web-first staging) |
