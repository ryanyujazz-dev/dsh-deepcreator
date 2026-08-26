/**
 * The injected presence runtime — the app-layer half of the Px-β channel.
 *
 * The static server splices this into every `text/html` app document (a
 * same-origin `defer` script; the sandbox CSP is not relaxed) and it does
 * exactly one thing: consume the one-way presence event stream and paint
 * what it authoritatively says. Invariants (presence doc §7):
 * - **Zero callable API.** No globals, no window hooks — an app cannot
 *   trigger, alter, or suppress presence visuals through any interface.
 * - **One-way data flow.** The EventSource only receives; the page can also
 *   connect and read, which grants nothing (the events are structured
 *   host-side facts).
 * - **Metadata honesty.** Without a known app binding the runtime keeps the
 *   channel state but paints nothing — absence of metadata never becomes a
 *   fabricated visual. Under prefers-reduced-motion the ripple is dropped
 *   entirely (explicit degradation, same labels).
 * - **Closed shadow root.** The overlay is unreachable from app styles and
 *   scripts; pointer-events stay none, so it can never intercept input.
 * @module @ryanyujazz/dsh-app-stage/presence-runtime
 */

/** The runtime source served at `/deepcreator-app-stage/__dsh_presence__.js`. */
export const PRESENCE_RUNTIME_JS = `;(function () {
'use strict'
var script = document.currentScript
var app = ''
if (script && script.dataset && typeof script.dataset.dshApp === 'string') app = script.dataset.dshApp
if (!app) {
  var parsed = location.pathname.match(/\\/installed\\/([^/]+)/)
  if (parsed) app = decodeURIComponent(parsed[1])
}
var root = document.documentElement
root.dataset.dshPresence = 'connecting'
if (typeof EventSource !== 'function') { root.dataset.dshPresence = 'unsupported'; return }
var reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }
var host = null
var shadow = null
function overlay() {
  if (host || reduce.matches) return
  host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;'
  shadow = host.attachShadow({ mode: 'closed' })
  var style = document.createElement('style')
  style.textContent = '.dsh-ripple{position:fixed;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid rgba(0,113,227,.55);animation:dsh-ripple 900ms ease-out forwards}@keyframes dsh-ripple{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(46)}}.dsh-ghost{position:fixed;left:50%;top:50%;transform:translate(-50%,-160%);display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none;font:500 13px/19px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:rgba(29,29,31,.72);opacity:.92}.dsh-ghost-label{font-size:11px;letter-spacing:.02em;color:rgba(0,113,227,.9);text-transform:uppercase}.dsh-ghost-text{max-width:44vw;padding:2px 10px;border-bottom:2px solid rgba(0,113,227,.6);background:rgba(255,255,255,.94);border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dsh-ghost.dsh-wait .dsh-ghost-text{border-bottom-style:dotted}.dsh-ghost.dsh-commit .dsh-ghost-text{animation:dsh-commit 450ms ease-out}@keyframes dsh-commit{0%{box-shadow:0 0 0 0 rgba(0,113,227,.4)}100%{box-shadow:0 0 0 16px rgba(0,113,227,0)}}.dsh-ghost.dsh-fail .dsh-ghost-text{border-bottom-color:rgba(211,49,49,.85);color:rgba(178,32,32,.95)}.dsh-cursor{position:fixed;left:12%;top:78%;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;border:2px solid rgba(0,113,227,.75);background:rgba(255,255,255,.85);box-shadow:0 0 0 3px rgba(0,113,227,.15);transition:left 320ms ease,top 320ms ease,opacity 300ms ease}'
  shadow.appendChild(style)
  root.appendChild(host)
}
function ripple() {
  if (reduce.matches) return
  overlay()
  if (!shadow) return
  var ring = document.createElement('div')
  ring.className = 'dsh-ripple'
  shadow.appendChild(ring)
  window.setTimeout(function () { ring.remove() }, 1000)
}

// ---- Co-visible ghost (presence §3.2/§3.3, X7 full form) ----
// Only rendered when the host itself marked the app co-visible (a live
// AppData subscription): the ghost's commit flash then matches a real
// broadcast landing in this viewport. Reduced motion drops the theatre
// entirely — the shell banner still tells the story.
var ghost = null
function ghostClear() {
  if (!ghost) return
  if (ghost.timer) window.clearInterval(ghost.timer)
  if (ghost.hold) window.clearTimeout(ghost.hold)
  var node = ghost.node
  if (node) window.setTimeout(function () { node.remove() }, 350)
  ghost = null
}
function ghostFade(node, delay) {
  node.style.transition = 'opacity 300ms ease'
  window.setTimeout(function () { node.style.opacity = '0' }, delay)
  window.setTimeout(function () { node.remove() }, delay + 400)
}
function ghostStart(payload) {
  if (reduce.matches) return
  var params = payload.params
  if (!params || !params.length || typeof params[0].value !== 'string') return
  var pair = params[0]
  ghostClear()
  overlay()
  if (!shadow) return
  var box = document.createElement('div')
  box.className = 'dsh-ghost'
  var label = document.createElement('div')
  label.className = 'dsh-ghost-label'
  label.textContent = payload.action || payload.commandKind || 'AI'
  var text = document.createElement('div')
  text.className = 'dsh-ghost-text'
  text.textContent = ''
  box.appendChild(label)
  box.appendChild(text)
  shadow.appendChild(box)
  // Synthetic cursor (target-oriented easing to center, no fabricated path).
  var cursor = document.createElement('div')
  cursor.className = 'dsh-cursor'
  shadow.appendChild(cursor)
  window.setTimeout(function () { cursor.style.left = '50%'; cursor.style.top = '50%' }, 30)
  var value = pair.value
  var pace = Math.max(30, Math.min(60, Math.round(2200 / Math.max(1, value.length))))
  var at = 0
  var state = { node: box, cursor: cursor, text: text, value: value, timer: null, hold: null, settled: false }
  state.timer = window.setInterval(function () {
    at += 1
    text.textContent = value.slice(0, at)
    if (at >= value.length) {
      window.clearInterval(state.timer)
      state.timer = null
      // typed → wait for the authoritative settle (explicit wait state ~3 s)
      if (!state.settled) state.hold = window.setTimeout(function () { if (ghost === state) state.node.classList.add('dsh-wait') }, 3000)
    }
  }, pace)
  ghost = state
}
function ghostSettle(payload) {
  if (!ghost) return
  var state = ghost
  state.settled = true
  if (state.timer) { window.clearInterval(state.timer); state.timer = null }
  state.text.textContent = state.value
  state.node.classList.remove('dsh-wait')
  if (payload.outcome === 'ok') {
    state.node.classList.add('dsh-commit')
    ghostFade(state.node, 700)
  } else {
    state.node.classList.add('dsh-fail')
    ghostFade(state.node, 1400)
  }
  if (state.cursor) {
    state.cursor.style.opacity = '0'
    window.setTimeout(function () { state.cursor.remove() }, 400)
  }
  ghost = null
}
var seen = 0
var source = new EventSource('/deepcreator-app-stage/__dsh_presence__/events')
source.onopen = function () { root.dataset.dshPresence = 'live' }
source.onerror = function () { root.dataset.dshPresence = 'degraded' }
source.onmessage = function (message) {
  var event
  try { event = JSON.parse(message.data) } catch (error) { return }
  if (!event || typeof event.seq !== 'number' || event.seq <= seen) return
  seen = event.seq
  if (event.kind !== 'command' || event.payload === undefined) return
  if (!app || event.appId !== app) return
  if (event.payload.phase === 'start') {
    ripple()
    ghostStart(event.payload)
  } else if (event.payload.phase === 'settled') {
    ghostSettle(event.payload)
  }
}
})()
`
