# Constitutional / conversation-task / web-read / orchestration flags — Checkpoint A

assessedAt: 2026-09-28T04:10:00Z
Code SHA: `6628f4bf364bd6d0560847b938b00e74035a8947`
Transcript: `evidence/rg-imports-and-flags.txt`

Truthiness for every flag below is only `1`, `true`, `yes`, or `on` after trim and lowercasing. Unset, empty, `0`, `false`, `no`, and `off` stay off. This audit did not set any of these variables and did not change defaults.

Production process environment is **unknown** (no `openbot-gateway-rc`; see `production-baseline.md`). "Default off" here means the code path when the variable is absent, which is what a fresh process does. It is not a claim about a live host's env file.

## Constitutional flags (caller snapshot, fail-closed)

These helpers do not read `process.env`. An empty snapshot is off.

| Env name                                    | Constant        | Reader                                           | Default                                                                                                              |
| ------------------------------------------- | --------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `OPENBOT_CONSTITUTIONAL_SHADOW`             | `flags.ts:16`   | `isConstitutionalShadowEnabled` `flags.ts:35-39` | false when the key is absent (`:32-33`)                                                                              |
| `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_SELECT`  | `select.ts:34`  | `isLegalPathSelectEnabled` `select.ts:119-123`   | false; `selectLegalPath` returns mode `inert`, `selectedPath: null`, `executed: false` (`select.ts:216-223`, `:191`) |
| `OPENBOT_CONSTITUTIONAL_LEGAL_PATH_EXECUTE` | `execute.ts:29` | `isLegalPathExecuteEnabled` `execute.ts:84-88`   | false; `executed` is true only when `selectedPath !== null` and execute is opted in (`execute.ts:112-114`)           |
| `OPENBOT_CONSTITUTIONAL_PATH_GAP_REPORT`    | `report.ts:32`  | `isPathGapReportEnabled` `report.ts:123-125`     | false; `reportPathGap` does not name a gap unless `report: true` or the snapshot is on (`report.ts:197`)             |

Hard constants, not env flags (`flags.ts:18-20`):

- `CONSTITUTIONAL_CONTRACTS_ENFORCE = false`
- `CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE = false`
- `CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON = false`

Hard-false result fields, not env flags:

- `shadowCompared: false` and `readyToTighten: false` on the façade result type (`shadow.ts:121-124`) and on the inert object (`shadow.ts:165-167`)
- `executed: false` on every `runRuntimeFacadeShadow` result (`shadow.ts:124`, comment at `:245`)
- `selectLegalPath` always returns `executed: false` (`select.ts:191`)

`OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE` does not exist in source outside `.kiro/` specs. The scan `rg OPENBOT_CONSTITUTIONAL_SHADOW_COMPARE` excluding `.kiro` returned no hits (`evidence/rg-authority.txt`). The P8c start-order names that variable for a future slice. This SHA does not implement the reader. Compare stays a hard-false field.

No gateway, dispatch, or preflight barrel reads these snapshots. See `constitutional-caller-inventory.md`.

## ConversationTask flags (env, default off)

`src/conversation-task/feature.ts:24-29` and `envEnabled` at `:49-51`. `isConversationTaskFlagEnabled` (`:54-58`) is false when unset.

| Flag          | Env                                       |
| ------------- | ----------------------------------------- |
| detection     | `OPENBOT_CONVERSATION_TASK_DETECTION`     |
| qualification | `OPENBOT_CONVERSATION_TASK_QUALIFICATION` |
| activation    | `OPENBOT_CONVERSATION_TASK_ACTIVATION`    |
| projection    | `OPENBOT_CONVERSATION_TASK_PROJECTION`    |
| authorization | `OPENBOT_CONVERSATION_TASK_AUTHORIZATION` |

Config store cannot open the last three. `isFlagEnabled` returns false for a forbidden flag before it reads a row (`config-store.ts:191-194`). `setFlag` throws `forbidden_flag` if asked to enable one (`config-store.ts:213-217`). Activation control rows are inserted with `forced_off = 1` (`control-plane.ts:216-220`).

Related observe flags, also default off (unset is false):

| Env                                                        | Reader                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT`         | `isConversationTaskDeliveryCloseConsultEnabled` `reply-completion.ts:46-60`                      |
| `OPENBOT_CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_PERSIST` | `isConversationTaskDeliveryCloseConsultPersistEnabled` `delivery-close-consult-persist.ts:22-53` |

`src/conversation-task` does not import `constitutional-contracts`, `selectLegalPath`, or `executeLegalPath`.

## Web-read flag (default off)

| Env                                         | Reader                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `OPENBOT_CONVERSATION_TASK_WEB_READ_SHADOW` | `isWebReadShadowEnabled` `src/task-orchestration/feature.ts:102`, `:112-114` |

Comment at `:109-111`: independent of the four orchestration flags; default off. Unset is false via the same `envEnabled` helper (`feature.ts:33-35`).

## Orchestration flags (default off)

`src/task-orchestration/feature.ts:24-28`. `isOrchestrationFlagEnabled` (`:38-42`) is false when unset. `emptyOrchestrationFlags` returns all four false (`types.ts:160-166`).

| Flag            | Env                                       |
| --------------- | ----------------------------------------- |
| shadowEnabled   | `OPENBOT_CONVERSATION_TASK_ORCH_SHADOW`   |
| dispatchEnabled | `OPENBOT_CONVERSATION_TASK_ORCH_DISPATCH` |
| nodeEnabled     | `OPENBOT_CONVERSATION_TASK_ORCH_NODE`     |
| browserEnabled  | `OPENBOT_CONVERSATION_TASK_ORCH_BROWSER`  |

`ORCHESTRATION_LIVE_INVOKE` is the constant `false` (`types.ts:22`), not an env flag. `dispatch.ts` still checks it (`dispatch.ts:161`) and the constant cannot be flipped by an env var. The orchestration façade echoes it and does not assign true (`constitutional-runtime-facade.ts:37`, `:51`).

CTR `OPENBOT_CONVERSATION_TASK_ACTIVATION` is explicitly not an orchestration enable (`feature.ts:66-68`, `:93-98`).

## Fail-closed summary

- Constitutional select, execute, shadow, and path-gap report stay off unless a caller passes `true` or a truthy snapshot. No production module reads `process.env` for `OPENBOT_CONSTITUTIONAL_*`.
- ConversationTask, web-read, and orchestration env flags are off when unset.
- Enforce, live invoke, Fabric default, `readyToTighten`, façade `executed`, and façade `shadowCompared` are constants false.
- This checkpoint did not change any default.
