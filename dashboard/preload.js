const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mochi', {
  // Tasks
  getTasks: () => ipcRenderer.invoke('get-tasks'),
  addTask: (name, durationMinutes) => ipcRenderer.invoke('add-task', { name, durationMinutes }),
  completeTask: (id) => ipcRenderer.invoke('complete-task', id),
  dismissTask: (id) => ipcRenderer.invoke('dismiss-task', id),

  // Stats
  getStats: () => ipcRenderer.invoke('get-stats'),

  // Lists
  getLists: () => ipcRenderer.invoke('get-lists'),
  updateLists: (lists) => ipcRenderer.invoke('update-lists', lists),

  // Startup
  getStartupStatus: () => ipcRenderer.invoke('get-startup-status'),
  toggleStartup: (enabled) => ipcRenderer.invoke('toggle-startup', enabled),

  // Receive from main
  onTasksUpdate: (cb) => ipcRenderer.on('tasks-update', (_, tasks) => cb(tasks)),
  onStatsUpdate: (cb) => ipcRenderer.on('stats-update', (_, stats) => cb(stats)),
  onSwitchTab: (cb) => ipcRenderer.on('switch-tab', (_, tab) => cb(tab))
})
