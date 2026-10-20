# AcroForm 填写与核验

视觉通过不等于字段逻辑正确。页上 `/Widget` 外观可能有值，而 `/AcroForm/Fields` 缺失或陈旧。

## 原则

1. 默认保持可交互；仅当用户明确要求静态完成件时 `flatten=True`。
2. 保留源 PDF；未明确授权不要压平已签名 PDF。
3. 填写前同时枚举 `get_fields()` 与每页 `/Annots` 中的 Widget。
4. 同名但无父子关系的字段与 Widget：不要盲目 `reattach_fields()`；报告歧义或改出静态件。

## 填写模式（pypdf）

```python
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject

reader = PdfReader(input_pdf)
writer = PdfWriter()
writer.clone_document_from_reader(reader)
writer.reattach_fields()  # only for genuine orphan widgets
fields = writer.get_fields() or {}
missing = set(expected_values) - set(fields)
if missing:
    raise ValueError(f"Form fields not found after repair: {sorted(missing)}")

values_to_write = dict(expected_values)
if flatten:
    values_to_write = {
        name: field.get("/V", "/Off" if field.get("/FT") == "/Btn" else "")
        for name, field in fields.items()
    }
    values_to_write.update(expected_values)

writer.update_page_form_field_values(
    None, values_to_write, auto_regenerate=False, flatten=flatten
)
if flatten:
    writer.remove_annotations(subtypes="/Widget")
    writer.root_object.pop(NameObject("/AcroForm"), None)

with open(output_pdf, "wb") as stream:
    writer.write(stream)
```

## 交付前重开核验

- 可交互：期望字段有正确 `/V`；Widget 有效值一致；有非空 `/AP` `/N`；再渲 PNG。
- 已压平：零 Widget、无 AcroForm 字段树；再渲 PNG。用户可能还要改则另留可编辑副本。
