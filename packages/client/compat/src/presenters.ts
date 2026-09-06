/**
 * Client-side replicas of the official 0.1.2 tool presenters.
 *
 * 0.1.1 shipped render-intent views on the session wire (the since-deleted
 * `dsh-client-runtime` aligned them with events by index); 0.1.2 dropped wire
 * views and instead has every tool declare pure `presentCall`/`presentResult`
 * presenters over its parsed arguments and settled result. The presenters run
 * HOST-side where the tool definitions live, and the official client does not
 * consume them yet — so this module replicates the pure projections and the
 * conversation assembler attaches their output to the assembled records
 * (`callView`/`resultView`, consumed by the fork ui-tool card models).
 *
 * Per-function sources: `@deepseek-ai/dsh-tool-fs@0.1.2-rc.1` lib/index.js
 * (write/edit/read), `@deepseek-ai/dsh-tools@0.1.2-rc.1` lib/index.js
 * (run_code); the bash/pwsh terminal projection and the web/search narrowings
 * of the harness `meta` payloads are fork-owned. Everything here must stay a
 * pure function of (name, args, result) — live and replayed sessions assemble
 * through the same path. Type-only imports: none of the host packages may
 * enter a client bundle as values.
 * @module
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  FileDiff,
  ReadFileLine,
  ToolCallView,
  ToolResultView,
} from '@deepseek-ai/dsh-tools/presentation'

/** The settled outcome a result presenter may narrow into a view. */
export interface ToolResultProjection {
  readonly content: readonly ContentBlock[]
  readonly isError: boolean
  /**
   * The result's presentation payload, persisted verbatim on the wire
   * `tool/result` for presenters to narrow independently.
   */
  readonly meta?: unknown
}

type ArgsObject = Record<string, unknown>

/** Narrow parsed presenter input to a plain object; any other JSON is unusable. */
function argsObject(args: unknown): ArgsObject | undefined {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? args as ArgsObject
    : undefined
}

/** Join the result's text blocks; the only material the text presenters need. */
function textOf(content: readonly ContentBlock[]): string | undefined {
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'type' in block
      && (block as { type: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.length === 0 ? undefined : parts.join('\n')
}

/** The official meta.diffs narrowing: an array of well-formed FileDiff hunks. */
function diffsFromMeta(meta: unknown): FileDiff[] | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const diffs = (meta as { diffs?: unknown }).diffs
  if (!Array.isArray(diffs) || diffs.length === 0) return undefined
  for (const diff of diffs) {
    if (typeof diff !== 'object' || diff === null) return undefined
    const hunk = diff as Record<string, unknown>
    if (typeof hunk.path !== 'string') return undefined
    if (hunk.oldText !== null && typeof hunk.oldText !== 'string') return undefined
    if (typeof hunk.newText !== 'string') return undefined
    if (hunk.oldStart !== undefined && (!Number.isInteger(hunk.oldStart) || (hunk.oldStart as number) < 1)) return undefined
    if (hunk.newStart !== undefined && (!Number.isInteger(hunk.newStart) || (hunk.newStart as number) < 1)) return undefined
  }
  return diffs as FileDiff[]
}

interface ReadMeta {
  path: string
  offset: number
  lines: ReadFileLine[]
  totalLines: number
  lang?: string
}

/** The official read-meta narrowing: strictly monotonic 1-based file lines. */
function readMetaFromMeta(meta: unknown): ReadMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const raw = meta as Record<string, unknown>
  const { path, offset, lines, totalLines, lang } = raw
  if (typeof path !== 'string' || typeof totalLines !== 'number' || typeof offset !== 'number') return undefined
  if (!Number.isInteger(offset) || offset < 1) return undefined
  if (!Number.isInteger(totalLines) || totalLines < 0) return undefined
  if (!Array.isArray(lines)) return undefined
  const narrowed: Array<{ number: number; text: string }> = []
  let previous = offset - 1
  for (const line of lines) {
    if (typeof line !== 'object' || line === null) return undefined
    const { number, text } = line as Record<string, unknown>
    if (typeof number !== 'number' || !Number.isInteger(number)) return undefined
    if (typeof text !== 'string') return undefined
    if (number <= previous || number > totalLines) return undefined
    previous = number
    narrowed.push({ number, text })
  }
  return {
    path,
    offset,
    lines: narrowed,
    totalLines,
    ...(lang === undefined ? {} : typeof lang === 'string' ? { lang } : {}),
  }
}

/**
 * The pending-state presenter: how one call renders while it runs. Unknown
 * tools return undefined — the documented generic-card default.
 */
