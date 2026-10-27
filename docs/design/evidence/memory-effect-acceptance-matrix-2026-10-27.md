# Memory effect-acceptance matrix（延伸 O8；隔离脚手架）

| 字段     | 值                                                                                   |
| -------- | ------------------------------------------------------------------------------------ |
| 日期     | 2026-10-27（Asia/Shanghai）                                                          |
| Harness  | `src/memory/memory-effect-acceptance-matrix.test.ts`                                 |
| 隔离     | `src/memory/memory-batch1-isolation.ts`（合成根；禁真实 `~/.openbot` / `~/OpenBot`） |
| 延伸自   | O8 v3 layered baseline（`memory-batch1-o8-baseline-v3`）                             |
| 关联     | forget assessment `#111`；DS path1 `#114`                                            |
| 状态模型 | `passed` \| `failed` \| `not-run`；**not-run 永不计入 passed**                       |

## Hard bans（本矩阵遵守）

- **不** deploy / 不写生产记忆 / 不用 `--admin`
- **不**声称 production / online effect verified
- **不**立项事实级遗忘产品；**不**做 D4 forget-lifecycle chaining
- 脚手架内部通过 ≠ 系统有效率（`scaffoldInternalOnly` / `notSystemEffectiveness`）

## 分层结果（脚手架内部）

| 层级                         | 用例                             | 覆盖意图                                                                            |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| isolation                    | EFF-ISO-1                        | 隔离路径断言；无真实 home 泄漏                                                      |
| manager-integration          | EFF-RECALL-1                     | `CogniWeaveMemoryManager.search` 召回 workspace `MEMORY.md` 短语                    |
| data-layer                   | EFF-LIST-1                       | path1 `listAgentMemoryEntries`：workspace 语料在列；DS `memory/agent` **不**在列    |
| sdk-unit                     | EFF-ACL-1 / EFF-ACL-2            | `queryAtoms` ACL：绑定主体可见；错主 fail-closed                                    |
| o4-statusView                | EFF-O4-1 / EFF-O4-2 / EFF-O4-3   | readonly `statusView=active\|tentative` 精确过滤；未绑定 → `MEMORY_SUBJECT_UNBOUND` |
| path1-forget-vs-multi-source | EFF-FORGET-PATH1-1 / EFF-MULTI-1 | path1 文件级 forget；**同内容多来源删 A 留 B = 预期**（assessment §3）              |
| helper-integration           | EFF-FORGET-PATH1-2               | 非语料 / 穿越 key 拒绝删除                                                          |
| gateway-handler-chain        | EFF-GW-1-not-run                 | **not-run**                                                                         |
| model-effect                 | EFF-MODEL-1-not-run              | **not-run**                                                                         |
| production-online            | EFF-PROD-1-not-run               | **not-run**（硬禁声称）                                                             |
| （同 path1 层）              | EFF-FACT-1-not-run               | 事实级遗忘产品 **not-run**                                                          |

## 相对 O8 的延伸

| O8 v3                | 本矩阵新增 / 强调                                        |
| -------------------- | -------------------------------------------------------- |
| S1 manager.search    | EFF-RECALL-1（同层；显式「不声称 online recall」）       |
| S3 wrong-owner       | EFF-ACL-1/2（bound + deny）                              |
| S4 forgetMemoryEntry | EFF-FORGET-PATH1-1 + **EFF-MULTI-1**（多来源预期残留）   |
| （无）               | EFF-LIST-1 path1 list vs DS legacy                       |
| （无；O4 另测）      | EFF-O4-1/2/3 纳入同一 effect 矩阵                        |
| MODEL/GW not-run     | 保留并加 **EFF-PROD-1-not-run** / **EFF-FACT-1-not-run** |

## 明确不声称（Does NOT claim）

- Production / online effect verified
- 完整网关 RPC / 认证链 / Memory Center UI 端到端
- 模型请求发送或正确采用（model adoption）
- 事实级「全来源遗忘」产品行为
- D4 CogniWeave forget-lifecycle chaining
- 部署或对真实用户记忆的写入
- 系统有效率 / 线上召回率

## 多来源期望（摘自 forget assessment）

隔离设定：相同短语；来源 A = workspace `MEMORY.md`；来源 B = workspace `memory/*.md`。

- 删 A 后 B **合法保留且仍可被 search 命中** → **不得**判遗忘故障。
- 这与「事实级全来源遗忘」产品目标不同；后者本矩阵标 `EFF-FACT-1-not-run`。

## 本次本地跑分（隔离；Asia/Shanghai 2026-10-27）

证据：`memory-effect-acceptance-matrix-run-2026-10-27.json`

汇总：**total=15 passed=11 failed=0 not-run=4**（scaffoldInternalOnly；`productionOnlineEffectVerified=false`）。

执行：`EFF-ISO-1`, `EFF-RECALL-1`, `EFF-LIST-1`, `EFF-ACL-1`, `EFF-ACL-2`, `EFF-O4-1`, `EFF-O4-2`, `EFF-O4-3`, `EFF-FORGET-PATH1-1`, `EFF-MULTI-1`, `EFF-FORGET-PATH1-2`

未跑：`EFF-GW-1-not-run`, `EFF-MODEL-1-not-run`, `EFF-PROD-1-not-run`, `EFF-FACT-1-not-run`

## 可选证据 JSON

```bash
OPENBOT_MEMORY_EFFECT_MATRIX_OUT=/tmp/memory-effect-matrix-out.json \
  pnpm exec vitest run --config vitest.unit.config.ts \
  src/memory/memory-effect-acceptance-matrix.test.ts
```

输出含 `scaffoldInternalOnly: true`、`productionOnlineEffectVerified: false`。
