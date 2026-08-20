const { contextBridge, ipcRenderer } = require('electron')
const channels = Object.freeze({
  create: 'deepcreator:browser:create', navigate: 'deepcreator:browser:navigate', back: 'deepcreator:browser:back',
  forward: 'deepcreator:browser:forward', reload: 'deepcreator:browser:reload', bounds: 'deepcreator:browser:bounds',
  close: 'deepcreator:browser:close', state: 'deepcreator:browser:state', popup: 'deepcreator:browser:popup',
})
const windowChannels = Object.freeze({
  get: 'deepcreator:window:get', changed: 'deepcreator:window:changed',
})
contextBridge.exposeInMainWorld('deepcreatorBrowser', Object.freeze({
  create: (id, url, bounds) => ipcRenderer.invoke(channels.create, id, url, bounds),
  navigate: (id, url) => ipcRenderer.invoke(channels.navigate, id, url), back: id => ipcRenderer.invoke(channels.back, id),
  forward: id => ipcRenderer.invoke(channels.forward, id), reload: id => ipcRenderer.invoke(channels.reload, id),
  setBounds: (id, bounds) => ipcRenderer.invoke(channels.bounds, id, bounds), close: id => ipcRenderer.invoke(channels.close, id),
  onState: listener => { const handler = (_event, state) => listener(state); ipcRenderer.on(channels.state, handler); return () => ipcRenderer.removeListener(channels.state, handler) },
  onPopup: listener => { const handler = (_event, popup) => listener(popup); ipcRenderer.on(channels.popup, handler); return () => ipcRenderer.removeListener(channels.popup, handler) },
}))
contextBridge.exposeInMainWorld('deepcreatorWindow', Object.freeze({
  getState: () => ipcRenderer.invoke(windowChannels.get),
  onStateChange: listener => { const handler = (_event, state) => listener(state); ipcRenderer.on(windowChannels.changed, handler); return () => ipcRenderer.removeListener(windowChannels.changed, handler) },
}))
