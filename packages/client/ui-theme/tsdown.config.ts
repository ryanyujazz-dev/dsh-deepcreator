import { clientBundle } from '../../../scripts/tsdown.client.ts'

export default clientBundle(
  '@ryanyujazz/dsh-client-ui-theme',
  ['lib/types/index.js'],
  {
    lib: {
      copy: [{ from: 'src/styles/*', to: 'lib/styles' }],
    },
  },
)
