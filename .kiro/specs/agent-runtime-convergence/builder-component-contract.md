# M1d 协作任务上下文组件契约（只读设计）

## 范围与组件边界

候选实现：`runtime-context-assembly.ts:137–174` 的 `buildCollaborationGroupMissionPrompt`。它是完整的“协作任务说明投影”组件：将一个已解析profile呈现为模型所需的group/purpose/mission/mode/acceptance/instructions说明。不拆成字段级formatter，不建注册器，不新增builder执行调度，不批量拆其他来源。

目标位置建议 `src/agent-runtime/context/sources/collaboration-mission.ts`；保留一个窄DTO、一个纯render入口、对应契约测试。未来是否归sources子目录，应由组件数量决定，不为一个函数预建层级。

## 最小DTO

```ts
export type CollaborationMissionData = {
  displayName?: string;
  purpose?: string;
  currentMission?: string;
  collaborationMode?: string;
  successCriteria?: readonly string[];
  systemInstructions?: readonly string[];
};

export function renderCollaborationMission(profile?: CollaborationMissionData): string | undefined;
```

不引SessionEntry/OpenBotConfig/Gateway类型，不含tenant/permission/路径字段。DTO是源码接口，不是允许任意内容越权的外部配置。现有profile包含额外字段时结构赋值可以直接传入；如原字段是必填或更窄union，仍保持兼容。不要扩宽至unknown/any或增加运行期schema自动容错，避免悄然改行为。

## 原adapter职责（必须保持）

```ts
export function buildCollaborationGroupMissionPrompt(
  sessionEntry?: SessionEntry,
  resolvedProfile?: SessionEntry["collaborationGroupProfile"],
): string | undefined {
  return renderCollaborationMission(resolvedProfile ?? sessionEntry?.collaborationGroupProfile);
}
```

- resolvedProfile非nullish时**整体优先**，即便它是空对象也不字段级回填session。
- session只在resolvedProfile缺省时fallback；不可merge二者字段。
- 原函数名/签名保留，原assembly调用时点保留：profile/并发来源解析后，delivery resolve之前。
- 原调用只发生一次；纯render不负责读取profile、解析group、更新sessionCtx或运行delivery。

## 输出等价要求

- header严格 `Collaboration group context:`；仅无正文时undefined。
- 字段顺序固定displayName→purpose→currentMission→collaborationMode→criteria→instructions。
- 标量先trim决定是否保留，保留trim后正文。
- arrays按原序map(trim)/filter(Boolean)，不排序不去重；criteria用`; `，instructions用`|`。
- 输出仅LF join，无尾部换行。
- 未更改现有system placement；不把它移动到user-body，不提升其他来源权限。
- 不删除重复条目、不做新budget、不修英文文案、不加入治理说明。

## M1d回归专项

组件单测：无profile、空profile、空白全字段→undefined；单字段、全部字段精确字符串；重复/空白数组；unicode与字面\\n；输入不被mutation。

原adapter测（runtime-context-assembly.test.ts已有mission基础用例）：session fallback；resolved优先；resolved空对象不得fallback；resolved只给mission不继承session purpose；undefined resolved保留旧行为。

真实assembly测：调用次序与文本序列不变，mission位于charter之后、delivery之前；source读取次数不增；DeliveryToolSideEffect原写入行为不动。真实get-reply入口M1哨兵回归保持。

命令建议：
`pnpm exec vitest run src/agent-runtime/context/collaboration-mission.test.ts src/auto-reply/reply/runtime-context-assembly.test.ts src/auto-reply/reply/get-reply-run.aside-dialogue-context.test.ts`

加现有manifest边界检查及变更文件oxfmt/oxlint；构建与tsgo按管理者已固定差量门槛执行。

## 后续builder组件规范（登记为专项，不本轮批量迁）

每个builder迁移必须按一个完整领域组件定义：数据来源/解析adapter、窄数据契约、纯投影、trust placement、budget、side effects、调用时序、失败退化、契约测试及owner。读/记账/动作不能因命名builder就迁入纯context。

- Knowledge：保留evidence/receipts/diagnostics及scope/identity/abort；不能降格为只返回string。
- Learning：保留retrieved/injected/pending的run-bound暴露记账；不得重跑source或遗漏账。
- Identity：权限数据读取与prompt呈现分开，说明不代替强制授权。
- Composer：host tool.execute是能力调用，不归上下文只读模块；summary只是它的结果。
- Collaboration assembly：有DeliveryToolSideEffect写入，不整体搬为纯context。

反碎片化要求：不为每字段建文件；不为统一接口增加无消费者抽象；不重复导出多个同义入口；每次提取有真实调用方替换和旧实现退出；纯算法组件与领域组件区分，不能用文件数衡量模块化进展。

## 接受与回退

只接受字节等价、同次序/次数、同placement、同错误与fallback、无新增IO。任一字段级fallback、自动去重、预算变化、额外await/model/tool、session mutation变化均退回。首切片可独立revert，无状态迁移，不新建并行分支选择器。

`sources` identifies a domain projection component, not an additional execution stage.
