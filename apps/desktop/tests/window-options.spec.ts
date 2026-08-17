import { describe, expect, it } from 'vitest'
import {
  MACOS_TRAFFIC_LIGHT_POSITION,
  nativeWindowChromeOptions,
} from '../src/window-options.ts'

describe('nativeWindowChromeOptions', () => {
  it('removes the macOS title bar while retaining aligned native traffic lights', () => {
    expect(nativeWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
    })
    expect(MACOS_TRAFFIC_LIGHT_POSITION).toEqual({ x: 20, y: 17 })
  })

  it('leaves other platform frames and controls unchanged', () => {
    expect(nativeWindowChromeOptions('win32')).toEqual({})
    expect(nativeWindowChromeOptions('linux')).toEqual({})
  })
})
