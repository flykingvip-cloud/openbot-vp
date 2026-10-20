# Verify / render

DOCX「保存成功」≠ 视觉正确。

## 推荐

```bash
# LibreOffice -> PDF -> PNG
OUTDIR=./qa-docx
INPUT=input.docx
BASENAME=$(basename "$INPUT" .docx)
LO_PROFILE=./.lo_profile_$$
mkdir -p "$OUTDIR" "$LO_PROFILE"
HOME="$LO_PROFILE" soffice --headless -env:UserInstallation=file://"$PWD/$LO_PROFILE"   --convert-to pdf --outdir "$OUTDIR" "$INPUT"
pdftoppm -png "$OUTDIR/$BASENAME.pdf" "$OUTDIR/$BASENAME"
```

## 成功标准

- 每页有 PNG；页数符合预期。
- 100% 缩放检查：无裁切/重叠/坏表/缺字/页眉错位。
- LibreOffice stderr 有时吓人但仍可能成功——以 PNG 为准。

## 局限

- 批注常不出现在 headless PDF：需结构检查。
- 域（页码/TOC）可能显示占位：关键交付可在 Word 更新域后再渲。
