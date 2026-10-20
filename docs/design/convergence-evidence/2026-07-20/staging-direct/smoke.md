# Smoke (local direct)

| #   | Check                                             | Result                                                   |
| --- | ------------------------------------------------- | -------------------------------------------------------- |
| 1   | healthz                                           | **PASS** `{"ok":true,"status":"live"}`                   |
| 2   | readyz                                            | **PASS** `{"ready":true}`                                |
| 3   | control-ui-config                                 | **PASS** 200 JSON (token mode)                           |
| 4   | smoke.sh local-only                               | **PASS** 4/0                                             |
| 5   | tip vitest tenant+history+localFolder+checkpoints | **PASS** 40/40                                           |
| 6   | Live WS chat.history                              | **SKIP** (token local; no full client harness this wave) |

platform-auth/login → 404 JSON (PLATFORM_AUTH_DISABLED) — expected for token-mode sim.
