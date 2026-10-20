# S01 Stage B Implementation Accept 申请

- **Owner**: `cursor-data-governance`
- **Task**: `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-implementation-accept`
- **日期**: 2026-09-01
- **基线**: `origin/main` `a54f5860dd58557b62914d5895ca207fe95681d6`（#877 之后）
- **selfAccepted**: `false`
- **packetSelfAccepted**: `false`
- **signedAsCodexArchitecture**: `false`
- **reviewRequested / appliesFor**: S01 Stage B Implementation Accept（仅此项）
- **reviewer**: `flykingvip-cloud`
- **authorizesStageBImplementationAccepted**: `false`（本包申请独立 Accept，不自签、不自授、不自合并）

证据来自 **isolated replica window2**，不是 LIVE organic production receipts。不是 Stage C Accept，不是 Stage D cutover，不是 LIVE。

## 窗口（FLAG-ON replica，非 LIVE）

| 项                                            | 值                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| first                                         | `2026-08-31T22:00:02.192+08:00`                                                                                                                                                         |
| last                                          | `2026-09-01T00:08:48.720+08:00`                                                                                                                                                         |
| elapsed                                       | `2h08m46s`（≥2h）                                                                                                                                                                       |
| nShadow                                       | **n=103**（nSends=104；1 次 send 无 shadow）                                                                                                                                            |
| 连续 30min buckets                            | 22:00 / 22:30 / 23:00 / 23:30，另有 close-2h（00:00:02 之后）                                                                                                                           |
| byKind                                        | catalog_miss 44, fencing_stale 18, tenant_mismatch 18, authorization_denied 10, fail_closed_missing_identity 6, identity_and_authorization_match 4, fail_closed_missing_authorization 3 |
| tenants                                       | `001` + `workspace-8-7d722e88`                                                                                                                                                          |
| employees                                     | 001=6, workspace-8=2                                                                                                                                                                    |
| cross-tenant identity_and_authorization_match | 0                                                                                                                                                                                       |
| unexpected error rate                         | 0（shadow_error 0 / import_error 0 / 103）                                                                                                                                              |
| helperCwdPresent                              | 103/103                                                                                                                                                                                 |
| productionCwdUnchanged                        | 103/103                                                                                                                                                                                 |
| catalogLocatorAsCwd true                      | 0                                                                                                                                                                                       |
| image                                         | `ghcr.io/gmood2008/openbot@sha256:8778b2affc82c0069538aea2483d8baf4b46d9734f079d9c114f19b5d6541740` commit `aa44194a`（#871）                                                           |
| replica                                       | `127.0.0.1:18793` FLAG-ON                                                                                                                                                               |
| LIVE                                          | 仍是 `4aa1e738` / `59be5066` catalog `6e99c144` rev 77；`productionLiveReceiptsObserved=0`                                                                                              |
| ledger                                        | `/var/lib/openbot/s01-stage-b-shadow-obs/canary-ledger-window2.json` sha256 `c4fc61917df9c397e4612f399f205676d6c1b97317740a87a4a97ae6954d3932`                                          |

`isolatedReplicaAcceptanceMet=true` 仅表示 **active 100 政策** 下窗口数字已满足（2h、100、4 buckets、coverage、零跨租户成功、error rate 0、helper cwd 不变）。本包 **不** 把 `authorizesStageBImplementationAccepted` 置 true。

## 不计入

- 旧窗口 19:08–21:13 **n=42** FAIL（active 100）；不计入；proposed 60 不回溯（#877 `thisPacketActivatesProposedPolicy=false`；active minSampleSize 仍为 100）。
- flag-off 证据路径：`/var/lib/openbot/s01-stage-b-shadow-obs/logs/s01-post871-flagoff-probe.mjs`（label `post-871-flag-off-probe`；同镜像 4/4 get-reply、0 shadow events）。不与 n=103 混算，也不是 n=42。

## 锁

- flag 默认 **off**；helper 仍决定 cwd；scan **10/10**；P5 仍在
- `implementationVerified=false`；`deployAuthorized=false`；`live=forbidden`
- `authorizesStageC=false`；`authorizesStageD=false`；`authorizesStageE=false`
- 不编辑 #865 sidecar；不改 scan index；不删 P5；不在 LIVE 开 flag；作者不能 self-merge / self-sign

## 机器可读锁

```
reviewRequested: S01 Stage B Implementation Accept
appliesFor: S01 Stage B Implementation Accept
selfAccepted: false
packetSelfAccepted: false
signedAsCodexArchitecture: false
requestsStageBImplementationAccept: true
authorizesStageBImplementationAccepted: false
isolatedReplicaReceiptsObserved: 103
isolatedReplicaAcceptanceMet: true
productionLiveReceiptsObserved: 0
authorizesStageC: false
authorizesStageD: false
authorizesStageE: false
implementationVerified: false
deployAuthorized: false
live: forbidden
remaining: 10
liveWriteWatchIndex: 10
thisPacketActivatesProposedPolicy: false
```
