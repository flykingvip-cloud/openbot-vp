# Digital Employee Creation — P2 Offline Coding Admission

> **性质:** 书面编码准入。不是生产发布单。  
> **日期:** 2026-09-17  
> **授权来源:** 用户口头授权「执行下一步，书面准入授权你来搞定」。  
> **执笔 / 落地:** `cursor-dec-p1`  
> **服从:** [`./architecture-principles.md`](./architecture-principles.md)、[`./requirements.md`](./requirements.md)、[`./p1-p2-design-baseline.md`](./p1-p2-design-baseline.md)

## 1. 判定

| 项                   | 结论                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **批准**             | **P2-OFFLINE**：确定性 Design Compiler（D1–D4）、确认映射投影、固定夹具回放                            |
| **不批准**           | P2 Designer **生产实现**、LLM、接线网关、写 `openbot.json`、调用 `agents.create` / `workspaces.create` |
| **不批准**           | P3 确认卡 UI、P4 Factory 执行、自动授权、账号绑定                                                      |
| **本文不可被引用为** | 「已经批准上线 Designer / 自动创建」                                                                   |

专家原句仍然有效：_P2 生产实现另需书面编码准入_。本次准入 **不是** 那张生产单；只把 baseline §11 已允许的离线验证写成可执行范围。

## 2. 批准范围

允许改动的路径：

- `.kiro/specs/digital-employee-creation/**`
- `src/digital-employee-creation/**`

允许新增的纯函数：

1. **D1** `extractDesignIntent(rawRequest)` — 从原文抽 Intent 字段；禁止选 Blueprint、发明 skillKey、谈授权结果
2. **Compile** `compileEmployeeDesign` — 固定顺序 D1 → D2 → D3 → D4；禁止 `Prompt → 巨大 JSON`
3. **Revision** `compileRevision` — 同一 Creation Session 上合并原文与修订
4. **Mapping** `projectDesignMapping` — 「我理解的是…」的**数据投影**；禁止 CoT / 「我猜你…」
5. **Fixtures + Replay** — 用例 A–N 的固定输入与金标回放

D2 / D4 必须保持确定性。D3 只做目录 match；找不到则 `unresolved`，不得发明 `skillKey`。

## 3. 明确禁止

- `openai` / 任何模型 SDK、租户 Prompt、远程抽取
- `agents.create`、`workspaces.create`、`robots.bind-workspace`、skill 安装
- 读写企业 CRM / Memory / 私有文档 / 会话 / token
- UI 路由、左侧「+」、生产确认卡组件
- 把 `CreationSession.id` 当成 `agentId`
- 把 Tenant `CapabilityPackId` 当成 `RoleRecipe`
- 为通过校验而补造权限或能力
- 环境开关打开即等于生产 Designer（本阶段不得增加这类 flag）

## 4. 退出标准

1. `OPENBOT_TEST_PROFILE=low pnpm test src/digital-employee-creation` 全绿
2. 夹具覆盖 Requirements §9 用例 A–N（含修订、双击、PARTIAL、放弃、旧模板不迁移）
3. 任一回放不得产生 Adapter 禁止字段或副作用探针为真
4. `projectDesignMapping` 输出不含思维链字段

达到退出标准 = **P2-OFFLINE 完成**。不等于 P2 生产、P3、P4 开闸。

## 5. 下一步仍需新的书面准入

| 阶段                    | 仍需单独准入                         |
| ----------------------- | ------------------------------------ |
| P2 生产 Designer        | 是（LLM D1、网关方法、租户目录）     |
| P3 确认卡 UI            | 是                                   |
| P4 Factory Adapter 执行 | 是（见 Requirements §8 P4 冻结清单） |
