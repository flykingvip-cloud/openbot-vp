# OpenBot Diagnosis Platform — P25 isolated canary record

Date: 2026-09-06

Status: **Ready for Daniel/CEO signing**

## Identity (exact match required)

- candidate/origin-main: `0d8a31a2c4e91e13a9acff64ce57511efd694135`
- LIVE: `7d3fdf5bfef57077f7956ccab07c3c960984331b`
- frozen candidate: `0d8a31a2c4e91e13a9acff64ce57511efd694135`
- frozen LIVE: `7d3fdf5bfef57077f7956ccab07c3c960984331b`
- exactIdentityMatch: true

## Isolated canary

- tenant: `tenant-fixture-a`
- isolatedAllowlisted: true
- liveExecutorUndeployed: true
- previewExecuteVerify: true
- highRiskRequiresApproval: true
- blockedRuntimeActions: true
- appliedToRuntime: false
- p25Started: true
- p26ProductionReady: false

P25 isolated governed remediation canary. Live executor stays undeployed. Delivery cutover still required before user-visible LIVE effect.
