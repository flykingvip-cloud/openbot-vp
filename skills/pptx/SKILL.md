---
name: pptx
description: >-
  当用户要做演示文稿 / PPT / PPTX / 咨询风幻灯片时务必使用本技能作为薄入口，并立即改走 cyber-ppt。
  遇到「做 PPT」「做 PPTX」「演示文稿」「幻灯片」「路演页」务必使用，然后加载 cyber-ppt 权威流程。
  本技能仅路由别名，不是平行 presentations 实现；不要用本目录旧 python-pptx 引擎冒充 CyberPPT 终版。
alias-of: cyber-ppt
triggers: pptx,ppt,演示文稿,幻灯片,路演,转成ppt,做成ppt,生成ppt,pdf转ppt,转ppt,做ppt,改成ppt
---

# pptx → cyber-ppt

**立即读取并遵循 `cyber-ppt`。**

本目录保留仅为兼容旧引用与触发词。正式咨询级密度、确认门、蓝图与混合还原一律以 `cyber-ppt` 为准。

- 用户意图是 PPT/PPTX/演示 → 加载 **cyber-ppt** 并按其三阶段流程执行。
- 若会话只点到了本技能：告知以 cyber-ppt 为准，然后改读该技能全文与 references。
- 不要把 `scripts/pptx_engine.py`（若 live 树仍残留）产出标为 CyberPPT 合格终版。
- 需要不依赖沙箱里的 PptxGenJS、并保留非目标页的文件级创建/编辑/预览时，调用 `office_file`（技能 `office-file-suite`）。咨询叙事仍以 cyber-ppt 为准。

详见 `../cyber-ppt/references/pptx-routing.md`（合并进 live tree 后为 `skills/cyber-ppt/references/pptx-routing.md`）。

## 沙箱说明

沙箱缺 `python-pptx` / pip **是预期**，不是无法做 PPT 的理由。立刻改走 `cyber-ppt` + PptxGenJS。不要安装或调用本目录旧 `scripts/pptx_engine.py` 作为终版。
