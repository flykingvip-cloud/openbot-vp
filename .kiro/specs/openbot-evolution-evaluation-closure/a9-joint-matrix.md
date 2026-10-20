# A9 joint matrix — M1 shadow observation

Status: joint observation only. E5.1.5 is not E5.2 and does not make the system single-track.

Baseline is `origin/main` `b88a67a116`, which already contains `#1230` `313b58661b` and the merged `#1232` squash `6fe49507d9`. This slice does not rewrite those delivery files and does not replay the pre-squash E5.1.4 commits.

A9 M1 supplies a fact that names an existing Proposal, Experiment, and Application. B records that fact through the same shadow JSONL and health hash chain used by runtime-auto and skill-auto. B does not call Adapter Apply. Direct mutators stay in place.

| A9 M1 fact                                                           | B observation                                                  | Cutover effect                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| Proposal, Experiment, and Application ids match the server binding   | shadow row `source=a9-m1`, `livePath=diagnosis-m1-observation` | row is not an E5.2 receipt                                  |
| observation window                                                   | `shadowObservationWindow.sampleCount`                          | empty window forces both flags false                        |
| denial counts                                                        | `denyCounts` / `unresolvedDenials`                             | any unresolved denial forces both flags false               |
| health chain                                                         | `evolution-shadow-ledger/events.jsonl`                         | missing, corrupt, or tampered chain forces both flags false |
| `directMutatorsRetired`                                              | always `false` on the live reader                              | `e52SwitchAllowed=false`                                    |
| client `cutoverReady`, drill flags, `executedConsumer`, or `audited` | ignored                                                        | cannot mint a cutover receipt                               |

## Fail closed

| Store or caller state                                               | cutoverReady | e52SwitchAllowed |
| ------------------------------------------------------------------- | ------------ | ---------------- |
| shadow corruption, including a forged `e5.2-cutover-receipt` source | false        | false            |
| empty observation window                                            | false        | false            |
| unresolved denial                                                   | false        | false            |
| health chain missing                                                | false        | false            |
| direct mutator still present                                        | false        | false            |
| `executedConsumer`                                                  | always false | false            |

Recovery accepts only an admin identity issued by `resolveServerAdmin` after the server authority check. A raw `adminId`, `audited`, or `observationWindowRevalidated` claim does not clear the latch.

E5.1.5 does not switch `applyGovernanceRuntimeAction` or `installSkillToRobotAsset`.
