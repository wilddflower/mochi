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
const { buildSpriteManifest } = require('./src/sprite-manifest')

// The overlay is a transparent, always-on-top window. On Windows, GPU
// compositing can fail to paint transparent windows at larger sizes (the
// content goes invisible with no error) — forcing software compositing keeps
// Mochi + the panel reliably visible. Must be called before app 'ready'.
app.disableHardwareAcceleration()

let store, windowManager, trayManager, windowMonitor, moodEngine
let sessionTracker, sessionManager, taskManager, quoteEngine
let blocking = false  // true while the full-screen lock-in blocker is up


// Single-instance lock — auto-launch and the login Startup shortcut can both try
// to start Mochi; without this a second copy spawns a duplicate overlay, tray, and
// PowerShell poller that fight each other. The second instance just bows out (and
// surfaces the dashboard of the one already running).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {

app.on('second-instance', () => {
  if (windowManager) windowManager.showDashboard()
})

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
  await windowManager.createBlocker()
  trayManager = new TrayManager(windowManager, store, (paused) => {
    // Tray pause/resume must actually quiet the engine — not just flip a flag.
    if (paused) {
      moodEngine.pause()
      if (windowMonitor) windowMonitor.pause()
      sessionManager.setDistracted(false) // stop draining break while paused
      blocking = false
      windowManager.hideBlocker()
      windowManager.sendToOverlay('distraction-timer-update', 0)
      windowManager.sendToOverlay('mood-changed', { mood: 'encouraging' })
    } else {
      if (windowMonitor) windowMonitor.resume()
      moodEngine.resume()
    }
  })
  trayManager.create()

  // Window monitor → mood engine (only while a work session is active)
  windowMonitor = new WindowMonitor(store)
  windowMonitor.on('foreground-changed', (info) => {
    if (blocking) return // blocker is up (and is itself the foreground app) — ignore until dismissed
    if (sessionManager.state === 'working' && !store.get('settings.paused')) {
      moodEngine.onWindowChanged(info)
      const distraction = WindowMonitor.classify(info, store) === 'distraction'
      // Distraction pauses the work clock + drains the break budget.
      sessionManager.setDistracted(distraction)
      // Caught on a blocked site → pop up even if Ctrl+M-hidden; restore when off.
      if (distraction) {
        windowManager.forceShow()
      } else {
        windowManager.restoreUserPreference()
      }
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

  // 5 min on a distraction during a work session → full-screen lock-in.
  moodEngine.on('block-site', (name) => {
    if (sessionManager.state !== 'working' || store.get('settings.paused')) return
    blocking = true
    windowManager.showBlocker(name)
  })

  // Session manager → mood engine + overlay
  sessionManager.on('state-changed', (status) => {
    moodEngine.setSessionState(status.state)
    windowManager.sendToOverlay('session-status', status)
    // Leaving work mode (break / end) clears any active lock-in.
    if (status.state !== 'working' && blocking) { blocking = false; windowManager.hideBlocker() }

    if (status.state === 'working' && !status.forced) {
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
    // Fires right after the forced state-changed→working above; flashMood shows
    // the angry reaction over the working mood, then reverts to the real mood.
    flashMood('angry', 4500)
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

  // Keep overdue task badge + dashboard data fresh (incl. live focus-block progress)
  setInterval(() => {
    const count = taskManager.getOverdueTasks().length
    windowManager.sendToOverlay('task-badge-update', count)
    windowManager.sendToDashboard('tasks-update', taskManager.getTasks())
    windowManager.sendToDashboard('gamification-update', computeGamification())
  }, 5000)

  sessionTracker.checkDateRollover()

  // Global hotkey: show/hide Mochi entirely
  const hotkeyOk = globalShortcut.register('CommandOrControl+M', () => {
    windowManager.toggleOverlayVisibility()
  })
  if (!hotkeyOk) console.error('[hotkey] Ctrl+M registration failed (already in use)')

  await AutoLaunch.enableIfFirstRun(store)
})

} // end single-instance guard

// ── Today list helpers ───────────────────────────────────────────────
function getTodayList() {
  const all = store.get('todayList') || []
  return all.filter(t => t.date === store.getTodayKey())
}

function pushTodayList() {
  windowManager.sendToOverlay('today-list', getTodayList())
}

// Briefly show a celebration mood, then snap back to Mochi's real current mood.
function flashMood(mood, ms = 4000) {
  windowManager.sendToOverlay('mood-changed', { mood })
  setTimeout(() => {
    windowManager.sendToOverlay('mood-changed', { mood: moodEngine.getCurrentMood() })
  }, ms)
}

// ── Gamification (all derived from real stored data) ─────────────────
const BLOCK_MIN = 25            // one "focus block" = 25 min of work-session time
const POINTS_PER_LEVEL = 200    // points to advance a level
const STREAK_MIN = 5            // a day counts toward the streak at >= 5 focus min

// XP for completing a task — scales with its duration, clamped to 5..60.
function xpForTask(task) {
  return Math.max(5, Math.min(60, Math.round((task && task.durationMinutes) || 10)))
}

// Consecutive days (ending today, or yesterday if today's still empty) with real focus.
function computeDayStreak(stats) {
  const DAY = 86400000
  const keyOf = (ms) => new Date(ms).toISOString().slice(0, 10)
  const has = (k) => !!(stats[k] && (stats[k].focusMinutes || 0) >= STREAK_MIN)
  let cursor = Date.parse(store.getTodayKey() + 'T00:00:00.000Z')
  if (!has(keyOf(cursor))) cursor -= DAY // today not active yet — streak can still be alive
  let streak = 0
  while (has(keyOf(cursor))) { streak++; cursor -= DAY }
  return streak
}

function computeGamification() {
  const stats = store.get('stats') || {}
  const lifetimeFocus = Object.keys(stats).reduce((s, d) => s + (stats[d].focusMinutes || 0), 0)
  const bonus = (store.get('activityLog') || []).reduce((s, a) => s + (a.points || 0), 0)
  const points = Math.round(lifetimeFocus) + bonus
  const settings = store.get('settings') || {}
  const goalBlocks = settings.dailyGoalBlocks || 5
  const workTodayMin = (sessionManager.getStatus().workTodayMs || 0) / 60000
  const todayKey = store.getTodayKey()
  const wins = (store.get('todayList') || []).filter(t => t.date === todayKey && t.done).map(t => t.text)
  return {
    points,
    level: Math.floor(points / POINTS_PER_LEVEL) + 1,
    xpInLevel: points % POINTS_PER_LEVEL,
    xpForLevel: POINTS_PER_LEVEL,
    dayStreak: computeDayStreak(stats),
    blocksDone: Math.floor(workTodayMin / BLOCK_MIN),
    goalBlocks,
    wins
  }
}

// Append an event and push fresh gamification + activity to the dashboard.
function logActivity(entry) {
  store.pushActivity(entry)
  windowManager.sendToDashboard('activity-update', (store.get('activityLog') || []).slice(0, 12))
  windowManager.sendToDashboard('gamification-update', computeGamification())
}

function setupIpcHandlers() {
  // ── Overlay basics ──
  ipcMain.on('set-ignore-mouse-events', (_, ignore) => {
    const overlay = windowManager.getOverlayWindow()
    if (overlay) overlay.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on('overlay-request-init', () => {
    windowManager.sendToOverlay('sprite-manifest', buildSpriteManifest())
    windowManager.sendToOverlay('session-status', sessionManager.getStatus())
    pushTodayList()
    windowManager.sendToOverlay('open-panel')
    windowManager.sendToOverlay('quote-show', 'hi pavni! 🐰 ready to start a work session?')
  })

  // ── Session controls ──
  ipcMain.on('session-start-work', () => sessionManager.startWork())
  ipcMain.on('session-take-break', () => sessionManager.takeBreak())

  // Full-screen blocker dismissed → hide it and restart the 5-min countdown.
  ipcMain.on('blocker-dismiss', () => {
    blocking = false
    windowManager.hideBlocker()
    moodEngine.resetDistraction()
  })

  // End Work: if the to-do list isn't done, get annoyed and demand a reason
  // before ending. Otherwise end happily.
  ipcMain.on('session-end-work', () => {
    const unfinished = getTodayList().filter(t => !t.done)
    if (unfinished.length > 0) {
      windowManager.forceShow()
      flashMood('angry', 6000)
      windowManager.sendToOverlay('quote-show',
        `you still have ${unfinished.length} thing${unfinished.length > 1 ? 's' : ''}!! 😤 why are you stopping??`)
      windowManager.sendToOverlay('ask-reason', unfinished.map(t => t.text))
    } else {
      sessionManager.endWork()
      flashMood('celebrate', 4000)
      const d = Math.round(sessionManager.getSessionDistractedMinutes())
      windowManager.sendToOverlay('quote-show', d >= 1
        ? `great work!! 🎉 ${d} min distracted this session — that came off your break`
        : 'great work today!! zero distractions 🎉')
      logActivity({ icon: '🏁', text: 'Wrapped a session · ' + d + ' min distracted', points: 0 })
    }
  })

  // Reason submitted from the End Work prompt → log it and end the session.
  ipcMain.on('work-reason', (_, reason) => {
    const distractedMin = Math.round(sessionManager.getSessionDistractedMinutes())
    const log = store.get('workLog') || []
    log.push({
      date: store.getTodayKey(),
      at: new Date().toISOString(),
      reason: String(reason || '').trim(),
      unfinished: getTodayList().filter(t => !t.done).map(t => t.text),
      distractedMin
    })
    store.set('workLog', log)
    sessionManager.endWork()
    windowManager.sendToOverlay('quote-show', `...fine. logged it. 👀 ${distractedMin} min distracted today — do better tmrw`)
  })

  // ── Today list ──
  ipcMain.on('today-add', (_, text) => {
    const today = store.getTodayKey()
    // Prune previous days' items so the list can't grow unbounded.
    const all = (store.get('todayList') || []).filter(t => t.date === today)
    all.push({ id: Date.now(), text: String(text).trim(), done: false, date: today })
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
      if (remaining === 0) {
        // Whole list cleared → crown celebration
        flashMood('celebrate', 5000)
        windowManager.sendToOverlay('quote-show', 'ALL DONE! you legend 🎉')
        logActivity({ icon: '🎉', text: "Cleared today's list!", points: 20 })
      } else {
        // One task done → the "complete" pose (both ears flopped)
        flashMood('complete', 3000)
        const quote = quoteEngine.getQuote('task-complete')
        windowManager.sendToOverlay('quote-show', quote || 'nice one! ✓')
        logActivity({ icon: '✅', text: 'Done: ' + item.text, points: 5 })
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
    const task = taskManager.getTasks().find(t => t.id === id)
    const wasDone = task ? task.done : true
    const ok = taskManager.completeTask(id)
    if (ok) {
      const quote = quoteEngine.getQuote('task-complete')
      if (quote) windowManager.sendToOverlay('quote-show', quote)
      flashMood('happy', 3000)
      if (task && !wasDone) logActivity({ icon: '✅', text: 'Finished: ' + task.name, points: xpForTask(task) })
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
  ipcMain.handle('get-stats', () => {
    const s = sessionTracker.getTodayStats()
    // Use the break-draining distraction accounting for "distracted today".
    return { ...s, distractionMinutes: Math.round(sessionManager.getDistractedTodayMinutes()) }
  })

  // ── Gamification ──
  ipcMain.handle('get-gamification', () => computeGamification())
  ipcMain.handle('get-activity', () => (store.get('activityLog') || []).slice(0, 12))

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
