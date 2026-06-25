const { EventEmitter } = require('events')

const BREAK_BUDGET_MIN = 4 * 60 // 4 hours of break allowed per day

// Tracks the work/break session lifecycle.
// States: 'idle' (app open, not started) | 'working' (work clock running) | 'break'
// Distraction nagging only happens while 'working'. Break time is capped daily,
// and work time accumulates across breaks into a daily total.
class SessionManager extends EventEmitter {
  constructor(store) {
    super()
    this.store = store
    this.state = 'idle'
    this.workStartedAt = null
    this.breakStartedAt = null
    this._tick = setInterval(() => this._onTick(), 1000)
  }

  _today() {
    return this.store.getTodayKey()
  }

  // ── Break accounting ──────────────────────────────────────────────
  getBreakUsedMinutes() {
    const db = this.store.get('dailyBreak') || {}
    let used = db.date === this._today() ? (db.minutesUsed || 0) : 0
    if (this.state === 'break' && this.breakStartedAt) {
      used += (Date.now() - this.breakStartedAt) / 60000
    }
    return used
  }

  _bankBreak() {
    if (!this.breakStartedAt) return
    const db = this.store.get('dailyBreak') || {}
    const base = db.date === this._today() ? (db.minutesUsed || 0) : 0
    const total = base + (Date.now() - this.breakStartedAt) / 60000
    this.store.set('dailyBreak', { date: this._today(), minutesUsed: total })
    this.breakStartedAt = null
  }

  // ── Work accounting (cumulative for the day) ──────────────────────
  getWorkUsedMinutes() {
    const dw = this.store.get('dailyWork') || {}
    let used = dw.date === this._today() ? (dw.minutesUsed || 0) : 0
    if (this.state === 'working' && this.workStartedAt) {
      used += (Date.now() - this.workStartedAt) / 60000
    }
    return used
  }

  _bankWork() {
    if (!this.workStartedAt) return
    const dw = this.store.get('dailyWork') || {}
    const base = dw.date === this._today() ? (dw.minutesUsed || 0) : 0
    const total = base + (Date.now() - this.workStartedAt) / 60000
    this.store.set('dailyWork', { date: this._today(), minutesUsed: total })
    this.workStartedAt = null
  }

  // ── Transitions ───────────────────────────────────────────────────
  startWork() {
    if (this.state === 'break') this._bankBreak()
    else if (this.state === 'working') this._bankWork() // re-entrant safety
    this.state = 'working'
    this.workStartedAt = Date.now()
    this.breakStartedAt = null
    this._emitState()
  }

  // Returns false if the daily break budget is exhausted.
  takeBreak() {
    if (this.state === 'break') return true // already on break — no-op
    if (this.getBreakUsedMinutes() >= BREAK_BUDGET_MIN) {
      this.emit('break-denied')
      return false
    }
    this._bankWork() // bank the work segment before breaking
    this.state = 'break'
    this.breakStartedAt = Date.now()
    this._emitState()
    return true
  }

  _onTick() {
    if (this.state === 'break' && this.getBreakUsedMinutes() >= BREAK_BUDGET_MIN) {
      // Budget exhausted mid-break → force back to work.
      this._bankBreak()
      this.state = 'working'
      this.workStartedAt = Date.now()
      // Emit state-changed FIRST (sets working mood, skips the start quote via
      // the `forced` flag) so the break-exhausted reaction below isn't overwritten.
      this._emitState({ forced: true })
      this.emit('break-exhausted')
      return
    }
    this.emit('tick', this.getStatus())
  }

  getStatus(extra = {}) {
    const breakUsed = this.getBreakUsedMinutes()
    const remaining = Math.max(0, BREAK_BUDGET_MIN - breakUsed)
    return {
      state: this.state,
      workTodayMs: Math.round(this.getWorkUsedMinutes() * 60000),
      breakUsedMin: breakUsed,
      breakBudgetMin: BREAK_BUDGET_MIN,
      breakRemainingMin: remaining,
      breakAllowed: remaining > 0,
      ...extra
    }
  }

  _emitState(extra = {}) {
    this.emit('state-changed', this.getStatus(extra))
  }

  stop() {
    if (this._tick) clearInterval(this._tick)
    if (this.state === 'break') this._bankBreak()
    if (this.state === 'working') this._bankWork()
  }
}

module.exports = SessionManager
