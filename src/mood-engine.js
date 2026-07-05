const { EventEmitter } = require('events')
const WindowMonitor = require('./window-monitor')

// Priority: Nagging > Sleeping > Angry > Sad > Focused > Happy > Encouraging
const MOODS = ['nagging', 'sleeping', 'angry', 'sad', 'focused', 'happy', 'encouraging']

const DISTRACTION_ESCALATE_MS = 1 * 60 * 1000  // 1 min on a blocked site → Angry
const DISTRACTION_BLOCK_MS = 5 * 60 * 1000     // 5 min on a distraction → full-screen lock-in
const DISTRACTION_GRACE_MS = 30 * 1000         // brief hops away (< this) don't reset the streak
const FOCUS_ESCALATE_MS = 10 * 60 * 1000        // 10 min → Focused
const IDLE_THRESHOLD_MS = 30 * 1000              // 30s no change → Encouraging
const MILESTONE_INTERVALS = [15, 30, 45, 60]    // minutes

class MoodEngine extends EventEmitter {
  constructor(store) {
    super()
    this.store = store
    this.currentMood = 'encouraging'
    this.paused = false

    // Internal timers and state
    this._hasNagging = false
    this._sessionState = 'idle'   // idle | working | break — only 'working' triggers reactions
    this._lastWindowInfo = null
    this._lastClassification = 'neutral'
    this._lastWindowChangeTime = Date.now()
    this._distractionSince = null    // start of the current continuous distraction segment
    this._distractionAccumMs = 0     // banked ms from earlier segments in this streak
    this._lastDistractionAt = null   // last time we saw a distraction (grace anchor)
    this._blockEmitted = false
    this._focusStartTime = null
    this._distractionTimerTick = null
    this._idleTimer = null
    this._milestoneMinutes = 0
    this._nextMilestone = MILESTONE_INTERVALS[0]

    this._blockThresholdMs = DISTRACTION_BLOCK_MS

    this._startIdleTimer()
    this._startDistractionTick()
    // Compute initial mood (e.g. sleeping if outside active hours on launch)
    this.currentMood = this._computeMood()
  }

  pause() {
    this.paused = true
    // Drop in-flight focus/distraction streaks so resuming starts clean
    // (otherwise a stale distraction timer keeps escalating after resume).
    this._clearDistraction()
    this._focusStartTime = null
  }
  resume() { this.paused = false; this._recalculateMood() }

  setSessionState(state) {
    this._sessionState = state
    if (state !== 'working') {
      // Leaving work mode: stop tracking focus/distraction timers.
      this._clearDistraction()
      this._focusStartTime = null
      this._lastClassification = 'neutral'
    }
    this._recalculateMood()
  }

  onWindowChanged(windowInfo) {
    if (this.paused) return
    this._lastWindowInfo = windowInfo
    this._lastWindowChangeTime = Date.now()
    this._resetIdleTimer()

    const classification = WindowMonitor.classify(windowInfo, this.store)
    const prev = this._lastClassification
    this._lastClassification = classification

    const now = Date.now()
    if (classification === 'distraction') {
      if (!this._distractionSince) {
        // Start (or resume) a streak. A brief hop away — under the grace window —
        // keeps the accumulated time; a real absence starts from zero. This makes
        // the 5-min blocker reliable: tab flickers, quick alt-tabs, and clicking
        // Mochi herself no longer zero the countdown.
        if (!this._lastDistractionAt || now - this._lastDistractionAt > DISTRACTION_GRACE_MS) {
          this._distractionAccumMs = 0
          this._blockEmitted = false
        }
        this._distractionSince = now
      }
      this._lastDistractionAt = now
      this._focusStartTime = null
    } else if (classification === 'productive') {
      if (prev !== 'productive') {
        // Fresh focus streak → restart milestone tracking
        this._focusStartTime = now
        this._nextMilestone = MILESTONE_INTERVALS[0]
        this._milestoneMinutes = 0
      }
      this._pauseDistractionSegment()
    } else {
      // neutral
      this._focusStartTime = null
      this._pauseDistractionSegment()
    }

    this._recalculateMood()
  }

  setNagging(hasOverdue) {
    this._hasNagging = hasOverdue
    this._recalculateMood()
  }

  // Escalating strikes: main lowers the blocker threshold after each block today.
  setBlockThreshold(ms) {
    this._blockThresholdMs = Math.max(10_000, ms)
  }

  // Called when the user dismisses the full-screen blocker: restart the 5-min
  // countdown so it doesn't instantly re-fire, but keep tracking (re-blocks if they stay).
  resetDistraction() {
    this._distractionAccumMs = 0
    this._distractionSince = this._lastClassification === 'distraction' ? Date.now() : null
    this._lastDistractionAt = this._distractionSince
    this._blockEmitted = false
    this.emit('distraction-timer', 0)
  }

