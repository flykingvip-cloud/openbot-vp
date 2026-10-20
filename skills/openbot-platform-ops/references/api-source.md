# External API source

## Delegate entirely

Load and follow skill **`configure-external-api-source`**. Do not duplicate its seven-step workflow here.

## Quick routing

| User intent                           | Action                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| Add / connect / migrate API KB source | `configure-external-api-source`                                |
| List or invoke bound source           | `knowledge_source` tool                                        |
| User cannot find Settings UI          | `user-guidance-protocol` + `references/platform-settings.yaml` |

## Agent tool: `knowledge_source`

Actions: `list`, `bind`, `sync_catalog`, `invoke`, `verify`

Requires `credentialRef` — **never** plaintext API keys in chat.

## Outcome states (from delegated skill)

`configured` | `configured-with-limitations` | `bound-not-consumable` | `not-configured` | `rolled-back`

Report one explicit state after verification.

## References in delegated skill

- `skills/configure-external-api-source/references/openbot-contract.md`
- `skills/configure-external-api-source/references/discovery-and-testing.md`
