const { app, ipcMain, globalShortcut } = require('electron')
const Store = require('./src/store')
const WindowManager = require('./src/window-manager')
const TrayManager = require('./src/tray')
const WindowMonitor = require('./src/window-monitor')
const MoodEngine = require('./src/mood-engine')
const SessionTracker = require('./src/session-tracker')
const SessionManager = require('./src/session-manager')
const TaskManager = require('./src/task-manager')
const QuoteEngine = require('./src/quote-engine')
const AutoLaunch = require('./src/auto-launch')

let store, windowManager, trayManager, windowMonitor, moodEngine
let sessionTracker, sessionManager, taskManager, quoteEngine

const TODAY_KEY = () => new Date().toISOString().slice(0, 10)

app.whenReady().then(async () => {
  store = new Store()
  windowManager = new WindowManager(store)
  moodEngine = new MoodEngine(store)
  sessionTracker = new SessionTracker(store, moodEngine)
  sessionManager = new SessionManager(store)
  taskManager = new TaskManager(store)
  quoteEngine = new QuoteEngine(store)

  setupIpcHandlers()

  await windowManager.createOverlay()
  await windowManager.createDashboard()
  trayManager = new TrayManager(windowManager, store)
  trayManager.create()

  // Window monitor → mood engine (only while a work session is active)
  windowMonitor = new WindowMonitor(store)
  windowMonitor.on('foreground-changed', (info) => {
    if (sessionManager.state === 'working' && !store.get('settings.paused')) {
      moodEngine.onWindowChanged(info)
    }
  })
  windowMonitor.start()

  // Mood engine → overlay, with context-appropriate quotes
  moodEngine.on('mood-transition', (state) => {
    windowManager.sendToOverlay('mood-changed', state)
    sessionTracker.onMoodChange(state.mood)

    if (state.mood === 'sad' || state.mood === 'angry') {
      const quote = quoteEngine.getQuote('guilt')
      if (quote) windowManager.sendToOverlay('quote-show', quote)
    } else if ((state.mood === 'happy' || state.mood === 'focused') &&
               (state.prevMood === 'sad' || state.prevMood === 'angry')) {
      const quote = quoteEngine.getQuote('return')
      if (quote) windowManager.sendToOverlay('quote-show', quote)
    }
  })

  moodEngine.on('milestone', (type) => {
    const quote = quoteEngine.getQuote(type)
    if (quote) windowManager.sendToOverlay('quote-show', quote)
  })

  moodEngine.on('distraction-timer', (seconds) => {
    windowManager.sendToOverlay('distraction-timer-update', seconds)
  })

  // Session manager → mood engine + overlay
  sessionManager.on('state-changed', (status) => {
    moodEngine.setSessionState(status.state)
    windowManager.sendToOverlay('session-status', status)

    if (status.state === 'working') {
      const quote = quoteEngine.getQuote('start')
      windowManager.sendToOverlay('quote-show', quote || "let's lock in! 💪")
    } else if (status.state === 'break') {
      windowManager.sendToOverlay('quote-show', 'enjoy your break ☕ i\'ll be here')
    }
  })

  sessionManager.on('tick', (status) => {
    windowManager.sendToOverlay('session-status', status)
  })

  sessionManager.on('break-denied', () => {
    windowManager.sendToOverlay('mood-changed', { mood: 'angry', prevMood: 'happy' })
    windowManager.sendToOverlay('quote-show', 'no more breaks today! 😤 back to work')
  })

  sessionManager.on('break-exhausted', () => {
    windowManager.sendToOverlay('mood-changed', { mood: 'angry', prevMood: 'happy' })
    windowManager.sendToOverlay('quote-show', "break's over — you used all 4 hours 😤")
  })

  // Task manager (deadline tasks) → nagging
  taskManager.on('nagging-changed', (hasOverdue) => {
    moodEngine.setNagging(hasOverdue)
    if (hasOverdue && sessionManager.state === 'working') {
      const overdue = taskManager.getOverdueTasks()
      if (overdue.length > 0) windowManager.sendToOverlay('task-nagging', overdue[0].name)
    }
  })

  // Keep overdue task badge fresh
  setInterval(() => {
    const count = taskManager.getOverdueTasks().length
    windowManager.sendToOverlay('task-badge-update', count)
    windowManager.sendToDashboard('tasks-update', taskManager.getTasks())
  }, 5000)

  sessionTracker.checkDateRollover()

  // Global hotkey: pop out the checklist panel
  globalShortcut.register('CommandOrControl+Shift+M', () => {
    windowManager.sendToOverlay('toggle-panel')
  })

  await AutoLaunch.enableIfFirstRun(store)
})

