# 交付

产物写在当前工作区的 `output/office-suite/` 下，并按租户和用户分开：

- 企业用户：`tenant/<tenant>/user/<user>/`
- 个人用户：`individual/<user>/`

每次成功写入新的 blob 和任务记录。任务记录只有动作、状态、字节数和错误码，不写文档正文，也不写凭据。

下载和预览必须带当前会话身份。其他用户即使猜到文件编号也不能读取。

可选系统依赖：

- LibreOffice（`soffice`）与 Poppler（`pdftoppm`）：像素预览
- CJK 字体，例如 `fonts-droid-fallback` 或 `fonts-noto-cjk`：PDF 中文嵌入

没有这些依赖时，创建、编辑、公式和文本抽取仍然可用，像素预览标记为有限支持。
