# Phase D H1 — 热路径旁一处 Runtime 门面 observe 接受记录

> 记录 id：`phase_d_hotpath_facade_observe_one_site_acceptance`。  
> 接受对象：`phase_d_hotpath_facade_observe_one_site`  
> 落点：`.kiro/specs/constitutional-governance-discovery/phase-d-hotpath-facade-observe-one-site-acceptance.md`  
> 日期：**2026-10-13**（Asia/Shanghai）  
> 接受宽度：`accepted-for-hotpath-observe-one-site-docs-only`（本 PR）；后续实现须引用 `phase_d_hotpath_facade_observe_one_site_start_order` 另开 PR。  
> **C10 仍不能 pass。** 合入 ≠ PASS/GO。非整段 D GO。非 Gate 收紧。非 enforce。

## 1. 接受声明

在 Owner 2026-10-13「继续下一步 / 本地改仓推 GitHub」语境下，记名接受本刀**书面三件套入库**（docs-only），作为通向热路径治理阶梯的 **H1**。

**不**接受：Gate 收紧、enforce 默认开、Fabric-on、live invoke 生产默认、整段 P8b/P8c GO、改写 Phase C NO-GO、C10 pass。

## 2. 与既有切片关系

| 切片 | 关系 |
| --- | --- |
| #60 Runtime façade shadow | 本刀**复用**其 observe API；不重做门面 |
| soft/observe FC-05+ | 可挂在既有 observe 旁；不替代；不发明 stdio/AOR 刀 |
| Path-Gate / P8b Knife1 / EXECUTE / P8c 对照 | 收口仍站；本刀不扩执行、不翻 `readyToTighten` |
| Owner Path-Gate track #101 | 若 tip 仍在则引用；本刀为 track 下有界 H1，非整段 free-for-all |

## 3. 主张天花板

- docs：`code-present`  
- 未来实现：至多 `runtime-enabled`（observe-only）  
- **禁止** production-proven / Gate 已收紧 / C10 pass

## 4. FAIL 条件

写成 C10 pass、C GO、整段 D GO、Gate 已收紧、enforce 默认开、本 PR 改 `src/`/`packages/`。
