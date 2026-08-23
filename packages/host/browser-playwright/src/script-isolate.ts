import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { transform } from 'esbuild'
import { getQuickJS, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten'
import * as playwright from 'playwright-core'
import { BrowserRuntimeError, sanitizeBrowserModelValue, resolveWorkspaceUpload, type BrowserSignalInput } from '@ryanyujazz/dsh-browser'

export type PlaywrightScriptMode = 'controlled' | 'trusted'
export interface PlaywrightScriptArtifact { artifactId: string; kind: string }
export interface PlaywrightScriptLog { level: string; text: string }
export interface PlaywrightScriptResult { value: unknown; artifacts: PlaywrightScriptArtifact[]; logs: PlaywrightScriptLog[]; warnings: string[] }
export interface PlaywrightScriptEnvironment {
  engine?: 'chromium' | 'firefox' | 'webkit'
  browser?: unknown
  context?: unknown
  page?: unknown
  workspaceRoot: string
  observe?(value: unknown, invocation: { type: string; method: string }): Promise<void>
}
export interface PlaywrightScriptPolicy {
  mode: PlaywrightScriptMode
  beforeCall(type: string, method: string, args: unknown[]): Promise<void>
}

type Wire = null | boolean | number | string | Wire[] | { [key: string]: Wire }
interface HandleEntry { id: string; type: string; value: object }

const OPAQUE_METHODS = new Set(['evaluate', 'evaluateHandle', 'addInitScript', 'newCDPSession', 'connect', 'connectOverCDP', 'launchServer'])
const SECRET_METHODS = new Set(['cookies', 'storageState', 'headers', 'allHeaders', 'headersArray', 'headerValue', 'headerValues', 'postData', 'postDataBuffer', 'postDataJSON'])
const PATH_DISCLOSURE_METHODS = new Set(['path', 'pathAfterFinished', 'executablePath'])
const UNSAFE_REFLECTION = new Set(['constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments', 'call', 'apply', 'bind'])

function sanitizePlaywrightSecret(method: string, args: unknown[], result: unknown): unknown {
  if (method === 'cookies' && Array.isArray(result)) return result.map(cookie => {
    if (cookie === null || typeof cookie !== 'object') return '[REDACTED]'
    const { value: _value, ...metadata } = cookie as Record<string, unknown>
    return { ...metadata, value: '[REDACTED]' }
  })
  if (method === 'storageState' && result !== null && typeof result === 'object') {
    const state = result as { cookies?: unknown[]; origins?: Array<{ origin?: unknown; localStorage?: Array<{ name?: unknown }> }> }
    return {
      cookies: sanitizePlaywrightSecret('cookies', [], state.cookies ?? []),
      origins: (state.origins ?? []).map(origin => ({ origin: origin.origin, localStorageKeys: (origin.localStorage ?? []).map(item => item.name).filter(name => typeof name === 'string') })),
    }
  }
  if ((method === 'headersArray') && Array.isArray(result)) return result.map(header => {
    if (header === null || typeof header !== 'object') return header
    const value = header as { name?: unknown; value?: unknown }
    return /^(?:authorization|proxy-authorization|cookie|set-cookie)$/i.test(String(value.name ?? '')) ? { ...value, value: '[REDACTED]' } : value
  })
  if ((method === 'headerValue' || method === 'headerValues') && /^(?:authorization|proxy-authorization|cookie|set-cookie)$/i.test(String(args[0] ?? ''))) return '[REDACTED]'
  if (method === 'postData' || method === 'postDataBuffer' || method === 'postDataJSON') return '[REDACTED]'
  return sanitizeBrowserModelValue(result)
}

const BOOTSTRAP = String.raw`
(() => {
  const HANDLE = Symbol('playwrightHandle');
  const BLOCKED_MEMBERS = new Set(['constructor','prototype','__proto__','caller','callee','arguments','call','apply','bind']);
  const assertSafeMember = prop => {
    const member=String(prop);
    if(member.startsWith('_')||BLOCKED_MEMBERS.has(member))throw new Error('Playwright reflection property '+member+' is blocked.');
    return member;
  };
  const callbacks = new Map(); let nextCallback = 1;
  const encode = (value, functionSource=false) => {
    if (value === undefined) return {$undefined:true};
    if (typeof value === 'bigint') return {$bigint:String(value)};
    if (typeof value === 'function') { if(functionSource)return {$functionSource:String(value)}; const id=nextCallback++; callbacks.set(id,value); return {$callback:id}; }
    if (value instanceof RegExp) return {$regexp:value.source,$flags:value.flags};
    if (value instanceof ArrayBuffer) return {$bytes:[...new Uint8Array(value)]};
    if (ArrayBuffer.isView(value)) return {$bytes:[...new Uint8Array(value.buffer,value.byteOffset,value.byteLength)]};
    if (value && value[HANDLE]) return {$handle:value[HANDLE]};
    if (Array.isArray(value)) return value.map(item=>encode(item,functionSource));
    if (value && typeof value === 'object') { const out={}; for (const [k,v] of Object.entries(value)) out[k]=encode(v,functionSource); return out; }
    return value;
  };
  const parse = raw => decode(JSON.parse(raw));
  const chain = promise => new Proxy(function(){}, {
    get(_target, prop) {
      if (prop==='then') return promise.then.bind(promise);
      if (prop==='catch') return promise.catch.bind(promise);
      if (prop==='finally') return promise.finally.bind(promise);
      if (prop===Symbol.toStringTag) return 'Promise';
      const name=assertSafeMember(prop);
      return (...args) => chain(promise.then(value => { const member=value?.[name]; if(typeof member!=='function')throw new TypeError(name+' is not a function'); return Reflect.apply(member,value,args); }));
    }
  });
  const invoke = (id,method,args) => { const source=/^(evaluate|evaluateHandle|\$eval|\$\$eval|evaluateAll|waitForFunction|addInitScript)$/.test(method); const raw=__pwCall(JSON.stringify({id,method,args:encode(args,source)})); return raw && typeof raw.then==='function' ? chain(raw.then(parse)) : parse(raw); };
  const make = (id,type) => new Proxy(function(){}, {
    get(_target, prop) {
      if (prop===HANDLE) return id;
      if (prop==='then') return undefined;
      if (prop==='toString') return () => '[Playwright '+type+' '+id+']';
      const name=assertSafeMember(prop);
      const member=JSON.parse(__pwGet(JSON.stringify({id,property:name})));
      if (member && member.$method) return (...args) => invoke(id,String(prop),args);
      return decode(member);
    },
    set(){ throw new Error('Playwright proxy properties are read-only'); }
  });
  const decode = value => {
    if (value && value.$handle) return make(value.$handle,value.$type||'Object');
    if (value && value.$undefined) return undefined;
    if (value && value.$bigint) return BigInt(value.$bigint);
    if (value && value.$regexp) return new RegExp(value.$regexp,value.$flags||'');
    if (value && value.$bytes) return new Uint8Array(value.$bytes);
    if (value && value.$blocked) throw new Error(value.$blocked);
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value==='object') { const out={}; for (const [k,v] of Object.entries(value)) out[k]=decode(v); return out; }
    return value;
  };
  globalThis.__pwRoot = raw => parse(raw);
  globalThis.__pwInvokeCallback = (id,argsRaw) => callbacks.get(id)(...parse(argsRaw));
  globalThis.__pwEncodeResult = value => JSON.stringify(encode(value));
})();`

export class PlaywrightScriptIsolate {
  readonly #handles = new Map<string, HandleEntry>()
  readonly #objects = new WeakMap<object, string>()
  readonly #objectTypes = new WeakMap<object, string>()
  readonly #artifacts: PlaywrightScriptArtifact[] = []
  readonly #logs: PlaywrightScriptLog[] = []
  readonly #warnings: string[] = []
  readonly #pathTokens = new Map<string, { path: string; role: 'input' | 'output' | 'output-directory' }>()
  readonly #pendingHostCalls = new Set<Promise<void>>()
  #vm: QuickJSContext | undefined

  constructor(private readonly environment: PlaywrightScriptEnvironment, private readonly policy: PlaywrightScriptPolicy) {}

  async run(code: string, timeoutMs: number, signal: BrowserSignalInput): Promise<PlaywrightScriptResult> {
    const QuickJS = await getQuickJS(); const vm = QuickJS.newContext(); this.#vm = vm
    vm.runtime.setMemoryLimit(128 * 1024 * 1024)
    const deadline = Date.now() + timeoutMs
    vm.runtime.setInterruptHandler(() => signal.aborted || Date.now() > deadline)
    try {
      this.#installHostFunctions(vm)
      vm.unwrapResult(vm.evalCode(BOOTSTRAP)).dispose()
      const playwrightApi = { chromium: playwright.chromium, firefox: playwright.firefox, webkit: playwright.webkit, devices: playwright.devices, selectors: playwright.selectors, request: playwright.request, errors: playwright.errors }
      const root = {
        playwright: playwrightApi,
        ...(this.environment.browser === undefined ? {} : { browser: this.environment.browser }),
        ...(this.environment.context === undefined ? {} : { context: this.environment.context }),
        ...(this.environment.page === undefined ? {} : { page: this.environment.page }),
        workspace: { file: async (path: string) => this.#workspaceFile(path) },
        artifacts: { output: (kind: string, extension?: string) => this.#artifactOutput(kind, extension), directory: (kind: string) => this.#artifactDirectory(kind), list: () => [...this.#artifacts] },
      }
      if (this.environment.engine !== undefined) for (const value of [this.environment.browser, this.environment.context, this.environment.page]) this.#tag(value, this.environment.engine)
      const rootWire = this.#encode(root)
      const rootJson = vm.newString(JSON.stringify(rootWire)); vm.setProp(vm.global, '__pwRootData', rootJson); rootJson.dispose()
      const transpiled = await this.#transpile(code)
      const evaluated = vm.evalCode(`(async()=>{const __env=__pwRoot(__pwRootData);const __user=(${transpiled});if(typeof __user!=='function')throw new TypeError('playwright_run code must evaluate to a function');return await __user(__env)})()`)
      const promise = vm.unwrapResult(evaluated)
      // Drive synchronous async-function completion/rejection before awaiting the
      // native bridge. Later host promises schedule this again when they settle.
      vm.runtime.executePendingJobs()
      const initialState = vm.getPromiseState(promise)
      const resolved = initialState.type === 'pending'
        ? await Promise.race([
            vm.resolvePromise(promise),
            new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new BrowserRuntimeError('TIMEOUT', `Playwright script exceeded ${timeoutMs}ms.`)), timeoutMs); timer.unref?.() }),
          ])
        : initialState.type === 'fulfilled'
          ? { value: initialState.value }
          : { error: initialState.error }
      promise.dispose()
      if (resolved.error !== undefined) {
        const dumped = vm.dump(resolved.error) as { message?: unknown } | string
        resolved.error.dispose()
        const message = typeof dumped === 'string' ? dumped : typeof dumped?.message === 'string' ? dumped.message : JSON.stringify(dumped)
        const match = /^(PLAYWRIGHT_COMPILE_ERROR|PLAYWRIGHT_RUNTIME_ERROR|PLAYWRIGHT_POLICY_BLOCKED|APPROVAL_DENIED|NAVIGATION_BLOCKED):\s*(.*)$/s.exec(message)
        if (match !== null) throw new BrowserRuntimeError(match[1] as 'PLAYWRIGHT_RUNTIME_ERROR', match[2] ?? message)
        throw new BrowserRuntimeError('PLAYWRIGHT_RUNTIME_ERROR', message)
      }
      const handle = resolved.value
      if (handle === undefined) throw new BrowserRuntimeError('PLAYWRIGHT_RUNTIME_ERROR', 'QuickJS returned neither a value nor an error.')
      const encoder = vm.getProp(vm.global, '__pwEncodeResult')
      const encodedResult = vm.callFunction(encoder, vm.undefined, handle)
      encoder.dispose(); handle.dispose()
      const encodedHandle = vm.unwrapResult(encodedResult); const value = this.#decodeResult(JSON.parse(vm.getString(encodedHandle)) as Wire); encodedHandle.dispose()
      return { value: sanitizeBrowserModelValue(value), artifacts: [...this.#artifacts], logs: [...this.#logs], warnings: [...this.#warnings] }
    } catch (error) {
      if (error instanceof BrowserRuntimeError) throw error
      throw new BrowserRuntimeError('PLAYWRIGHT_RUNTIME_ERROR', error instanceof Error ? error.message : String(error))
    } finally {
      await this.#drainHostCalls(deadline).catch(() => undefined)
      this.#vm = undefined
      vm.runtime.executePendingJobs()
      vm.dispose()
    }
  }

  #installHostFunctions(vm: QuickJSContext): void {
    const get = vm.newFunction('__pwGet', request => {
      const parsed = JSON.parse(vm.getString(request)) as { id: string; property: string }
      const entry = this.#required(parsed.id)
      if (parsed.property.startsWith('_') || UNSAFE_REFLECTION.has(parsed.property)) return vm.newString(JSON.stringify({ $blocked: `Playwright reflection property ${parsed.property} is blocked.` }))
      const value = Reflect.get(entry.value, parsed.property)
      return vm.newString(JSON.stringify(typeof value === 'function' ? { $method: true } : this.#encode(value)))
    })
    const call = vm.newFunction('__pwCall', request => {
      const parsed = JSON.parse(vm.getString(request)) as { id: string; method: string; args: Wire }
      const deferred = vm.newPromise()
      const hostCall = this.#invoke(parsed.id, parsed.method, parsed.args).then(
        value => { const handle = vm.newString(JSON.stringify(this.#encode(value))); deferred.resolve(handle); handle.dispose() },
        error => { const code = error instanceof BrowserRuntimeError ? `${error.code}: ` : ''; const handle = vm.newError(`${code}${error instanceof Error ? error.message : String(error)}`); deferred.reject(handle); handle.dispose() },
      ).then(() => deferred.settled).then(() => { vm.runtime.executePendingJobs() })
      let tracked: Promise<void>
      tracked = hostCall.catch(() => undefined).finally(() => this.#pendingHostCalls.delete(tracked))
      this.#pendingHostCalls.add(tracked)
      return deferred.handle
    })
    const consoleObject = vm.newObject()
    const consoleHandles: QuickJSHandle[] = []
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      const fn = vm.newFunction(level, (...args) => { this.#logs.push({ level, text: args.map(value => String(vm.dump(value))).join(' ') }); return vm.undefined })
      consoleHandles.push(fn); vm.setProp(consoleObject, level, fn)
    }
    vm.setProp(vm.global, '__pwGet', get); vm.setProp(vm.global, '__pwCall', call); vm.setProp(vm.global, 'console', consoleObject)
    get.dispose(); call.dispose(); consoleObject.dispose(); for (const handle of consoleHandles) handle.dispose()
  }

  async #invoke(id: string, method: string, argsWire: Wire): Promise<unknown> {
    const entry = this.#required(id)
    if (method.startsWith('_') || UNSAFE_REFLECTION.has(method) || entry.type === 'Function') throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', `Playwright reflective invocation ${entry.type}.${method} is blocked.`)
    if (PATH_DISCLOSURE_METHODS.has(method)) throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', `${entry.type}.${method} would expose an internal executable or filesystem path; use workspace.file() or artifacts.output().`)
    if (this.policy.mode === 'controlled' && OPAQUE_METHODS.has(method)) throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', `${entry.type}.${method} requires trusted mode.`)
    if (method === 'launch' && this.policy.mode !== 'trusted') throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', 'BrowserType.launch requires trusted mode; use the managed target in controlled mode.')
    const args = this.#decodeArgs(argsWire, entry.type) as unknown[]
    if (method === 'launch' && typeof args[0] === 'object' && args[0] !== null && 'executablePath' in (args[0] as object)) throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', 'Custom executablePath is not available to playwright_run.')
    this.#brokerPaths(method, args)
    const targetUrl = this.#targetUrl(entry)
    await this.policy.beforeCall(entry.type, method, targetUrl === undefined ? args : [...args, { url: targetUrl }])
    const candidate = Reflect.get(entry.value, method)
    if (typeof candidate !== 'function') throw new BrowserRuntimeError('PLAYWRIGHT_RUNTIME_ERROR', `${entry.type}.${method} is not callable.`)
    const result = await this.#invokePlaywright(entry, method, candidate, args)
    const engine = /\((chromium|firefox|webkit)\)$/.exec(entry.type)?.[1]
    if (engine !== undefined) this.#tag(result, engine)
    await this.environment.observe?.(result, { type: entry.type, method })
    if (SECRET_METHODS.has(method)) return sanitizePlaywrightSecret(method, args, result)
    if (method === 'content' && typeof result === 'string') return result.replace(/(<input\b[^>]*(?:type=["']?password|autocomplete=["']?(?:one-time-code|cc-[^\s>"']+))[^>]*\bvalue=)(["'])[^"']*\2/gi, '$1$2[REDACTED]$2')
    return result
  }

  #encode(value: unknown): Wire {
    if (value === undefined) return { $undefined: true }
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value
    if (typeof value === 'bigint') return { $bigint: String(value) }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return this.#writeArtifact(Buffer.from(value), 'binary')
    if (value instanceof RegExp) return { $regexp: value.source, $flags: value.flags }
    if (Array.isArray(value)) return value.map(item => this.#encode(item))
    if (typeof value === 'function') return this.#handle(value as object, 'Function')
    if (typeof value === 'object') {
      const prototype = Object.getPrototypeOf(value)
      const entries = Object.entries(value)
      if ((prototype === Object.prototype || prototype === null) && !entries.some(([, item]) => typeof item === 'function')) { const output: Record<string, Wire> = {}; for (const [key, item] of entries) output[key] = this.#encode(item); return output }
      const browserType = value === playwright.chromium ? 'BrowserType(chromium)' : value === playwright.firefox ? 'BrowserType(firefox)' : value === playwright.webkit ? 'BrowserType(webkit)' : undefined
      return this.#handle(value, browserType ?? this.#objectTypes.get(value) ?? value.constructor?.name ?? 'Object')
    }
    return String(value)
  }

  #handle(value: object, type: string): Wire {
    let id = this.#objects.get(value)
    if (id === undefined) { id = `pw-${randomUUID()}`; this.#objects.set(value, id); this.#handles.set(id, { id, type, value }) }
    return { $handle: id, $type: this.#handles.get(id)?.type ?? type }
  }
  #required(id: string): HandleEntry { const entry = this.#handles.get(id); if (entry === undefined) throw new BrowserRuntimeError('PLAYWRIGHT_RUNTIME_ERROR', `Playwright handle ${id} is stale.`); return entry }

  #targetUrl(entry: HandleEntry): string | undefined {
    if (!/(?:^|\()(?:Route|Request|Response|WebSocket|Page|Frame)(?:\(|$)/.test(entry.type)) return undefined
    try {
      const routeRequest = Reflect.get(entry.value, 'request')
      const target = typeof routeRequest === 'function' ? Reflect.apply(routeRequest, entry.value, []) : entry.value
      const url = target === null || (typeof target !== 'object' && typeof target !== 'function') ? undefined : Reflect.get(target, 'url')
      const value = typeof url === 'function' ? Reflect.apply(url, target, []) : url
      return typeof value === 'string' ? value : undefined
    } catch { return undefined }
  }

  #decodeArgs(value: Wire, lineage?: string): unknown {
    if (Array.isArray(value)) return value.map(item => this.#decodeArgs(item, lineage))
    if (value === null || typeof value !== 'object') return value
    if ('$undefined' in value) return undefined
    if ('$bigint' in value) return BigInt(String(value.$bigint))
    if ('$regexp' in value) return new RegExp(String(value.$regexp), typeof value.$flags === 'string' ? value.$flags : '')
    if ('$bytes' in value && Array.isArray(value.$bytes)) return Buffer.from(value.$bytes.map(item => Number(item)))
    if ('$handle' in value) return this.#required(String(value.$handle)).value
    if ('$functionSource' in value) return { __dshFunctionSource: String(value.$functionSource) }
    if ('$callback' in value) { const callbackId = Number(value.$callback); return (...args: unknown[]) => { const engine = lineage === undefined ? undefined : /\((chromium|firefox|webkit)\)$/.exec(lineage)?.[1]; if (engine !== undefined) this.#tag(args, engine); return Promise.resolve(this.environment.observe?.(args, { type: lineage ?? 'Callback', method: 'callback' })).then(() => this.#invokeCallback(callbackId, args)) } }
    const output: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value)) output[key] = this.#decodeArgs(item, lineage); return output
  }
  #decodeResult(value: Wire): unknown { if (Array.isArray(value)) return value.map(item => this.#decodeResult(item)); if (value === null || typeof value !== 'object') return value; if ('$undefined' in value) return undefined; if ('$bigint' in value) return String(value.$bigint); if ('$handle' in value) return { handle: String(value.$handle), type: String(value.$type ?? 'Object') }; const output: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value)) output[key] = this.#decodeResult(item); return output }

  async #invokeCallback(id: number, args: unknown[]): Promise<unknown> {
    const vm = this.#vm; if (vm === undefined) throw new BrowserRuntimeError('PLAYWRIGHT_RUNTIME_ERROR', 'Playwright callback outlived its script run.')
    const fn = vm.getProp(vm.global, '__pwInvokeCallback'); const idHandle = vm.newNumber(id); const argsHandle = vm.newString(JSON.stringify(this.#encode(args)))
    const called = vm.callFunction(fn, vm.undefined, idHandle, argsHandle); fn.dispose(); idHandle.dispose(); argsHandle.dispose()
    const handle = vm.unwrapResult(called)
    const state = vm.getPromiseState(handle)
    if (state.type === 'pending') { const resolved = await vm.resolvePromise(handle); handle.dispose(); const value = vm.unwrapResult(resolved); const result = vm.dump(value); value.dispose(); return result }
    const result = vm.dump(handle); handle.dispose(); return result
  }

  async #drainHostCalls(deadline: number): Promise<void> {
    while (this.#pendingHostCalls.size > 0) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new BrowserRuntimeError('TIMEOUT', 'Playwright host calls did not settle before the script deadline.')
      await Promise.race([
        Promise.allSettled([...this.#pendingHostCalls]).then(() => undefined),
        new Promise<void>((_resolve, reject) => { const timer = setTimeout(() => reject(new BrowserRuntimeError('TIMEOUT', 'Playwright host calls did not settle before the script deadline.')), remaining); timer.unref?.() }),
      ])
    }
  }

  #writeArtifact(bytes: Buffer, kind: string): Wire {
    const artifactId = `playwright-${randomUUID()}`; const root = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'artifacts', 'playwright'); mkdirSync(root, { recursive: true, mode: 0o700 }); writeFileSync(join(root, `${artifactId}.bin`), bytes, { mode: 0o600 }); this.#artifacts.push({ artifactId, kind }); return { artifactId, kind }
  }
  async #invokePlaywright(entry: HandleEntry, method: string, candidate: (...args: unknown[]) => unknown, args: unknown[]): Promise<unknown> {
    const sourceAt = (index: number): string | undefined => {
      const value = args[index]
      return value !== null && typeof value === 'object' && '__dshFunctionSource' in value ? String((value as { __dshFunctionSource: unknown }).__dshFunctionSource) : undefined
    }
    if (method === 'addInitScript') {
      const source = sourceAt(0)
      if (source !== undefined) return Reflect.apply(candidate, entry.value, [`(${source})(${JSON.stringify(args[1])})`])
    }
    const sourceIndex = method === '$eval' || method === '$$eval' ? 1 : 0
    const source = sourceAt(sourceIndex)
    if (source === undefined) return Reflect.apply(candidate, entry.value, args)
    const arg = args[sourceIndex + 1]
    if (method === '$eval' || method === '$$eval') {
      const selector = args[0]
      const safe = (element: unknown, payload: { source: string; arg: unknown }) => (0, eval)(`(${payload.source})`)(element, payload.arg)
      return Reflect.apply(candidate, entry.value, [selector, safe, { source, arg }])
    }
    if (/Locator/.test(entry.type) && (method === 'evaluate' || method === 'evaluateHandle' || method === 'evaluateAll')) {
      const safe = (element: unknown, payload: { source: string; arg: unknown }) => (0, eval)(`(${payload.source})`)(element, payload.arg)
      return Reflect.apply(candidate, entry.value, [safe, { source, arg }])
    }
    const safe = (payload: { source: string; arg: unknown }) => (0, eval)(`(${payload.source})`)(payload.arg)
    const forwarded = method === 'waitForFunction' ? [safe, { source, arg }, args[2]] : [safe, { source, arg }]
    return Reflect.apply(candidate, entry.value, forwarded)
  }
  #tag(value: unknown, engine: string): void {
    const seen = new WeakSet<object>()
    const visit = (candidate: unknown): void => {
      if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) return
      const object = candidate as object; if (seen.has(object)) return; seen.add(object)
      const base = (candidate as { constructor?: { name?: string } }).constructor?.name ?? 'Object'
      this.#objectTypes.set(object, `${base}(${engine})`)
      if (Array.isArray(candidate)) for (const item of candidate) visit(item)
    }
    visit(value)
  }
  async #workspaceFile(path: string): Promise<string> {
    const resolved = await resolveWorkspaceUpload(this.environment.workspaceRoot, path)
    const token = `workspace://${randomUUID()}`
    this.#pathTokens.set(token, { path: resolved, role: 'input' })
    return token
  }
  #artifactOutput(kind: string, extension = 'bin'): string {
    const safeExtension = /^[a-z0-9]{1,8}$/i.test(extension) ? extension.toLowerCase() : 'bin'
    const artifactId = `playwright-${randomUUID()}`
    const root = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'artifacts', 'playwright')
    mkdirSync(root, { recursive: true, mode: 0o700 })
    const token = `artifact://${artifactId}`
    this.#pathTokens.set(token, { path: join(root, `${artifactId}.${safeExtension}`), role: 'output' })
    this.#artifacts.push({ artifactId, kind })
    return token
  }
  #artifactDirectory(kind: string): string {
    const artifactId = `playwright-${randomUUID()}`
    const root = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'artifacts', 'playwright')
    const path = join(root, artifactId)
    mkdirSync(path, { recursive: true, mode: 0o700 })
    const token = `artifact-directory://${artifactId}`
    this.#pathTokens.set(token, { path, role: 'output-directory' })
    this.#artifacts.push({ artifactId, kind })
    return token
  }
  #brokerPaths(method: string, args: unknown[]): void {
    const replace = (value: unknown, role: 'input' | 'output' | 'output-directory'): unknown => {
      if (typeof value !== 'string') throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', `${method} path must come from ${role === 'input' ? 'workspace.file()' : role === 'output-directory' ? 'artifacts.directory()' : 'artifacts.output()'}.`)
      const mapped = this.#pathTokens.get(value)
      if (mapped?.role !== role) throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', `${method} rejected an unbrokered ${role} path.`)
      return mapped.path
    }
    if (method === 'launchPersistentContext') throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', 'playwright_run cannot select an arbitrary persistent user-data directory; use the managed target profile.')
    if (method === 'setInputFiles' && args.length > 0) {
      const files = args[0]
      args[0] = Array.isArray(files) ? files.map(value => replace(value, 'input')) : replace(files, 'input')
    }
    if (method === 'saveAs' && args.length > 0) args[0] = replace(args[0], 'output')
    const options = args[0]
    if (options !== null && typeof options === 'object' && 'path' in options) {
      if (method === 'storageState') throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', 'Exporting authentication storage to a file is not available to playwright_run.')
      const role = method === 'fulfill' ? 'input' : 'output'
      ;(options as { path?: unknown }).path = replace((options as { path?: unknown }).path, role)
    }
    if (options !== null && typeof options === 'object') {
      const value = options as Record<string, unknown>
      if ('storageState' in value) throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', 'Importing authentication storage is not available to playwright_run.')
      for (const key of ['downloadsPath', 'tracesDir']) if (key in value) value[key] = replace(value[key], 'output-directory')
      if (value.recordVideo !== null && typeof value.recordVideo === 'object' && 'dir' in value.recordVideo) (value.recordVideo as Record<string, unknown>).dir = replace((value.recordVideo as Record<string, unknown>).dir, 'output-directory')
      for (const key of ['executablePath', 'userDataDir', 'certPath', 'keyPath', 'pfxPath']) if (key in value) throw new BrowserRuntimeError('PLAYWRIGHT_POLICY_BLOCKED', `${method}.${key} is not available to playwright_run.`)
    }
  }
  async #transpile(code: string): Promise<string> { try { const result = await transform(code, { loader: 'ts', target: 'es2023', format: 'esm', sourcemap: false }); return result.code.trim().replace(/;$/, '') } catch (error) { throw new BrowserRuntimeError('PLAYWRIGHT_COMPILE_ERROR', error instanceof Error ? error.message : String(error)) } }
}
