# Workbench Artifact panel

Owns the `artifact` Workbench type and its panel. The list is a projection of
the **official produced-files fact** — files the model actually wrote or
edited — assembled from session events through the same conversation
event/view mechanism trajectory uses, never a plugin-owned copy or a pull.

The `workbench-artifact` node follows the official `ui-deliverables`
derivation exactly: `turn/start` starts a per-turn context, `tool/call` records
the call view, and an append-surface `tool/result` collects the paths a diff
card (or a generic `edit` card) produced — reads, deletes, failed results and
replacement surfaces contribute nothing. The `artifacts` snapshot builder folds
per-turn nodes into one record per path (latest production wins), sorted by
production time descending. The official `ui-deliverables` row remains
composed and owns closing-prose `chatFileMentions` and model guidance. This
package contributes a higher-priority renderer to its Turn-tail selector:
only the addressed Turn's produced paths appear in an expandable Artifact
card above the independent Review change card. Both use the shared
`ConversationFileCard` chrome; Artifact omits Undo, its View action opens the
Artifact home, and each file opens its full-file Artifact tab.

The home also contains a `Plans` list group above `Files`. It is deliberately
Session-scoped: a separate `plans` conversation projection reconstructs every
valid `exit_plan_mode` call in the current Session from its durable raw
arguments and paired result, retaining each revision with pending, approved,
or not-approved status. It neither scans sibling Sessions nor writes a
project-level index. A plan row opens a non-file Artifact tab whose body uses
the same read-only `MarkdownText` pipeline; no Host file read is involved.

Instance content is read through the mounted `artifacts` remote namespace,
keyed on the active path: a re-read happens only when the active path changes
or the user refreshes. Every instance keeps a compact breadcrumb of that full
path above loading, error, and rendered content. The panel owns a fixed-height
layout: the path bar never scrolls away, and only the content surface below it
scrolls on either axis. Leading Unix/UNC slash markers
are omitted from the visual crumbs (the accessible label retains the exact
path); a narrow bar keeps the file-side tail visible and masks its clipped left
edge while the tab remains the short file identity. A fixed trailing folder
action uses the shared DeepCreator Lottie on its unscaled open frame and opens the
file's containing directory through the official Workspace path opener on a
loopback desktop connection. Remote surfaces omit this native-path action,
without competing with or scrolling away with the breadcrumb. A
missing or escaped path surfaces the reader's error code; there is no tombstone
state because the official fact never retracts.

Every Artifact entry point resolves its instance id against the owning Session workspace before opening a tab. Home rows, conversation file links, Agent presentation, and restored legacy relative ids therefore converge on one absolute path identity. Existing relative/absolute duplicates are atomically merged without emitting a user-dismissal edge, so one file owns exactly one tab.

The read boundary returns a tagged presentation payload instead of decoding
every file as UTF-8. Images render directly inside the Artifact instance from
a fenced loopback URL, and PDFs stay in the same instance while Chromium's
embedded PDF renderer consumes byte-range responses from that URL. The PDF
iframe exclusively owns the content viewport and scrolling; the Artifact
wrapper adds no second scroll layer. DOCX files are converted to
structural HTML with Mammoth and rendered in a scriptless sandboxed iframe;
legacy DOC files use `word-extractor` and render their extracted body as a
readable document surface. None of these paths activates the Browser panel.
HTML/HTM remains the deliberate exception described below: its Turn-card row's
explicit Open action runs the page in Browser, while clicking the file body or
the Artifact home row still opens its source in Artifact.

Produced-file rows and instance loading states use the shared Material-backed
`FileIcon`/`FileLabel`. The Provider contributes both deduplicated basename
labels and `tabFilePaths`, so Artifact tabs carry the same file identity while
non-file Workbench tabs remain unaffected. Tabs opened directly from a
conversation Read row are included even when that path has never appeared in
the produced-file list; the same workspace reader renders their full content.

HTML and HTM stay ordinary entries in that same official produced-files list;
they do not gain a parallel artifact registry or event. Their per-Turn Artifact
card rows add a trailing split Open control whose transparent 28px primary action
shares the View action's 11px typography and hover treatment; Artifact home rows
remain ordinary full-row source entries. The primary action and “Open in DeepCreator” menu item
request a fenced loopback preview URL from `remote.artifacts.preview`,
then call the public Presentation Client with an explicit `browserId: "iab"`.
The Browser URL resolver therefore creates the exact built-in Browser tab and
the normal Workbench Browser Presenter owns visibility and mount receipt.
“Open in system browser” sends the real HTML path to the official Workspace/OS
path opener. Selecting the row outside that split control still opens the
read-only source artifact tab.
When the Agent proactively presents `{ kind: "artifact", workspacePath }`, the
Host applies the same exception during materialization: HTML/HTM becomes an
IAB `browser-tab`, while every other supported file remains an Artifact-panel
resource.
Remote surfaces keep that same source row and Artifact renderer but omit the
HTML split action entirely, because Browser and native OS path opening are not
part of the remote capability set.

Content rendering goes through the `deepcreator.workbench.artifact.renderer`
slot (declared by `ui-workbench`, consumed through the panel's
`renderArtifact` owner prop). This package registers the `code` renderer: text
artifacts render through the shared `CodeSurface` as the same full-file row
grid Review uses (a number gutter plus content, without Diff signs,
insert/delete backgrounds, or word marks). Paths that map to a registered
grammar add Shiki tokens over the `data-code-theme` chain; unknown extensions
degrade only to plain rows, never to a separate `<pre>` layout. The surface
soft-wraps to the panel width and paints no background.

Markdown and MDX instances add a compact icon-only `Preview | Code` segmented
control immediately before the fixed containing-folder action. Preview uses
the supplied eye glyph; Code uses the product `</>` glyph. Both options expose
localized hover/focus hints and accessible names. Preview is the default and
renders through the same shared `MarkdownText` pipeline as settled assistant
prose, including GFM, math, code fences, and the same untrusted-link policy.
Scheme-free image destinations such as `./images/chart.png` and reference-style
equivalents resolve from the open Markdown file's containing directory. The
panel reads each distinct path once through the fenced `artifacts.read`
boundary and supplies only an image-kind loopback HTTP URL to `MarkdownText`;
workspace escapes, absolute local paths, `file:` URLs, and non-image results
remain alt text, while authored HTTP(S) images continue to render directly.
The panel-wide scroll surface remains responsible for overflow, while the
preview document is centered at `width: 100%` with the shared
`--dsh-reading-content-width` maximum; narrow panels shrink naturally and the
scrollbar stays aligned to the panel edge.
Code returns to the registered renderer's `document` CodeSurface (no outer
margin, numbered gutter with a vertical divider, and content padding inside
the text column). The selection is remembered independently per open file for
the panel's mounted lifetime; non-Markdown files do not show it.

The type entry icon carries a blue dot while the session has produced files or submitted plans
the user has not looked at yet: the dot advances the per-session seen
watermark only while the panel group is visible (hidden groups stay mounted,
so a hidden panel keeps its dot until opened).

Binary outputs remain part of Review's repository truth for reconciliation and
Undo, but the conversation Turn change card omits binary rows. The same image,
PDF, or Office document therefore appears as a produced artifact rather than
being duplicated as a source-code change card entry.

Truncated-window semantics: a turn whose `turn/start` lives in an unloaded
older page stays invisible until that page loads — same semantics as every
other conversation projection; updates without a start are inert.
