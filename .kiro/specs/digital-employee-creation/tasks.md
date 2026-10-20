# Digital Employee Creation — Tasks

## Agents

- `cursor-dec-p1` · role: owner · scope: P1–P4 设计编译/确认卡/Factory Adapter 落地 · paths: `.kiro/specs/digital-employee-creation/**`, `src/digital-employee-creation/**`, `src/gateway/server-methods/digital-employee.pack.ts`, `ui/src/ui/ports/employee/views/workbench-design-card.ts`, `ui/src/ui/ports/employee/views/workbench-design-catalog.ts`, `ui/src/ui/ports/employee/views/workbench-design-labels.ts`, `ui/src/styles/workbench.css` · since: 2026-09-17

## P1

- [x] Domain Types（Intent / Hypothesis / Resolution / Draft / Recipe / Session / Receipt / Validation）
- [x] CreationSession 状态机 + 修订号
- [x] DEC-I\* 可断言不变量
- [x] Ownership（Designer 只读目录；Factory 才写实例）
- [x] D2 Role Resolution / D3 Skill Match / D4 Validation 纯函数（无 LLM）
- [x] Factory Adapter 签名与禁止字段（不调用 `agents.create`）
- [x] P1 契约测试绿 — 22/22 `src/digital-employee-creation` — cursor-dec-p1

## P2-OFFLINE（已准入，见 `p2-offline-admission.md`）

- [x] D1 确定性 Intent 提取（无 LLM）
- [x] D1–D4 `compileEmployeeDesign` / `compileRevision`
- [x] 确认映射投影（禁 CoT）
- [x] 用例 A–N 夹具回放绿 — 26/26 `src/digital-employee-creation` — cursor-dec-p1

## P3（已准入，见 `p3-admission.md`）

- [x] 确认卡 UI + 自然语言 Revision
- [x] `digitalEmployee.design.compile/revise/confirm/abort`

## P4（已准入，见 `p4-admission.md`）

- [x] `skipCapabilityAutoInstall` + instantiate 只装已解析 skill
- [x] PARTIAL 诚实暴露；旧表单双轨保留

## P2+

- [ ] 未批准生产 Designer / LLM D1
