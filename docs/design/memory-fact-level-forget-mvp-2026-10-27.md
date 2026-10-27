# 事实级遗忘 MVP（2026-10-27）

| 项       | 值                                                     |
| -------- | ------------------------------------------------------ |
| 状态     | 产品 MVP 编码（soft forget only）                      |
| factRef  | `atomId`（+ manager `defaultScope`）                   |
| 评估依据 | `memory-fact-level-forget-assessment-2026-10-27.md` §6 |

## 范围

1. 枚举：`listLiveSourcesForAtom` 经 `source_object_links`（atom + evidence），不文本扫库。
2. 编排：`data.memory.forgetFact` → soft-forget 各 live source；返回分源完成态；**默认不 purge**。
3. UI：原子详情「忘记此事实（全部来源）」+ confirm；**不改** O5「删除此记忆文件」文案/入口。
4. 验收：隔离金标（多源同事实；错主体拒绝；与 path1 单文件遗忘并存）。

## 非目标

- 部署 / `--admin` 合入 / 真写生产记忆
- 默认硬 purge、D4 无收据串联、跨 atom claim 指纹合并、一键恢复

## 注意

同一来源文件上的其他原子也会失去该来源（源级 lifecycle 固有语义）。
