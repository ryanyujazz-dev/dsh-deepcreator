import { defineConfig } from 'tsdown'
export default defineConfig({ entry: ['src/index.ts'], format: 'esm', outDir: 'lib', clean: false, dts: false, sourcemap: true, platform: 'node', target: 'es2024', fixedExtension: false, external: [/^@deepseek-ai\//, /^@ryanyujazz\//] })
