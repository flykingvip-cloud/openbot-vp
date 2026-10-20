# Blind holdout meta（B1 泛化观察）

> Agent: grok-bot（evaluator implementer）
> Holdout ownership: architecture-owner:thomas-joshua

## Provenance（required）

| Field               | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| classifierFrozenSha | `533d3263d2de10b7ed0c1c7530b1e0bc774129ad`                                |
| holdoutCorpusDigest | `sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586` |
| revealedAt          | `2026-09-24T07:06:02+08:00`（Asia/Shanghai）                              |
| evaluatorOwner      | grok-bot                                                                  |
| holdoutOwner        | architecture-owner:thomas-joshua                                          |

## Honesty note

Holdout sealed **after** classifier freeze (`classifierFrozenSha` above). Labels were **not** used to retune regex / intent cues. Holdout ownership is attributed to the architecture Owner gate — the evaluator implementer (`grok-bot`) did **not** adjust cues after reveal. If holdout metrics are poor, report honestly; do not retune and still call it blind.

## Cohort

| Dimension                           | Target       | Actual            |
| ----------------------------------- | ------------ | ----------------- |
| Total                               | ≥30          | 30                |
| web_read / not_web_read / clarify   | 10 / 10 / 10 | 10 / 10 / 10      |
| Profile A / B                       | balanced     | 15 / 15           |
| Overlap with calibration utterances | 0            | 0（exact string） |

## Metrics reporting

Holdout metrics are printed **separately** from calibration (`holdoutMatchRate` / `holdoutFalseAllowRate` …). They are **not** independent Phase C acceptance by themselves; they are generalization observation after freeze.

— Agent: grok-bot

## Rebase note

After `git rebase origin/main`, `classifierFrozenSha` was refreshed to the rewritten freeze commit (content-identical classifier; no cue retune).

## Owner written acceptance（B1 independent Owner evidence）

身份：**blind holdout / Owner-signed**（不得降级为 post-freeze holdout）。

| Field               | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| owner stable id     | `architecture-owner:thomas-joshua`                                        |
| classifierFrozenSha | `533d3263d2de10b7ed0c1c7530b1e0bc774129ad`                                |
| holdoutCorpusDigest | `sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586` |
| revealedAt          | `2026-09-24T07:06:02+08:00`（Asia/Shanghai）                              |

Acceptance（exact）：

> 本人确认 blind holdout 语料（digest sha256:c12eb16b6ee75c5ac0d0399af489af0dd476dc4b68a539075fc3dc1f2729b586；revealedAt 2026-09-24T07:06:02+08:00；classifierFrozenSha 533d3263d2de10b7ed0c1c7530b1e0bc774129ad）作为 B1 独立 Owner 证据有效。
