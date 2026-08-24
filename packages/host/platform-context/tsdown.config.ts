import type { UserConfig } from 'tsdown'

/** Build the platform-context Host package: plain ESM, no Typert surface. */
export default {
  name: '@ryanyujazz/dsh-platform-context',
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
} satisfies UserConfig
