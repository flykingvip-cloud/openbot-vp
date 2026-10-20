# Session compatibility: Mario 0.57.1 → Earendil 0.84.4

Date: 2026-08-29  
Harness: isolated `/tmp/pi-sdk-v3-session` (not the OpenBot tree, not v2 fixtures)  
Scripts: `/tmp/pi-sdk-v3-session/mario/write-057.mjs`, `/tmp/pi-sdk-v3-session/earendil/read-084.mjs`  
Copied fixtures: `fixtures/session-057.jsonl`, `fixtures/write-057.json`, `fixtures/read-084.json`

## Format

| Field                     | Mario 0.57.1                                                                                   | Earendil 0.84.4        |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------- |
| `CURRENT_SESSION_VERSION` | `3`                                                                                            | `3`                    |
| Storage                   | append-only JSONL tree                                                                         | append-only JSONL tree |
| Header                    | `{ type:"session", version, id, timestamp, cwd }`                                              | same                   |
| Entry types used here     | message, model_change, thinking_level_change, custom, custom_message, session_info, compaction | same                   |

Same version number is not by itself proof. Empirical round-trip is required.

## Empirical results (PASS, 23/23)

A 0.57 `SessionManager.create` session with 9 entries was opened by 0.84 `SessionManager.open`:

| Check                                                                        | Result |
| ---------------------------------------------------------------------------- | ------ |
| Header id/cwd/version preserved                                              | PASS   |
| Entry count 9, types unchanged                                               | PASS   |
| User / assistant / toolResult payloads preserved (`tenant-a secret payload`) | PASS   |
| Custom metadata (`tenant`, `sessionKey`) preserved                           | PASS   |
| Custom message text preserved                                                | PASS   |
| Session name + compaction summary preserved                                  | PASS   |
| `open()` does not rewrite legacy bytes                                       | PASS   |
| Append on 0.84 then reopen sees the new user message                         | PASS   |
| Resume context still contains the tool result                                | PASS   |

Missing/invalid files (0.84 vs 0.57):

| Case                                      | Mario 0.57.1                                       | Earendil 0.84.4                                                          |
| ----------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| Non-empty file without session header     | Truncates and writes a new header (`_rewriteFile`) | **Throws** `Session file is not a valid pi session` and does not rewrite |
| Truncated JSONL line after a valid header | Skips malformed line                               | Skips malformed line; no partial object materialized                     |
| Header `version: 99` with a user message  | Readable                                           | Readable; user text not dropped                                          |

0.84 is stricter than 0.57 on corrupt files (throw vs silent rewrite). Future `version > CURRENT_SESSION_VERSION` is **not** rejected by the SDK.

## OpenBot adapter requirements (Phase B)

1. Keep `SessionManager.open` / `inMemory` / `create` / `appendMessage` / `appendCompaction`.
2. After `open()`, if `getHeader()` is null or `version` is missing/greater than `CURRENT_SESSION_VERSION`, throw and stop. Do not rebuild, truncate, or import a partial transcript.
3. Do not call `newSession()` on an existing tenant session path.
4. Cover create / resume / append / compaction using `fixtures/session-057.jsonl`.

## Verdict

**PASS.** Old 0.57 sessions are readable by 0.84 without silent loss of messages, tool results, or custom metadata. Corrupt files fail closed at the SDK. Future-version policy must be enforced in the OpenBot wrapper.
