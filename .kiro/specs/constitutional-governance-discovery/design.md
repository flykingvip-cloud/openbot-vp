# 设计：宪法治理发现（Phase A）

> 只规定文档放哪、如何对照已合并评审稿、Manifest 如何再生、C11 如何改写。
> 不设计新运行时。

## 1. 文档位置

```text
.kiro/specs/constitutional-governance-discovery/
├── requirements.md
├── design.md
├── tasks.md
├── terminology-and-non-equivalence.md
├── execution-entry-inventory.md
├── authority-evidence-baselines.md
└── web-read-shadow-slice.md
```

三件套保持短，指向四份正文。不在 `docs/design/` 再复制一套。

## 2. 与已合并评审稿的关系

| 已合并文档                                                             | 本任务怎么用                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| `docs/design/openbot-constitutional-gap-and-feasibility-2026-09-23.md` | 名词、C11 目标、禁用别名、三基线字段的上级叙述 |
| `docs/design/openbot-transformation-execution-plan-2026-09-23.md`      | A–D 授权、§6.4 清单、§7 `web_read` 合同        |
| `docs/design/openbot-constitutional-revision-notes-2026-09-23.md`      | 第二轮三项强制修正（C11、Manifest、地面真值）  |

PR #1249 的差距评估仍是入口与对象盘点的事实源，但该 PR 未合并。正文只引用其中已在当前 `main` 复核过的锚点。评估里「Pi 热路径无治理 / 裸执行」一类表述以可行性文的禁止表述为准：默认 Pi 热路径已有多层治理包络。

## 3. C11 改写（本任务不再使用旧目标）

最终目标：

> Domain-local single authority + explicit cross-domain finalization protocol

技能交付、普通聊天、协作任务、演进、发布是不同域。每域一个终态写权威。跨域只走显式终态化协议。上层可以做只读聚合，不能成为通用写者。

「跨域单一写权威」和「全局完成状态机」是已纠正谬误，不得写进成功标准。

## 4. BaselineManifest 再生

字段与示例见 `authority-evidence-baselines.md`。规则：

1. 评审快照（`main` @ `f1c7efece96d68375bf4b7fb57e77908fedfdd6c`，生产 seq 96）只作示例初始冻结。
2. Phase A 草案另记再生时的 `origin/main`（不含本任务自己的文档提交），与评审快照分开。
3. 每次阶段验收再生。进入 Phase B 前、进入 Phase C 前再冻结。
4. 生产 seq 以当时 `deploy/production/releases.jsonl` 末行（或容器自报，二者冲突时以容器为准）读取。seq 96 与后来的 seq 97 都不是六周常量。本草案已从 seq 96 再生到 seq 97。
5. 主张分级只用 `code-present` / `runtime-enabled` / `production-proven`。未探测容器则 production-proven 写 `unknown`。

## 5. 四份正文的分工

| 文件          | 冻结什么                   | 明确不写               |
| ------------- | -------------------------- | ---------------------- |
| 术语          | 三条 ADR + 禁用别名        | 新对象、重命名方案     |
| 入口          | 副作用入口九字段           | 收口设计、改默认值     |
| 权威与基线    | 域矩阵、证据分级、Manifest | 全局完成写者           |
| web_read 切片 | B 的可检查合同             | 接线代码、生产账本写入 |

## 6. 编码仍被挡住的条件

`web-read-shadow-slice.md` 使下列检查可做。缺任何一项，B 编码保持不批准：

- 目标面 = `web_read`
- ≥60 标注用例的字段、构成、双标注与 Owner 裁决
- 阈值与分母
- 报告落点 = 结构化结果 + 测试/离线报告；v1 不写生产 ledger
- 进入 B 前再次冻结的 BaselineManifest

本设计不把「合同文档已写入」当成「语料已标注完成」。语料文件本身不在 Phase A 产出内。
