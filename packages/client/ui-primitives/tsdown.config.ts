import { clientBundle } from '../../../scripts/tsdown.client.ts'

/** CSS stubs are only used by the Node library; the client bundle injects the real styles. */
const cssStub = {
  name: 'deepcreator-css-stub',
  resolveId(source: string) {
    if (!source.endsWith('.css')) return null
    return `\0deepcreator-css-stub:${source}.mjs`
  },
  load(id: string) {
    if (!id.startsWith('\0deepcreator-css-stub:')) return null
    return 'export default {};'
  },
}

export default clientBundle(
  '@ryanyujazz/dsh-client-ui-primitives',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { lib: { platform: 'neutral', plugins: [cssStub] } },
)
