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
    // Distraction during a work session acts as an automatic break: it pauses the
    // work clock and drains the break budget. Tracked separately so we can also
    // report per-session distracted time.
    this.distracted = false
    this._distractedStartedAt = null
    this._sessionDistractedMs = 0
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
    // Live distraction drains the break budget in real time.
    if (this.distracted && this._distractedStartedAt) {
      used += (Date.now() - this._distractedStartedAt) / 60000
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
    // Work clock is frozen while distracted (distraction counts as break, not work).
    if (this.state === 'working' && !this.distracted && this.workStartedAt) {
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
    const wasIdle = this.state === 'idle'
    if (this.state === 'break') this._bankBreak()
    else if (this.state === 'working') { this._bankDistracted(); this._bankWork() } // re-entrant safety
    this.state = 'working'
    this.workStartedAt = Date.now()
    this.breakStartedAt = null
    this.distracted = false
    this._distractedStartedAt = null
    if (wasIdle) this._sessionDistractedMs = 0 // fresh session, not a resume from break
    this._emitState()
  }

  // Returns false if the daily break budget is exhausted.
  takeBreak() {
    if (this.state === 'break') return true // already on break — no-op
    if (this.getBreakUsedMinutes() >= BREAK_BUDGET_MIN) {
      this.emit('break-denied')
      return false
    }
    this._bankDistracted() // close any live distraction first
    this.distracted = false
    this._bankWork() // bank the work segment before breaking
    this.state = 'break'
    this.breakStartedAt = Date.now()
    this._emitState()
    return true
  }

  endWork() {
    if (this.state === 'break') this._bankBreak()
    else if (this.state === 'working') { this._bankDistracted(); this._bankWork() }
    this.state = 'idle'
    this.workStartedAt = null
    this.breakStartedAt = null
    this.distracted = false
    this._distractedStartedAt = null
    this._emitState()
  }

  // ── Distraction = automatic break ─────────────────────────────────
  // Called from main when the foreground classification changes during a work
  // session. While distracted: work clock pauses, break budget drains.
  setDistracted(on) {
    if (this.state !== 'working') {
      if (this.distracted) { this._bankDistracted(); this.distracted = false }
      return
    }
    if (on && !this.distracted) {
      this._bankWork()                 // freeze the work clock
      this.distracted = true
      this._distractedStartedAt = Date.now()
      this._emitState()
    } else if (!on && this.distracted) {
      this._bankDistracted()           // drain break + add to session total
      this.distracted = false
      this.workStartedAt = Date.now()  // resume the work clock
      this._emitState()
    }
  }

  _bankDistracted() {
    if (!this._distractedStartedAt) return
    const ms = Date.now() - this._distractedStartedAt
    this._sessionDistractedMs += ms
    // Distraction drains the break budget...
    const db = this.store.get('dailyBreak') || {}
    const base = db.date === this._today() ? (db.minutesUsed || 0) : 0
    this.store.set('dailyBreak', { date: this._today(), minutesUsed: base + ms / 60000 })
    // ...and accumulates a daily distracted total for the dashboard.
    const dd = this.store.get('dailyDistracted') || {}
    const dbase = dd.date === this._today() ? (dd.minutesUsed || 0) : 0
    this.store.set('dailyDistracted', { date: this._today(), minutesUsed: dbase + ms / 60000 })
    this._distractedStartedAt = null
  }

  // Distracted minutes for the current / just-ended session (incl. live segment).
  getSessionDistractedMinutes() {
    let ms = this._sessionDistractedMs
    if (this.distracted && this._distractedStartedAt) ms += Date.now() - this._distractedStartedAt
    return ms / 60000
  }

  // Total distracted minutes today (banked + any live segment).
  getDistractedTodayMinutes() {
    const dd = this.store.get('dailyDistracted') || {}
    let m = dd.date === this._today() ? (dd.minutesUsed || 0) : 0
    if (this.distracted && this._distractedStartedAt) m += (Date.now() - this._distractedStartedAt) / 60000
    return m
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
      distracted: this.distracted,
      sessionDistractedMin: Math.round(this.getSessionDistractedMinutes() * 10) / 10,
      ...extra
    }
  }

  _emitState(extra = {}) {
    this.emit('state-changed', this.getStatus(extra))
  }

  stop() {
    if (this._tick) clearInterval(this._tick)
    if (this.distracted) this._bankDistracted()
    if (this.state === 'break') this._bankBreak()
    if (this.state === 'working') this._bankWork()
  }
}

module.exports = SessionManager
