# EvaluationPolicy

There is **no** global three-vote rule. Policy is keyed by `surfaceId + producerKind`.

## Required on every proposal

- Experiment result that is not `inconclusive`
- Guardrails within budget
- Authority / grant still active
- Domain / SoT verification (read-after-write or adapter inspect)

## Safety priority

Negative facts are decided first and always rollback:

- `guardrailDegraded` → rollback
- `experimentResult=regressed` → rollback
- `externalEffectOutcome=contradicted` → rollback
- `recheck=REGRESSED` → rollback

Sample size, confidence, or rollback-drill gaps must not downgrade those facts to observe.
`rollbackDrillRequired` only blocks Promote.

## Diagnosis Recheck

| Producer                                                   | Policy        | Missing Finding                  |
| ---------------------------------------------------------- | ------------- | -------------------------------- |
| `diagnosis-origin`                                         | `required`    | fail-closed (`recheck_required`) |
| `pattern-origin` / `governance-origin` / `operator-origin` | `unsupported` | must **not** block               |

Diagnosis-origin Promote also requires `Recheck=RESOLVED`.

| Recheck        | Action                                |
| -------------- | ------------------------------------- |
| `RESOLVED`     | may Promote if all other signals pass |
| `STILL_OPEN`   | Hold                                  |
| `REGRESSED`    | Rollback                              |
| `INCONCLUSIVE` | continue observing                    |
| `BLOCKED`      | fail-closed                           |

## Phase-1 coded policies

`evaluationPolicyFor` only returns a promote-capable policy for:

- `agent.working-dna`
- `capability.skill-installation`

Defaults: `minimumSampleSize=20`, `requiredConfidence=0.9`, `rollbackDrillRequired=true`, `guardrailMetricIds=GUARDRAIL_METRIC_IDS`.

External verifiers:

- Working DNA → `working-dna-read-after-write`
- Skill Installation → `skill-installation-read-after-write`

Other surfaces are inventoried in the matrix and return `unknown_surface`. They must not be treated as no-regression.
