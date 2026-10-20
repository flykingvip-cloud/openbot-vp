# Thinking progress UX (process channel)

## Goal

During model thinking / scratchpad (e.g. DeepSeek long reasoning before Chinese delivery), show users a **structure outline + progress bar**, not a spinner-only wait and not raw English CoT.

## Channels

| Channel  | Event                                            | User sees                                           | Persist / history                        |
| -------- | ------------------------------------------------ | --------------------------------------------------- | ---------------------------------------- |
| Process  | `chat` `state: "thinking"` + `thinking` snapshot | Outline steps + progress / neutral「正在梳理思路…」 | No                                       |
| Delivery | `chat` `state: "delta"` message text             | Streaming Chinese answer                            | Final/history via existing chat-delivery |
| Final    | `chat` `state: "final"`                          | Settled delivery bubble                             | Yes (Layer C only)                       |

## Acceptance (通路)

1. Thinking phase: structure + progress only; ban English CoT/scratchpad in the user bubble.
2. Stream visible delivery only after Layer C text is ready; until structure is ready, use neutral Chinese placeholder.
3. `final` / history still go through chat-delivery; process layer must not pollute final.
4. Prefer 1:1 大白; shared component for collaboration must also ban bare CoT.
5. No LIVE cutover from this change set.

## Verify in UI

1. Open steward 1:1 (大白) against a DeepSeek/thinking-capable model.
2. Send a question that triggers a long think phase.
3. Expect outline + progress before any delivery text; then normal `chatStream` streaming.
4. Reload history: no thinking-progress panel left in transcript; only delivery text.
