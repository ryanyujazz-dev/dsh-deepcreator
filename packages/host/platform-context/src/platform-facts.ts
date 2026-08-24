import { join } from 'node:path'

/** Brokered environment inputs so tests never touch the real machine. */
export interface PlatformFactsInput {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  fileExists(path: string): boolean
}

/**
 * PowerShell 7 is present when `pwsh.exe` is reachable on PATH (Store, winget
 * user installs, and shim-based managers all put it there) or lives in the
 * standard machine-wide install root. The pwsh tool itself falls back to
 * `powershell.exe` silently, so the model cannot tell otherwise.
 */
export function hasPowerShellSeven(input: PlatformFactsInput): boolean {
  if (input.platform !== 'win32') return false
  for (const dir of (input.env.PATH ?? '').split(';')) {
    if (dir.trim() !== '' && input.fileExists(join(dir, 'pwsh.exe'))) return true
  }
  const programFiles = input.env.ProgramFiles
  return programFiles !== undefined && programFiles !== ''
    && input.fileExists(join(programFiles, 'PowerShell', '7', 'pwsh.exe'))
}

const WINDOWS_PS51_FACTS = [
  'Current platform is Windows, and the pwsh tool actually runs Windows PowerShell 5.1 on this host (PowerShell 7 is not installed) despite the tool name.',
  '- A .ps1 file saved as UTF-8 without BOM is parsed with the legacy ANSI codepage (GBK on zh-CN hosts): non-ASCII string literals become mojibake that can silently swallow adjacent ASCII syntax such as a closing tag. Keep generated .ps1 scripts ASCII-only and derive non-ASCII values from the data files they process.',
  '- PowerShell 7-only syntax does not exist here: no `u{XXXX} escape sequences (use [char]N), no ?? or ?: operators, no ConvertFrom-Json -AsHashtable.',
  '- Read and write files with an explicit encoding: Get-Content -Encoding UTF8, Set-Content/Out-File -Encoding utf8, or [IO.File]::ReadAllText/WriteAllText with UTF8Encoding.',
  '- Quote every path that may contain spaces or non-ASCII characters.',
  '- GUI subprocesses (Edge, Chrome, Electron) spawned inside the sandbox may die with mojo/platform-channel access-denied (0x5) errors: that is the sandbox blocking named-pipe IPC. Escalate the exact command once or use the managed Browser Providers instead of retrying browser flags.',
].join('\n')

const WINDOWS_PS7_FACTS = [
  'Current platform is Windows, and the pwsh tool runs PowerShell 7 (UTF-8 by default, modern syntax available).',
  '- Quote every path that may contain spaces or non-ASCII characters.',
  '- GUI subprocesses (Edge, Chrome, Electron) spawned inside the sandbox may die with mojo/platform-channel access-denied (0x5) errors: that is the sandbox blocking named-pipe IPC. Escalate the exact command once or use the managed Browser Providers instead of retrying browser flags.',
].join('\n')

/**
 * The runtime-context snapshot text for this host: Windows shell-dialect and
 * encoding facts that decide how scripts must be written, or empty text on
 * other platforms (empty context contributions are dropped by the official
 * registry, so macOS/Linux prompts stay unchanged).
 */
export function buildPlatformFacts(input: PlatformFactsInput): string {
  if (input.platform !== 'win32') return ''
  return hasPowerShellSeven(input) ? WINDOWS_PS7_FACTS : WINDOWS_PS51_FACTS
}
