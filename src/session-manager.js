const { EventEmitter } = require('events')

const BREAK_BUDGET_MIN = 4 * 60 // 4 hours of break allowed per day

// Tracks the work/break session lifecycle.
// States: 'idle' (app open, not started) | 'working' (work clock running) | 'break'
// Distraction nagging only happens while 'working'. Break time is capped daily.
class SessionManager extends EventEmitter {
  constructor(store) {
    super()
    this.store = store
    this.state = 'idle'
    this.workStartedAt = null
    this.breakStartedAt = null
    this._tick = setInterval(() => this._onTick(), 1000)
  }

  _todayKey() {
    return new Date().toISOString().slice(0, 10)
  }

  // Break minutes already banked today, plus the current in-progress break.
  getBreakUsedMinutes() {
    const db = this.store.get('dailyBreak') || {}
    let used = db.date === this._todayKey() ? (db.minutesUsed || 0) : 0
    if (this.state === 'break' && this.breakStartedAt) {
      used += (Date.now() - this.breakStartedAt) / 60000
    }
    return used
  }

  _bankBreak() {
    if (!this.breakStartedAt) return
    const db = this.store.get('dailyBreak') || {}
    const base = db.date === this._todayKey() ? (db.minutesUsed || 0) : 0
    const total = base + (Date.now() - this.breakStartedAt) / 60000
    this.store.set('dailyBreak', { date: this._todayKey(), minutesUsed: total })
    this.breakStartedAt = null
  }

  startWork() {
    if (this.state === 'break') this._bankBreak()
    this.state = 'working'
    this.workStartedAt = Date.now()
    this.breakStartedAt = null
    this._emitState()
  }

  // Returns false if the daily break budget is exhausted.
  takeBreak() {
    if (this.getBreakUsedMinutes() >= BREAK_BUDGET_MIN) {
      this.emit('break-denied')
      return false
    }
    this.state = 'break'
    this.breakStartedAt = Date.now()
    this._emitState()
    return true
  }

  getWorkElapsedMs() {
    return this.state === 'working' && this.workStartedAt
      ? Date.now() - this.workStartedAt
      : 0
  }

  _onTick() {
    if (this.state === 'break' && this.getBreakUsedMinutes() >= BREAK_BUDGET_MIN) {
      // Budget exhausted mid-break → force back to work.
      this._bankBreak()
      this.state = 'working'
      this.workStartedAt = Date.now()
      this.emit('break-exhausted')
      this._emitState()
      return
    }
    this.emit('tick', this.getStatus())
  }

  getStatus() {
    const breakUsed = this.getBreakUsedMinutes()
    const remaining = Math.max(0, BREAK_BUDGET_MIN - breakUsed)
    return {
      state: this.state,
      workElapsedMs: this.getWorkElapsedMs(),
      breakUsedMin: breakUsed,
      breakBudgetMin: BREAK_BUDGET_MIN,
      breakRemainingMin: remaining,
      breakAllowed: remaining > 0
    }
  }

  _emitState() {
    this.emit('state-changed', this.getStatus())
  }

  stop() {
    if (this._tick) clearInterval(this._tick)
    if (this.state === 'break') this._bankBreak()
  }
}

module.exports = SessionManager
