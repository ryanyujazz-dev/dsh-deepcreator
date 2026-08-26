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
  style.textContent = '.dsh-ripple{position:fixed;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid rgba(0,113,227,.55);animation:dsh-ripple 900ms ease-out forwards}@keyframes dsh-ripple{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(46)}}'
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
var seen = 0
var source = new EventSource('/deepcreator-app-stage/__dsh_presence__/events')
source.onopen = function () { root.dataset.dshPresence = 'live' }
source.onerror = function () { root.dataset.dshPresence = 'degraded' }
source.onmessage = function (message) {
  var event
  try { event = JSON.parse(message.data) } catch (error) { return }
  if (!event || typeof event.seq !== 'number' || event.seq <= seen) return
  seen = event.seq
  if (event.kind !== 'command' || event.payload === undefined || event.payload.phase !== 'start') return
  if (!app || event.appId !== app) return
  ripple()
}
})()
`