export function presentToolCall(name: string, args: unknown): ToolCallView | undefined {
  const parsed = argsObject(args)
  if (parsed === undefined) return undefined
  if (name === 'bash' || name === 'pwsh') {
    // Fork-owned terminal projection: the shell tools' args carry the command,
    // an optional working directory (the harness schema names it `workdir`;
    // `cwd` is accepted for older harnesses) and a summary line.
    const command = typeof parsed.command === 'string' ? parsed.command : undefined
    if (command === undefined) return undefined
    const cwd = typeof parsed.workdir === 'string'
      ? parsed.workdir
      : typeof parsed.cwd === 'string' ? parsed.cwd : undefined
    const description = typeof parsed.description === 'string' ? parsed.description : undefined
    return {
      card: 'terminal',
      title: command,
      ...(cwd === undefined ? {} : { cwd }),
      ...(description === undefined ? {} : { description }),
    }
  }
  if (name === 'write') {
    const path = typeof parsed.file_path === 'string' ? parsed.file_path : undefined
    if (path === undefined) return undefined
    // Source: dsh-tool-fs write.presentCall — a create's oldText is null.
    return {
      card: 'diff',
      title: `Write ${path}`,
      diffs: [{ path, oldText: null, newText: typeof parsed.content === 'string' ? parsed.content : '' }],
      locations: [{ path }],
    }
  }
  if (name === 'edit') {
    const path = typeof parsed.file_path === 'string' ? parsed.file_path : undefined
    if (path === undefined) return undefined
    // Source: dsh-tool-fs edit.presentCall.
    return {
      card: 'diff',
      title: `Edit ${path}`,
      diffs: [{
        path,
        oldText: typeof parsed.old_string === 'string' && parsed.old_string !== '' ? parsed.old_string : null,
        newText: typeof parsed.new_string === 'string' ? parsed.new_string : '',
      }],
      locations: [{ path }],
    }
  }
  if (name === 'read') {
    const path = typeof parsed.file_path === 'string' ? parsed.file_path : undefined
    if (path === undefined) return undefined
    // Source: dsh-tool-fs read.presentCall — a generic pending card that names
    // the file and the requested window.
    const offset = typeof parsed.offset === 'number' ? parsed.offset : undefined
    const limit = typeof parsed.limit === 'number' && parsed.limit > 0 ? parsed.limit : undefined
    const window = limit !== undefined
      ? ` (${offset ?? 1} - ${(offset ?? 1) + limit - 1})`
      : offset !== undefined ? ` (from line ${offset})` : ''
    return {
      card: 'generic',
      title: `Read ${path}${window}`,
      kind: 'read',
      locations: [{ path, line: offset ?? 1 }],
    }
  }
  if (name === 'run_code') {
    // Source: dsh-tools run_code presentCall.
    const title = typeof parsed.description === 'string' ? parsed.description : undefined
    if (title === undefined) return undefined
    return { card: 'generic', title, kind: 'execute', rawInput: parsed.code }
  }
  // Unknown-name shell tolerance (see isShellCall): the invocation shape is
  // the only signal left, and it is exactly what the 0.1.1 wire views
  // preserved for harness shell tools under names this bundle does not know.
  if (typeof parsed.command === 'string') {
    const cwd = typeof parsed.workdir === 'string'
      ? parsed.workdir
      : typeof parsed.cwd === 'string' ? parsed.cwd : undefined
    const description = typeof parsed.description === 'string' ? parsed.description : undefined
    return {
      card: 'terminal',
      title: parsed.command,
      ...(cwd === undefined ? {} : { cwd }),
      ...(description === undefined ? {} : { description }),
    }
  }
  return undefined
}

/**
 * The settled-state presenter: how one completed call renders. Unknown tools
 * and error results return undefined — the generic path preserves the raw
 * result text and its error styling.
 */
