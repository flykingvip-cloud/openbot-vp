# PPTX static preview and original-download repair

Task owner: codex-runtime-manager. This checkpoint responds to real user reports of text-only PPTX preview and unreadable downloaded decks. No production files were repaired or redeployed.

## Verified defects and root causes

1. `src/gateway/office-render.ts` originally extracted OOXML text into list cards, explicitly labelled non-original layout. It never rendered backgrounds, images, placement or charts. This was an implemented limitation, not evidence that the source PPTX itself was damaged.
2. `ui/src/ui/wiring/workspace-file-preview.ts:applyHtmlPreviewLane` created HTML preview/open blob URLs but did not establish an original-byte download URL. `ui/src/ui/views/artifact-sidebar.ts:resolveDownloadableHref` could fall back to that open URL, while its anchor used the workspace `.pptx` filename. Thus HTML could be downloaded under an Office filename. Two regression cases failed before the repair and pass afterward: original ZIP byte download and no fake Office download when original bytes are missing.
3. `ui/src/ui/wiring/deliverable-save.ts` could fall back to HTML/text when an Office preview lacked original bytes. Its missing-original-bytes regression failed before the change and passes afterward. Stale `fileBase64`/`dataUrl` and mutually exclusive preview metadata are now cleared when applying a new file response so a prior version cannot silently supply its bytes.

The generic defects are demonstrated. They do not establish that every reported unreadable file had this cause; malformed generation, old archived content, truncation and native compatibility remain independently possible.

## Repair and architectural boundary

- Original Office bytes now have a separate binary/download URL; HTML remains only a preview. Office header downloads reject HTML/open/preview fallbacks. Saving an Office artifact without retained original bytes refuses to turn preview text into its original file.
- Original `renderOfficePreviewHtml` remains the shared individual/group/knowledge integration. It delegates PPTX static rendering to a fixed local capability adapter; original byte payloads and editable slide text stay separate.
- `office-pptx-isolated.ts` invokes a fixed worker image via local Unix Docker socket, `--pull=never`, stdin bytes, no host mounts, no network, read-only root, dropped capabilities, no-new-privileges, CPU/memory/pid/tmpfs limits. Gateway secrets and Docker remote-context settings are not passed into the worker. Missing image/socket/capacity yields the existing clearly labelled text-only fallback.
- One conversion per Gateway process; identical in-flight bytes/pages share it, distinct concurrent work falls back rather than building an unbounded queue. This is not a cross-Gateway global scheduler. Failed conversion waits for bounded UUID-only container removal before releasing capacity; failed cleanup disables further conversion until restart and logs the condition.
- Inside that worker only, fixed local Impress→PDF→Poppler commands use an isolated temporary profile, macro disablement, shared 30-second native deadline, input/PDF/page/total-byte limits, PNG verification and expected original slide-count match. Temporary files are removed. No arbitrary configuration scripts or new task execution path.
- Static render retains layout, shapes, images and charts as page images. It does not provide animations, embedded media playback, editable objects in the preview image or a guarantee of exact PowerPoint font/layout equivalence. Existing text edit still updates the original PPTX package; its separate concurrent-edit CAS work remains DQ1.

## Local real-file evidence

- Source-tree fixture with 3 slides containing positioned colored shapes, a full-image slide and a chart: native isolated rendering returned all 3 page images; source SHA-256 unchanged. Image-only page visually inspected.
- Read-only production copy of the located Panda eight-page lecture: source ZIP/CRC, content types, presentation XML and 8 slide parts are valid. The repaired actual UI download-construction function produced exactly equal bytes/SHA-256. Feeding that downloaded file through the final actual isolated Gateway adapter rendered all 8 pages. Source file remained unchanged.
- User requested Panda outputs from November 3. Registry/owner mapping, Panda session indexes and that Shanghai-day PPTX-reference scan did not yield a uniquely corresponding new output. Located lecture files have October 17 modification dates, and other located decks are older. They were used as real-file compatibility evidence, not misrepresented as the specific November 3 failure. No user content or identifying storage paths are committed here; raw evidence stays in a private temporary directory.
- Production running build was read directly before investigation. No account state, transcript, original artifact, archive, container or renderer image was modified on production.

## Deployment prerequisite

Build the dedicated, reviewed renderer image on the same local daemon visible to Gateway:

```sh
docker build -f Dockerfile.pptx-renderer -t openbot-pptx-renderer:1 .
```

Gateway and Control UI must both contain this repair and deploy through the normal freshly fetched main/forward-only process. The renderer container receives no host path mounts, so it does not depend on mapping Gateway temporary paths to the daemon host. Production needs the existing local Docker-compatible socket/CLI access; a missing local capability does not trigger online package installation or remote content upload.

Local native proof used a dedicated image with the same fixed system packages and worker, built on a cached Node 22 Bookworm image. It does not prove that the new production image was built or deployed. Local host `soffice` was discovered to be a stale wrapper to a missing application; its existence alone was correctly rejected as render evidence.

## Baseline integration

Main advanced by PR #228 (unrelated enterprise-data masking). Existing local convergence commits were replayed onto the fresh main using rebase-merges after an exact file backup; all 12 then-current repair files restored byte-for-byte. Original history was preserved in local annotated `archive/runtime-convergence-pre-228-20261104` so earlier evidence SHAs remain reachable. No remote force push or production change occurred.

## Remaining acceptance limits

- No retrieved browser download from the exact November 3 incident; source-to-download identity is proven for the located existing eight-page original via the real UI construction function.
- No general aesthetic/source-truth validator is claimed; actual static rendering is a prerequisite for that later work.
- Rendering capacity is process-local; resource totals across multiple Gateway instances require deployment-level management. Browser object-URL lifecycle cleanup remains existing UI debt; this repair does not claim universal blob disposal.
