// ArtifactCodeRenderer: every produced text file uses the same full-file row
// grid as Review (number gutter + content, without Diff signs/backgrounds).
// Known languages add syntax tokens; unknown extensions stay plain text inside
// that same CodeSurface instead of falling back to a visually unrelated <pre>.

import type { ReactNode } from 'react'
import { CodeSurface, diffLanguageFromPath } from '@ryanyujazz/dsh-client-ui-primitives'
import type { ArtifactRendererProps } from '@ryanyujazz/dsh-client-ui-workbench/client'

function isMarkdownLanguage(lang: string | undefined): boolean {
  return lang === 'markdown' || lang === 'mdx'
}

export function ArtifactCodeRenderer({ artifactId, content }: ArtifactRendererProps): ReactNode {
  const lang = diffLanguageFromPath(artifactId)
  return <CodeSurface content={content} lang={lang} variant={isMarkdownLanguage(lang) ? 'document' : 'panel'} />
}
