import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const packageRoot = new URL('../', import.meta.url)
const ownPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const playwrightPackagePath = require.resolve('playwright-core/package.json')
const playwrightRoot = dirname(playwrightPackagePath)
const installed = JSON.parse(await readFile(playwrightPackagePath, 'utf8'))
if (ownPackage.dependencies['playwright-core'] !== installed.version) throw new Error(`playwright-core must be exactly pinned: package=${ownPackage.dependencies['playwright-core']} installed=${installed.version}`)
const typesPath = join(playwrightRoot, 'types', 'types.d.ts')
const source = ts.createSourceFile(typesPath, await readFile(typesPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const api = {}
function nameOf(member) { const name = member.name; if (!name) return undefined; if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text; return name.getText(source) }
function visit(node) {
  if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
    const name = node.name?.text
    if (name) api[name] = [...new Set(node.members.map(nameOf).filter(Boolean))].sort()
  }
  ts.forEachChild(node, visit)
}
visit(source)
for (const required of ['BrowserType', 'Browser', 'BrowserContext', 'Page', 'Frame', 'Locator', 'JSHandle', 'APIRequestContext', 'Download', 'Video', 'Tracing']) if (!api[required]) throw new Error(`Playwright API manifest is missing ${required}`)
if (Object.keys(api).length < 50 || api.Page.length < 40) throw new Error(`Playwright API manifest coverage is unexpectedly small (${Object.keys(api).length} types, ${api.Page.length} Page members).`)
const manifest = { playwrightVersion: installed.version, source: 'playwright-core/types/types.d.ts', generatedAtBuild: true, api }
if (process.argv.includes('--check')) process.stdout.write(`Playwright ${installed.version}: ${Object.keys(api).length} types, ${Object.values(api).reduce((sum, members) => sum + members.length, 0)} members\n`)
else { const output = fileURLToPath(new URL('../lib/playwright-api-manifest.json', import.meta.url)); await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`) }
