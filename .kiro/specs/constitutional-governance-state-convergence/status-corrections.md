# 过期状态修正清单

authorityRole: supporting-evidence
currentAuthority: .kiro/specs/constitutional-governance-state-convergence/current-state.md

只改状态读法，不删历史时间线，不改冻结推荐理由。

| 位置                                                                                                                                                      | Historical status                | Superseded by                                                                   | Current authority                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `constitutional-governance-discovery/tasks.md` 架构评审纪要勾选，同时写「会议纪要未召开」                                                                 | 勾选表示文档里写了授权表         | 本目录 `current-state.md` 第 1 节                                               | Phase A 文档在主干上。该勾选不是会议回执，也不授权 Phase D                                                                   |
| `constitutional-governance-web-read-shadow/tasks.md`「local commit only；不 push」「不 push / 开 PR」「等待 Codex 验收」以及未勾选的「不 push / 不开 PR」 | 接线回合的操作约束               | `current-state.md` 第 3 节                                                      | B2 默认关闭的影子接线已由 PR #20 / #23 合入。那些句子不再表示代码不在主干上                                                  |
| `constitutional-governance-phase-c-decision/decision.md` 的 REVISE / pending / unsigned                                                                   | 材料草案当时的签收空位           | `final-acceptance.md` 的三方 AGREE_NO_GO，以及 `current-state.md` 第 4 节       | 唯一当前决定是 NO-GO accepted。REVISE 段落按字节留在冻结正文里                                                               |
| `constitutional-governance-phase-c-decision/final-acceptance.md` 末尾「Awaiting Codex final acceptance」与文首 Independent acceptance COMPLETE            | 2026-09-24 的下一闸门句子        | `current-state.md` 第 4 节                                                      | 三方回执已构成 NO-GO accepted。该句子不是第二个当前决定。2026-09-27 收敛包的 Codex 验收仍是外部未完成项                      |
| `constitutional-governance-phase-c-decision/tasks.md`「不做建包 / Phase D」                                                                               | Phase C 那一轮对整段 D 的边界    | `current-state.md` 第 5 节与 `phase-d-classification.md`                        | 整段 Phase D 仍是 NO-GO。其后个别切片有自己的书面范围或两段门，只覆盖 inert、shadow 或 default-off，不把这张清单改成整段批准 |
| 生产 seq 98 与当前 main                                                                                                                                   | 账本开放 LIVE 仍是 seq 98 的记载 | `docs/design/evidence/constitutional-governance-state-baseline-2026-09-27.json` | 主干 `30fde26f…` 比账本 gateway SHA 超前 206 个提交。容器 SHA 本次不可读                                                     |

未改写的历史：

- `decision.md` 冻结正文，含 NO-GO 推荐理由和 REVISE 表
- 三份 review 回执
- `failure-cases.md`、`alternatives-matrix.md`、`metrics-and-evidence.md`、`security-profile-review.md`
- Phase D 各 acceptance、scope、start-order 文件的正文。本收敛包逐一引用：有界切片授权与整体治理 NO-GO 分开记录，不把切片写成整体授权，也不把未找到写成统一的 false