export function presentToolResult(name: string, args: unknown, result: ToolResultProjection): ToolResultView | undefined {
  if (result.isError) return undefined
  const parsed = argsObject(args)
  if (parsed === undefined) return undefined
  if (name === 'bash' || name === 'pwsh') {
    // Fork-owned terminal projection: the captured output is the result text;
    // the harness reports success by absence of error, and a failure is kept
    // on the generic path (its fenced text and error styling survive there).
    // A background start never produces output here either — generic path.
    if (parsed.run_in_background === true) return undefined
    return { card: 'terminal', output: textOf(result.content) ?? '', exitCode: 0 }
  }
  if (name === 'write') {
    // Source: dsh-tool-fs write.presentResult — the applied hunks when the
    // host projected them, else the args-derived whole-file diff.
    const path = typeof parsed.file_path === 'string' ? parsed.file_path : undefined
    if (path === undefined) return undefined
    const diffs = diffsFromMeta(result.meta) ?? [{
      path,
      oldText: null,
      newText: typeof parsed.content === 'string' ? parsed.content : '',
    }]
    return { card: 'diff', title: `Write ${path}`, diffs }
  }
  if (name === 'edit') {
    // Source: dsh-tool-fs edit.presentResult — meta hunks only; without them
    // the raw result stays on the generic path.
    const diffs = diffsFromMeta(result.meta)
    if (diffs === undefined) return undefined
    const path = typeof parsed.file_path === 'string' ? parsed.file_path : undefined
    return {
      card: 'diff',
      ...(path === undefined ? {} : { title: `Edit ${path}` }),
      diffs,
    }
  }
  if (name === 'read') {
    // Source: dsh-tool-fs read.presentResult — the structured window rides the
    // persisted meta; the envelope-stripped body is cut from the result text.
    const meta = readMetaFromMeta(result.meta)
    if (meta === undefined) return undefined
    const text = textOf(result.content)
    if (text === undefined) return undefined
    const body = /^<path>[^\n]*<\/path>\n<type>file<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u.exec(text)?.[1]
    if (body === undefined) return undefined
    return {
      card: 'read',
      path: meta.path,
      offset: meta.offset,
      lines: meta.lines,
      totalLines: meta.totalLines,
      ...(meta.lang === undefined ? {} : { lang: meta.lang }),
      content: [{ type: 'text', text: body }],
    }
  }
  if (name === 'grep' || name === 'glob') {
    // Fork-owned narrowing: a search card needs the structured matches/paths
    // payload; without it the raw result text stays on the generic path.
    const meta = result.meta
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
    const raw = meta as Record<string, unknown>
    const truncated = raw.truncated === true
    if (Array.isArray(raw.files)) {
      const files: Array<{ path: string; matches: Array<{ lineNumber: number; line: string }> }> = []
      for (const file of raw.files) {
        if (typeof file !== 'object' || file === null) return undefined
        const entry = file as Record<string, unknown>
        if (typeof entry.path !== 'string' || !Array.isArray(entry.matches)) return undefined
        const matches: Array<{ lineNumber: number; line: string }> = []
        for (const match of entry.matches) {
          if (typeof match !== 'object' || match === null) return undefined
          const item = match as Record<string, unknown>
          if (typeof item.lineNumber !== 'number' || typeof item.line !== 'string') return undefined
          matches.push({ lineNumber: item.lineNumber, line: item.line })
        }
        files.push({ path: entry.path, matches })
      }
      const total = typeof raw.total === 'number' ? raw.total : files.reduce((sum, file) => sum + file.matches.length, 0)
      return { card: 'search', shape: 'matches', files, truncated, total }
    }
    if (Array.isArray(raw.paths)) {
      const paths: string[] = []
      for (const path of raw.paths) {
        if (typeof path !== 'string') return undefined
        paths.push(path)
      }
      return { card: 'search', shape: 'paths', paths, truncated, total: typeof raw.total === 'number' ? raw.total : paths.length }
    }
    return undefined
  }
  if (name === 'web_search') {
    // Fork-owned narrowing of the harness payload (meta.sources is what the
    // wire verifiably carries); a malformed payload takes the generic path.
    const meta = result.meta
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
    const raw = meta as Record<string, unknown>
    if (!Array.isArray(raw.sources)) return undefined
    const sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }> = []
    for (const source of raw.sources) {
      if (typeof source !== 'object' || source === null) return undefined
      const item = source as Record<string, unknown>
      if (typeof item.url !== 'string') return undefined
      sources.push({
        url: item.url,
        ...(typeof item.title === 'string' ? { title: item.title } : {}),
        ...(typeof item.snippet === 'string' ? { snippet: item.snippet } : {}),
        ...(typeof item.publishedAt === 'string' ? { publishedAt: item.publishedAt } : {}),
      })
    }
    return {
      card: 'web',
      kind: 'search',
      ...(typeof raw.answer === 'string' ? { answer: raw.answer } : {}),
      sources,
      truncated: raw.truncated === true,
    }
  }
  if (name === 'web_fetch') {
    const meta = result.meta
    const raw = typeof meta === 'object' && meta !== null && !Array.isArray(meta)
      ? meta as Record<string, unknown>
      : undefined
    const url = typeof raw?.url === 'string' ? raw.url : typeof parsed.url === 'string' ? parsed.url : undefined
    if (url === undefined) return undefined
    // The official view type requires the fetch's HTTP status; the wire meta
    // does not always carry it, and fabricating one would lie about a fetch
    // this client never performed — no status means the generic path keeps
    // the raw markdown body.
    if (typeof raw?.statusCode !== 'number') return undefined
    return {
      card: 'web',
      kind: 'fetch',
      url,
      statusCode: raw.statusCode,
      truncated: raw.truncated === true,
    }
  }
  // Unknown-name shell tolerance (see presentToolCall): same terminal
  // projection as the named shell tools, gated on the same background/error
  // exclusions.
  if (typeof parsed.command === 'string') {
    if (parsed.run_in_background === true) return undefined
    return { card: 'terminal', output: textOf(result.content) ?? '', exitCode: 0 }
  }
  return undefined
}

/**
 * Parse a wire `tool/call` `arguments` payload (a JSON string). A malformed
 * payload yields undefined — the presenters' unusable-input default.
 */
export function parseToolArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}
