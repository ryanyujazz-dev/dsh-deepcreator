/**
 * Session-bound dev-directory watcher set (S4).
 *
 * The watcher set mirrors live session bindings: one recursive watcher per
 * workspace root that has at least one live session, reference-counted, so the
 * watcher appears when the first session binds a workspace and disappears when
 * the last binding ends. Filesystem events under `<cwd>/.deepcreator/apps/`
 * re-emit as one Cordis event (`app-stage/dev-changed`) carrying the root.
 *
 * S4 platform facts (verified): macOS `fs.watch({recursive: true})` reports
 * `rename` for create/delete and `change` for content edits. Platforms that
 * reject recursive watching fall back to a signature scan on an interval
 * (dir names + mtimes), the design's sanctioned fallback; correctness always
 * also rests on probe-at-open.
 * @module @ryanyujazz/dsh-app-stage/watcher
 */
import { watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { APPS_DIR } from './types.ts'

/** Trailing coalescing window: one editor save can fire several raw events. */
export const WATCH_DEBOUNCE_MS = 60
/** Fallback scan interval on platforms without recursive fs.watch. */
export const WATCH_FALLBACK_MS = 2000

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A watched workspace's `.deepcreator/apps/` tree changed. Emitted after
     * the trailing debounce window; consumers re-scan on receipt (probe
     * semantics — the event carries no diff).
     * @param cwd - the workspace root that changed.
     */
    'app-stage/dev-changed'(cwd: string): void
  }
}

/** What one watched root keeps alive. */
interface WatchedRoot {
  readonly cwd: string
  /** Reference count = live session bindings on this root. */
  refs: number
  watcher?: FSWatcher | undefined
  timer?: ReturnType<typeof setInterval> | undefined
  pending?: ReturnType<typeof setTimeout> | undefined
  /** Last fallback signature (fallback mode only). */
  signature?: string | undefined
}

/**
 * The session-bound watcher registry (`ctx.appStage.watchers`-adjacent
 * companion owned by the service). Pure infrastructure: binding bookkeeping,
 * platform-appropriate watching, debounced emission on the given Context.
 */
export class AppStageWatcherSet {
  private readonly roots = new Map<string, WatchedRoot>()

  constructor(private readonly ctx: Context) {}

  /** Roots with at least one live binding. */
  activeRoots(): readonly string[] {
    return [...this.roots.values()].filter(root => root.refs > 0).map(root => root.cwd)
  }

  /**
   * One session bound this workspace: register the root's watcher (first
   * binding wins) and start/refresh its event sources.
   */
  bind(cwd: string): void {
    const appsRoot = join(cwd, APPS_DIR)
    let root = this.roots.get(appsRoot)
    if (root === undefined) {
      root = { cwd: appsRoot, refs: 0 }
      this.roots.set(appsRoot, root)
    }
    root.refs += 1
    if (root.refs > 1) return
    this.start(root).catch(error => {
      this.ctx.logger.warn(`app-stage watcher failed on ${appsRoot}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** One binding ended: drop the watcher when the last one leaves. */
  unbind(cwd: string): void {
    const appsRoot = join(cwd, APPS_DIR)
    const root = this.roots.get(appsRoot)
    if (root === undefined || root.refs <= 0) return
    root.refs -= 1
    if (root.refs === 0) this.stop(root)
  }

  /** Tear every root down (row disposal). */
  dispose(): void {
    for (const root of [...this.roots.values()]) this.stop(root)
    this.roots.clear()
  }

  private stop(root: WatchedRoot): void {
    root.watcher?.close()
    root.watcher = undefined
    if (root.timer !== undefined) clearInterval(root.timer)
    root.timer = undefined
    if (root.pending !== undefined) clearTimeout(root.pending)
    root.pending = undefined
  }

  private async start(root: WatchedRoot): Promise<void> {
    // Recursive watching is the fast path; the constructor does not throw on
    // Linux (the error arrives on the first event callback), so probe with a
    // throwaway handle first.
    try {
      const probe = watch(root.cwd, { recursive: true }, () => {})
      probe.close()
      root.watcher = watch(root.cwd, { recursive: true }, () => this.scheduleEmit(root))
      return
    } catch {
      // Fallback: interval signature scan (design-sanctioned for platforms
      // without recursive watchers). The root dir may not exist yet — the
      // signature scan tolerates that and picks it up when it appears.
    }
    root.signature = await this.signatureOf(root.cwd)
    const timer: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      void this.tick(root)
    }, WATCH_FALLBACK_MS)
    root.timer = timer
  }

  private async tick(root: WatchedRoot): Promise<void> {
    // The fast path may have failed only because the apps root did not exist
    // yet; upgrade to a recursive watcher once it does — and report whatever
    // changed while we were polling (e.g. the root's first appearance).
    if (root.watcher === undefined) {
      try {
        const probe = watch(root.cwd, { recursive: true }, () => {})
        probe.close()
        root.watcher = watch(root.cwd, { recursive: true }, () => this.scheduleEmit(root))
        if (root.timer !== undefined) clearInterval(root.timer)
        root.timer = undefined
        const next = await this.signatureOf(root.cwd)
        if (next !== root.signature && root.signature !== undefined) this.ctx.emit('app-stage/dev-changed', root.cwd)
        root.signature = next
        return
      } catch {
        // Still absent (or still unsupported): keep polling.
      }
    }
    const next = await this.signatureOf(root.cwd)
    if (next === root.signature) return
    root.signature = next
    this.ctx.emit('app-stage/dev-changed', root.cwd)
  }

  private scheduleEmit(root: WatchedRoot): void {
    if (root.pending !== undefined) return
    root.pending = setTimeout(() => {
      root.pending = undefined
      this.ctx.emit('app-stage/dev-changed', root.cwd)
    }, WATCH_DEBOUNCE_MS)
  }

  /** Cheap change signature: recursive names + mtimes, depth-capped. */
  private async signatureOf(dir: string, depth = 0): Promise<string> {
    let entries: readonly { name: string; isDirectory: () => boolean }[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return '<missing>'
    }
    const parts: string[] = []
    const sorted = [...entries].sort((a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : 1))
    for (const entry of sorted) {
      const full = join(dir, entry.name)
      let mtime = ''
      try {
        mtime = String((await stat(full)).mtimeMs)
      } catch {
        mtime = '?'
      }
      parts.push(`${entry.name}:${entry.isDirectory() ? 'd' : 'f'}:${mtime}`)
      if (entry.isDirectory() && depth < 3) parts.push(await this.signatureOf(full, depth + 1))
    }
    return parts.join('|')
  }
}
