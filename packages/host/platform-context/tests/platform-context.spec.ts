// @vitest-environment node
// Platform-facts snapshot text: win32 contributes shell-dialect and encoding
// facts (PowerShell 5.1 vs 7), every other platform contributes empty text,
// and apply() wires exactly one ordered runtime-context registration.

import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply, inject, name } from '../src/index.ts'
import { buildPlatformFacts, hasPowerShellSeven, type PlatformFactsInput } from '../src/platform-facts.ts'

const WINDOWS_ENV = {
  PATH: 'C:\\Windows\\System32;C:\\Windows;C:\\Tools',
  ProgramFiles: 'C:\\Program Files',
}

function input(platform: NodeJS.Platform, existing: string[] = [], env: NodeJS.ProcessEnv = WINDOWS_ENV): PlatformFactsInput {
  const set = new Set(existing)
  return { platform, env, fileExists: path => set.has(path) }
}

describe('hasPowerShellSeven', () => {
  it('finds pwsh.exe on PATH or in the standard install root', () => {
    expect(hasPowerShellSeven(input('win32', [join('C:\\Tools', 'pwsh.exe')]))).toBe(true)
    expect(hasPowerShellSeven(input('win32', [join('C:\\Program Files', 'PowerShell', '7', 'pwsh.exe')]))).toBe(true)
  })

  it('reports absence without pwsh.exe and ignores the check off Windows', () => {
    expect(hasPowerShellSeven(input('win32'))).toBe(false)
    expect(hasPowerShellSeven(input('darwin', [join('C:\\Tools', 'pwsh.exe')]))).toBe(false)
  })
})

describe('buildPlatformFacts', () => {
  it('contributes nothing outside Windows', () => {
    expect(buildPlatformFacts(input('darwin', [join('C:\\Tools', 'pwsh.exe')]))).toBe('')
    expect(buildPlatformFacts(input('linux'))).toBe('')
  })

  it('describes the PowerShell 5.1 hazards when PowerShell 7 is absent', () => {
    const text = buildPlatformFacts(input('win32'))
    expect(text).toContain('PowerShell 5.1')
    expect(text).toContain('without BOM')
    expect(text).toContain('ASCII-only')
    expect(text).toContain('-Encoding')
    expect(text).toContain('[char]N')
    expect(text).toContain('access-denied')
  })

  it('describes PowerShell 7 when it is installed', () => {
    const text = buildPlatformFacts(input('win32', [join('C:\\Tools', 'pwsh.exe')]))
    expect(text).toContain('PowerShell 7')
    expect(text).not.toContain('5.1')
  })
})

describe('apply', () => {
  it('registers one ordered context on win32', () => {
    const context = vi.fn()
    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    try {
      apply({ systemPrompt: { context } } as unknown as Context)
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    }
    expect(context).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'deepcreator:platform', order: 120, text: expect.any(String) }),
    )
  })

  it('registers nothing off Windows', () => {
    const context = vi.fn()
    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      apply({ systemPrompt: { context } } as unknown as Context)
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    }
    expect(context).not.toHaveBeenCalled()
  })

  it('declares the system-prompt dependency', () => {
    expect(name).toBe('platform-context')
    expect(inject).toContain('systemPrompt')
  })
})
