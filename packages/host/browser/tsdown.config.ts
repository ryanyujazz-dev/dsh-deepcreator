import { defineConfig } from 'tsdown'
import { hostBundle } from '../../../scripts/tsdown.host.ts'

export default defineConfig([
  { entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false, external: [/^@deepseek-ai\//, /^@ryanyujazz\//] },
  hostBundle('@ryanyujazz/dsh-browser', ['lib/types/typert-entry.js']),
])
