# Feature inclusion (RC0 candidate)

Tip: **`9aceda7349`** (`RECOMMENDED_RC0_TIP`)

## Included (D0–D4)

| Phase | Feature ids / summary                                                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D0    | Path A build green; tsgo ceiling established (historically 77 at D4 acceptance)                                                                                    |
| D1    | Auth/tenant thin pack — forged `tenantId` reject; `enterprise.organization.snapshot` + `requireEnterpriseScope`; scopes register                                   |
| D2    | Session invariants S1–S5 — `resolveSessionStorePathForInboundMessage`, `promoteGlobalSessionEntryIfNewer`, inbound write wiring                                    |
| D3    | History → `loadSessionEntryForClient`; checkpoints.list negatives; transcript unsafe-sessionFile fallback; steward `agent:bot-*` preserve; T5 restore **DEFERRED** |
| D4    | Knowledge **localFolder** / `local_index` golden matrix **K1–K6** + handlers/scopes as landed                                                                      |

## Explicitly excluded

- Other import kinds: one-shot file upload, web/url, dataset, gitRepo, cloudDrive, mailAttachment, full connector productization
- Full mobile UX / EmployeeShell productization claims
- Unreviewed commercial / billing packages beyond what already sits on LOCKED_BASE lineage
- **Org monthly-usage UI** commits after D4 (`a478f29e29`…`08027a7006`) — **pollution**; strip by tagging `9aceda7349`
- Production cutover / registry push
- Expanding readyz failures beyond `{wecom}`
