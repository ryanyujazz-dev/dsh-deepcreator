# @ryanyujazz/dsh-presentation

UI- and resource-domain-independent DeepCreator presentation coordination. It owns `PresentationRuntime`, the `open_in_deepcreator` root-Agent tool, the resolver registry, client capability/claim fencing, receipts, deadlines, and dismissal tombstones.

Resource packages contribute resolver schemas and materializers. Client UI packages contribute presenters through `@ryanyujazz/dsh-client-presentation`; neither layer depends on Browser or Workbench.

Presentation is a staged acknowledgement, not a panel-open hint. Receipts distinguish panel render failures from native Surface mount rejection/timeout. A non-retryable failure is tombstoned by canonical input for the rest of the current Agent turn, preventing repeated panel churn and duplicate materialization.
