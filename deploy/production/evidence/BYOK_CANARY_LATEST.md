# BYOK canary run — 20260726T084459

- tenant: `001`
- connectionId: `92e66a76-33cf-42e6-931a-48d17e331545`
- runtimeModelId: `ent/24b2afba8f/deepseek-v4-flash`
- assetId: `5fa893e6-3b33-4a0e-bcb3-cae9610fc8d2`
- seatId: `seat-a5b0a839-32bb-42b9-aba9-822768cfcd21`
- full.pass: `True`
- persist.pass: `True`
- creditsConsumed before/after: `150` → `150` (Δ=0)
- credits Δ==0: `True`
- agentOk: `True`
- budgetBlocked: `True`
- auditPass: `True`
- auditHints: `[{'kind': 'create', 'present': True}, {'kind': 'probe', 'present': True}, {'kind': 'register', 'present': True}, {'kind': 'grant', 'present': True}, {'kind': 'invoke', 'present': True}, {'kind': 'budget-block', 'present': True}]`

## Hard gate

| Check                                                         | Result |
| ------------------------------------------------------------- | ------ |
| create→probe→register→grantBatch                              | PASS   |
| Credits not debited (disk buckets)                            | PASS   |
| Budget block (cap=0)                                          | PASS   |
| Audit trail (create/probe/register/grant/invoke/budget-block) | PASS   |
| Persist after restart                                         | PASS   |

Restart log: `/var/lib/openbot-staging/evidence/byok-restart-20260726T084459.log`
