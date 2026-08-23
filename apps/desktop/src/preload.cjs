const { contextBridge, ipcRenderer } = require('electron')
const surfaceChannels = Object.freeze({
  mount: 'deepcreator:browser-surface:mount', bounds: 'deepcreator:browser-surface:bounds',
  visible: 'deepcreator:browser-surface:visible', unmount: 'deepcreator:browser-surface:unmount',
})
const windowChannels = Object.freeze({
  get: 'deepcreator:window:get', changed: 'deepcreator:window:changed',
  titlebarTheme: 'deepcreator:window:titlebar-theme',
})
contextBridge.exposeInMainWorld('deepcreatorBrowserSurface', Object.freeze({
  mount: (surfaceId, bounds) => ipcRenderer.invoke(surfaceChannels.mount, surfaceId, bounds),
  setBounds: (surfaceId, bounds) => ipcRenderer.invoke(surfaceChannels.bounds, surfaceId, bounds),
  setVisible: (surfaceId, visible) => ipcRenderer.invoke(surfaceChannels.visible, surfaceId, visible),
  unmount: surfaceId => ipcRenderer.invoke(surfaceChannels.unmount, surfaceId),
}))
contextBridge.exposeInMainWorld('deepcreatorWindow', Object.freeze({
  getState: () => ipcRenderer.invoke(windowChannels.get),
  onStateChange: listener => { const handler = (_event, state) => listener(state); ipcRenderer.on(windowChannels.changed, handler); return () => ipcRenderer.removeListener(windowChannels.changed, handler) },
  setTitleBarTheme: (color, symbolColor) => ipcRenderer.invoke(windowChannels.titlebarTheme, color, symbolColor),
}))
