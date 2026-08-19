// ArtifactCodeRenderer: the produced-file content projection for code-known
// paths. A file whose extension maps to a registered grammar (markdown
// included — a prose artifact is still a file) renders as the wrapped,
// line-numbered, colored CodeSurface; anything else keeps the panel's plain
// <pre> fallback verbatim, so unknown types look exactly as before.

import type { ReactNode } from 'react'
import { CodeSurface, diffLanguageFromPath } from '@ryanyujazz/dsh-client-ui-primitives'
import type { ArtifactRendererProps } from '@ryanyujazz/dsh-client-ui-workbench/client'

function isMarkdownLanguage(lang: string): boolean {
  return lang === 'markdown' || lang === 'mdx'
}

export function ArtifactCodeRenderer({ artifactId, content }: ArtifactRendererProps): ReactNode {
  const lang = diffLanguageFromPath(artifactId)
  if (lang === undefined) return <pre>{content}</pre>
  return <CodeSurface content={content} lang={lang} variant={isMarkdownLanguage(lang) ? 'document' : 'panel'} />
}
