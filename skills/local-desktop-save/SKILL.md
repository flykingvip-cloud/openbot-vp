---
name: local-desktop-save
description: "Save a deliverable onto the user's own computer Desktop (本机桌面, ~/Desktop, /Users/<name>/Desktop). Use when the user asks to save, export, or write a file to their Desktop or 桌面. Do not use the workspace write tool."
metadata: { "openclaw": { "emoji": "🖥️" } }
---

# Save to the local Desktop

The workspace `write` and `edit` tools stay inside the sandbox. A path such as `/Users/<name>/Desktop/...` is the user's own computer, and the right-pane cloud computer is not that Desktop.

1. Call `exec` with `host` set to `node`.
2. Use this command shape and no other shell:

```bash
cat > "$HOME/Desktop/<file-name>" <<'OB_DESKTOP'
<file contents>
OB_DESKTOP
```

The file name is one segment. Hidden names, nested folders, and extra commands are not this route. A short proof may use `printf 'text\n' > "$HOME/Desktop/<file-name>"`.

3. Wait for the in-chat Always Allow / Allow Once / Never card. Do not say the file was saved before the command succeeds.
4. A previous `local_file.list` or `local_file.read` of the Desktop does not approve this write.
