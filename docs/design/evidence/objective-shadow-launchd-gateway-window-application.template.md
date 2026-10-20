# Cycle 0 launchd_gateway window application (template)

Fill this only after a new build is deployed through the existing release process. Empty or git-inferred fields are a reject.

This application is **not** pre-approved by the 2026-09-14 gate-prep.

## Running artifact (required)

| Field                 | Value (from the process / container, not git) |
| --------------------- | --------------------------------------------- |
| `build-info.commit`   |                                               |
| `build-info.builtAt`  |                                               |
| `build-info.version`  |                                               |
| How the file was read |                                               |

Ancestry of the **running** commit:

```text
git merge-base --is-ancestor 16cea426e711516629e52c0522c39a7a77628655 <RUNNING>
git merge-base --is-ancestor b03ffa66a8870f42042f4a0f743bd1b7cd1b6926 <RUNNING>
```

| Check                       | Result |
| --------------------------- | ------ |
| `#1107` ancestor of RUNNING |        |
| `#1120` ancestor of RUNNING |        |

Branch / PR SHA used as a stand-in for RUNNING: **forbidden**.

## Deploy evidence

| Gate                            | Command                                                                    | Exit / result |
| ------------------------------- | -------------------------------------------------------------------------- | ------------- |
| Forward-only                    | `./deploy/production/scripts/verify-forward-only.sh --candidate <RUNNING>` |               |
| Delivery alignment              | `./deploy/production/scripts/verify-delivery-alignment.sh`                 |               |
| Live image identity (container) | `./deploy/production/scripts/verify-live-image-identity.sh`                |               |

## LaunchAgent integrity

Baseline digest from gate-prep: `9d52bbd8a078856831e5cccd03ffc5db11c7e5668f4ac29718100749ae58a0d5`

| Field                               | Value      |
| ----------------------------------- | ---------- |
| Current plist sha256                |            |
| Directly rewritten?                 | must be no |
| Production flag injected this turn? | must be no |

## HMAC recoverability

`scripts/dev/objective-shadow-hmac-inject.sh check` output (no key bytes):

```text

```

## Requested window

- `sourceKind`: `launchd_gateway` only
- Do not add counts to `synthetic_observe_api` or `runtime_callsite_harness`
- Phase 3a / 3b / 4 / 5 remain unapproved even if this window is granted
