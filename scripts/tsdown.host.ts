import type { UserConfig } from 'tsdown'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

/** Build one Host-only Cordis package and emit its generated Typert artifacts. */
export function hostBundle(id: string, entries: readonly string[] = ['lib/types/index.js']): UserConfig {
  return {
    name: id,
    entry: [...entries],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: [typertPlugin({ mode: 'package', faces: ['host'] })],
  }
}
