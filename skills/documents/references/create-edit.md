# Create / edit DOCX

## 默认工具：python-docx

用于段落/run、Title/Heading 样式、表格、简单页眉页脚与边距。

### 注意

- 页眉页脚里 `add_table` 要显式 width。
- 字体可同时设 `run.font.name` 与 `w:rFonts`（ascii/hAnsi）。
- 真·修订批注若 python-docx 不够，再考虑最小 OOXML 补丁；不要整包导入专有脚本树。

## 编辑原则

- 小改优先局部替换；保留原结构。
- 不要整篇划掉重写，除非用户明确要求新稿。
