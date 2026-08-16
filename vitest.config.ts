import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const repositoryRoot = dirname(fileURLToPath(import.meta.url))
const upstreamRoot = process.env.DEEPSEEK_HARNESS_SOURCE
  ?? resolve(repositoryRoot, '../deepseek-harness-upstream')
const upstream = join(upstreamRoot, 'tsconfig.base.json')
const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m
const rootRequire = createRequire(join(repositoryRoot, 'package.json'))

/** Resolve official Harness package imports to its clean source checkout. */
function harnessSourcePlugin() {
  const packages = new Map<string, string>()
  const packagesRoot = join(upstreamRoot, 'packages')
  for (const group of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const leaf of readdirSync(join(packagesRoot, group.name), { withFileTypes: true })) {
      if (!leaf.isDirectory()) continue
      const root = join(packagesRoot, group.name, leaf.name)
      const manifestPath = join(root, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
      if (manifest.name !== undefined) packages.set(manifest.name, root)
    }
  }
  const names = [...packages.keys()].sort((a, b) => b.length - a.length)
  return {
    name: 'deepcreator-harness-source',
    enforce: 'pre' as const,
    resolveId(source: string) {
      const name = names.find(candidate => source === candidate || source.startsWith(`${candidate}/`))
      if (name === undefined) return null
      const root = packages.get(name)!
      const subpath = source.slice(name.length)
      const candidates = subpath === ''
        ? [join(root, 'src/index.ts')]
        : subpath.startsWith('/src/')
          ? [join(root, subpath.slice(1))]
          : [
              join(root, 'src', `${subpath.slice(1)}.ts`),
              join(root, 'src', `${subpath.slice(1)}.tsx`),
              join(root, 'src', subpath.slice(1), 'index.ts'),
              join(root, 'src', subpath.slice(1), 'index.tsx'),
            ]
      return candidates.find(existsSync) ?? null
    },
  }
}

/** Resolve clean-checkout dependencies from this workspace's pnpm virtual store. */
function virtualDependencyPlugin() {
  const virtualStore = join(repositoryRoot, 'node_modules/.pnpm')
  const entries = readdirSync(virtualStore)
  const cache = new Map<string, string | null>()
  return {
    name: 'deepcreator-virtual-dependencies',
    enforce: 'pre' as const,
    resolveId(source: string, importer: string | undefined) {
      if (importer === undefined || !importer.startsWith(upstreamRoot)) return null
      if (source === 'vitest' || source.startsWith('@vitest/')) return null
      if (source.startsWith('.') || source.startsWith('/') || source.startsWith('\0') || source.startsWith('node:')) return null
      try {
        return rootRequire.resolve(source)
      } catch {
        // The source checkout is a sibling of this workspace, so pnpm's strict
        // dependency links are not in its ancestor chain. Resolve the same
        // installed dependency through its virtual-store package directory.
      }
      const parts = source.split('/')
      const packageName = source.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!
      let packageRoot = cache.get(packageName)
      if (packageRoot === undefined) {
        packageRoot = null
        for (const entry of entries) {
          const candidate = join(virtualStore, entry, 'node_modules', ...packageName.split('/'))
          if (!existsSync(join(candidate, 'package.json'))) continue
          packageRoot = candidate
          break
        }
        cache.set(packageName, packageRoot)
      }
      if (packageRoot === null) return null
      try {
        return createRequire(join(packageRoot, 'package.json')).resolve(source)
      } catch {
        return null
      }
    },
  }
}

/** Transform standard decorators before Vite parses official source modules. */
function standardDecoratorPlugin() {
  return {
    name: 'deepcreator-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return { code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'), map: result.sourceMapText }
    },
  }
}

export default defineConfig({
  plugins: [
    harnessSourcePlugin(),
    virtualDependencyPlugin(),
    tsconfigPaths({ projects: [upstream] }),
    tsconfigPaths({ projects: ['./tsconfig.test.json'] }),
    standardDecoratorPlugin(),
  ],
  test: {
    setupFiles: ['./scripts/test-setup.ts'],
    include: ['packages/client/*/tests/**/*.spec.{ts,tsx}', 'apps/*/tests/**/*.spec.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : [],
      },
    },
  },
})
