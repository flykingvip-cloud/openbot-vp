# Defect status update — tip `f68a3c56b00fe060209678921bfdc28dbd4138b5`

Vocabulary: PASS / FAIL / BLOCKED / NOT RUN / N/A.  
Re-reproduction required on NEW tip before any fix (completed).

| ID      | Title                                    | Old pin    | Tip reproduce       | Tip after fix                                    | Notes                                                                                                                                                                      |
| ------- | ---------------------------------------- | ---------- | ------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEF-001 | PluginMemoryToolFactory / tsgo contract  | FAIL       | FAIL                | **PASS**                                         | Real producer (`extensions/memory-core`) + impl (`memory-tool.ts`) + plugin type aligned; contract test added. Extra tip tsgo errors fixed with real types (not `as any`). |
| DEF-002 | protocol:check Swift GatewayModels drift | FAIL       | FAIL                | **PASS** (after regen commit)                    | Canonical gen flow. Light swiftc+AnyCodable OK. Full `swift build --target OpenBotProtocol` BLOCKED (dep hang).                                                            |
| DEF-003 | format:check ~30 files                   | FAIL       | FAIL (pre-existing) | **FAIL** (out of P1; changed files only oxfmt’d) | Not authorized as P1 product fix; no mass reformat.                                                                                                                        |
| DEF-004 | SarGovernanceProvider import             | FAIL       | FAIL                | **PASS**                                         | Import from `sar-governance-bridge`; materializer resolves; focused vitest PASS.                                                                                           |
| DEF-005 | tool-policy.test drift                   | FAIL (old) | NOT RUN this PR     | open                                             | Out of P1 authorization.                                                                                                                                                   |
| DEF-006 | employee entitlement allowlist units     | FAIL (old) | NOT RUN this PR     | open                                             | Out of P1 authorization.                                                                                                                                                   |
| DEF-007 | dispatchInboundMessage lifecycle unit    | FAIL (old) | NOT RUN this PR     | open                                             | Out of P1 authorization.                                                                                                                                                   |

## Cleared on NEW tip (authorized P1)

- DEF-001, DEF-002, DEF-004

## Explicit

Clearing these P1s removes current type/protocol/materializer blockers for honest green `tsgo` + `protocol:check` on tip. It is **not** a fullstack acceptance PASS.
