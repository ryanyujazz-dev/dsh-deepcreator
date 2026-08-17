import { readFileSync } from 'node:fs'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const CLIENT_BUNDLE_PREFIX = 'window.__ModuleLoader__.load({'
const FACTORY_MARKER = 'factory: (require) => {'
const FACTORY_END = '\n\t}\n});'

/**
 * Adapt an installed Harness lazy-CJS browser bundle into an ESM test module.
 * Production executes these files through ClientModuleLoader; Vitest needs the
 * same factory exports presented through native imports without a source checkout.
 */
function harnessClientBundlePlugin() {
  return {
    name: 'deepcreator-installed-harness-client-bundles',
    enforce: 'pre' as const,
    load(id: string) {
      const file = id.split('?', 1)[0]!
      if (!file.includes('/node_modules/@deepseek-ai/') || !file.endsWith('/lib/client.js')) return
      const code = readFileSync(file, 'utf8')
      if (!code.startsWith(CLIENT_BUNDLE_PREFIX)) return
      return code.replace(/\n?\/\/# sourceMappingURL=client\.js\.map\s*$/u, '\n')
    },
    transform(code: string, id: string) {
      if (!id.includes('/node_modules/@deepseek-ai/') || !code.startsWith(CLIENT_BUNDLE_PREFIX)) return

      const factoryMarker = code.indexOf(FACTORY_MARKER)
      const factoryEnd = code.lastIndexOf(FACTORY_END)
      if (factoryMarker === -1 || factoryEnd === -1) {
        throw new Error(`Unsupported Harness client bundle wrapper: ${id}`)
      }
      const body = code.slice(factoryMarker + FACTORY_MARKER.length, factoryEnd)
      const dependencies = [...body.matchAll(/\brequire\("([^"]+)"\)/g)]
        .map(match => match[1]!)
        .filter((value, index, all) => all.indexOf(value) === index)
      const exportNames = [...body.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)]
        .map(match => match[1]!)
        .filter((value, index, all) => all.indexOf(value) === index)

      const imports = dependencies
        .map((dependency, index) => `import * as __dependency${String(index)} from ${JSON.stringify(dependency)};`)
        .join('\n')
      const moduleTable = dependencies
        .map((dependency, index) => `${JSON.stringify(dependency)}: __dependency${String(index)}`)
        .join(',\n')
      const exports = exportNames
        .map(name => `export const ${name} = __clientExports.${name};`)
        .join('\n')

      return {
        code: `${imports}
const __clientModules = {${moduleTable}};
const __clientExports = ((require) => {${body}
})((specifier) => {
  const dependency = __clientModules[specifier];
  if (dependency === undefined) throw new Error(\`Unknown Harness client dependency: \${specifier}\`);
  return dependency;
});
${exports}
`,
        map: null,
      }
    },
  }
}

export default defineConfig({
  plugins: [
    harnessClientBundlePlugin(),
    tsconfigPaths({ projects: ['./tsconfig.test.json'] }),
  ],
  test: {
    setupFiles: ['./scripts/test-setup.ts'],
    include: ['packages/client/*/tests/**/*.spec.{ts,tsx}', 'packages/host/*/tests/**/*.spec.ts', 'apps/*/tests/**/*.spec.ts'],
    server: {
      deps: {
        inline: [
          /\/node_modules\/@deepseek-ai\/dsh-client-/,
          /\/node_modules\/@deepseek-ai\/[^/]+\/lib\/client\.js$/,
        ],
      },
    },
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : [],
      },
    },
  },
})
