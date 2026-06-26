const Store = require('electron-store')
const SEED = require('./seed-content.json')

const DEFAULTS = {
  productiveApps: ['code.exe', 'cursor.exe', 'notion.exe', 'obsidian.exe', 'word.exe', 'excel.exe'],
  distractionApps: ['discord.exe'],
  productiveSites: ['github.com', 'stackoverflow.com', 'docs.google.com', 'notion.so'],
  distractionSites: ['youtube.com', 'twitter.com', 'reddit.com', 'tiktok.com', 'instagram.com', 'facebook.com', 'twitch.tv'],
  quotes: [
    "you got this!",
    "lock in.",
    "back on track, let's go",
    "10 min streak!",
    "stay focused",
    "you're doing great",
    "keep going!",
    "one task at a time",
    "almost there",
    "you can do it",
    "deep work mode: on",
    "make it count",
    "the grind never stops",
    "level up",
    "focus mode activated",
    "no distractions",
    "you showed up, that's half the battle",
    "small steps, big results",
    "let's get it",
    "consistency beats perfection",
    "just 5 more minutes",
    "you're in the zone",
    "flow state loading...",
    "doing the thing!",
    "future you is grateful",
    "less scrolling, more shipping",
    "ship it!",
    "make something today",
    "progress > perfection",
    "you've got the skills",
    "execution is everything",
    "build the habit",
    "showing up is 80%",
    "momentum is a superpower",
    "one more hour, then celebrate",
    "this is the work",
    "heads down time",
    "no one's coming to save you — and that's actually good",
    "you're becoming the person who ships things",
    "good enough shipped beats perfect waiting",
    "done is better than perfect",
    "iteration > perfection",
    "what would you regret NOT doing?",
    "the work compounds",
    "write the code, not the readme",
    "the best time was yesterday, the next best is now",
    "you've solved harder problems than this",
    "trust the process",
    "build, ship, learn, repeat"
  ],
  tasks: [],
  todayList: [],          // simple daily checklist: { id, text, done, date }
  dailyBreak: {},         // { date: 'YYYY-MM-DD', minutesUsed: number }
  dailyWork: {},          // { date: 'YYYY-MM-DD', minutesUsed: number } — cumulative work clock
  workLog: [],            // [{ date, at, reason, unfinished[] }] — End Work reasons
  activityLog: [],        // [{ at, icon, text, points }] — recent gamified events, newest first
  settings: {
    activeHoursStart: 9,
    activeHoursEnd: 22,
    overlayX: 100,
    overlayY: 100,
    overlaySize: 120,
    paused: false,
    firstRun: true
  },
  stats: {}
}

class MochiStore {
  constructor() {
    this._store = new Store({
      name: 'mochi-data',
      defaults: DEFAULTS,
      clearInvalidConfig: true
    })
    // One-time, non-destructive content seed: union the curated quote/app/site
    // lists into whatever's already saved (deduped), so existing installs pick up
    // the new content without losing custom entries or resurrecting deleted ones.
    this._seedContent()
  }

  _seedContent() {
    const settings = this.get('settings') || {}
    if (settings.seededContentV1) return
    const keys = ['quotes', 'productiveApps', 'distractionApps', 'productiveSites', 'distractionSites']
    for (const k of keys) {
      const current = this.get(k) || []
      const merged = Array.from(new Set([...current, ...(SEED[k] || [])]))
      this.set(k, merged)
    }
    this.set('settings', { ...settings, seededContentV1: true })
  }

  get(key) {
    try {
      return this._store.get(key)
    } catch {
      return undefined
    }
  }

  set(key, value) {
    try {
      this._store.set(key, value)
    } catch (err) {
      console.error('[store] set error:', key, err.message)
    }
  }

  getTodayKey() {
    return new Date().toISOString().slice(0, 10)
  }

  getTodayStats() {
    const key = this.getTodayKey()
    const stats = this.get('stats') || {}
    if (!stats[key]) {
      stats[key] = { focusMinutes: 0, distractionMinutes: 0, longestStreak: 0, currentStreak: 0 }
      this.set('stats', stats)
    }
    return stats[key]
  }

  setTodayStats(data) {
    const key = this.getTodayKey()
    const stats = this.get('stats') || {}
    stats[key] = { ...stats[key], ...data }
    this.set('stats', stats)
  }

  // Append a gamified event to the activity log (newest first, capped at 30).
  pushActivity(entry) {
    const log = this.get('activityLog') || []
    log.unshift({ at: new Date().toISOString(), ...entry })
    if (log.length > 30) log.length = 30
    this.set('activityLog', log)
  }
}

module.exports = MochiStore
