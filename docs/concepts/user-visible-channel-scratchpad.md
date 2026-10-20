# User-visible channel: scratchpad strip

Delivery (`type:text`) must stay Layer C. Live thinking UI / `type:thinking` may remain.

## Layers

| Layer | Meaning                                              | User bubble |
| ----- | ---------------------------------------------------- | ----------- |
| A     | English CoT written as ordinary text                 | Strip       |
| B     | Tooling meta, sandbox prose, raw `/approve` protocol | Strip       |
| C     | Real answer                                          | Keep        |

## `/approve` — strip-because-card

The local approval UI already shows an approval **card** for `/approve <uuid> allow-once`.

- Do **not** leave the raw protocol fence/line in the delivery bubble.
- After peeling it, append the CTA `请批准下面这条命令` when the surrounding body is user-facing delivery (or when the body would otherwise be empty).
- This is intentional product copy aligned with the card — not Layer-B leakage.

## L10 — solid CJK delivery

When every paragraph looks like scratchpad, only keep a paragraph with **solid** Chinese delivery (≥ 8 CJK characters and no English scratchpad hints).

Incidental product nouns such as `微信` inside English CoT must **not** rescue that paragraph.

## Stream non-monotonic updates

After scratchpad strip, a shorter Chinese delivery must be allowed to replace a longer English buffer on both:

- UI `chatStream` (`controllers/chat.ts`)
- Gateway delta flush (`server-chat.ts` `flushBufferedChatDeltaIfNeeded` / `emitChatDelta`)

Simple truncations of the current stream are still rejected on the UI side.

## Thinking progress (process UI)

While delivery text is empty (DeepSeek / long scratchpad phase), the gateway may emit
`chat` events with `state: "thinking"` carrying a **safe structure + progress** snapshot
(`steps` / `percent` / Chinese `placeholder`).

- Process only — not persisted as history `type:text`, not Layer C delivery.
- Must not include raw English CoT / scratchpad in the bubble.
- When Chinese delivery arrives via `state: "delta"`, UI clears the progress panel and streams as usual.
- Shared control-ui component is used for 1:1 steward (大白) and collaboration surfaces; collab must also never dump bare CoT.
