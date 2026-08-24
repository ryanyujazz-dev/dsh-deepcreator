import { describe, expect, it } from 'vitest'
import { collectPolicyUrls } from '../src/policy-urls.ts'

describe('collectPolicyUrls', () => {
  it('collects navigable schemes beyond http and ws, including file', () => {
    expect(collectPolicyUrls('https://example.com/page')).toEqual(['https://example.com/page'])
    expect(collectPolicyUrls('file:///E:/YuProjects/report/index.html')).toEqual(['file:///E:/YuProjects/report/index.html'])
    expect(collectPolicyUrls('FILE://C:/temp/check.png')).toEqual(['FILE://C:/temp/check.png'])
    expect(collectPolicyUrls('ws://127.0.0.1:9222')).toEqual(['ws://127.0.0.1:9222'])
    expect(collectPolicyUrls('wss://example.devtools/browser')).toEqual(['wss://example.devtools/browser'])
  })

  it('excludes brokered tokens, Windows drive paths, and authority-less strings', () => {
    expect(collectPolicyUrls('workspace://output/report.html')).toEqual([])
    expect(collectPolicyUrls('artifact://screenshot-1.png')).toEqual([])
    expect(collectPolicyUrls('artifact-directory://screenshots/')).toEqual([])
    expect(collectPolicyUrls('E:\\YuProjects\\自由空间\\report.html')).toEqual([])
    expect(collectPolicyUrls('C:/Users/dev/AppData/report.png')).toEqual([])
    expect(collectPolicyUrls('/unix/absolute/path.md')).toEqual([])
    expect(collectPolicyUrls('about:blank')).toEqual([])
    expect(collectPolicyUrls('data:image/png;base64,iVBORw0KGgo=')).toEqual([])
    expect(collectPolicyUrls('javascript:alert(1)')).toEqual([])
    expect(collectPolicyUrls('report.html')).toEqual([])
  })

  it('collects recursively through arrays and nested call options', () => {
    expect(collectPolicyUrls([
      'file:///tmp/local.html',
      'selector',
      { url: 'https://example.com/', children: [{ href: 'ws://host:1' }] },
    ])).toEqual(['file:///tmp/local.html', 'https://example.com/', 'ws://host:1'])
    expect(collectPolicyUrls({ setInputFiles: { paths: ['E:\\work\\a.png', 'workspace://b.png'], strict: true } })).toEqual([])
    expect(collectPolicyUrls(null)).toEqual([])
    expect(collectPolicyUrls(42)).toEqual([])
  })

  it('keeps data-URI page content out of the policy check', () => {
    const html = '<!doctype html><body><img src="data:image/png;base64,iVBORw0KGgo="></body></html>'
    expect(collectPolicyUrls({ html })).toEqual([])
  })
})
