import { useEffect, useRef } from 'react'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import css from './Panels.module.css'

interface TerminalEmulatorProps {
  terminal: TypertClientRemote['terminal-workbench']
  agentSessionId: string
  terminalSessionId: string
  onError: (message: string | null) => void
  onExit: () => void
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback
}

/** Browser terminal emulator over the Agent-fenced raw PTY Remote. */
export function TerminalEmulator({ terminal, agentSessionId, terminalSessionId, onError, onExit }: TerminalEmulatorProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const styles = getComputedStyle(host)
    const emulator = new Terminal({
      allowProposedApi: false,
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'bar',
      drawBoldTextInBrightColors: true,
      fontFamily: token(styles, '--dsw-font-mono', 'ui-monospace, SFMono-Regular, Consolas, monospace'),
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: {
        background: 'rgba(0, 0, 0, 0)',
        foreground: token(styles, '--dsw-alias-label-primary', '#d8d8d8'),
        cursor: token(styles, '--dsw-alias-label-primary', '#d8d8d8'),
        cursorAccent: token(styles, '--dsw-alias-bg-base', '#0b0d10'),
        selectionBackground: token(styles, '--dsw-alias-fill-selected', 'rgba(120, 150, 220, 0.3)'),
      },
    })
    const fit = new FitAddon()
    emulator.loadAddon(fit)
    emulator.open(host)

    let disposed = false
    let cursor = 0
    let inputChain = Promise.resolve()
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let lastSize = ''

    const applyAppearance = () => {
      if (disposed) return
      const nextStyles = getComputedStyle(host)
      emulator.options.fontFamily = token(nextStyles, '--dsw-font-mono', 'ui-monospace, SFMono-Regular, Consolas, monospace')
      emulator.options.theme = {
        background: 'rgba(0, 0, 0, 0)',
        foreground: token(nextStyles, '--dsw-alias-label-primary', '#d8d8d8'),
        cursor: token(nextStyles, '--dsw-alias-label-primary', '#d8d8d8'),
        cursorAccent: token(nextStyles, '--dsw-alias-bg-base', '#0b0d10'),
        selectionBackground: token(nextStyles, '--dsw-alias-fill-selected', 'rgba(120, 150, 220, 0.3)'),
      }
      lastSize = ''
      scheduleSize()
    }

    const report = (reason: unknown) => { if (!disposed) onError(messageOf(reason)) }
    const sendSize = () => {
      if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return
      try { fit.fit() } catch { return }
      const key = `${emulator.cols}x${emulator.rows}`
      if (key === lastSize || emulator.cols < 1 || emulator.rows < 1) return
      lastSize = key
      void terminal.resize(agentSessionId, terminalSessionId, emulator.cols, emulator.rows).then((wire) => {
        if (!wire.ok) throw new Error(wire.error.message)
        if (!wire.value.ok) throw new Error(wire.value.message)
      }).catch(report)
    }
    const scheduleSize = () => {
      if (resizeTimer !== undefined) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(sendSize, 60)
    }

    const inputDisposable = emulator.onData((data) => {
      inputChain = inputChain.then(async () => {
        const wire = await terminal.input(agentSessionId, terminalSessionId, data)
        if (!wire.ok) throw new Error(wire.error.message)
        if (!wire.value.ok) throw new Error(wire.value.message)
      }).catch(report)
    })

    const pump = async (): Promise<void> => {
      while (!disposed) {
        try {
          const wire = await terminal.readRaw(agentSessionId, terminalSessionId, cursor)
          if (!wire.ok) throw new Error(wire.error.message)
          if (!wire.value.ok) throw new Error(wire.value.message)
          const page = wire.value.page
          if (page.truncated) emulator.reset()
          if (page.data.length > 0) emulator.write(page.data)
          cursor = page.nextCursor
          onError(null)
          if (page.status.kind === 'exited') {
            onExit()
            return
          }
          if (!page.hasMore) await new Promise(resolve => setTimeout(resolve, 70))
        } catch (reason) {
          report(reason)
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    }

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(scheduleSize)
    resizeObserver?.observe(host)
    const appearanceObserver = typeof MutationObserver === 'undefined'
      ? undefined
      : new MutationObserver(applyAppearance)
    appearanceObserver?.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme', 'data-code-theme', 'style'],
    })
    const focus = () => { emulator.focus() }
    host.addEventListener('pointerdown', focus)
    scheduleSize()
    emulator.focus()
    void pump()

    return () => {
      disposed = true
      if (resizeTimer !== undefined) clearTimeout(resizeTimer)
      resizeObserver?.disconnect()
      appearanceObserver?.disconnect()
      host.removeEventListener('pointerdown', focus)
      inputDisposable.dispose()
      fit.dispose()
      emulator.dispose()
    }
  }, [agentSessionId, onError, onExit, terminal, terminalSessionId])

  return <div ref={hostRef} className={css.terminalCanvas} aria-label="Terminal" />
}
