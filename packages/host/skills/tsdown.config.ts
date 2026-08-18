import type { UserConfig } from 'tsdown'

/** Build the bundled-skills Host package: plain ESM, no Typert surface. */
export default {
  name: '@ryanyujazz/dsh-skills',
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
} satisfies UserConfig
