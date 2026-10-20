# OpenBot Diagnosis Platform — P24.2 统一窗口生产依赖注入

Date: 2026-09-05

Status: **Host injection ready. Gates stay closed。**
liveConnected=false productionWrite=false enablementBlockedUntilVerifyLive=true p25Started=false.

## Injection

- reader: true
- audit: true
- quota: true
- auth: true
- Da Bai unconnected: true
- conversation unconnected: true
- remediation unconnected: true
- fail-closed: true

## Dependencies

- composite_report_reader: host=true held=false write=false
- audit_persist: host=true held=false write=false
- quota_store: host=true held=false write=false
- gateway_auth_membership: host=true held=false write=false
- daibai_delivery_transport: host=false held=true write=false
- conversation_state_store: host=false held=true write=false
- remediation_executor: host=false held=true write=false

Inject unified-window production-shaped reader/audit/quota/auth only. Keep Da Bai, live conversation, and remediation unconnected until verify-live. Do not open functional gates or start P25.
