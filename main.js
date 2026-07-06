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
let reasonAttempts = 0   // End-Work excuse gauntlet: Mochi rejects the first two
let reasonExcuses = []   // ...and logs every excuse she was given
let sessionGoal = null   // the todo she committed to attacking this session

const LOCK_MINUTES = 60  // 🔒 locked-session length
// Escalating strikes: blocker threshold per prior block today (5m → 3m → 1m → 10s)
const STRIKE_THRESHOLDS_MS = [5 * 60000, 3 * 60000, 1 * 60000, 10 * 1000]
const SHOP_ITEMS = [
  { id: 'bow', emoji: '🎀', name: 'hair bow', cost: 10 },
  { id: 'flower', emoji: '🌸', name: 'flower', cost: 15 },
  { id: 'scarf', emoji: '🧣', name: 'scarf', cost: 20 },
  { id: 'glasses', emoji: '🕶️', name: 'sunnies', cost: 25 },
  { id: 'sprout', emoji: '🌱', name: 'sprout friend', cost: 30 },
  { id: 'crown', emoji: '👑', name: 'crown', cost: 40 }
]


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
  let lastForegroundClass = null
  windowMonitor.on('foreground-changed', (info) => {
    if (blocking) return // blocker is up (and is itself the foreground app) — ignore until dismissed
    if (sessionManager.state === 'working' && !store.get('settings.paused')) {
      moodEngine.onWindowChanged(info)
      const cls = WindowMonitor.classify(info, store)
      // Distraction pauses the work clock + drains the break budget.
      sessionManager.setDistracted(cls === 'distraction')
      // Pop up / restore ONLY on classification transitions. The monitor emits on
      // every 2.5s poll — reacting every time made forceShow() fight the user's
      // Ctrl+M hide (Mochi reappeared within 2.5s: "the toggle doesn't work").
      if (cls !== lastForegroundClass) {
        if (cls === 'distraction') {
          windowManager.forceShow()
        } else {
          windowManager.restoreUserPreference()
        }
      }
      lastForegroundClass = cls
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

  // Distraction threshold crossed during a work session → full-screen lock-in.
  // Every block today is a strike: the next one fires sooner (5m → 3m → 1m → 10s),
  // and each strike costs carrots.
  moodEngine.on('block-site', (name) => {
    if (sessionManager.state !== 'working' || store.get('settings.paused')) return
    blocking = true
    addStrike()
    addCarrots(-2, `strike ${strikesToday()} — caught on ${String(name).slice(0, 30)}`)
    windowManager.showBlocker(name, sessionManager.isLocked())
  })

  // Strikes from earlier today still apply after a restart.
  applyStrikeThreshold()

  sessionManager.on('locked-denied', () => {
    const min = sessionManager.getStatus().lockRemainingMin
    windowManager.sendToOverlay('mood-changed', { mood: 'angry', prevMood: 'happy' })
    windowManager.sendToOverlay('quote-show', `🔒 locked session. ${min} min left — no breaks, no escape.`)
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
    const g = computeGamification()
    windowManager.sendToDashboard('gamification-update', g)

    // Carrots: +3 per focus block, +5 for closing the daily ring (once/day).
    const today = store.getTodayKey()
    const cs = store.get('carrotState') || {}
    const awarded = cs.date === today ? (cs.blocksAwarded || 0) : 0
    const ringClosed = cs.date === today ? !!cs.ringClosed : false
    const newBlocks = g.blocksDone - awarded
    if (newBlocks > 0) addCarrots(3 * newBlocks, newBlocks > 1 ? `${newBlocks} focus blocks done` : 'focus block done')
    const closesRing = !ringClosed && g.blocksDone >= g.goalBlocks && g.blocksDone > 0
    if (closesRing) addCarrots(5, 'daily ring closed!')
    if (newBlocks > 0 || closesRing) {
      store.set('carrotState', { date: today, blocksAwarded: Math.max(awarded, g.blocksDone), ringClosed: ringClosed || closesRing })
    }
  }, 5000)

  sessionTracker.checkDateRollover()

  // Global hotkey: show/hide Mochi. ONE binding only — the extra fallbacks turned
  // out to steal real shortcuts globally (Ctrl+Shift+M is VS Code's Problems
  // panel, Alt+Shift+M collides with keyboard-layout switching). The tray's
  // "Show/Hide Mochi" item is the conflict-proof fallback.
  const toggleViz = () => {
    windowManager.toggleOverlayVisibility()
    if (trayManager) trayManager.updatePauseLabel() // keep the tray Show/Hide label in sync
  }
  const hotkeyOk = globalShortcut.register('CommandOrControl+M', toggleViz)
  if (hotkeyOk) console.log('[hotkey] toggle bound to: Ctrl+M')
  else console.error('[hotkey] Ctrl+M taken — use the tray menu Show/Hide')

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
// Walks LOCAL calendar days to match store.getTodayKey's local date keys.
function computeDayStreak(stats) {
  const p = (n) => String(n).padStart(2, '0')
  const keyOf = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const has = (k) => !!(stats[k] && (stats[k].focusMinutes || 0) >= STREAK_MIN)
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  if (!has(keyOf(cursor))) cursor.setDate(cursor.getDate() - 1) // today not active yet — streak can still be alive
  let streak = 0
  while (has(keyOf(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1) }
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

// ── Carrot economy 🥕 ────────────────────────────────────────────────
function getCarrots() { return store.get('carrots') || 0 }

function addCarrots(n, why) {
  const total = Math.max(0, getCarrots() + n)
  store.set('carrots', total)
  windowManager.sendToOverlay('carrots-update', total)
  windowManager.sendToDashboard('shop-update', shopState())
  if (why) logActivity({ icon: '🥕', text: `${n > 0 ? '+' : ''}${n} 🥕 — ${why}`, points: 0 })
  return total
}

function shopState() {
  return { carrots: getCarrots(), wardrobe: store.get('wardrobe') || { owned: [], worn: null }, items: SHOP_ITEMS }
}

function pushWornAccessory() {
  const w = store.get('wardrobe') || {}
  const item = SHOP_ITEMS.find(i => i.id === w.worn)
  windowManager.sendToOverlay('wardrobe-update', item ? item.emoji : '')
}

// ── Escalating strikes ───────────────────────────────────────────────
function strikesToday() {
  const s = store.get('dailyStrikes') || {}
  return s.date === store.getTodayKey() ? (s.count || 0) : 0
}

function applyStrikeThreshold() {
  const idx = Math.min(strikesToday(), STRIKE_THRESHOLDS_MS.length - 1)
  moodEngine.setBlockThreshold(STRIKE_THRESHOLDS_MS[idx])
}

function addStrike() {
  store.set('dailyStrikes', { date: store.getTodayKey(), count: strikesToday() + 1 })
  applyStrikeThreshold()
}

// ── Session goal check-in ────────────────────────────────────────────
function settleSessionGoal() {
  if (!sessionGoal) return ''
  const goal = sessionGoal
  sessionGoal = null
  const item = getTodayList().find(t => t.text === goal)
  if (item && item.done) {
    addCarrots(2, `kept your word on "${goal}"`)
    return ` you said "${goal}" and you DID it ✅`
  }
  logActivity({ icon: '😐', text: `said "${goal}"… didn't finish it`, points: 0 })
  return ` you said "${goal}"… still not done 😐 logged.`
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
    windowManager.sendToOverlay('carrots-update', getCarrots())
    pushWornAccessory()
    windowManager.sendToOverlay('open-panel')
    windowManager.sendToOverlay('quote-show', 'hi pavni! 🐰 ready to start a work session?')
  })

  // ── Session controls ──
  // No fresh session without a plan: at least one unfinished item on today's
  // list before Start Work. (Resuming from a break is exempt — flow > nagging.)
  // Fresh sessions also get the goal check-in: which todo are you attacking?
  const startSession = (lockMinutes) => {
    const unfinished = getTodayList().filter(t => !t.done)
    const fresh = sessionManager.state === 'idle'
    if (fresh && unfinished.length === 0) {
      windowManager.forceShow()
      windowManager.sendToOverlay('open-panel')
      flashMood('nagging', 4000)
      windowManager.sendToOverlay('quote-show', "nope. write down what you're fixing today first 📝 then we lock in")
      windowManager.sendToOverlay('focus-todo')
      return
    }
    sessionManager.startWork(lockMinutes)
    if (fresh) {
      sessionGoal = null
      windowManager.sendToOverlay('ask-goal', unfinished.map(t => t.text))
      if (lockMinutes) {
        windowManager.sendToOverlay('quote-show', `🔒 LOCKED for ${lockMinutes} min. no end button, no breaks. we're in this now.`)
      }
    }
  }
  ipcMain.on('session-start-work', () => startSession())
  ipcMain.on('session-start-locked', () => startSession(LOCK_MINUTES))

  // She picked which todo she's attacking this session.
  ipcMain.on('session-goal', (_, text) => {
    sessionGoal = String(text || '').trim() || null
    if (sessionGoal) windowManager.sendToOverlay('quote-show', `"${sessionGoal}" — ok. lock in 💪`)
  })
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
    // Locked sessions have no exit — not even the excuse gauntlet.
    if (sessionManager.state !== 'idle' && sessionManager.isLocked()) {
      const min = sessionManager.getStatus().lockRemainingMin
      windowManager.forceShow()
      flashMood('angry', 5000)
      windowManager.sendToOverlay('quote-show', `🔒 you LOCKED this session. ${min} min to go. back to work.`)
      return
    }
    const unfinished = getTodayList().filter(t => !t.done)
    if (unfinished.length > 0) {
      reasonAttempts = 0
      reasonExcuses = []
      windowManager.forceShow()
      flashMood('angry', 6000)
      windowManager.sendToOverlay('quote-show',
        `you still have ${unfinished.length} thing${unfinished.length > 1 ? 's' : ''}!! 😤 why are you stopping??`)
      windowManager.sendToOverlay('ask-reason', unfinished.map(t => t.text))
    } else {
      sessionManager.endWork()
      flashMood('celebrate', 4000)
      const d = Math.round(sessionManager.getSessionDistractedMinutes())
      const goalNote = settleSessionGoal()
      windowManager.sendToOverlay('quote-show', (d >= 1
        ? `great work!! 🎉 ${d} min distracted this session — that came off your break.`
        : 'great work today!! zero distractions 🎉') + goalNote)
      logActivity({ icon: '🏁', text: 'Wrapped a session · ' + d + ' min distracted', points: 0 })
    }
  })

  // End-Work excuse gauntlet: Mochi does NOT accept the first excuse. She pushes
  // back twice (with escalating sass) before reluctantly letting you go — and
  // every excuse you gave gets written into the work log.
  ipcMain.on('work-reason', (_, reason) => {
    const text = String(reason || '').trim()
    const unfinished = getTodayList().filter(t => !t.done)
    reasonAttempts++
    reasonExcuses.push(text)

    if (reasonAttempts < 3) {
      windowManager.forceShow()
      flashMood('angry', 5000)
      const n = unfinished.length
      const sass = reasonAttempts === 1
        ? `"${text.slice(0, 40)}"?? that's an excuse, not a reason 😤 try again`
        : `still not buying it. ${n} thing${n === 1 ? '' : 's'} left. one more try — convince me 👀`
      windowManager.sendToOverlay('reason-rejected', sass)
      return
    }

    const distractedMin = Math.round(sessionManager.getSessionDistractedMinutes())
    const log = store.get('workLog') || []
    log.push({
      date: store.getTodayKey(),
      at: new Date().toISOString(),
      reason: text,
      excuses: reasonExcuses.slice(),
      unfinished: unfinished.map(t => t.text),
      distractedMin
    })
    store.set('workLog', log)
    reasonAttempts = 0
    reasonExcuses = []
    sessionManager.endWork()
    const goalNote = settleSessionGoal()
    windowManager.sendToOverlay('quote-show',
      `UGH. fine. 😤 all 3 excuses are in the log + ${distractedMin} min distracted.${goalNote} tmrw we do better.`)
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
    if (process.env.MOCHI_DEBUG) console.log('[todo-debug] main toggle', id, 'found=', !!item, 'wasDone=', item && item.done)
    if (!item) return
    item.done = !item.done
    store.set('todayList', all)
    pushTodayList()

    if (item.done) {
      addCarrots(2, `task done: ${item.text.slice(0, 30)}`)
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

  // ── Carrot shop 🥕 ──
  ipcMain.handle('get-shop', () => shopState())
  ipcMain.handle('shop-buy', (_, id) => {
    const item = SHOP_ITEMS.find(i => i.id === id)
    const w = store.get('wardrobe') || { owned: [], worn: null }
    if (!item || w.owned.includes(id)) return shopState()
    if (getCarrots() < item.cost) {
      windowManager.sendToOverlay('quote-show', `not enough carrots for the ${item.name} 🥕 keep focusing`)
      return shopState()
    }
    addCarrots(-item.cost, `bought the ${item.name} ${item.emoji}`)
    w.owned.push(id)
    w.worn = id
    store.set('wardrobe', w)
    pushWornAccessory()
    windowManager.sendToOverlay('quote-show', `the ${item.name} ${item.emoji}!! she's beautiful`)
    return shopState()
  })
  ipcMain.handle('shop-wear', (_, id) => {
    const w = store.get('wardrobe') || { owned: [], worn: null }
    w.worn = (id && w.owned.includes(id)) ? id : null
    store.set('wardrobe', w)
    pushWornAccessory()
    return shopState()
  })

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
