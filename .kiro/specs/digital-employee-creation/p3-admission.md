# Digital Employee Creation — P3 Confirmation Card Admission

> **性质:** 书面编码准入。  
> **日期:** 2026-09-17  
> **授权来源:** 用户「先 p3 后 p4」+ 先前书面准入授权。  
> **执笔 / 落地:** `cursor-dec-p1`  
> **服从:** 原则层、Requirements、P2-OFFLINE 准入。

## 1. 判定

| 项          | 结论                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| **批准**    | 确认卡 UI + 自然语言 Revision + `digitalEmployee.design.{compile,revise,confirm,abort}` |
| **不批准**  | LLM D1、生产自动创建、账号/授权、P5 三入口改版                                          |
| **Confirm** | 只把 Session 推到 `CONFIRMED`，**不得**调用 `agents.create`                             |

## 2. 范围

- `.kiro/specs/digital-employee-creation/**`
- `src/digital-employee-creation/**`
- `src/gateway/server-methods/digital-employee.pack.ts` + packs 注册
- `ui/src/ui/ports/employee/views/workbench-design-card.ts` 与创建抽屉接线
- i18n 仅确认卡文案

旧「名称 + 模板」表单保留为双轨。未走设计编译时，创建行为不变。

确认卡只渲染 `projectDesignMapping` 事实。禁止 CoT / 「我猜」。

## 3. 退出

1. 编译后可展示确认卡；`invalid` 不可确认
2. 修订保持同一 `CreationSession.id`
3. 确认后仍无 Agent / Workspace / Skill 安装
4. 相关测试绿
