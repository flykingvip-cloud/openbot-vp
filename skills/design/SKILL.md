---
name: design
description: |
  审查并改进 Web/App/Landing/Dashboard/HTML/UI 与页面截图的专业设计质量。
  遇到「设计审查」「design audit」「critique」「改一版 UI」「响应式」「对比度」「无障碍」「polish」「landing」「dashboard 截图」务必使用。
  操作收敛为 audit / critique / improve / polish。能规则检测的不要丢给模型。
  不写内容研究、不写长文、不监控热点。
---

# 设计审查

先看用户要的是找问题、给方案，还是直接改。默认闭环：检测 → 分级 → 修改 → 再检测。

## 先判断

1. 对象是代码、预览 URL，还是截图？
2. 有没有已有设计约定（色板、间距、组件）？有则遵守，不要用审美覆盖 brief。
3. 能否跑确定性脚本？能则先跑。

## 操作

| 操作     | 行为                              |
| -------- | --------------------------------- |
| audit    | 只报问题，不改                    |
| critique | 启发式 UX 判断 + 改法，仍不改代码 |
| improve  | 按 P0→P3 执行修改                 |
| polish   | 发布前收口，不新开视觉方向        |

自然语言「看看这页」「帮我改」按上表路由。细则：`references/severity.md`、`references/checks.md`。

## 问题等级

- **P0** 严重可用性/功能（完不成任务、对比度致命、触控不可用）
- **P1** 明显设计/UX 或 WCAG AA
- **P2** 一般视觉
- **P3** 可选优化

不要把口味差异标成 P0。

## 检查面

Layout · Typography · Spacing · Color · Contrast · Responsive · Accessibility · Interaction · Visual hierarchy · Component consistency

## 确定性检测

对 HTML/CSS 先跑：

```bash
python3 {baseDir}/scripts/design_audit.py <file-or-dir>
```

脚本覆盖：过小点击目标、标题层级跳跃、弱对比线索、过宽内容、重复色、间距离散、overflow、缺 mobile breakpoint。模型只处理脚本看不到的层级、文案、心智模型。

## 闭环

```text
design audit  → 问题清单
design improve → 按优先级改
design audit  → 验证关闭项与回归
```

最多两轮复检。开环自我打磨会浪费 token。

## 输出

```text
范围
P0–P3 清单（位置 / 类别 / 影响 / 改法）
已改 / 未改
复检 delta
```

## 交接

内容对不对 → `knowledge` / `content`。页面好不好用 → 本技能。

## 组合

只处理界面。文案对错交接 `content` / `knowledge`。不要在审查里改产品事实。

## 验收

- 能规则检测的问题先出现在脚本输出
- 每条问题有级别与位置
- improve 后复检，对应 P0/P1 关闭或说明残留
- 审美项不得标 P0

## 触发样例

- 「audit 这个 landing」
- 「按钮太难点，改完再检查」
- 「这张 dashboard 截图做设计审查」
