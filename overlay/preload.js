const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mochi', {
  // Receive from main
  onMoodChanged: (cb) => ipcRenderer.on('mood-changed', (_, data) => cb(data)),
  onQuoteShow: (cb) => ipcRenderer.on('quote-show', (_, text) => cb(text)),
  onDistractionTimer: (cb) => ipcRenderer.on('distraction-timer-update', (_, s) => cb(s)),
  onTaskNagging: (cb) => ipcRenderer.on('task-nagging', (_, name) => cb(name)),
  onTaskBadgeUpdate: (cb) => ipcRenderer.on('task-badge-update', (_, count) => cb(count)),
  onSessionStatus: (cb) => ipcRenderer.on('session-status', (_, status) => cb(status)),
  onTodayList: (cb) => ipcRenderer.on('today-list', (_, items) => cb(items)),
  onTogglePanel: (cb) => ipcRenderer.on('toggle-panel', () => cb()),
  onOpenPanel: (cb) => ipcRenderer.on('open-panel', () => cb()),
  onSpriteManifest: (cb) => ipcRenderer.on('sprite-manifest', (_, manifest) => cb(manifest)),
  onPlayFlop: (cb) => ipcRenderer.on('play-flop', () => cb()),

  // Send to main
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  requestInit: () => ipcRenderer.send('overlay-request-init'),

  // Session controls
  startWork: () => ipcRenderer.send('session-start-work'),
  takeBreak: () => ipcRenderer.send('session-take-break'),
  endWork: () => ipcRenderer.send('session-end-work'),
  submitReason: (reason) => ipcRenderer.send('work-reason', reason),
  onAskReason: (cb) => ipcRenderer.on('ask-reason', (_, items) => cb(items)),
  onReasonRejected: (cb) => ipcRenderer.on('reason-rejected', (_, msg) => cb(msg)),
  onFocusTodo: (cb) => ipcRenderer.on('focus-todo', () => cb()),

  // Today list
  addTodo: (text) => ipcRenderer.send('today-add', text),
  toggleTodo: (id) => ipcRenderer.send('today-toggle', id),
  removeTodo: (id) => ipcRenderer.send('today-remove', id)
})
