# @ryanyujazz/dsh-presentation

UI- and resource-domain-independent DeepCreator presentation coordination. It owns `PresentationRuntime`, the `open_in_deepcreator` root-Agent tool, the resolver registry, client capability/claim fencing, receipts, deadlines, and dismissal tombstones.

Resource packages contribute resolver schemas and materializers. Client UI packages contribute presenters through `@ryanyujazz/dsh-client-presentation`; neither layer depends on Browser or Workbench.

Presentation is a staged acknowledgement, not a panel-open hint. Receipts distinguish panel render failures from native Surface mount rejection/timeout. A non-retryable failure is tombstoned by canonical input for the rest of the current Agent turn, preventing repeated panel churn and duplicate materialization.

Explicit Client UI actions can call the `open` Remote with a JSON-encoded resource input. Host runs that input through the same resolver, materialization, claim, deadline and receipt path as `open_in_deepcreator`, using a synthetic negative turn so the action remains available while the Agent is idle. This is a user gesture path, not a second presentation implementation; explicit destinations such as `browserId: "iab"` retain strict no-fallback semantics.
