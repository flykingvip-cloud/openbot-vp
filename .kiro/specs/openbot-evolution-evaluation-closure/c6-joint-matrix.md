# C6 joint matrix — A10 M1 evidence and promotion projection

Status: read-only audit. C6 is not E5.2 and does not make runtime or skill-auto single-track.

Baseline is `origin/main` `516c4ba34f` (#1236), which already contains `470bf68e82` (#1235). The replay is the A10 001 M1 closure: tenant `001`, target `agent:a8-m1-isolated`, surface `agent.working-dna`, proposal `evo:diag:8bee2c37b1f39478`, experiment `exp:cmd-a9-exp-down`, active application `app:cmd-a9-active-up`, verification `ver:cmd-a9-verify-ok`, command `cmd-a9-verify-ok`. The ledger has `application.applied` and `verification.completed`. It has no `promotion.completed`.

`projectC6M1Status` only reads those facts. It does not call Adapter Apply and does not append a promotion event. An A9/M1 event remains a shadow observation and cannot become an E5.2 cutover receipt.

| Fact                                          | Projection field      | A10 active replay           |
| --------------------------------------------- | --------------------- | --------------------------- |
| Proposal `VERIFIED` plus a bound verification | `applicationVerified` | true                        |
| Diagnosis recheck outcome                     | `recheckOutcome`      | `STILL_OPEN`                |
| `decideEvaluationOutcome`                     | `evaluationDecision`  | hold / `finding_still_open` |
| Verified and evaluation action `promote`      | `promotionEligible`   | false                       |
| Unique bound `promotion.completed` event      | `promotionCompleted`  | false                       |
| Visible copy                                  | `userVisibleStatus`   | 已验证，进化未完成          |

## Decision matrix

| Application verified | Recheck        | evaluationDecision         | promotionEligible | promotionCompleted                                                                                                                  |
| -------------------- | -------------- | -------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| yes                  | `RESOLVED`     | promote                    | true              | true only when one structured event matches tenant, proposal, experiment, application, verification, target, surface, and candidate |
| yes                  | `STILL_OPEN`   | hold                       | false             | false                                                                                                                               |
| yes                  | `REGRESSED`    | rollback                   | false             | false                                                                                                                               |
| yes                  | `INCONCLUSIVE` | observe                    | false             | false                                                                                                                               |
| yes                  | missing        | block / `recheck_required` | false             | false                                                                                                                               |

`已完成进化` is shown only when that unique structured event also has `authorityOk=true`, `guardrailDegraded=false`, recheck `RESOLVED`, and evaluation action `promote`. A type string alone does not complete promotion. See `c6.1-joint-matrix.md`.

## Shadow gate

| Condition                                                             | cutoverReady         | e52SwitchAllowed                   |
| --------------------------------------------------------------------- | -------------------- | ---------------------------------- |
| A9 event asks for `executedConsumer=true`                             | false                | false; the stored flag stays false |
| `directMutatorsRetired=false`                                         | false for the switch | false                              |
| empty window, damaged chain, unresolved denial, forged cutover fields | false                | false                              |

A manual M1 `application.applied` is not a runtime-tick or skill-auto cutover. Live tick still calls `applyGovernanceRuntimeAction`. Skill-auto still calls `installSkillToRobotAsset`.
