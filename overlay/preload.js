const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mochi', {
  // Receive from main
  onMoodChanged: (cb) => ipcRenderer.on('mood-changed', (_, data) => cb(data)),
  onQuoteShow: (cb) => ipcRenderer.on('quote-show', (_, text) => cb(text)),
  onDistractionTimer: (cb) => ipcRenderer.on('distraction-timer-update', (_, s) => cb(s)),
  onTaskNagging: (cb) => ipcRenderer.on('task-nagging', (_, name) => cb(name)),
  onTaskBadgeUpdate: (cb) => ipcRenderer.on('task-badge-update', (_, count) => cb(count)),

  // Send to main
  characterClicked: () => ipcRenderer.send('character-clicked'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  dragPositionUpdate: (x, y) => ipcRenderer.send('drag-position-update', { x, y })
})
