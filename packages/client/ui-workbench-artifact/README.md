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
production time descending, so the panel shows the same files the conversation
turn-tail lists.

Instance content is read through the mounted `artifacts` remote namespace,
keyed on the active path: a re-read happens only when the active path changes
or the user refreshes. A missing or escaped path surfaces the reader's error
code; there is no tombstone state because the official fact never retracts.

Content rendering goes through the `deepcreator.workbench.artifact.renderer`
slot (declared by `ui-workbench`, consumed through the panel's
`renderArtifact` owner prop). This package registers the `code` renderer: a
path whose extension maps to a registered grammar (markdown included — a
prose artifact is still a file) renders through the shared `CodeSurface`
(line-numbered gutter, Shiki tokens over the `data-code-theme` chain, soft
wrap to the panel width, no painted background). Markdown and MDX use the
`document` surface variant: no outer margin, a numbered gutter with a vertical
divider, and content padding only inside the text column. Anything else keeps
the panel's built-in plain `<pre>` fallback verbatim.

The type entry icon carries a blue dot while the session has produced files
the user has not looked at yet: the dot advances the per-session seen
watermark only while the panel group is visible (hidden groups stay mounted,
so a hidden panel keeps its dot until opened).

Truncated-window semantics: a turn whose `turn/start` lives in an unloaded
older page stays invisible until that page loads — same semantics as every
other conversation projection; updates without a start are inert.