// ── Today list helpers ───────────────────────────────────────────────
function getTodayList() {
  const all = store.get('todayList') || []
  return all.filter(t => t.date === TODAY_KEY())
}

function pushTodayList() {
  windowManager.sendToOverlay('today-list', getTodayList())
}

function setupIpcHandlers() {
  // ── Overlay basics ──
  ipcMain.on('set-ignore-mouse-events', (_, ignore) => {
    const overlay = windowManager.getOverlayWindow()
    if (overlay) overlay.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on('overlay-request-init', () => {
    windowManager.sendToOverlay('session-status', sessionManager.getStatus())
    pushTodayList()
    windowManager.sendToOverlay('open-panel')
    windowManager.sendToOverlay('quote-show', 'hi pavni! 🐰 ready to start a work session?')
  })

  // ── Session controls ──
  ipcMain.on('session-start-work', () => sessionManager.startWork())
  ipcMain.on('session-take-break', () => sessionManager.takeBreak())

  // ── Today list ──
  ipcMain.on('today-add', (_, text) => {
    const all = store.get('todayList') || []
    all.push({ id: Date.now(), text: String(text).trim(), done: false, date: TODAY_KEY() })
    store.set('todayList', all)
    pushTodayList()
  })

  ipcMain.on('today-toggle', (_, id) => {
    const all = store.get('todayList') || []
    const item = all.find(t => t.id === id)
    if (!item) return
    item.done = !item.done
    store.set('todayList', all)
    pushTodayList()

    if (item.done) {
      const remaining = getTodayList().filter(t => !t.done).length
      windowManager.sendToOverlay('mood-changed', { mood: 'happy', prevMood: 'happy' })
      if (remaining === 0) {
        windowManager.sendToOverlay('quote-show', 'ALL DONE! you legend 🎉')
      } else {
        const quote = quoteEngine.getQuote('task-complete')
        windowManager.sendToOverlay('quote-show', quote || 'nice one! ✓')
      }
      windowManager.sendToOverlay('open-panel')
    }
  })

  ipcMain.on('today-remove', (_, id) => {
    let all = store.get('todayList') || []
    all = all.filter(t => t.id !== id)
    store.set('todayList', all)
    pushTodayList()
  })

  // ── Deadline tasks (dashboard) ──
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
      windowManager.sendToOverlay('mood-changed', { mood: 'happy', prevMood: 'happy' })
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

  // ── Stats ──
  ipcMain.handle('get-stats', () => sessionTracker.getTodayStats())

  // ── Lists / settings ──
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
    if (lists.settings) {
      const s = store.get('settings') || {}
      store.set('settings', { ...s, ...lists.settings })
    }
    return true
  })

  ipcMain.handle('toggle-startup', async (_, enabled) => { await AutoLaunch.toggle(enabled); return enabled })
  ipcMain.handle('get-startup-status', async () => AutoLaunch.isEnabled())
  ipcMain.on('open-dashboard', (_, tab) => windowManager.showDashboard(tab))
}

app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  if (windowMonitor) windowMonitor.stop()
  if (sessionManager) sessionManager.stop()
  globalShortcut.unregisterAll()
})
