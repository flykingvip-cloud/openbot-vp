# Phase C §8.3 ABC Knife1 — Path C 旁路表锁定开工令

> 开工令 id：`phase_c_83_path_c_bypass_table_lock_start_order`。  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-c-83-path-c-bypass-table-lock-start-order.md`。  
> 日期：**2026-09-26**（Asia/Shanghai）  
> 前置接受：`phase-c-83-path-c-bypass-table-lock-acceptance.md`  
> 有界范围：`phase-c-83-path-c-bypass-table-lock-scope.md`  
> 本页是 **ABC Knife1（Path C）第二门开工令**。不是 Meta-Schema 工程开工，不是 C10 pass，不是整段 D GO，不是 Path A/B 偷渡。

## 1. 授权一句话

在 Path C 旁路表锁定范围已按接受记录记名接受的前提下：

1. **立即授权** discovery 文档三件套 + operate-path / product-confirmation 最小 xref 入库（本 PR）。  
2. **继而授权** 引用本开工令的实现 PR：落地 scope §3 冻结表 + 单测；主张 **`code-present`**；无新旗标；无热路径强制 import；不宣称 C10 pass。

## 2. 基线

| 项 | 值 |
| --- | --- |
| Base branch | `main` |
| Baseline SHA | `f6c6a92360f001e52b568fdf5e5af58dd60a6ee0`（#85 merge；§8.3 运营路径确认；停 Meta-Schema） |
| Scope PR | https://github.com/upbeyond/openbot/pull/86 |
| 实现 PR | （另开；须在描述中引用本开工令 id） |

## 3. 落点（paths）

### 3.1 本 PR（docs-only）

| 落点 | 路径 |
| --- | --- |
| 接受记录 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-path-c-bypass-table-lock-acceptance.md` |
| 本开工令 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-path-c-bypass-table-lock-start-order.md` |
| 书面范围 | `.kiro/specs/constitutional-governance-discovery/phase-c-83-path-c-bypass-table-lock-scope.md` |
| 最小 xref | `phase-c-83-operate-path-confirmation-scope.md` §10；`phase-c-83-product-confirmation.md` §1 一短注 |

### 3.2 实现 PR（引用本令；建议路径）

| 落点 | 路径 |
| --- | --- |
| 冻结表 | `src/agents/execution-preflight/allowed-entry-disposition.ts` |
| 单测 | `src/agents/execution-preflight/allowed-entry-disposition.test.ts` |
| 可选 barrel | `src/agents/execution-preflight/index.ts`（不得制造热路径新依赖） |
| 可选 discovery 后记 | inventory / disposition / C10 progress 各一行 xref |

**不**落点：`packages/constitutional-*`；gateway/ACP/AOR 新 observe 调用点；新 `OPENBOT_*` 旗标；Phase C 冻结包。

## 4. 主张天花板

- 允许：登记「允许入口旁路表已 code-present 锁定；与 #68/#69/#70 一致；C10 仍不能 pass」  
- 禁止：`runtime-enabled` / `production-proven` / C10 pass / Decision GO / C GO / 整段 D GO / UNIQUE≥1 / Meta-Schema 工程开席

## 5. 回滚

docs-only：

```bash
git revert <scope-docs-landing-commit-sha(s)>
```

实现 PR：

```bash
git revert <implement-commit-sha(s)>
# or delete allowed-entry-disposition.ts(+test) and drop exports
```

无运行时旗标可残留；表未被热路径强制依赖。

## 6. 测试门（实现 PR）

```bash
# 表与单测存在
test -f src/agents/execution-preflight/allowed-entry-disposition.ts
test -f src/agents/execution-preflight/allowed-entry-disposition.test.ts

# 预检包相关单测（实现方可收窄到 disposition 文件）
pnpm exec vitest run src/agents/execution-preflight/allowed-entry-disposition.test.ts
```

须覆盖：§3.1 入口均在表中；处置枚举合法；豁免项不得标为 `reuse-observe`；CTR 整行为 `n/a-not-tri-state`。

## 7. OUT（本开工令不授权）

- Meta-Schema / constitutional-contracts / 四产品工程  
- 新 soft-observe；Path / Gate / enforce / live invoke；Fabric-on  
- C10 pass；Decision GO；整段 D GO；C GO  
- Path A 新接线；Path B defer-close / enforce  
- 改写冻结正文；重开 #58–#85 为杂项清单  
- 本 scope PR 内直接改 `src/`（实现必须另 PR）

## 8. 残差

- Path A observe 助手收敛 — 另文  
- Path B consult 抛光 — 另文  
- C10 pass 挡门项 — 不由本刀关闭  
- #80 推翻路径 — 不启动  