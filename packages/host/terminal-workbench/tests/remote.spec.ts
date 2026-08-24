import { describe, expect, it } from 'vitest'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'

describe('Terminal Workbench generated Remote', () => {
  it('keeps every terminal operation behind the Agent lookup fence', () => {
    const descriptors = TYPERT_REMOTE.descriptors
    expect(descriptors.map(item => item.namespace)).toEqual(Array(descriptors.length).fill('terminal-workbench'))
    expect(descriptors.map(item => item.method).sort()).toEqual([
      'backends', 'input', 'kill', 'list', 'readRaw', 'resize', 'spawn',
    ])
    for (const descriptor of descriptors) {
      expect(descriptor.parameters[0]).toMatchObject({ name: 'agent', source: 'lookup', lookup: 'agent' })
    }
  })
})
