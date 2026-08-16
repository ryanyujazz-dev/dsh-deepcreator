# Client plugin instructions

This tree owns DeepCreator browser features and the compatibility/type packages they share.

- One feature is one Cordis Client package. Keep optional `contract`, `model-adapter`, `view-model`, and `view` layers inside that package.
- Host entry points register the browser bundle and invariants; browser assembly belongs in `src/client/apply.ts` or the package's equivalent single entry.
- Views are pure props consumers. Adapt official Runtime objects outside React views and keep business state in the official Runtime.
- Compose UI only through declared Slots. Register into an external Slot with `ctx.slots.inject()` and return every disposer.
- Use keyed Slots for open renderer sets such as tools and conversation nodes. A feature package may not add itself to another package's central switch.
- `dsh.client` `inject` edges are descriptive, not load ordering. `immediately: true` is reserved for infrastructure required before normal activation.
- UI stores contain drafts, selection, panel dimensions, tabs, and other presentation state only.
- Keep browser CSS in the owning feature or shared semantic tokens in `ui-theme`; controls shared by multiple domains belong in `ui-primitives`.
- Every package must typecheck, test, and emit the declared Host and browser artifacts. Verify disposal and remount behavior when changing registration code.
