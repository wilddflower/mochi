const { powerMonitor } = require('electron')

class SessionTracker {
  constructor(store, moodEngine) {
    this.store = store
    this.moodEngine = moodEngine
    this._currentMood = 'encouraging'
    this._moodStartTime = Date.now()
    this._currentDate = new Date().toISOString().slice(0, 10)

    // 3-trigger daily reset strategy
    setInterval(() => this.checkDateRollover(), 60_000)
    try {
      powerMonitor.on('resume', () => this.checkDateRollover())
    } catch {
      // powerMonitor may not be available in tests
    }
  }

  checkDateRollover() {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this._currentDate) {
      this._currentDate = today
      this._resetDailyStats()
    }
  }

  _resetDailyStats() {
    this.store.setTodayStats({
      focusMinutes: 0,
      distractionMinutes: 0,
      longestStreak: 0,
      currentStreak: 0
    })
  }

  onMoodChange(newMood) {
    const elapsed = (Date.now() - this._moodStartTime) / 60000 // minutes

    const stats = this.store.getTodayStats()

    if (this._currentMood === 'happy' || this._currentMood === 'focused') {
      const added = stats.focusMinutes + elapsed
      let streak = stats.currentStreak + elapsed
      const longest = Math.max(stats.longestStreak, streak)
      this.store.setTodayStats({ focusMinutes: added, currentStreak: streak, longestStreak: longest })
    } else if (this._currentMood === 'sad' || this._currentMood === 'angry') {
      const added = stats.distractionMinutes + elapsed
      this.store.setTodayStats({ distractionMinutes: added })
    }

    // Reset streak when entering any distraction state
    if (newMood === 'sad' || newMood === 'angry') {
      this.store.setTodayStats({ currentStreak: 0 })
    }

    this._currentMood = newMood
    this._moodStartTime = Date.now()
  }

  getTodayStats() {
    const stats = this.store.getTodayStats()
    return {
      ...stats,
      focusMinutes: Math.round(stats.focusMinutes),
      distractionMinutes: Math.round(stats.distractionMinutes)
    }
  }
}

module.exports = SessionTracker
