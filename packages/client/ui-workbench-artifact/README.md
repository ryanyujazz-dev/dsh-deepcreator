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
file's containing directory through the official Workspace path opener,
without competing with or scrolling away with the breadcrumb. A
missing or escaped path surfaces the reader's error code; there is no tombstone
state because the official fact never retracts.

Produced-file rows and instance loading states use the shared Material-backed
`FileIcon`/`FileLabel`. The Provider contributes both deduplicated basename
labels and `tabFilePaths`, so Artifact tabs carry the same file identity while
non-file Workbench tabs remain unaffected. Tabs opened directly from a
conversation Read row are included even when that path has never appeared in
the produced-file list; the same workspace reader renders their full content.

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
Code returns to the registered renderer's `document` CodeSurface (no outer
margin, numbered gutter with a vertical divider, and content padding inside
the text column). The selection is remembered independently per open file for
the panel's mounted lifetime; non-Markdown files do not show it.

The type entry icon carries a blue dot while the session has produced files
the user has not looked at yet: the dot advances the per-session seen
watermark only while the panel group is visible (hidden groups stay mounted,
so a hidden panel keeps its dot until opened).

Truncated-window semantics: a turn whose `turn/start` lives in an unloaded
older page stays invisible until that page loads — same semantics as every
other conversation projection; updates without a start are inert.
