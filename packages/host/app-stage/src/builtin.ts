/**
 * The factory preinstall (v0.0.5): a trimmed reference app materialized into
 * the install store on first boot of the resident row, so the desktop is
 * never empty — the user sees in thirty seconds what an installed app looks
 * like. Marked `publishedVia: 'builtin'` (labeled as a sample in the UI) and
 * fully uninstallable; re-preinstalls only while it is absent.
 * @module @ryanyujazz/dsh-app-stage/builtin
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readInstallPointer } from './store.ts'
import { commitSnapshot, hashSnapshot, writeInstallPointer } from './publish.ts'

/** The preinstalled sample app's id. */
export const BUILTIN_APP_ID = 'notes-sample'
/** The preinstalled sample app's version. */
export const BUILTIN_APP_VERSION = '0.1.0'

const MANIFEST = JSON.stringify({
  id: BUILTIN_APP_ID,
  platform: 'app-stage-v1',
  name: '便签示例',
  version: BUILTIN_APP_VERSION,
  description: '出厂预装的示例应用：一个最小便签，演示沙箱容器与数据桥。可随时卸载。',
  entry: 'index.html',
  dataVersion: '1',
  dev: false,
  actions: [],
  permissions: [],
}, null, 2)

/** CSP discipline: logic lives in an external same-directory script. */
const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>便签示例</title>
<style>
  body { margin: 0; font: 14px/1.6 system-ui, sans-serif; color: #1a1a1a; background: #fafafa; }
  header { padding: 16px 20px 8px; }
  h1 { font-size: 16px; margin: 0; }
  main { padding: 0 20px 20px; }
  ul { list-style: none; margin: 12px 0; padding: 0; display: grid; gap: 8px; }
  li { padding: 10px 12px; border: 1px solid #e3e3e3; border-radius: 8px; background: #fff; display: flex; justify-content: space-between; gap: 8px; }
  li.done span { text-decoration: line-through; color: #999; }
  button { border: 0; border-radius: 6px; padding: 6px 12px; font-size: 13px; cursor: pointer; background: #efefef; }
  button.primary { background: #0071e3; color: #fff; }
  .add { display: flex; gap: 8px; margin-top: 8px; }
  .add input { flex: 1; padding: 8px 10px; border: 1px solid #e3e3e3; border-radius: 6px; font: inherit; background: #fff; }
  .hint { color: #888; font-size: 12px; margin-top: 16px; }
</style>
</head>
<body>
<header><h1>便签示例</h1></header>
<main>
  <ul id="list"></ul>
  <div class="add">
    <input id="draft" placeholder="新便签…" aria-label="新便签">
    <button id="add" class="primary" type="button">添加</button>
  </div>
  <p class="hint">数据经舞台数据桥持久化：改动会同步到所有打开的实例，刷新后仍在。</p>
</main>
<script src="app.js"></script>
</body>
</html>
`

const APP_JS = `'use strict'
// Minimal reference client for the App Stage data bridge (protocol v1).
const send = (id, op, extra) => window.parent.postMessage({ __appStage: 1, id, op, ...extra }, '*')
let nextId = 1
const pending = new Map()
window.addEventListener('message', (event) => {
  const data = event.data
  if (data === null || typeof data !== 'object' || data.__appStage !== 1) return
  if (data.id !== undefined && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id) }
  if (data.op === 'data.event' && Array.isArray(data.changes)) render()
})
const call = (op, extra) => new Promise((resolve) => {
  const id = `+"`c${nextId++}`"+`
  pending.set(id, resolve)
  send(id, op, extra)
})

let notes = []
async function load() {
  const reply = await call('data.get', { path: 'notes' })
  notes = Array.isArray(reply.value) ? reply.value : []
  render()
}
function persist() { send(`+"`w${nextId++}`"+`, 'data.set', { path: 'notes', value: notes }) }

function render() {
  const list = document.getElementById('list')
  list.textContent = ''
  for (const [index, note] of notes.entries()) {
    const li = document.createElement('li')
    if (note.done) li.classList.add('done')
    const label = document.createElement('span')
    label.textContent = note.text
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.textContent = note.done ? '恢复' : '完成'
    toggle.addEventListener('click', () => { notes[index] = { ...note, done: !note.done }; persist(); render() })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '删除'
    remove.addEventListener('click', () => { notes.splice(index, 1); persist(); render() })
    li.append(label, toggle, remove)
    list.append(li)
  }
}

document.getElementById('add').addEventListener('click', () => {
  const draft = document.getElementById('draft')
  const text = draft.value.trim()
  if (text === '') return
  notes.push({ text, done: false })
  draft.value = ''
  persist(); render()
})
document.getElementById('draft').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('add').click()
})

send(`+"`s${nextId++}`"+`, 'data.subscribe', { path: 'notes' })
load().then(render)
`

/** Materialize the sample app's files into a staging directory. */
async function materializeBuiltin(stagingDir: string): Promise<void> {
  await mkdir(stagingDir, { recursive: true })
  await writeFile(join(stagingDir, 'app.json'), `${MANIFEST}\n`, 'utf8')
  await writeFile(join(stagingDir, 'index.html'), INDEX_HTML, 'utf8')
  await writeFile(join(stagingDir, 'app.js'), APP_JS, 'utf8')
}

/**
 * Preinstall the sample app if (and only if) it is not installed — including
 * after the user uninstalls it deliberately, which stays honored until the
 * pointer reappears by a later real publish of the same id.
 */
export async function preinstallBuiltin(home: string, stagingRoot: string): Promise<'installed' | 'already-present' | 'failed'> {
  const existing = await readInstallPointer(BUILTIN_APP_ID, home)
  if (existing !== undefined) return 'already-present'
  const stagingDir = join(stagingRoot, `builtin-${Date.now().toString(36)}`)
  try {
    await materializeBuiltin(stagingDir)
    await commitSnapshot(stagingDir, BUILTIN_APP_ID, BUILTIN_APP_VERSION, home)
    // Real snapshot digest, so the installed-entry integrity path stays
    // uniform between builtin and published apps.
    const { digest } = await hashSnapshot(join(home, 'deepcreator', 'apps', 'installed', BUILTIN_APP_ID, BUILTIN_APP_VERSION))
    await writeInstallPointer(BUILTIN_APP_ID, {
      version: BUILTIN_APP_VERSION, digest, installedAt: new Date().toISOString(),
      sourceWorkspace: 'DeepCreator', sourceFingerprint: 'builtin', sourceSession: '', publishedVia: 'builtin',
    }, home)
    return 'installed'
  } catch {
    return 'failed'
  }
}
