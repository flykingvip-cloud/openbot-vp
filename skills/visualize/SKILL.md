---
name: visualize
description: >-
  在对话中用交互 HTML/PNG 解释机制、仿真、对照或「如果…会怎样」。
  遇到「可视化」「交互图」「模拟器」「帮我理解」「what if」「explore」「对照图」务必使用本技能。
  不要在「新建独立 App/站点/组件进仓库」、纯 Markdown 表、纯 Mermaid 结构图、或办公看板交付（用 canvas）场景用。
---

# visualize（对话内可视化）

用**工作区 HTML/PNG** 让用户看见或操作，而不是再写一段长文。产出落盘后经聊天附件或 OpenBot artifact 交付；**不要**依赖 Codex 内联 surface / `window.openai`。

与 `canvas` 的边界：`canvas` 偏看板/架构页/`canvas.present`；本技能偏**对话内探索**（仿真、可调参数、对照、轻量 mockup）。重叠时：要 Node 展示看板 → `canvas`；要当场试参数 → 本技能。

## 硬边界（先判）

| 用户意图                             | 做法                                   |
| ------------------------------------ | -------------------------------------- |
| 新建/改仓库里的 App、页面、组件      | **不用本技能**；当工程任务做           |
| 只要静态结构（流程图/时序）          | 聊天里直接给 **Mermaid** 代码块        |
| 只要表                               | 直接 Markdown 表，**不要**做成 HTML 表 |
| 办公看板 / 多图报告 / Node 展示      | 用 `canvas`                            |
| 对话里探索、仿真、可调输入、空间运动 | **用本技能**                           |

## 流程

1. **确认需要看见**：视觉能明显改善理解再做；纯数字结论用短文即可。
2. **选形态**：仿真/explainer → 紧凑控件 + 主视觉；图/曲线 → SVG 或 D3；地图 → 投影真实 GeoJSON；UI mockup → 产品自有样式（勿套通用 viz 工具类）。细则见 `references/when-to-use.md`。
3. **写文件**：ASCII 小写连字符标题，如 `spring-mass.html`。写入**可写工作区**（任务 `work/`、当前 workspace、或授权输出目录）。**禁止**把系统临时目录当唯一落点。
4. **遵守 HTML 契约**：完整可打开的单页 HTML（含必要 CSS/JS），或 fragment + `scripts/render.py` 包壳。细节见 `references/html-contract.md`。
5. **交付**：路径告知用户；用聊天附件 / OpenBot artifact / 本机打开。**禁止**发 Codex `visualize` 特殊标记。见 `references/openbot-delivery.md`。
6. **回复**：一句说明「能看见/能调什么」；不要复述图上已有数据，不要暴露实现细节堆砌。

## 输出约定

- 主交付：`*.html`（交互）或导出的 `*.png`（用户明确要静态图时）。
- 文件 < 1MB：大数据先聚合/抽样/降精度。
- 主题色用 CSS 变量（`light-dark` 或 `--foreground` / `--viz-series-*`）；勿写死白底黑字一套。
- 无 `fetch`/XHR/WebSocket；外链脚本仅允许常见 CDN（jsDelivr / unpkg / esm.sh / cdnjs / Google/Bunny fonts）。
- 根节点给稳定 `id`；交互用原生 `button`/`input`/`select`；`aria-live="polite"` 报关键结果。

## 脚本（可选）

把 fragment 包成可本地预览的完整页：

```bash
python3 scripts/render.py /abs/path/to/fragment.html /abs/path/out.html
python3 scripts/render.py /abs/path/to/fragment.html --serve   # 本机预览
```

模板：`assets/template.html` + `assets/template.css`（简化主题与工具类）。可直接写完整 HTML，不必强制走 render。

## 不要

- 独立 App / 新仓库 / 可部署站点当本技能交付物
- 仅静态 Mermaid（聊天代码块即可）
- 把普通表格做成 HTML
- LIVE / 云端微信、扫码授权、sidecar（那是 wechat-\* 技能）
- 公众号正文 HTML / 成稿排版（走 `wechat-article`，不要用交互页冒充可粘贴正文）
- Codex compaction 提示、`openai.yaml`、`plugin.json`、内联 visualize 特殊标记、`window.openai.*`
- 复制品牌 SVG / 专有宿主 UI 冒充 OpenBot 官方组件
- 为填版面发明 KPI 卡、装饰性色块、未请求的筛选/搜索

## 触发样例

- 「用一个弹簧质量块仿真帮我理解阻尼」
- 「把这两条转化漏斗对照成可点选的图」
- 「画个可拖参数的 what-if，不要长文」

## 完成标准

工作区有可读 HTML（或 PNG）；用户能打开/预览；回复说明交互要点且无工程交付混淆；未引入 Codex 专有标记。

## 参考

- `references/when-to-use.md` — 形态选择与否决清单
- `references/html-contract.md` — 标记、主题、CDN、无障碍
- `references/openbot-delivery.md` — 落盘与附件
- `ATTRIBUTION.md` — 来源与再分发注意
