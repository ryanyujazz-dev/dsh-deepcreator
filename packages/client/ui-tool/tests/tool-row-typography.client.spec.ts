import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

const flowFont = 'font: var(--dsh-conversation-flow-font, var(--dsw-font-markdown-base));'

describe('tool row typography', () => {
  it('uses the conversation transcript role for standard and bash rows', () => {
    expect(source('../src/client/tool/components/ToolRow.module.css')).toContain(flowFont)
    expect(source('../src/client/tool/toolviews/bash-sample.module.css')).toContain(flowFont)
  })

  it('keeps expanded tool payloads on the compact detail role', () => {
    expect(source('../src/client/tool/components/ToolRow.module.css')).toContain(
      'font: var(--dsw-font-markdown-code-block-small);',
    )
    expect(source('../src/client/tool/toolviews/bash-sample.module.css')).toContain(
      'font: var(--dsw-font-markdown-code-block-small);',
    )
  })
})
