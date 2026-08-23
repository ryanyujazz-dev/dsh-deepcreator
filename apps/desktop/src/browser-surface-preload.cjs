const { ipcRenderer } = require('electron')
const prefix = '--deepcreator-surface-id='
const surfaceId = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
if (surfaceId) {
  const notify = event => { if (event.isTrusted) ipcRenderer.send('deepcreator:browser-surface:user-input', surfaceId) }
  addEventListener('pointerdown', notify, true)
  addEventListener('keydown', notify, true)
  addEventListener('beforeinput', notify, true)
}
