import type { ReactNode } from 'react'
import type { ArtifactRendererProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import { basename } from './artifact-view-model.ts'
import css from './ArtifactPanel.module.css'

function isolatedDocumentHtml(content: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    :root { color-scheme: light dark; font: 15px/1.7 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { max-width: 760px; margin: 0 auto; padding: 32px 40px 64px; box-sizing: border-box; color: CanvasText; background: Canvas; overflow-wrap: anywhere; }
    img { max-width: 100%; height: auto; } table { width: 100%; border-collapse: collapse; } td, th { padding: 6px 8px; border: 1px solid GrayText; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
    @media (max-width: 560px) { body { padding: 22px 20px 48px; } }
  </style></head><body>${content}</body></html>`
}

export function ArtifactImageRenderer({ artifactId, content }: ArtifactRendererProps): ReactNode {
  return <div className={css.imagePreview}><img src={content} alt={basename(artifactId)} data-artifact-image={artifactId} /></div>
}

export function ArtifactPdfRenderer({ artifactId, content }: ArtifactRendererProps): ReactNode {
  return <iframe className={css.pdfFrame} src={content} title={basename(artifactId)} data-artifact-pdf={artifactId} />
}

export function ArtifactDocumentHtmlRenderer({ artifactId, content }: ArtifactRendererProps): ReactNode {
  return (
    <iframe
      className={css.documentFrame}
      sandbox=""
      srcDoc={isolatedDocumentHtml(content)}
      title={basename(artifactId)}
      data-artifact-document="docx"
    />
  )
}

export function ArtifactDocumentTextRenderer({ content }: ArtifactRendererProps): ReactNode {
  return <div className={css.documentText} data-artifact-document="doc"><pre>{content}</pre></div>
}
