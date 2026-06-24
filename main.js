const { app, ipcMain, Menu } = require('electron')
const Store = require('./src/store')
const WindowManager = require('./src/window-manager')
const TrayManager = require('./src/tray')
const WindowMonitor = require('./src/window-monitor')
const MoodEngine = require('./src/mood-engine')
const SessionTracker = require('./src/session-tracker')
const TaskManager = require('./src/task-manager')
const QuoteEngine = require('./src/quote-engine')
const AutoLaunch = require('./src/auto-launch')

let store, windowManager, trayManager, windowMonitor, moodEngine, sessionTracker, taskManager, quoteEngine

app.whenReady().then(async () => {
  store = new Store()
  windowManager = new WindowManager(store)
  moodEngine = new MoodEngine(store)
  sessionTracker = new SessionTracker(store, moodEngine)
  taskManager = new TaskManager(store)
  quoteEngine = new QuoteEngine(store)

  await windowManager.createOverlay()
  await windowManager.createDashboard()
  trayManager = new TrayManager(windowManager, store)
  trayManager.create()

  // Wire window monitor -> mood engine
  windowMonitor = new WindowMonitor(store)
  windowMonitor.on('foreground-changed', (info) => {
    if (!store.get('settings.paused')) moodEngine.onWindowChanged(info)
  })
  windowMonitor.start()

  // Wire mood engine -> overlay IPC
  moodEngine.on('mood-transition', (state) => {
    windowManager.sendToOverlay('mood-changed', state)
    sessionTracker.onMoodChange(state.mood)
  })

  moodEngine.on('milestone', (type) => {
    const quote = quoteEngine.getQuote(type)
    if (quote) windowManager.sendToOverlay('quote-show', quote)
  })

  moodEngine.on('distraction-timer', (seconds) => {
    windowManager.sendToOverlay('distraction-timer-update', seconds)
  })

  // Wire task manager -> mood engine
  taskManager.on('nagging-changed', (hasOverdue) => {
    moodEngine.setNagging(hasOverdue)
    if (hasOverdue) {
      const overdue = taskManager.getOverdueTasks()
      if (overdue.length > 0) windowManager.sendToOverlay('task-nagging', overdue[0].name)
    }
  })

  // Keep task badge updated
  setInterval(() => {
    const count = taskManager.getOverdueTasks().length
    windowManager.sendToOverlay('task-badge-update', count)
    windowManager.sendToDashboard('tasks-update', taskManager.getTasks())
  }, 5000)

  // Daily reset on launch
  sessionTracker.checkDateRollover()

  // Enable startup on first run
  await AutoLaunch.enableIfFirstRun(store)

  setupIpcHandlers()
})

function setupIpcHandlers() {
  // ── Overlay ──────────────────────────────────────────────────────
  ipcMain.on('character-clicked', () => {
    const overlay = windowManager.getOverlayWindow()
    if (!overlay) return
    const paused = store.get('settings.paused')
    const menu = Menu.buildFromTemplate([
      { label: '📋 Dashboard', click: () => windowManager.showDashboard() },
      {
        label: paused ? '▶  Resume' : '⏸  Pause',
        click: () => {
          const next = !store.get('settings.paused')
          store.set('settings.paused', next)
          if (next) { windowMonitor.pause(); moodEngine.pause() }
          else { windowMonitor.resume(); moodEngine.resume() }
          trayManager.updatePauseLabel(next)
        }
      },
      { type: 'separator' },
      { label: '✅ Quick Task', click: () => windowManager.showDashboard('tasks') }
    ])
    menu.popup({ window: overlay })
  })

  ipcMain.on('set-ignore-mouse-events', (_, ignore) => {
    const overlay = windowManager.getOverlayWindow()
    if (overlay) overlay.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on('drag-position-update', (_, { x, y }) => {
    store.set('settings.overlayX', x)
    store.set('settings.overlayY', y)
  })

  // ── Tasks ────────────────────────────────────────────────────────
  ipcMain.handle('add-task', (_, { name, durationMinutes }) => {
    const task = taskManager.addTask(name, durationMinutes)
    windowManager.sendToDashboard('tasks-update', taskManager.getTasks())
    return task
  })

  ipcMain.handle('complete-task', (_, id) => {
    const ok = taskManager.completeTask(id)
    if (ok) {
      const quote = quoteEngine.getQuote('task-complete')
      if (quote) windowManager.sendToOverlay('quote-show', quote)
      // Brief happy flash on completion
      windowManager.sendToOverlay('mood-changed', { mood: 'happy', reason: 'task-complete' })
      setTimeout(() => moodEngine.recalculate(), 3000)
    }
    windowManager.sendToDashboard('tasks-update', taskManager.getTasks())
    return ok
  })

  ipcMain.handle('dismiss-task', (_, id) => {
    taskManager.dismissTask(id)
    windowManager.sendToDashboard('tasks-update', taskManager.getTasks())
  })

  ipcMain.handle('get-tasks', () => taskManager.getTasks())

  // ── Stats ────────────────────────────────────────────────────────
  ipcMain.handle('get-stats', () => sessionTracker.getTodayStats())

  // ── Lists / Settings ─────────────────────────────────────────────
  ipcMain.handle('get-lists', () => ({
    productiveApps: store.get('productiveApps'),
    distractionApps: store.get('distractionApps'),
    productiveSites: store.get('productiveSites'),
    distractionSites: store.get('distractionSites'),
    quotes: store.get('quotes')
  }))

  ipcMain.handle('update-lists', (_, lists) => {
    const keys = ['productiveApps', 'distractionApps', 'productiveSites', 'distractionSites', 'quotes']
    keys.forEach(k => { if (lists[k] !== undefined) store.set(k, lists[k]) })
    return true
  })

  ipcMain.handle('toggle-startup', async (_, enabled) => {
    await AutoLaunch.toggle(enabled)
    return enabled
  })

  ipcMain.handle('get-startup-status', async () => AutoLaunch.isEnabled())

  ipcMain.on('open-dashboard', (_, tab) => windowManager.showDashboard(tab))
}

app.on('window-all-closed', () => {
  // Stay in tray — do not quit on window close
})

app.on('before-quit', () => {
  if (windowMonitor) windowMonitor.stop()
})
