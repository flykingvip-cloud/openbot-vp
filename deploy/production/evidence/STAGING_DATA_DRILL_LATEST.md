# Staging sanitized data drill — 20260726T074512

## Isolation

- staging state host path: `/var/lib/openbot-staging/state`
- snapshot path: `/var/lib/openbot-staging/snapshot-pre-migrate`
- container port: `18790`
- image: `localhost/openbot:rc-amd64-provenance-225de96b270f`
- mounts: `/var/lib/openbot-staging/state->/root/.openbot;`
- prod `/root/.openbot` mounted: **NO**

## Reconciliation

| Checkpoint    | tenantCount | fileSum |
| ------------- | ----------: | ------: |
| pre-migrate   |           6 |    2115 |
| post-restart  |           6 |    2115 |
| post-rollback |           6 |    2115 |

- tenantIds: `001, workspace-2-87217301, workspace-4-8bdcc581, workspace-5-5dc506f8, workspace-6-44ccf420, workspace-7-269a0320`

## Result

**DONE** — sanitized copy, restart persistence, and snapshot rollback reconciled.
