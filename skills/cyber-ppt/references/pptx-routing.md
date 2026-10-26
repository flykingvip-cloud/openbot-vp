# pptx → cyber-ppt

`skills/pptx/` 为历史薄引擎（python-pptx）。OpenBot 规范咨询 PPT **一律走 cyber-ppt**。

- 用户说 PPT/PPTX/演示/咨询页：加载 **cyber-ppt**。
- 若只点到了 pptx 技能：立即改读 cyber-ppt，并告知以 cyber-ppt 为准。
- 不要把 pptx_engine.py 产出标为 CyberPPT 合格终版。

## 沙箱与引擎（Owner 红框纠偏）

- LIVE Path B：`tools.exec.host=sandbox`，gateway/沙箱**预期没有** pip / python-pptx。
- 正式终版引擎：`PptxGenJS`（cyber-ppt）。沙箱镜像含 nodejs/npm；缺 Node/PptxGenJS 才是真 blocker。
- 禁止：把「沙箱没有 python-pptx/pip」写成无法做 PPT；禁止再跑 `skills/pptx/scripts/pptx_engine.py` 冒充终版。
- PDF→PPT / 做成 PPT：命中后立刻走 cyber-ppt（`pptx` 仅为 alias-of）。
