'use strict'
/**
 * 看板演示 — App Stage 数据桥 (protocol v1) 最小接入。
 * 契约要点：宿主 CSP 为 default-src 'self'，脚本必须外链（本文件），
 * 内联 <script> 会被静默阻断；跨窗通信只经 parent.postMessage('*') +
 * 回包校验 __appStage/proto 字段，信任边界由宿主侧 source 检查保证。
 */
const pending = new Map()
let invokeSeen = new Set()
let board = [], docRev = 0

/** 发起一次桥请求；回复按 id 关联。 */
function send(op, extra) {
  return new Promise((resolve, reject) => {
    const id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()))
    pending.set(id, { resolve, reject })
    parent.postMessage(Object.assign({ __appStage: 1, id, op }, extra), '*')
  })
}

function render() {
  document.getElementById('list').innerHTML = ''
  for (const item of board) {
    const li = document.createElement('li')
    const span = document.createElement('span')
    span.textContent = item.title
    const del = document.createElement('button')
    del.textContent = '移除'
    del.onclick = () => { void write(board.filter(x => x !== item)) }
    li.append(span, del)
    document.getElementById('list').append(li)
  }
  document.getElementById('rev').textContent = docRev > 0 ? 'dataVersion rev ' + docRev : ''
}

async function write(next) {
  try { await send('data.set', { path: 'board.items', value: next }) } catch (e) { console.error(e) }
}

onmessage = e => {
  const m = e.data
  if (!m || m.__appStage !== 1) return
  // 协议 v2 下行：宿主转发 action.invoke（proto:2 同 id 回执，不进 pending）。
  if (m.op === 'action.invoke' && m.proto === 2) { void handleInvoke(m); return }
  if (!pending.has(m.id)) return
  const waiter = pending.get(m.id); pending.delete(m.id)
  waiter.resolve(m)
}

// ── 协议 v2：声明 action 的处理端（发布闸通道一验的就是这条注册）───────
async function handleInvoke(m) {
  const reply = { __appStage: 1, proto: 2, id: m.id, ok: false }
  // 协议护栏：同一 id 的派发只执行一次（重复投递直接幂等回执）。
  if (!invokeSeen) invokeSeen = new Set()
  if (invokeSeen.has(m.id)) { parent.postMessage(Object.assign(reply, { ok: true, result: { deduped: true } }), '*'); return }
  invokeSeen.add(m.id)
  try {
    if (m.action !== 'createTask') throw new Error('unknown action ' + m.action)
    const title = String((m.params || {}).title || '').trim()
    if (title === '') throw new Error('params.title 必填')
    const column = String((m.params || {}).column || 'todo')
    const card = { title, column, createdAt: new Date().toISOString() }
    const next = board.concat([card])
    const done = await send('data.set', { path: 'board.items', value: next })
    if (!done.ok) throw new Error(done.error || 'data.set failed')
    board = next
    render()
    parent.postMessage(Object.assign(reply, { ok: true, result: { created: card } }), '*')
  } catch (err) {
    console.error('invoke', err)
    parent.postMessage(Object.assign(reply, { error: { message: String(err.message || err) } }), '*')
  }
}

// 订阅推送：宿主 1500ms 轮询 journal 增量回推 data.event。
window.addEventListener('message', e => {
  const m = e.data
  if (!m || m.__appStage !== 1 || m.op !== 'data.event' || !Array.isArray(m.changes)) return
  for (const change of m.changes) {
    if (change.path === 'board.items') board = Array.isArray(change.value) ? change.value : []
    if (typeof change.rev === 'number') docRev = change.rev
  }
  render()
})

document.getElementById('form').onsubmit = event => {
  event.preventDefault()
  const input = document.getElementById('title')
  const title = input.value.trim()
  if (title === '') return
  input.value = ''
  board = board.concat([{ title }])
  render()
  void write(board)
}

// 启动：读初始文档，再订阅增量。
void (async () => {
  try {
    const got = await send('data.get', { path: 'board.items' })
    if (got.ok) { board = Array.isArray(got.value) ? got.value : []; docRev = got.rev || 0 }
    render()
    // path 声明订阅的 AppData 键（发布闸 channel 2 依据它核对；宿主只读 sinceRev）。
    await send('data.subscribe', { path: 'board', sinceRev: docRev })
    // 声明 action 的处理端注册（发布闸 channel 1 核对 manifest.actions 逐条已注册）。
    await send('action.register', { action: 'createTask' })
  } catch (e) { console.error('bridge', e) }
})()
