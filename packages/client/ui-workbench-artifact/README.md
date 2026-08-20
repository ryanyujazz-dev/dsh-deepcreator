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
production time descending. DeepCreator disables the official duplicate
produced-files tail while the new Review change card owns the visible tail.
This projection publishes Turn location data only; the official
`ui-deliverables` client remains the single owner of closing-prose
`chatFileMentions` so the assembled browser never registers that service twice.

Instance content is read through the mounted `artifacts` remote namespace,
keyed on the active path: a re-read happens only when the active path changes
or the user refreshes. Every instance keeps a compact breadcrumb of that full
path above loading, error, and rendered content. Leading Unix/UNC slash markers
are omitted from the visual crumbs (the accessible label retains the exact
path); a narrow bar keeps the file-side tail visible and masks its clipped left
edge while the tab remains the short file identity. A fixed trailing folder
action opens the file's containing directory through the official Workspace
path opener, without competing with or scrolling away with the breadcrumb. A
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
`renderArtifact` owner prop). This package registers the `code` renderer: every
text artifact renders through the shared `CodeSurface` as the same full-file
row grid Review uses (a number gutter plus content, without Diff signs,
insert/delete backgrounds, or word marks). Paths that map to a registered
grammar (markdown included — a prose artifact is still a file) add Shiki
tokens over the `data-code-theme` chain; unknown extensions degrade only to
plain rows, never to a separate `<pre>` layout. The surface soft-wraps to the
panel width and paints no background. Markdown and MDX use the `document`
variant: no outer margin, a numbered gutter with a vertical divider, and
content padding only inside the text column.

The type entry icon carries a blue dot while the session has produced files
the user has not looked at yet: the dot advances the per-session seen
watermark only while the panel group is visible (hidden groups stay mounted,
so a hidden panel keeps its dot until opened).

Truncated-window semantics: a turn whose `turn/start` lives in an unloaded
older page stays invisible until that page loads — same semantics as every
other conversation projection; updates without a start are inert.
