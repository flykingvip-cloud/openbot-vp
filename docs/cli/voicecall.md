---
summary: "CLI reference for `openbot voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
title: "voicecall"
---

# `openbot voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
openbot voicecall status --call-id <id>
openbot voicecall call --to "+15555550123" --message "Hello" --mode notify
openbot voicecall continue --call-id <id> --message "Any questions?"
openbot voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
openbot voicecall expose --mode serve
openbot voicecall expose --mode funnel
openbot voicecall expose --mode off
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.
