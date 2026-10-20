# Data format inventory (RC0 subset)

Scan of versioned stores / manifests relevant to tenant · session · KB · enterprise · export. Not exhaustive of every channel offset store.

| Domain                    | Constant / field                                            | Typical path / notes                                                               | Current                                                                          |
| ------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Enterprise data           | `ENTERPRISE_DATA_STORE_VERSION`                             | `~/.openbot/openbot-enterprise-data.json` (`src/gateway/enterprise-data/types.ts`) | **5**                                                                            |
| Tenant config             | `TENANT_CONFIG_STORE_VERSION`                               | tenant config JSON (`src/gateway/tenant-config.ts`)                                | **1**                                                                            |
| User operational identity | `USER_OPERATIONAL_IDENTITY_STORE_VERSION`                   | identity persistence                                                               | **5**                                                                            |
| Identity credentials      | `USER_OPERATIONAL_IDENTITY_CREDENTIAL_SECRET_STORE_VERSION` | secret store                                                                       | **1**                                                                            |
| Billing seats             | `SEATS_STORE_VERSION`                                       | seats store                                                                        | **1**                                                                            |
| Workspaces                | `WORKSPACE_STORE_VERSION`                                   | workspace store                                                                    | **1**                                                                            |
| Data export manifest      | `schemaVersion`                                             | export ZIP manifest (`src/data/data-export.ts`)                                    | **1** (reject if `>1`)                                                           |
| Sessions                  | `sessions.json` entries                                     | `agents/<id>/sessions/sessions.json`                                               | entry fields optional / promote path (D2); no global store version bump in D0–D4 |
| Knowledge localFolder     | ingest `versionLabel` / `lastIngestedVersionId`             | local folder runtime/sync                                                          | per-ingest label; not a global store version                                     |
| Secrets                   | encrypted local `STORE_VERSION`                             | secrets store                                                                      | **1**                                                                            |
| Telegram offsets          | `STORE_VERSION`                                             | update-offset store                                                                | **2** (compat read of v1)                                                        |

## Read compatibility (D0–D4 relevant)

- Tenant / enterprise parsers generally use `parsed?.version ?? CURRENT` — missing version defaults forward.
- Session promote (D2): empty newer tenant entry must not block heal; store path resolution tenant-aware.
- Export restore: `schemaVersion > 1` is hard reject; `1` and missing tolerated.

## Irreversible migrations in RC0 tip?

**None identified** in D0–D4 landings that rewrite production roots in place. Knowledge localFolder writes are additive ingest into KB indexes under agent/tenant scope.