  // Total distraction time in the current streak (banked + live segment).
  _distractionElapsedMs() {
    let ms = this._distractionAccumMs
    if (this._distractionSince) ms += Date.now() - this._distractionSince
    return ms
  }

  // Leaving a distraction: bank the live segment (grace may resume it) and hide the timer.
  _pauseDistractionSegment() {
    if (this._distractionSince) {
      this._distractionAccumMs += Date.now() - this._distractionSince
      this._distractionSince = null
      // Grace is measured from when the user LEFT the distraction, not when the
      // streak started — anchor it here or the expiry check fires mid-blip.
      this._lastDistractionAt = Date.now()
      this.emit('distraction-timer', 0)
    }
  }

  _clearDistraction() {
    this._distractionSince = null
    this._distractionAccumMs = 0
    this._lastDistractionAt = null
    this._blockEmitted = false
  }

  _recalculateMood() {
    const mood = this._computeMood()
    if (mood !== this.currentMood) {
      const prev = this.currentMood
      this.currentMood = mood
      this.emit('mood-transition', { mood, prevMood: prev, classification: this._lastClassification })
    }
  }

  _computeMood() {
    // Outside an active work session, Mochi is calm and never nags — and sleeps
    // outside the user's focus hours.
    if (this._sessionState === 'idle') return this._isAsleep() ? 'sleeping' : 'encouraging'
    if (this._sessionState === 'break') return 'happy'

    if (this._hasNagging) return 'nagging'

    if (this._lastClassification === 'distraction' && (this._distractionSince || this._distractionAccumMs > 0)) {
      if (this._distractionElapsedMs() >= DISTRACTION_ESCALATE_MS) return 'angry'
      return 'sad'
    }

    if (this._lastClassification === 'productive' && this._focusStartTime) {
      const elapsed = Date.now() - this._focusStartTime
      if (elapsed >= FOCUS_ESCALATE_MS) return 'focused'
      return 'happy'
    }

    return 'encouraging'
  }

  // Asleep when the current hour is outside the user's focus hours.
  _isAsleep() {
    const s = this.store.get('settings') || {}
    const start = Number.isFinite(s.activeHoursStart) ? s.activeHoursStart : 9
    const end = Number.isFinite(s.activeHoursEnd) ? s.activeHoursEnd : 22
    if (start === end) return false
    const h = new Date().getHours()
    if (start < end) return h < start || h >= end          // normal daytime window
    return h >= end && h < start                            // overnight window (e.g. 22–6)
  }

  _startIdleTimer() {
    this._idleTimer = setInterval(() => {
      if (this.paused) return
      // Recalculate every few seconds so (a) neutral idle settles to a calm mood
      // and (b) sleep/wake takes effect when the focus-hours boundary passes.
      this._recalculateMood()
    }, 5000)
  }

  _resetIdleTimer() {
    // Timer keeps running; last-change-time is what matters
  }

  _startDistractionTick() {
    this._distractionTimerTick = setInterval(() => {
      if (this.paused || this._sessionState !== 'working') return

      if (this._lastClassification === 'distraction' && this._distractionSince) {
        const elapsedMs = this._distractionElapsedMs()
        this.emit('distraction-timer', Math.floor(elapsedMs / 1000))
        // Escalate sad → angry at 1 min even with no window change.
        this._recalculateMood()
        // Full-screen lock-in once past the (strike-adjustable) threshold.
        if (elapsedMs >= this._blockThresholdMs && !this._blockEmitted) {
          this._blockEmitted = true
          const info = this._lastWindowInfo || {}
          this.emit('block-site', info.windowTitle || info.processName || 'that site')
        }
      } else if (this._distractionAccumMs > 0 && this._lastDistractionAt &&
                 Date.now() - this._lastDistractionAt > DISTRACTION_GRACE_MS) {
        // Grace expired without returning to the distraction — streak is over.
        this._clearDistraction()
        this._recalculateMood()
      }

      // Focus milestones + happy → focused escalation
      if (this._lastClassification === 'productive' && this._focusStartTime) {
        const mins = Math.floor((Date.now() - this._focusStartTime) / 60000)
        if (mins >= this._nextMilestone) {
          this._milestoneMinutes = mins
          this._nextMilestone = MILESTONE_INTERVALS.find(m => m > mins) || (mins + 15)
          this.emit('milestone', `focus-${mins}`)
        }
        this._recalculateMood()
      }
    }, 1000)
  }

  getCurrentMood() { return this.currentMood }
}

module.exports = MoodEngine
