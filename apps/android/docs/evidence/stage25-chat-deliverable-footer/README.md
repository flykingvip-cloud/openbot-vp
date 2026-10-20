# Stage 2.5 — Chat deliverable footer / 「打开成果」 (evidence)

Locks (核查验收 Open MVP):

1. Declared `<<DELIVERABLE>>` envelope with `url=` http/https → Custom Tabs; other schemes → `ACTION_VIEW`.
2. `file=` only (no workspace open path) → 「打开成果」 **disabled** + `本地文件暂不可用` (no new gateway RPC).
3. Envelope with neither `file` nor `url` → **no** footer.
4. Single footer: left title/targetLabel, right 「打开成果」. No multi-chip / sidebar / deposit / badges / artifact library.
5. Offline `DEMO_DELIVERABLE` / `DEMO_DELIVERABLE_FILE` debug extras OK (disclosed below). Unit: envelope parse + gate rejects inferred. `assembleDebug` OK.

Do **not** touch: four-tab/#238 routing, #239 strip, #241 Knowledge destub, Tasks, Me.

| File | What it must show |
| --- | --- |
| `reference-target.png` | Full IMG_1711 product target (table + footer chrome). |
| `A-img1711-footer-crop.png` | Crop of deliverable footer area from IMG_1711 (title left + 「打开成果」 right). |
| `B-avd-table-footer.png` | AVD: assistant bubble with GFM table + footer title + 「打开成果」 (`DEMO_DELIVERABLE`). |
| `C-tap-open-url.png` | After tap 「打开成果」: Chrome/Custom Tabs opens `example.com` (url fixture). |
| `C-alt-disabled-file.png` | Supplemental: `file=` only → disabled CTA + `本地文件暂不可用` (`DEMO_DELIVERABLE_FILE`). |

## TODO

- [x] A — IMG_1711 footer crop
- [x] B — AVD table + footer (`DEMO_DELIVERABLE`)
- [x] C — tap open url (prefer) + disabled file alt
- [x] CAPTURE.md discloses DEMO extras
