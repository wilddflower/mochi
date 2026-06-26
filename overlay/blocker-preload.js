const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('blocker', {
  onInfo: (cb) => ipcRenderer.on('blocker-info', (_, name) => cb(name)),
  dismiss: () => ipcRenderer.send('blocker-dismiss')
})
